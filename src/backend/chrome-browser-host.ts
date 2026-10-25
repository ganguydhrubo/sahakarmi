import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { type BrowserWindow, WebContentsView } from "electron";
import type {
  BrowserBounds,
  BrowserControlState,
  BrowserTab,
  BrowserVisibilityInput,
} from "../shared/ipc";
import {
  type BrowserAction,
  BrowserControlTracker,
  type BrowserHostEvents,
  type BrowserSnapshot,
  type CoworkerBrowser,
  delay,
  isInputPoint,
  isPersistableBrowserUrl,
  isSnapshotElement,
  normalizeBrowserUrl,
  readBrowserState,
  runBrowserTool,
  type StoredBrowserState,
  snapshotScript,
  validateBounds,
  withTimeout,
} from "./browser-host";
import { persistentBrowserUrl } from "./browser-state";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";
import { isRecord } from "./protocol";

/** A Chrome or Edge installed on this computer. */
export interface InstalledBrowser {
  name: "Chrome" | "Edge";
  executable: string;
}

/**
 * Finds the real Chrome (preferred) or Microsoft Edge on this computer. Sites treat these as the
 * ordinary browsers they are, unlike a browser embedded in an app.
 */
export function findInstalledBrowser(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): InstalledBrowser | null {
  const candidates: InstalledBrowser[] = [];
  if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
      (root): root is string => Boolean(root),
    );
    for (const root of roots) {
      candidates.push({
        name: "Chrome",
        executable: join(root, "Google", "Chrome", "Application", "chrome.exe"),
      });
    }
    for (const root of roots) {
      candidates.push({
        name: "Edge",
        executable: join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      });
    }
  } else if (platform === "darwin") {
    candidates.push(
      {
        name: "Chrome",
        executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      },
      {
        name: "Edge",
        executable: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      },
    );
  } else {
    for (const path of ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"]) {
      candidates.push({ name: "Chrome", executable: path });
    }
    for (const path of ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"]) {
      candidates.push({ name: "Edge", executable: path });
    }
  }
  return candidates.find((candidate) => exists(candidate.executable)) ?? null;
}

/**
 * Google refuses sign-in in any browser that is being remote-controlled and sends it here. The
 * owner then signs in in the same profile with nothing attached, which Google accepts.
 */
export function isBlockedSignInUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "accounts.google.com" && /\/signin\/rejected\b/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Where to send the owner to sign in again after a blocked attempt. */
export function signInRetryUrl(blockedUrl: string): string {
  try {
    const target = new URL(blockedUrl).searchParams.get("continue");
    if (target && isPersistableBrowserUrl(target)) {
      return `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(target)}`;
    }
  } catch {
    // fall through
  }
  return "https://accounts.google.com/";
}

/** Chrome flags while coworkers drive it: keep background tabs and windows fully alive. */
export function agentBrowserArguments(profileDir: string): string[] {
  return [
    "--remote-debugging-pipe",
    ...commonBrowserArguments(profileDir),
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "about:blank",
  ];
}

/** Chrome flags while the owner uses it: an ordinary browser, nothing attached. */
export function humanBrowserArguments(profileDir: string, urls: string[]): string[] {
  return [...commonBrowserArguments(profileDir), "--start-maximized", ...urls];
}

function commonBrowserArguments(profileDir: string): string[] {
  return [
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble",
  ];
}

interface WindowBounds {
  width?: number;
  height?: number;
  windowState?: string;
}

interface ChromeTab {
  id: string;
  targetId: string | null;
  sessionId: string | null;
  url: string;
  title: string;
  loading: boolean;
  ownerThreadId: string | null;
  ownerBotId: string | null;
  revision: number;
  labels: Map<string, string>;
  queue: Promise<unknown>;
  ready: Promise<void> | null;
}

type CdpListener = (method: string, params: Record<string, unknown>, sessionId?: string) => void;

/** The DevTools protocol over Chrome's --remote-debugging-pipe (no network port is opened). */
class CdpPipe {
  readonly process: ChildProcess;
  readonly closed: Promise<void>;
  #nextId = 0;
  #buffer = Buffer.alloc(0);
  #isClosed = false;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly #listeners = new Set<CdpListener>();

  constructor(executable: string, args: string[]) {
    this.process = spawn(executable, args, {
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
      windowsHide: false,
    });
    const output = this.process.stdio[4];
    output?.on("data", (chunk: Buffer) => this.#read(chunk));
    this.closed = new Promise((resolve) => {
      const finish = () => {
        if (this.#isClosed) return;
        this.#isClosed = true;
        for (const pending of this.#pending.values()) {
          pending.reject(new Error("The browser was closed."));
        }
        this.#pending.clear();
        resolve();
      };
      this.process.once("exit", finish);
      this.process.once("error", finish);
      output?.once("close", finish);
    });
  }

  get isClosed(): boolean {
    return this.#isClosed;
  }

  on(listener: CdpListener): void {
    this.#listeners.add(listener);
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string | null,
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.#isClosed) return Promise.reject(new Error("The browser was closed."));
    const id = ++this.#nextId;
    const message = JSON.stringify(
      sessionId ? { id, method, params, sessionId } : { id, method, params },
    );
    const result = new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
    (this.process.stdio[3] as Writable | null)?.write(`${message}\0`);
    return withTimeout(result, timeoutMs, `Browser did not answer ${method}.`).finally(() =>
      this.#pending.delete(id),
    );
  }

  #read(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (let end = this.#buffer.indexOf(0); end >= 0; end = this.#buffer.indexOf(0)) {
      const raw = this.#buffer.subarray(0, end).toString("utf8");
      this.#buffer = this.#buffer.subarray(end + 1);
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isRecord(message)) continue;
      if (typeof message.id === "number") {
        const pending = this.#pending.get(message.id);
        if (!pending) continue;
        if (isRecord(message.error)) {
          pending.reject(new Error(String(message.error.message ?? "Browser command failed.")));
        } else {
          pending.resolve(isRecord(message.result) ? message.result : {});
        }
      } else if (typeof message.method === "string") {
        const params = isRecord(message.params) ? message.params : {};
        const sessionId = typeof message.sessionId === "string" ? message.sessionId : undefined;
        for (const listener of this.#listeners) listener(message.method, params, sessionId);
      }
    }
  }
}

/**
 * The coworker browser running in the real Chrome (or Edge) installed on the computer, in its own
 * Sahkarmi profile. Coworkers drive it over the DevTools pipe; when the owner takes over, the same
 * profile reopens as a plain browser with nothing attached, so every site's sign-in works. The
 * side panel shows a live view of the active tab; clicking it brings the Chrome window forward.
 */
export class ChromeBrowserHost implements CoworkerBrowser {
  readonly #window: BrowserWindow;
  readonly #browser: InstalledBrowser;
  readonly #profileDir: string;
  readonly #downloadsRoot: string;
  readonly #statePath: string;
  readonly #tabs = new Map<string, ChromeTab>();
  readonly #control = new BrowserControlTracker();
  readonly #listeners = new Set<(...args: BrowserHostEvents["changed"]) => void>();
  readonly #signInBlockedListeners = new Set<(url: string) => void>();
  readonly #humanClosedListeners = new Set<() => void>();
  readonly #closingTargets = new Set<string>();
  #activeTabId: string | null = null;
  #pipe: CdpPipe | null = null;
  #launching: Promise<CdpPipe> | null = null;
  #creatingTargets = 0;
  #humanInControl = false;
  #humanProcess: ChildProcess | null = null;
  #modeChange: Promise<void> = Promise.resolve();
  #destroyed = false;
  #persistQueue: Promise<void> = Promise.resolve();
  #preview: WebContentsView | null = null;
  #previewMounted = false;
  #visible = false;
  #bounds: BrowserBounds | null = null;
  #screencastSession: string | null = null;
  #framePending = false;
  #fitTimer: NodeJS.Timeout | null = null;

  constructor(
    window: BrowserWindow,
    browser: InstalledBrowser,
    profileDir: string,
    downloadsRoot: string,
    statePath: string,
  ) {
    this.#window = window;
    this.#browser = browser;
    this.#profileDir = profileDir;
    this.#downloadsRoot = downloadsRoot;
    this.#statePath = statePath;
  }

  get browserName(): string {
    return this.#browser.name;
  }

  async restore(): Promise<void> {
    const state = await readBrowserState(this.#statePath);
    for (const stored of state.tabs) {
      this.#tabs.set(
        stored.id,
        this.#newTab(stored.id, stored.url, stored.ownerThreadId, stored.ownerBotId),
      );
    }
    this.#activeTabId = this.#tabs.has(state.activeTabId ?? "")
      ? state.activeTabId
      : (this.#tabs.keys().next().value ?? null);
    this.#emitChanged();
  }

  onChanged(listener: (...args: BrowserHostEvents["changed"]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onControlChanged(listener: (...args: BrowserHostEvents["controlChanged"]) => void): () => void {
    return this.#control.onChanged(listener);
  }

  onSignInBlocked(listener: (url: string) => void): () => void {
    this.#signInBlockedListeners.add(listener);
    return () => this.#signInBlockedListeners.delete(listener);
  }

  onHumanBrowserClosed(listener: () => void): () => void {
    this.#humanClosedListeners.add(listener);
    return () => this.#humanClosedListeners.delete(listener);
  }

  getControlState(): BrowserControlState {
    return this.#control.getState();
  }

  endControl(threadId: string, turnId: string): void {
    this.#control.end(threadId, turnId);
  }

  clearControls(): void {
    this.#control.clear();
  }

  listTabs(): BrowserTab[] {
    return [...this.#tabs.values()].map((tab) => ({
      id: tab.id,
      title: tab.title || "New tab",
      url: tab.url,
      loading: tab.loading,
      ownerThreadId: tab.ownerThreadId,
      ownerBotId: tab.ownerBotId,
    }));
  }

  get activeTabId(): string | null {
    return this.#activeTabId;
  }

  async open(
    url: string,
    ownerThreadId: string | null = null,
    ownerBotId: string | null = null,
  ): Promise<BrowserTab> {
    const normalizedUrl = normalizeBrowserUrl(url);
    const tab = this.#newTab(randomUUID(), normalizedUrl, ownerThreadId, ownerBotId);
    this.#tabs.set(tab.id, tab);
    this.#activeTabId = tab.id;
    this.#emitChanged();
    await this.#persistState();
    if (this.#humanInControl) return this.#publicTab(tab);

    try {
      await this.#ensureTab(tab);
      await this.#waitForLoad(tab, 15_000);
      void this.#showActiveTab();
    } catch (error) {
      if (this.#tabs.get(tab.id) === tab) {
        this.#tabs.delete(tab.id);
        if (this.#activeTabId === tab.id) {
          this.#activeTabId = this.#tabs.keys().next().value ?? null;
        }
        this.#emitChanged();
        await this.#persistState();
      }
      throw new Error(`Unable to open ${normalizedUrl}: ${String(error)}`);
    }
    return this.#publicTab(tab);
  }

  async activate(tabId: string): Promise<void> {
    this.#requireTab(tabId);
    this.#activeTabId = tabId;
    this.#emitChanged();
    await this.#persistState();
    void this.#showActiveTab();
  }

  async close(tabId: string): Promise<void> {
    const tab = this.#requireTab(tabId);
    this.#tabs.delete(tabId);
    if (this.#activeTabId === tabId) {
      this.#activeTabId = this.#tabs.keys().next().value ?? null;
    }
    if (tab.targetId && this.#pipe && !this.#pipe.isClosed) {
      this.#closingTargets.add(tab.targetId);
      await this.#pipe
        .send("Target.closeTarget", { targetId: tab.targetId }, null, 5_000)
        .catch(() => undefined);
    }
    this.#emitChanged();
    await this.#persistState();
    void this.#showActiveTab();
  }

  async setVisible(input: BrowserVisibilityInput): Promise<void> {
    this.#visible = input.visible;
    if (input.bounds) this.#bounds = validateBounds(input.bounds);
    this.#syncPreview();
    if (this.#visible) {
      void this.#showActiveTab();
      this.#scheduleFitWindow();
    } else void this.#stopScreencast();
  }

  async snapshot(tabId: string): Promise<BrowserSnapshot> {
    return this.#enqueue(tabId, async (tab) => {
      await this.#ensureTab(tab);
      return this.#readSnapshot(tab, tab.revision + 1);
    });
  }

  async act(tabId: string, revision: number, action: BrowserAction): Promise<BrowserSnapshot> {
    return this.#enqueue(tabId, async (tab) => {
      if (revision !== tab.revision) {
        throw new Error("Stale browser references. Take a fresh snapshot before acting.");
      }
      const pipe = await this.#ensureTab(tab);
      await withTimeout(performCdpAction(pipe, tab, action), 10_000, "Browser action timed out.");
      await delay(300);
      return this.#readSnapshot(tab, tab.revision + 1);
    });
  }

  async screenshot(tabId: string): Promise<string> {
    return this.#enqueue(tabId, async (tab) => {
      const pipe = await this.#ensureTab(tab);
      if (tab.targetId) {
        await pipe.send("Target.activateTarget", { targetId: tab.targetId }).catch(() => undefined);
      }
      const result = await pipe.send<{ data?: string }>(
        "Page.captureScreenshot",
        { format: "png" },
        tab.sessionId,
        10_000,
      );
      if (typeof result.data !== "string") throw new Error("Browser screenshot failed.");
      return `data:image/png;base64,${result.data}`;
    });
  }

  handleDynamicTool(params: DynamicToolCallParams): Promise<DynamicToolResult> {
    return runBrowserTool(this, this.#control, params);
  }

  describeTarget(tabId: string, ref: string | null): { label: string; url: string } {
    const tab = this.#tabs.get(tabId);
    if (!tab) return { label: "", url: "" };
    return { label: ref ? (tab.labels.get(ref) ?? "") : "", url: tab.url };
  }

  /**
   * Takeover: the controlled browser closes and the same profile opens as a normal browser for
   * the owner (sign-ins, 2FA, payments). Hand back: it closes and coworkers get it again, with
   * every cookie and login the owner made.
   */
  setHumanControl(humanInControl: boolean): Promise<void> {
    this.#modeChange = this.#modeChange
      .catch(() => undefined)
      .then(() => this.#switchMode(humanInControl));
    return this.#modeChange;
  }

  async destroy(): Promise<void> {
    this.#destroyed = true;
    if (this.#fitTimer) clearTimeout(this.#fitTimer);
    try {
      await this.#persistState();
    } finally {
      this.#control.dispose();
      this.#listeners.clear();
      this.#signInBlockedListeners.clear();
      this.#humanClosedListeners.clear();
      if (this.#preview) {
        if (this.#previewMounted) this.#window.contentView.removeChildView(this.#preview);
        this.#preview.webContents.close();
        this.#preview = null;
      }
      await Promise.all([this.#closeAgent(), this.#closeHuman()]);
    }
  }

  async #switchMode(humanInControl: boolean): Promise<void> {
    if (this.#destroyed || humanInControl === this.#humanInControl) return;
    this.#humanInControl = humanInControl;
    this.#syncPreview();
    if (humanInControl) {
      await this.#closeAgent();
      await this.#launchHuman();
    } else {
      await this.#closeHuman();
      if (this.#tabs.size > 0) {
        await Promise.all([...this.#tabs.values()].map((tab) => this.#ensureTab(tab))).catch(
          (error) => console.error("Unable to reopen the coworker browser:", error),
        );
        void this.#showActiveTab();
      }
    }
  }

  #newTab(
    id: string,
    url: string,
    ownerThreadId: string | null,
    ownerBotId: string | null,
  ): ChromeTab {
    return {
      id,
      targetId: null,
      sessionId: null,
      url,
      title: "",
      loading: false,
      ownerThreadId,
      ownerBotId,
      revision: 0,
      labels: new Map(),
      queue: Promise.resolve(),
      ready: null,
    };
  }

  #publicTab(tab: ChromeTab): BrowserTab {
    return this.listTabs().find((candidate) => candidate.id === tab.id) as BrowserTab;
  }

  #requireTab(tabId: string): ChromeTab {
    const tab = this.#tabs.get(tabId);
    if (!tab) throw new Error(`Unknown browser tab: ${tabId}`);
    return tab;
  }

  #enqueue<T>(tabId: string, operation: (tab: ChromeTab) => Promise<T>): Promise<T> {
    const tab = this.#requireTab(tabId);
    const result = tab.queue.then(() => operation(tab));
    tab.queue = result.catch(() => undefined);
    return result;
  }

  /** The tab's page exists in the running controlled browser (launching it if needed). */
  async #ensureTab(tab: ChromeTab): Promise<CdpPipe> {
    const pipe = await this.#ensureAgent();
    if (tab.targetId && tab.sessionId) return pipe;
    if (!tab.ready) {
      tab.ready = (async () => {
        if (!tab.targetId) {
          this.#creatingTargets += 1;
          try {
            const created = await pipe.send<{ targetId?: string }>("Target.createTarget", {
              url: tab.url,
            });
            if (typeof created.targetId !== "string") throw new Error("No tab was created.");
            tab.targetId = created.targetId;
          } finally {
            this.#creatingTargets -= 1;
          }
        }
        await this.#attach(pipe, tab);
      })().finally(() => {
        tab.ready = null;
      });
    }
    await tab.ready;
    if (!this.#tabs.has(tab.id)) throw new Error("The browser tab was closed.");
    return pipe;
  }

  async #attach(pipe: CdpPipe, tab: ChromeTab): Promise<void> {
    const attached = await pipe.send<{ sessionId?: string }>("Target.attachToTarget", {
      targetId: tab.targetId,
      flatten: true,
    });
    if (typeof attached.sessionId !== "string") throw new Error("Unable to reach the tab.");
    tab.sessionId = attached.sessionId;
    await pipe.send("Page.enable", {}, tab.sessionId).catch(() => undefined);
    await pipe
      .send("Emulation.setFocusEmulationEnabled", { enabled: true }, tab.sessionId)
      .catch(() => undefined);
  }

  #ensureAgent(): Promise<CdpPipe> {
    if (this.#destroyed) return Promise.reject(new Error("The browser is shut down."));
    if (this.#humanInControl) {
      return Promise.reject(
        new Error("The owner is using the browser right now. Wait until they hand control back."),
      );
    }
    if (this.#pipe && !this.#pipe.isClosed) return Promise.resolve(this.#pipe);
    if (!this.#launching) {
      this.#launching = this.#launchAgent().finally(() => {
        this.#launching = null;
      });
    }
    return this.#launching;
  }

  async #launchAgent(): Promise<CdpPipe> {
    await this.#prepareProfile();
    const pipe = new CdpPipe(this.#browser.executable, agentBrowserArguments(this.#profileDir));
    const startupTargets = new Set<string>();
    let ready = false;
    pipe.on((method, params, sessionId) => {
      if (!ready && method === "Target.targetCreated" && isRecord(params.targetInfo)) {
        const targetId = params.targetInfo.targetId;
        if (typeof targetId === "string") startupTargets.add(targetId);
      }
      if (this.#pipe === pipe) this.#handleEvent(pipe, method, params, sessionId);
    });
    void pipe.closed.then(() => this.#agentClosed(pipe));
    try {
      await pipe.send("Browser.getVersion", {}, null, 20_000);
      await pipe.send("Target.setDiscoverTargets", { discover: true });
      const { targetInfos } = await pipe.send<{ targetInfos?: unknown[] }>("Target.getTargets");
      for (const info of targetInfos ?? []) {
        if (isRecord(info) && typeof info.targetId === "string") startupTargets.add(info.targetId);
      }
      await pipe
        .send("Browser.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: this.#downloadsRoot,
        })
        .catch(() => undefined);
    } catch (error) {
      pipe.process.kill();
      throw new Error(
        `Unable to start ${this.#browser.name} for the coworkers. Close any ${this.#browser.name} window of the Sahkarmi profile and try again. (${String(error)})`,
      );
    }
    this.#pipe = pipe;
    ready = true;
    const tabs = [...this.#tabs.values()];
    // Pages are created after the browser is registered, so each one reuses the same launch.
    void Promise.all(tabs.map((tab) => this.#ensureTab(tab).catch(() => undefined))).then(
      async () => {
        if (this.#tabs.size === 0 || this.#pipe !== pipe) return;
        for (const targetId of startupTargets) {
          if (this.#findTabByTarget(targetId)) continue;
          this.#closingTargets.add(targetId);
          await pipe.send("Target.closeTarget", { targetId }).catch(() => undefined);
        }
      },
    );
    return pipe;
  }

  #agentClosed(pipe: CdpPipe): void {
    if (this.#pipe !== pipe) return;
    this.#pipe = null;
    this.#screencastSession = null;
    for (const tab of this.#tabs.values()) {
      tab.targetId = null;
      tab.sessionId = null;
      tab.loading = false;
    }
    this.#closingTargets.clear();
    this.#emitChanged();
    this.#syncPreview();
  }

  #handleEvent(
    pipe: CdpPipe,
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): void {
    switch (method) {
      case "Target.targetInfoChanged": {
        const info = isRecord(params.targetInfo) ? params.targetInfo : null;
        const tab =
          info && typeof info.targetId === "string" ? this.#findTabByTarget(info.targetId) : null;
        if (!info || !tab) return;
        const url = typeof info.url === "string" ? info.url : tab.url;
        const title = typeof info.title === "string" ? info.title : tab.title;
        if (isBlockedSignInUrl(url)) {
          tab.url = signInRetryUrl(url);
          for (const listener of this.#signInBlockedListeners) listener(tab.url);
        } else if (url !== tab.url && isPersistableBrowserUrl(url)) {
          tab.url = url;
          tab.revision += 1;
          this.#schedulePersist();
        }
        tab.title = title;
        this.#emitChanged();
        return;
      }
      case "Target.targetCreated": {
        const info = isRecord(params.targetInfo) ? params.targetInfo : null;
        if (info?.type !== "page" || typeof info.targetId !== "string") return;
        const targetId = info.targetId;
        const opener =
          typeof info.openerId === "string" ? this.#findTabByTarget(info.openerId) : null;
        // Our own pages claim their target when createTarget answers; anything still unclaimed
        // shortly after is a page the site or the owner opened (popup, new tab): show it as a tab.
        setTimeout(() => this.#adoptTarget(pipe, targetId, info, opener), 400);
        return;
      }
      case "Target.targetDestroyed": {
        const targetId = typeof params.targetId === "string" ? params.targetId : null;
        if (!targetId) return;
        if (this.#closingTargets.delete(targetId)) return;
        // When the whole browser quits every page is destroyed first; keep those tabs so they
        // reopen next time. A single tab closed in the window is removed.
        setTimeout(() => {
          if (pipe.isClosed || this.#pipe !== pipe) return;
          const tab = this.#findTabByTarget(targetId);
          if (!tab) return;
          this.#tabs.delete(tab.id);
          if (this.#activeTabId === tab.id) {
            this.#activeTabId = this.#tabs.keys().next().value ?? null;
          }
          this.#emitChanged();
          this.#schedulePersist();
        }, 1_500);
        return;
      }
      case "Page.frameStartedLoading":
      case "Page.frameStoppedLoading": {
        const tab = sessionId ? this.#findTabBySession(sessionId) : null;
        if (!tab || params.frameId !== tab.targetId) return;
        tab.loading = method === "Page.frameStartedLoading";
        this.#emitChanged();
        if (!tab.loading && tab.targetId) void this.#refreshTargetInfo(pipe, tab, tab.targetId);
        return;
      }
      case "Page.javascriptDialogOpening": {
        if (!sessionId) return;
        // A dialog freezes the page for the coworkers. Plain alerts are dismissed; questions
        // ("Are you sure?") are answered no, so nothing irreversible is confirmed silently.
        const accept = params.type === "alert" || params.type === "beforeunload";
        void pipe.send("Page.handleJavaScriptDialog", { accept }, sessionId).catch(() => undefined);
        return;
      }
      case "Page.screencastFrame": {
        if (!sessionId) return;
        void pipe
          .send("Page.screencastFrameAck", { sessionId: params.sessionId }, sessionId)
          .catch(() => undefined);
        if (sessionId !== this.#screencastSession || typeof params.data !== "string") return;
        this.#pushFrame(`data:image/jpeg;base64,${params.data}`);
        return;
      }
    }
  }

  #adoptTarget(
    pipe: CdpPipe,
    targetId: string,
    info: Record<string, unknown>,
    opener: ChromeTab | null,
  ): void {
    if (this.#pipe !== pipe || pipe.isClosed || this.#findTabByTarget(targetId)) return;
    if (this.#creatingTargets > 0) {
      setTimeout(() => this.#adoptTarget(pipe, targetId, info, opener), 400);
      return;
    }
    const url =
      typeof info.url === "string" && isPersistableBrowserUrl(info.url) ? info.url : "about:blank";
    const tab = this.#newTab(
      randomUUID(),
      url,
      opener?.ownerThreadId ?? null,
      opener?.ownerBotId ?? null,
    );
    tab.targetId = targetId;
    tab.title = typeof info.title === "string" ? info.title : "";
    this.#tabs.set(tab.id, tab);
    void this.#attach(pipe, tab).catch(() => undefined);
    this.#emitChanged();
    this.#schedulePersist();
  }

  /** Page titles are not always announced; read the final one when a page finishes loading. */
  async #refreshTargetInfo(pipe: CdpPipe, tab: ChromeTab, targetId: string): Promise<void> {
    const result = await pipe
      .send<{ targetInfo?: { title?: unknown; url?: unknown } }>("Target.getTargetInfo", {
        targetId,
      })
      .catch(() => null);
    const info = result?.targetInfo;
    if (!info || tab.targetId !== targetId || !this.#tabs.has(tab.id)) return;
    if (typeof info.title === "string") tab.title = info.title;
    if (typeof info.url === "string" && isPersistableBrowserUrl(info.url) && info.url !== tab.url) {
      tab.url = info.url;
      this.#schedulePersist();
    }
    this.#emitChanged();
  }

  #findTabByTarget(targetId: string): ChromeTab | null {
    for (const tab of this.#tabs.values()) if (tab.targetId === targetId) return tab;
    return null;
  }

  #findTabBySession(sessionId: string): ChromeTab | null {
    for (const tab of this.#tabs.values()) if (tab.sessionId === sessionId) return tab;
    return null;
  }

  async #waitForLoad(tab: ChromeTab, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this.#tabs.has(tab.id)) {
      const pipe = this.#pipe;
      if (!pipe || !tab.sessionId) return;
      // A new tab starts on an already "complete" about:blank before its real page loads.
      const state = await evaluate(
        pipe,
        tab,
        "location.href === 'about:blank' ? 'blank' : document.readyState",
        3_000,
      ).catch(() => null);
      if (state === "complete") return;
      await delay(250);
    }
  }

  async #readSnapshot(tab: ChromeTab, revision: number): Promise<BrowserSnapshot> {
    const pipe = this.#pipe;
    if (!pipe) throw new Error("The browser was closed.");
    const raw = await evaluate(pipe, tab, snapshotScript(revision), 10_000);
    if (!isRecord(raw)) throw new Error("Browser returned an invalid snapshot.");
    tab.revision = revision;
    const snapshot: BrowserSnapshot = {
      tabId: tab.id,
      revision,
      title: typeof raw.title === "string" ? raw.title.slice(0, 500) : "",
      url: typeof raw.url === "string" ? raw.url : tab.url,
      text: typeof raw.text === "string" ? raw.text.slice(0, 100_000) : "",
      elements: Array.isArray(raw.elements)
        ? raw.elements.filter(isSnapshotElement).slice(0, 500)
        : [],
    };
    tab.labels = new Map(
      snapshot.elements.map((element) => [
        element.ref,
        `${element.name} ${element.role ?? ""} ${element.tag}`.trim(),
      ]),
    );
    return snapshot;
  }

  // ---- Owner takeover: the same profile as a plain browser -------------------------------------

  async #launchHuman(): Promise<void> {
    await this.#prepareProfile();
    const active = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    const urls = [
      ...(active ? [active.url] : []),
      ...[...this.#tabs.values()].filter((tab) => tab !== active).map((tab) => tab.url),
    ].filter(isPersistableBrowserUrl);
    const child = spawn(
      this.#browser.executable,
      humanBrowserArguments(this.#profileDir, urls.length > 0 ? urls : ["https://www.google.com/"]),
      { stdio: "ignore", detached: false },
    );
    this.#humanProcess = child;
    child.once("error", (error) => console.error("Unable to open the browser:", error));
    child.once("exit", () => {
      if (this.#humanProcess !== child) return;
      this.#humanProcess = null;
      if (this.#humanInControl && !this.#destroyed) {
        for (const listener of this.#humanClosedListeners) listener();
      }
    });
  }

  async #closeHuman(): Promise<void> {
    const child = this.#humanProcess;
    this.#humanProcess = null;
    if (child) await closeProcessGracefully(child);
  }

  async #closeAgent(): Promise<void> {
    const pipe = this.#pipe ?? (await this.#launching?.catch(() => null)) ?? null;
    if (!pipe) return;
    await this.#persistState().catch(() => undefined);
    await pipe.send("Browser.close", {}, null, 5_000).catch(() => undefined);
    await Promise.race([pipe.closed, delay(8_000)]);
    if (!pipe.isClosed) pipe.process.kill();
    this.#agentClosed(pipe);
  }

  /**
   * Only one browser can use a profile at a time, and a second launch would just hand its
   * arguments to the first. Close a leftover Sahkarmi-profile browser (for example from a crash)
   * and mark the profile as cleanly closed so no "Restore pages?" prompt appears.
   */
  async #prepareProfile(): Promise<void> {
    await mkdir(this.#profileDir, { recursive: true });
    await mkdir(this.#downloadsRoot, { recursive: true }).catch(() => undefined);
    await closeStrayProfileBrowsers(this.#profileDir);
    const defaultDir = join(this.#profileDir, "Default");
    const preferencesPath = join(defaultDir, "Preferences");
    let preferences: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(await readFile(preferencesPath, "utf8"));
      if (isRecord(parsed)) preferences = parsed;
    } catch {
      // first launch, or unreadable: start from the defaults below
    }
    const section = (name: string): Record<string, unknown> => {
      const value = preferences[name];
      if (isRecord(value)) return value;
      const created: Record<string, unknown> = {};
      preferences[name] = created;
      return created;
    };
    const profile = section("profile");
    profile.exit_type = "Normal";
    profile.exited_cleanly = true;
    if (typeof profile.name !== "string" || !profile.name) profile.name = "Sahkarmi";
    const download = section("download");
    download.default_directory = this.#downloadsRoot;
    download.prompt_for_download = false;
    await mkdir(defaultDir, { recursive: true });
    await writeFile(preferencesPath, JSON.stringify(preferences), "utf8").catch(() => undefined);
  }

  // ---- Live view in the side panel -------------------------------------------------------------

  #syncPreview(): void {
    if (this.#destroyed) return;
    if (!this.#visible || !this.#bounds) {
      this.#preview?.setVisible(false);
      return;
    }
    const preview = this.#ensurePreview();
    if (!this.#previewMounted) {
      this.#window.contentView.addChildView(preview);
      this.#previewMounted = true;
    }
    preview.setBounds(this.#bounds);
    preview.setVisible(true);
    const name = this.#browser.name;
    let message: string | null = null;
    if (this.#humanInControl) {
      message = `You are using ${name} now. Sign in or do what you need in the ${name} window, then click Hand back.`;
    } else if (this.#tabs.size === 0) {
      message = `Coworkers browse in ${name} on this computer. Open a page above to start.`;
    } else if (!this.#pipe) {
      message = `Opening ${name}…`;
    }
    if (message) this.#runInPreview(`window.sahkarmiMessage(${JSON.stringify(message)})`);
  }

  #ensurePreview(): WebContentsView {
    if (this.#preview) return this.#preview;
    const preview = new WebContentsView({
      webPreferences: {
        // Its own empty in-memory session: the app's content policy is for the app's own pages.
        partition: "sahkarmi-browser-preview",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    preview.setBackgroundColor("#0b0b0b");
    preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    preview.webContents.on("will-navigate", (event) => event.preventDefault());
    preview.webContents.on("console-message", (event) => {
      if (event.message === "sahkarmi:focus-browser") void this.#focusBrowserWindow();
    });
    void preview.webContents
      .loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(previewHtml(this.#browser.name))}`,
      )
      .then(() => preview.webContents.executeJavaScript(PREVIEW_SCRIPT, false))
      .then(() => this.#syncPreview())
      .catch(() => undefined);
    this.#preview = preview;
    return preview;
  }

  #runInPreview(script: string): void {
    const contents = this.#preview?.webContents;
    if (!contents || contents.isDestroyed() || contents.isLoading()) return;
    void contents.executeJavaScript(script, false).catch(() => undefined);
  }

  #pushFrame(dataUrl: string): void {
    if (!this.#visible || this.#framePending) return;
    const contents = this.#preview?.webContents;
    if (!contents || contents.isDestroyed() || contents.isLoading()) return;
    this.#framePending = true;
    void contents
      .executeJavaScript(`window.sahkarmiFrame(${JSON.stringify(dataUrl)})`, false)
      .catch(() => undefined)
      .finally(() => {
        this.#framePending = false;
      });
  }

  /** Brings the active tab forward in the browser and streams it into the panel. */
  async #showActiveTab(): Promise<void> {
    if (this.#humanInControl || this.#destroyed) return;
    const tab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    if (!tab) {
      await this.#stopScreencast();
      this.#syncPreview();
      return;
    }
    if (!this.#visible && !this.#pipe) return;
    try {
      const pipe = await this.#ensureTab(tab);
      this.#syncPreview();
      if (tab.targetId) {
        await pipe.send("Target.activateTarget", { targetId: tab.targetId }).catch(() => undefined);
      }
      if (!this.#visible) return;
      if (this.#screencastSession === tab.sessionId) return;
      await this.#stopScreencast();
      if (!tab.sessionId) return;
      const scale = this.#window.webContents.getZoomFactor() || 1;
      const width = Math.max(320, Math.round((this.#bounds?.width ?? 800) * scale * 2));
      const height = Math.max(240, Math.round((this.#bounds?.height ?? 600) * scale * 2));
      this.#screencastSession = tab.sessionId;
      await pipe.send(
        "Page.startScreencast",
        { format: "jpeg", quality: 70, maxWidth: width, maxHeight: height, everyNthFrame: 1 },
        tab.sessionId,
      );
      const still = await pipe
        .send<{ data?: string }>(
          "Page.captureScreenshot",
          { format: "jpeg", quality: 70 },
          tab.sessionId,
          5_000,
        )
        .catch(() => null);
      if (still && typeof still.data === "string")
        this.#pushFrame(`data:image/jpeg;base64,${still.data}`);
      this.#scheduleFitWindow();
    } catch (error) {
      this.#runInPreview(`window.sahkarmiMessage(${JSON.stringify(String(error))})`);
    }
  }

  async #stopScreencast(): Promise<void> {
    const sessionId = this.#screencastSession;
    this.#screencastSession = null;
    if (sessionId && this.#pipe && !this.#pipe.isClosed) {
      await this.#pipe.send("Page.stopScreencast", {}, sessionId, 3_000).catch(() => undefined);
    }
  }

  #scheduleFitWindow(): void {
    if (this.#fitTimer) clearTimeout(this.#fitTimer);
    this.#fitTimer = setTimeout(() => {
      this.#fitTimer = null;
      void this.#fitWindowToPanel().catch(() => undefined);
    }, 300);
    this.#fitTimer.unref();
  }

  /**
   * Gives the browser's page area the panel's size and shape, so the live view fills the panel
   * at full size instead of a wide window shrunk into a tall strip.
   */
  async #fitWindowToPanel(): Promise<void> {
    const pipe = this.#pipe;
    const tab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    const bounds = this.#bounds;
    if (!this.#visible || this.#humanInControl || !bounds) return;
    if (!pipe || pipe.isClosed || !tab?.targetId || !tab.sessionId) return;
    const found = await pipe.send<{ windowId?: number; bounds?: WindowBounds }>(
      "Browser.getWindowForTarget",
      { targetId: tab.targetId },
    );
    if (typeof found.windowId !== "number" || !found.bounds) return;
    if (found.bounds.windowState && found.bounds.windowState !== "normal") {
      await pipe.send("Browser.setWindowBounds", {
        windowId: found.windowId,
        bounds: { windowState: "normal" },
      });
      return this.#scheduleFitWindow();
    }
    const metrics = await pipe.send<{
      cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
    }>("Page.getLayoutMetrics", {}, tab.sessionId);
    const viewport = metrics.cssVisualViewport;
    const { width = 0, height = 0 } = found.bounds;
    if (!viewport?.clientWidth || !viewport.clientHeight || !width || !height) return;
    const targetWidth = Math.round(bounds.width + (width - viewport.clientWidth));
    const targetHeight = Math.round(bounds.height + (height - viewport.clientHeight));
    if (Math.abs(targetWidth - width) <= 4 && Math.abs(targetHeight - height) <= 4) return;
    await pipe.send("Browser.setWindowBounds", {
      windowId: found.windowId,
      bounds: { width: targetWidth, height: targetHeight },
    });
  }

  async #focusBrowserWindow(): Promise<void> {
    const pipe = this.#pipe;
    const tab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    if (!pipe || !tab?.targetId) return;
    await pipe.send("Target.activateTarget", { targetId: tab.targetId }).catch(() => undefined);
    const found = await pipe
      .send<{ windowId?: number }>("Browser.getWindowForTarget", { targetId: tab.targetId })
      .catch(() => null);
    if (typeof found?.windowId !== "number") return;
    // Minimise and restore: Windows lets a restored window come to the front.
    await pipe
      .send("Browser.setWindowBounds", {
        windowId: found.windowId,
        bounds: { windowState: "minimized" },
      })
      .catch(() => undefined);
    await pipe
      .send("Browser.setWindowBounds", {
        windowId: found.windowId,
        bounds: { windowState: "normal" },
      })
      .catch(() => undefined);
  }

  // ---- State -----------------------------------------------------------------------------------

  #emitChanged(): void {
    const tabs = this.listTabs();
    for (const listener of this.#listeners) listener(tabs, this.#activeTabId);
  }

  #schedulePersist(): void {
    void this.#persistState().catch((error) => {
      console.error("Unable to persist browser tabs:", error);
    });
  }

  #persistState(): Promise<void> {
    const state: StoredBrowserState = {
      version: 1,
      activeTabId: this.#activeTabId,
      tabs: [...this.#tabs.values()]
        .filter((tab) => isPersistableBrowserUrl(tab.url))
        .map((tab) => ({
          id: tab.id,
          url: persistentBrowserUrl(tab.url),
          ownerThreadId: tab.ownerThreadId,
          ownerBotId: tab.ownerBotId,
        })),
    };
    this.#persistQueue = this.#persistQueue
      .catch(() => undefined)
      .then(() =>
        writeFile(this.#statePath, `${JSON.stringify(state)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        }),
      );
    return this.#persistQueue;
  }
}

async function evaluate(
  pipe: CdpPipe,
  tab: ChromeTab,
  expression: string,
  timeoutMs: number,
): Promise<unknown> {
  const result = await pipe.send<{
    result?: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  }>(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true, userGesture: true },
    tab.sessionId,
    timeoutMs,
  );
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Page script failed.",
    );
  }
  return result.result?.value;
}

async function performCdpAction(
  pipe: CdpPipe,
  tab: ChromeTab,
  action: BrowserAction,
): Promise<void> {
  const sessionId = tab.sessionId;
  switch (action.type) {
    case "click": {
      const point = await evaluate(
        pipe,
        tab,
        `(() => {
          const node = document.querySelector('[data-sahkarmi-ref=${JSON.stringify(action.ref)}]');
          if (!(node instanceof HTMLElement)) throw new Error('Element reference is no longer available.');
          node.scrollIntoView({ block: 'center', inline: 'center' });
          node.focus();
          const rect = node.getBoundingClientRect();
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            direct: node instanceof HTMLAnchorElement && node.hasAttribute('download'),
          };
        })()`,
        10_000,
      );
      if (!isInputPoint(point)) throw new Error("Element does not have a clickable position.");
      if (point.direct === true) {
        await evaluate(
          pipe,
          tab,
          `document.querySelector('[data-sahkarmi-ref=${JSON.stringify(action.ref)}]')?.click()`,
          10_000,
        );
        return;
      }
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await pipe.send(
          "Input.dispatchMouseEvent",
          type === "mouseMoved"
            ? { type, x: point.x, y: point.y }
            : { type, x: point.x, y: point.y, button: "left", clickCount: 1 },
          sessionId,
        );
      }
      return;
    }
    case "type": {
      await evaluate(
        pipe,
        tab,
        `(() => {
          const node = document.querySelector('[data-sahkarmi-ref=${JSON.stringify(action.ref)}]');
          if (!(node instanceof HTMLElement)) throw new Error('Element reference is no longer available.');
          node.focus();
          if ('value' in node) {
            if (typeof node.select === 'function') node.select();
          } else if (node.isContentEditable) {
            const selection = getSelection();
            const range = document.createRange();
            range.selectNodeContents(node);
            selection?.removeAllRanges();
            selection?.addRange(range);
          } else {
            throw new Error('Element does not accept text.');
          }
        })()`,
        10_000,
      );
      await pipe.send("Input.insertText", { text: action.text.slice(0, 50_000) }, sessionId);
      if (action.submit) await pressCdpKey(pipe, sessionId, "Enter");
      return;
    }
    case "key":
      await pressCdpKey(pipe, sessionId, action.key);
      return;
    case "scroll":
      await evaluate(
        pipe,
        tab,
        `window.scrollBy({ top: ${Math.max(-10_000, Math.min(10_000, action.deltaY))}, behavior: 'instant' })`,
        10_000,
      );
      return;
    case "back":
    case "forward": {
      const history = await pipe.send<{ currentIndex?: number; entries?: Array<{ id: number }> }>(
        "Page.getNavigationHistory",
        {},
        sessionId,
      );
      const index = (history.currentIndex ?? 0) + (action.type === "back" ? -1 : 1);
      const entry = history.entries?.[index];
      if (entry) await pipe.send("Page.navigateToHistoryEntry", { entryId: entry.id }, sessionId);
      return;
    }
    case "reload":
      await pipe.send("Page.reload", {}, sessionId);
  }
}

const NAMED_KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
};

const MODIFIERS: Record<string, number> = {
  alt: 1,
  option: 1,
  ctrl: 2,
  control: 2,
  commandorcontrol: 2,
  cmdorctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

/** The DevTools key event for a key name like "Enter", "a", "Tab" or "Ctrl+A". */
export function cdpKeyEvent(input: string): {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
  text?: string;
} {
  if (!/^[a-zA-Z0-9+_-]{1,32}$/.test(input)) throw new Error("Invalid browser key.");
  const parts = input.split("+").filter(Boolean);
  const name = parts.pop() ?? "";
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part.toLowerCase()];
    if (bit === undefined) throw new Error("Invalid browser key.");
    modifiers |= bit;
  }
  const named = NAMED_KEYS[name.toLowerCase()];
  if (named) {
    return {
      key: named.key,
      code: named.code,
      windowsVirtualKeyCode: named.keyCode,
      modifiers,
      ...(named.text && modifiers === 0 ? { text: named.text } : {}),
    };
  }
  if (name.length === 1) {
    const upper = name.toUpperCase();
    const code = /[0-9]/.test(name) ? `Digit${name}` : `Key${upper}`;
    const text = modifiers & ~8 ? undefined : modifiers & 8 ? upper : name;
    return {
      key: modifiers & 8 ? upper : name,
      code,
      windowsVirtualKeyCode: upper.charCodeAt(0),
      modifiers,
      ...(text ? { text } : {}),
    };
  }
  const functionKey = /^F([1-9]|1[0-2])$/i.exec(name);
  if (functionKey) {
    const number = Number(functionKey[1]);
    return {
      key: `F${number}`,
      code: `F${number}`,
      windowsVirtualKeyCode: 111 + number,
      modifiers,
    };
  }
  throw new Error("Invalid browser key.");
}

async function pressCdpKey(pipe: CdpPipe, sessionId: string | null, input: string): Promise<void> {
  const event = cdpKeyEvent(input);
  await pipe.send(
    "Input.dispatchKeyEvent",
    { type: event.text ? "keyDown" : "rawKeyDown", ...event },
    sessionId,
  );
  const { text: _text, ...up } = event;
  await pipe.send("Input.dispatchKeyEvent", { type: "keyUp", ...up }, sessionId);
}

/** Asks a browser to close its windows normally, then forces it after a grace period. */
async function closeProcessGracefully(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(child.pid)], () => undefined);
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, delay(8_000)]);
  if (child.exitCode === null) {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => undefined);
    } else {
      child.kill("SIGKILL");
    }
    await Promise.race([exited, delay(3_000)]);
  }
}

/** Closes browsers left running on the Sahkarmi profile (never the owner's own browser). */
async function closeStrayProfileBrowsers(profileDir: string): Promise<void> {
  const lockfile = join(profileDir, "lockfile");
  const singleton = join(profileDir, "SingletonLock");
  if (process.platform === "win32") {
    if (!existsSync(lockfile)) return;
    // The lock can be removed only when no browser holds the profile.
    if (
      await rm(lockfile, { force: true }).then(
        () => true,
        () => false,
      )
    )
      return;
    const marker = profileDir.replace(/'/g, "''").replace(/([[\]*?])/g, "`$1");
    const script = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${marker}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object { $_.ProcessId }`;
    const ids = await new Promise<number[]>((resolve) => {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 15_000 },
        (_error, stdout) =>
          resolve(
            String(stdout)
              .split(/\s+/)
              .map(Number)
              .filter((id) => Number.isInteger(id) && id > 0),
          ),
      );
    });
    for (const id of ids) execFile("taskkill", ["/PID", String(id)], () => undefined);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(400);
      if (
        await rm(lockfile, { force: true }).then(
          () => true,
          () => false,
        )
      )
        return;
    }
    for (const id of ids) execFile("taskkill", ["/PID", String(id), "/T", "/F"], () => undefined);
    await delay(1_500);
    return;
  }
  if (existsSync(singleton)) {
    // On macOS/Linux the lock is a symlink "host-pid"; a dead pid means it is stale.
    await rm(singleton, { force: true }).catch(() => undefined);
  }
}

function previewHtml(browserName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0b0b0b;color:#e8e8e8;font:14px/1.45 system-ui,sans-serif;overflow:hidden;cursor:pointer;user-select:none}
  #frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:top center;display:none}
  #message{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}
  #hint{position:absolute;left:8px;bottom:8px;background:rgba(0,0,0,.72);color:#fff;padding:5px 9px;border-radius:7px;font-size:12px;display:none}
  </style></head><body>
  <img id="frame" alt="">
  <div id="message">Opening ${browserName}…</div>
  <div id="hint">Live view of ${browserName} · click to open the ${browserName} window</div>
  </body></html>`;
}

/** Installed from the main process: page scripts in the preview are not needed or trusted. */
const PREVIEW_SCRIPT = `(() => {
  if (window.sahkarmiFrame) return;
  const frame = document.getElementById('frame');
  const message = document.getElementById('message');
  const hint = document.getElementById('hint');
  window.sahkarmiFrame = (src) => { frame.src = src; frame.style.display = 'block'; hint.style.display = 'block'; message.style.display = 'none'; };
  window.sahkarmiMessage = (text) => { frame.style.display = 'none'; hint.style.display = 'none'; message.style.display = 'flex'; message.textContent = text; };
  document.addEventListener('click', () => console.log('sahkarmi:focus-browser'));
})()`;
