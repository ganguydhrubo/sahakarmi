import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import {
  app,
  type BrowserWindow,
  type Session,
  session,
  type WebContents,
  WebContentsView,
} from "electron";
import type {
  BrowserBounds,
  BrowserControlAction,
  BrowserControlSession,
  BrowserControlState,
  BrowserTab,
  BrowserVisibilityInput,
} from "../shared/ipc";
import { ACT_DESCRIPTION } from "./browser-act";
import { persistentBrowserUrl } from "./browser-state";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";
import { isRecord } from "./protocol";

export interface BrowserHostEvents {
  changed: [tabs: BrowserTab[], activeTabId: string | null];
  controlChanged: [state: BrowserControlState];
}

interface InternalTab {
  id: string;
  view: WebContentsView;
  requestedUrl: string;
  ownerThreadId: string | null;
  ownerBotId: string | null;
  revision: number;
  /** Accessible names from the latest snapshot, by element ref (used by permission checks). */
  labels: Map<string, string>;
  queue: Promise<unknown>;
}

export interface StoredBrowserState {
  version: 1;
  activeTabId: string | null;
  tabs: Array<{
    id: string;
    url: string;
    ownerThreadId: string | null;
    ownerBotId: string | null;
  }>;
}

export interface BrowserSnapshot {
  tabId: string;
  revision: number;
  title: string;
  url: string;
  text: string;
  elements: Array<{
    ref: string;
    tag: string;
    role: string | null;
    name: string;
    disabled: boolean;
  }>;
  /** Set when the action needs a follow-up, e.g. a click that opened the page's file picker. */
  notice?: string;
}

export type BrowserAction =
  | { type: "click"; ref: string }
  | { type: "type"; ref: string; text: string; submit?: boolean }
  | { type: "key"; key: string }
  | { type: "scroll"; deltaY: number }
  | { type: "upload"; ref: string; paths: string[] }
  | { type: "back" }
  | { type: "forward" }
  | { type: "reload" };

export const SAHKARMI_BROWSER_NAMESPACE = "sahkarmi_browser";

export const BROWSER_DYNAMIC_TOOLS = [
  {
    type: "namespace",
    name: SAHKARMI_BROWSER_NAMESPACE,
    description: "Operate Sahkarmi's private, persistent local browser.",
    tools: [
      functionTool("open", "Open an HTTP(S) URL in a new tab.", {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
        additionalProperties: false,
      }),
      functionTool("list_tabs", "List the browser tabs.", emptySchema()),
      functionTool("snapshot", "Read a page and obtain current element references.", {
        type: "object",
        properties: { tabId: { type: "string" } },
        required: ["tabId"],
        additionalProperties: false,
      }),
      functionTool("act", ACT_DESCRIPTION, {
        type: "object",
        properties: {
          tabId: { type: "string" },
          revision: { type: "integer" },
          action: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: ["click", "type", "key", "scroll", "upload", "back", "forward", "reload"],
              },
              ref: { type: "string" },
              paths: { type: "array", items: { type: "string" } },
              text: { type: "string" },
              submit: { type: "boolean" },
              key: { type: "string" },
              deltaY: { type: "number" },
            },
            required: ["type"],
            additionalProperties: false,
          },
        },
        required: ["tabId", "revision", "action"],
        additionalProperties: false,
      }),
      functionTool("screenshot", "Capture the visible page as an image.", {
        type: "object",
        properties: { tabId: { type: "string" } },
        required: ["tabId"],
        additionalProperties: false,
      }),
      functionTool("close_tab", "Close a browser tab.", {
        type: "object",
        properties: { tabId: { type: "string" } },
        required: ["tabId"],
        additionalProperties: false,
      }),
    ],
  },
] as const;

/** A hidden page gets this long, this many times, to paint before its preview is taken. */
const PREVIEW_PAINT_MS = 120;
const PREVIEW_PAINT_ATTEMPTS = 12;

/** The page's picture, or null while it has not painted yet. */
async function captureIfPainted(view: WebContentsView): Promise<string | null> {
  try {
    const image = await withTimeout(view.webContents.capturePage(), 5_000, "Preview timed out.");
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}

export class BrowserHost implements CoworkerBrowser {
  static readonly CONTROL_IDLE_GRACE_MS = 1_200;
  readonly #window: BrowserWindow;
  readonly #session: Session;
  readonly #downloadsRoot: string;
  readonly #statePath: string;
  readonly #tabs = new Map<string, InternalTab>();
  readonly #listeners = new Set<(...args: BrowserHostEvents["changed"]) => void>();
  readonly #control = new BrowserControlTracker();
  readonly #reservedDownloadPaths = new Set<string>();
  #activeTabId: string | null = null;
  #visible = false;
  #bounds: BrowserBounds | null = null;
  #attachedView: WebContentsView | null = null;
  readonly #mountedViews = new Set<WebContentsView>();
  #persistQueue: Promise<void> = Promise.resolve();

  constructor(window: BrowserWindow, downloadsRoot: string, statePath: string) {
    this.#window = window;
    this.#downloadsRoot = downloadsRoot;
    this.#statePath = statePath;
    this.#session = session.fromPartition("persist:sahkarmi-browser", { cache: true });
    this.#configureSession();
  }

  async restore(): Promise<void> {
    const state = await readBrowserState(this.#statePath);
    if (state.tabs.length === 0) return;

    const tabs = state.tabs.map((stored) => {
      const tab = this.#createTab(stored.id, stored.url, stored.ownerThreadId, stored.ownerBotId);
      this.#tabs.set(tab.id, tab);
      this.#bindTabEvents(tab);
      return tab;
    });
    this.#activeTabId = this.#tabs.has(state.activeTabId ?? "")
      ? state.activeTabId
      : (tabs[0]?.id ?? null);
    this.#syncAttachedView();
    this.#emitChanged();

    for (const tab of tabs) {
      void tab.view.webContents
        .loadURL(tab.requestedUrl, browserLoadOptions())
        .catch(() => undefined);
    }
  }

  onChanged(listener: (...args: BrowserHostEvents["changed"]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onControlChanged(listener: (...args: BrowserHostEvents["controlChanged"]) => void): () => void {
    return this.#control.onChanged(listener);
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
    return [...this.#tabs.values()].map((tab) => toPublicTab(tab));
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
    const tab = this.#createTab(randomUUID(), normalizedUrl, ownerThreadId, ownerBotId);

    this.#tabs.set(tab.id, tab);
    this.#bindTabEvents(tab);
    this.#activeTabId = tab.id;
    this.#syncAttachedView();
    this.#emitChanged();
    await this.#persistState();

    try {
      await tab.view.webContents.loadURL(normalizedUrl, browserLoadOptions());
    } catch (error) {
      if (this.#tabs.get(tab.id) === tab) {
        this.#unmountView(tab.view);
        this.#tabs.delete(tab.id);
        tab.view.webContents.close();
        if (this.#activeTabId === tab.id) {
          this.#activeTabId = this.#tabs.keys().next().value ?? null;
        }
        this.#syncAttachedView();
      }
      this.#emitChanged();
      await this.#persistState();
      throw new Error(`Unable to open ${normalizedUrl}: ${String(error)}`);
    }

    return toPublicTab(tab);
  }

  async activate(tabId: string): Promise<void> {
    this.#requireTab(tabId);
    this.#activeTabId = tabId;
    this.#syncAttachedView();
    this.#emitChanged();
    await this.#persistState();
  }

  async close(tabId: string): Promise<void> {
    const tab = this.#requireTab(tabId);
    this.#unmountView(tab.view);
    this.#tabs.delete(tabId);
    tab.view.webContents.close();

    if (this.#activeTabId === tabId) {
      this.#activeTabId = this.#tabs.keys().next().value ?? null;
    }
    this.#syncAttachedView();
    this.#emitChanged();
    await this.#persistState();
  }

  async setVisible(input: BrowserVisibilityInput): Promise<void> {
    this.#visible = input.visible;
    if (input.bounds) this.#bounds = validateBounds(input.bounds);
    this.#syncAttachedView();
  }

  async snapshot(tabId: string): Promise<BrowserSnapshot> {
    return this.#enqueue(tabId, async (tab) => {
      const revision = tab.revision + 1;
      return this.#readSnapshot(tab, revision);
    });
  }

  async act(tabId: string, revision: number, action: BrowserAction): Promise<BrowserSnapshot> {
    return this.#enqueue(tabId, async (tab) => {
      if (revision !== tab.revision) {
        throw new Error("Stale browser references. Take a fresh snapshot before acting.");
      }

      // A hidden page must be painted to take input, but never over the app: it is shown with
      // only its corner pixel inside the window while the coworker acts on it.
      const restore = tab.view.getVisible() ? null : this.#showOutOfSight(tab.view);
      tab.view.webContents.focus();
      let notice: string | undefined;
      try {
        if (restore) await delay(250);
        notice = await withTimeout(
          performAction(tab.view.webContents, action),
          10_000,
          "Browser action timed out.",
        );
        await delay(50);
      } finally {
        restore?.();
      }
      // A click has already waited for the page while watching for its file picker.
      if (action.type !== "click") await delay(250);
      const nextRevision = tab.revision + 1;
      const snapshot = await this.#readSnapshot(tab, nextRevision);
      return notice ? { ...snapshot, notice } : snapshot;
    });
  }

  async screenshot(tabId: string): Promise<string> {
    return this.#enqueue(tabId, async (tab) => {
      const image = await withTimeout(
        tab.view.webContents.capturePage(),
        10_000,
        "Browser screenshot timed out.",
      );
      return image.toDataURL();
    });
  }

  /**
   * A picture of a page for the page cards. Chromium paints only pages that are on screen, so a
   * hidden page is shown for a moment with all but its corner pixel outside the window (nothing
   * covers the app), captured, and hidden again.
   */
  async preview(tabId: string): Promise<string | null> {
    return this.#enqueue(tabId, async (tab) => {
      const view = tab.view;
      if (view.getVisible()) return captureIfPainted(view);
      const restore = this.#showOutOfSight(view);
      try {
        for (let attempt = 0; attempt < PREVIEW_PAINT_ATTEMPTS; attempt += 1) {
          await delay(PREVIEW_PAINT_MS);
          const image = await captureIfPainted(view);
          if (image) return image;
        }
        return null;
      } finally {
        restore();
      }
    });
  }

  /**
   * Shows a hidden page so Chromium paints it, with all but its bottom-right corner pixel
   * outside the window, so it never covers the app. Returns a function that puts it back.
   */
  #showOutOfSight(view: WebContentsView): () => void {
    const [windowWidth, windowHeight] = this.#window.getContentSize();
    const { width, height } = view.getBounds();
    view.setBounds({ x: windowWidth - 1, y: windowHeight - 1, width, height });
    view.setVisible(true);
    view.webContents.invalidate();
    return () => this.#settleView(view, { width, height });
  }

  /** Puts a page back where it belongs after a preview or action: on the panel, or hidden. */
  #settleView(view: WebContentsView, size: { width: number; height: number }): void {
    if (this.#attachedView === view && this.#visible && this.#bounds) {
      this.#syncAttachedView();
      return;
    }
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, ...size });
  }

  handleDynamicTool(params: DynamicToolCallParams): Promise<DynamicToolResult> {
    return runBrowserTool(this, this.#control, params);
  }

  async destroy(): Promise<void> {
    try {
      await this.#persistState();
    } finally {
      for (const tab of this.#tabs.values()) {
        this.#unmountView(tab.view);
        tab.view.webContents.close();
      }
      this.#tabs.clear();
      this.#listeners.clear();
      this.#control.dispose();
    }
  }

  #createTab(
    id: string,
    requestedUrl: string,
    ownerThreadId: string | null,
    ownerBotId: string | null,
  ): InternalTab {
    const view = this.#createView();
    this.#mountView(view);
    return {
      id,
      view,
      requestedUrl,
      ownerThreadId,
      ownerBotId,
      revision: 0,
      labels: new Map(),
      queue: Promise.resolve(),
    };
  }

  #createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.#session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    view.setBackgroundColor("#0b0b0b");
    return view;
  }

  #configureSession(): void {
    const userAgent = browserUserAgent(this.#session.getUserAgent());
    this.#session.setUserAgent(userAgent, preferredBrowserLanguageCodes());
    this.#session.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: browserRequestHeaders(details.requestHeaders, userAgent, details.url),
      });
    });
    this.#session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    this.#session.setPermissionCheckHandler(() => false);
    this.#session.on("will-download", (_event, item) => {
      const safeName = basename(item.getFilename()).replace(/[^a-zA-Z0-9._ -]/g, "_");
      const downloadPath = uniqueDownloadPath(
        this.#downloadsRoot,
        safeName || `download-${Date.now()}`,
        this.#reservedDownloadPaths,
      );
      this.#reservedDownloadPaths.add(downloadPath);
      item.setSavePath(downloadPath);
      item.once("done", () => this.#reservedDownloadPaths.delete(downloadPath));
    });
  }

  #bindTabEvents(tab: InternalTab): void {
    const contents = tab.view.webContents;
    const changed = () => this.#emitChanged();
    contents.on("did-start-loading", changed);
    contents.on("did-stop-loading", changed);
    contents.on("page-title-updated", changed);
    contents.on("did-navigate", (_event, url) => {
      if (isPersistableBrowserUrl(url)) tab.requestedUrl = persistentBrowserUrl(url);
      tab.revision += 1;
      changed();
      this.#schedulePersist();
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      if (isPersistableBrowserUrl(url)) tab.requestedUrl = persistentBrowserUrl(url);
      tab.revision += 1;
      changed();
      this.#schedulePersist();
    });
    contents.on("will-navigate", (event, url) => {
      if (!isAllowedMainUrl(url)) event.preventDefault();
    });
    // Sign-in popups ("Continue with Google", OAuth consent) must stay a real popup with a
    // window.opener, in the same session, or the site never gets its result back. They open as
    // a small hardened child window; plain links that ask for a new window become a tab.
    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!isAllowedMainUrl(url)) return { action: "deny" };
      const popup = disposition === "new-window" || /popup|width=|height=/i.test(features);
      if (!popup) {
        void this.open(url, tab.ownerThreadId, tab.ownerBotId);
        return { action: "deny" };
      }
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 540,
          height: 720,
          autoHideMenuBar: true,
          title: "Sign in",
          webPreferences: {
            session: this.#session,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
          },
        },
      };
    });
  }

  async #readSnapshot(tab: InternalTab, revision: number): Promise<BrowserSnapshot> {
    const raw = await withTimeout(
      tab.view.webContents.executeJavaScript(snapshotScript(revision), true),
      10_000,
      "Browser snapshot timed out.",
    );
    if (!isRecord(raw)) throw new Error("Browser returned an invalid snapshot.");
    tab.revision = revision;
    const snapshot: BrowserSnapshot = {
      tabId: tab.id,
      revision,
      title: typeof raw.title === "string" ? raw.title.slice(0, 500) : "",
      url: typeof raw.url === "string" ? raw.url : tab.view.webContents.getURL(),
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

  /** What a browser action would touch: the element's label and the page address. */
  describeTarget(tabId: string, ref: string | null): { label: string; url: string } {
    const tab = this.#tabs.get(tabId);
    if (!tab) return { label: "", url: "" };
    return {
      label: ref ? (tab.labels.get(ref) ?? "") : "",
      url: tab.view.webContents.getURL(),
    };
  }

  #syncAttachedView(): void {
    const tab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    if (!this.#visible || !this.#bounds || !tab) {
      this.#attachedView?.setVisible(false);
      return;
    }

    if (this.#attachedView !== tab.view) {
      this.#attachedView?.setVisible(false);
      this.#mountView(tab.view);
      this.#attachedView = tab.view;
    }
    tab.view.setBounds(this.#bounds);
    tab.view.setVisible(true);
    tab.view.webContents.invalidate();
  }

  #mountView(view: WebContentsView): void {
    if (this.#mountedViews.has(view)) return;
    view.setVisible(false);
    view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
    this.#window.contentView.addChildView(view);
    this.#mountedViews.add(view);
  }

  #unmountView(view: WebContentsView): void {
    view.setVisible(false);
    if (this.#mountedViews.delete(view)) this.#window.contentView.removeChildView(view);
    if (this.#attachedView === view) this.#attachedView = null;
  }

  #requireTab(tabId: string): InternalTab {
    const tab = this.#tabs.get(tabId);
    if (!tab) throw new Error(`Unknown browser tab: ${tabId}`);
    return tab;
  }

  #enqueue<T>(tabId: string, operation: (tab: InternalTab) => Promise<T>): Promise<T> {
    const tab = this.#requireTab(tabId);
    const result = tab.queue.then(() => operation(tab));
    tab.queue = result.catch(() => undefined);
    return result;
  }

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
      tabs: [...this.#tabs.values()].map((tab) => ({
        id: tab.id,
        url: persistentBrowserUrl(currentTabUrl(tab)),
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

/** What every browser engine needs for the tools: open, read, act, capture and close tabs. */
export interface BrowserToolTarget {
  readonly activeTabId: string | null;
  listTabs(): BrowserTab[];
  open(url: string, ownerThreadId?: string | null, ownerBotId?: string | null): Promise<BrowserTab>;
  snapshot(tabId: string): Promise<BrowserSnapshot>;
  act(tabId: string, revision: number, action: BrowserAction): Promise<BrowserSnapshot>;
  screenshot(tabId: string): Promise<string>;
  close(tabId: string): Promise<void>;
}

/** The coworker browser as the rest of the app sees it, whichever engine runs it. */
export interface CoworkerBrowser extends BrowserToolTarget {
  restore(): Promise<void>;
  onChanged(listener: (...args: BrowserHostEvents["changed"]) => void): () => void;
  onControlChanged(listener: (...args: BrowserHostEvents["controlChanged"]) => void): () => void;
  getControlState(): BrowserControlState;
  endControl(threadId: string, turnId: string): void;
  clearControls(): void;
  activate(tabId: string): Promise<void>;
  setVisible(input: BrowserVisibilityInput): Promise<void>;
  handleDynamicTool(params: DynamicToolCallParams): Promise<DynamicToolResult>;
  describeTarget(tabId: string, ref: string | null): { label: string; url: string };
  /** A picture of a page for the owner's page cards; null when it cannot be taken. */
  preview(tabId: string): Promise<string | null>;
  destroy(): Promise<void>;
  /** The owner takes over (true) or hands back (false); engines that need it switch modes. */
  setHumanControl?(humanInControl: boolean): Promise<void>;
  /** A site refused to sign in inside the controlled browser; the owner should take over. */
  onSignInBlocked?(listener: (url: string) => void): () => void;
  /** The owner closed the browser window they were using during a takeover. */
  onHumanBrowserClosed?(listener: () => void): () => void;
}

/** Which coworker turn is driving the browser right now, shown on the tabs and in the chat. */
export class BrowserControlTracker {
  readonly #sessions = new Map<string, BrowserControlSession>();
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #listeners = new Set<(...args: BrowserHostEvents["controlChanged"]) => void>();

  onChanged(listener: (...args: BrowserHostEvents["controlChanged"]) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getState(): BrowserControlState {
    return {
      sessions: [...this.#sessions.values()]
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
        .map((session) => ({ ...session })),
    };
  }

  end(threadId: string, turnId: string): void {
    const id = controlSessionId(threadId, turnId);
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    if (!this.#sessions.delete(id)) return;
    this.#emit();
  }

  clear(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    if (this.#sessions.size === 0) return;
    this.#sessions.clear();
    this.#emit();
  }

  dispose(): void {
    this.clear();
    this.#listeners.clear();
  }

  begin(params: DynamicToolCallParams, args: Record<string, unknown>): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const timer = this.#timers.get(id);
    if (timer) clearTimeout(timer);
    this.#timers.delete(id);
    const previous = this.#sessions.get(id);
    this.#sessions.set(id, {
      id,
      threadId: params.threadId,
      turnId: params.turnId,
      callId: params.callId,
      tabId: typeof args.tabId === "string" ? args.tabId : null,
      action: browserControlAction(params.tool, args),
      phase: "acting",
      startedAt: previous?.startedAt ?? new Date().toISOString(),
    });
    this.#emit();
  }

  finish(params: DynamicToolCallParams): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const current = this.#sessions.get(id);
    if (!current || current.callId !== params.callId) return;
    this.#sessions.set(id, { ...current, phase: "waiting" });
    this.#emit();
    const timer = setTimeout(() => {
      this.#timers.delete(id);
      const latest = this.#sessions.get(id);
      if (!latest || latest.callId !== params.callId || latest.phase !== "waiting") return;
      this.#sessions.delete(id);
      this.#emit();
    }, BrowserHost.CONTROL_IDLE_GRACE_MS);
    timer.unref();
    this.#timers.set(id, timer);
  }

  updateTab(params: DynamicToolCallParams, tabId: string): void {
    const id = controlSessionId(params.threadId, params.turnId);
    const current = this.#sessions.get(id);
    if (!current || current.callId !== params.callId) return;
    this.#sessions.set(id, { ...current, tabId });
    this.#emit();
  }

  #emit(): void {
    const state = this.getState();
    for (const listener of this.#listeners) listener(state);
  }
}

/** Runs one sahkarmi_browser tool call against a browser engine. */
export async function runBrowserTool(
  browser: BrowserToolTarget,
  control: BrowserControlTracker,
  params: DynamicToolCallParams,
): Promise<DynamicToolResult> {
  const args = isRecord(params.arguments) ? params.arguments : {};
  control.begin(params, args);
  try {
    switch (params.tool) {
      case "open": {
        const url = requiredString(args, "url");
        const tab = await browser.open(url, params.threadId);
        control.updateTab(params, tab.id);
        return textResult({ tab });
      }
      case "list_tabs":
        return textResult({ tabs: browser.listTabs(), activeTabId: browser.activeTabId });
      case "snapshot": {
        const snapshot = await browser.snapshot(requiredString(args, "tabId"));
        return textResult(snapshot);
      }
      case "act": {
        const tabId = requiredString(args, "tabId");
        const revision = requiredNumber(args, "revision");
        const action = parseAction(args.action);
        return textResult(await browser.act(tabId, revision, action));
      }
      case "screenshot": {
        const imageUrl = await browser.screenshot(requiredString(args, "tabId"));
        return { success: true, contentItems: [{ type: "inputImage", imageUrl }] };
      }
      case "close_tab": {
        await browser.close(requiredString(args, "tabId"));
        return textResult({ closed: true });
      }
      default:
        throw new Error(`Unknown browser tool: ${params.tool}`);
    }
  } catch (error) {
    return {
      success: false,
      contentItems: [{ type: "inputText", text: String(error) }],
    };
  } finally {
    control.finish(params);
  }
}

function controlSessionId(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

function browserControlAction(tool: string, args: Record<string, unknown>): BrowserControlAction {
  switch (tool) {
    case "open":
      return "open";
    case "list_tabs":
      return "list-tabs";
    case "snapshot":
      return "snapshot";
    case "screenshot":
      return "screenshot";
    case "close_tab":
      return "close-tab";
    case "act": {
      const action = isRecord(args.action) ? args.action.type : null;
      if (
        action === "click" ||
        action === "type" ||
        action === "key" ||
        action === "scroll" ||
        action === "upload" ||
        action === "back" ||
        action === "forward" ||
        action === "reload"
      ) {
        return action;
      }
      return "snapshot";
    }
    default:
      return "snapshot";
  }
}

function functionTool(name: string, description: string, inputSchema: Record<string, unknown>) {
  return { type: "function" as const, name, description, inputSchema };
}

function emptySchema() {
  return { type: "object", properties: {}, additionalProperties: false };
}

export function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (!value) throw new Error("A browser URL is required.");
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) browser URLs are allowed.");
  }
  return url.toString();
}

function browserLoadOptions(): { extraHeaders: string } {
  return { extraHeaders: "Cache-Control: no-cache\nPragma: no-cache" };
}

function browserRequestHeaders(
  requestHeaders: Record<string, string>,
  sessionUserAgent: string,
  url?: string,
): Record<string, string> {
  const userAgent = browserUserAgent(sessionUserAgent, url);
  const headers = { ...requestHeaders };
  setRequestHeader(headers, "User-Agent", userAgent);
  setRequestHeader(headers, "Accept-Language", preferredBrowserLanguages());
  return headers;
}

/**
 * The browser's identity: Electron's own User-Agent minus the Electron and app product tokens on
 * ordinary sites. Google's sign-in pages get the honest Electron token back, as an embedded app
 * browser should send; a Chrome-looking string that does not behave like Chrome is what Google
 * answers with "This browser or app may not be secure".
 */
export function browserUserAgent(sessionUserAgent: string, url?: string): string {
  const clean = removeUserAgentProducts(sessionUserAgent, [
    "Electron",
    app.getName(),
    "Sahkarmi",
    "sahkarmi",
  ]);
  if (!url || !isGoogleSignInHost(url)) return clean;
  return clean.replace(/(Chrome\/\S+)/u, `$1 Electron/${process.versions.electron}`);
}

function isGoogleSignInHost(url: string): boolean {
  try {
    return new URL(url).hostname.replace(/\.+$/u, "") === "accounts.google.com";
  } catch {
    return false;
  }
}

function removeUserAgentProducts(userAgent: string, products: string[]): string {
  return products
    .filter(Boolean)
    .reduce(
      (current, product) =>
        current.replace(new RegExp(`\\s${escapeRegExp(product)}/[^\\s]+`, "gi"), ""),
      userAgent,
    );
}

function preferredBrowserLanguages(): string {
  return preferredBrowserLanguageCodes()
    .split(",")
    .map((language, index) =>
      index === 0 ? language : `${language};q=${Math.max(1 - index * 0.1, 0.1).toFixed(1)}`,
    )
    .join(",");
}

function preferredBrowserLanguageCodes(): string {
  const languages = app.getPreferredSystemLanguages();
  return (languages.length > 0 ? languages : [app.getLocale()]).join(",");
}

function setRequestHeader(headers: Record<string, string>, name: string, value: string): void {
  const existingName = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  if (existingName && existingName !== name) delete headers[existingName];
  headers[name] = value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readBrowserState(path: string): Promise<StoredBrowserState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<StoredBrowserState>;
    if (parsed.version !== 1) return { version: 1, activeTabId: null, tabs: [] };
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs
          .filter(isStoredBrowserTab)
          .map((tab) => ({ ...tab, url: persistentBrowserUrl(tab.url) }))
      : [];
    return {
      version: 1,
      activeTabId: typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
      tabs: tabs.filter(
        (tab, index) => tabs.findIndex((candidate) => candidate.id === tab.id) === index,
      ),
    };
  } catch (error) {
    if (isMissingFile(error) || error instanceof SyntaxError) {
      return { version: 1, activeTabId: null, tabs: [] };
    }
    throw error;
  }
}

function isStoredBrowserTab(value: unknown): value is StoredBrowserState["tabs"][number] {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.url !== "string"
  ) {
    return false;
  }
  if (value.ownerThreadId !== null && typeof value.ownerThreadId !== "string") return false;
  if (value.ownerBotId !== null && typeof value.ownerBotId !== "string") return false;
  return isPersistableBrowserUrl(value.url);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function isAllowedMainUrl(value: string): boolean {
  return value === "about:blank" || isPersistableBrowserUrl(value);
}

export function isPersistableBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateBounds(bounds: BrowserBounds): BrowserBounds {
  if (!Object.values(bounds).every(Number.isFinite)) throw new Error("Invalid browser bounds.");
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.max(x + 1, Math.ceil(bounds.x + bounds.width));
  const bottom = Math.max(y + 1, Math.ceil(bounds.y + bounds.height));
  return { x, y, width: right - x, height: bottom - y };
}

function toPublicTab(tab: InternalTab): BrowserTab {
  return {
    id: tab.id,
    title: tab.view.webContents.getTitle() || "New tab",
    url: currentTabUrl(tab),
    loading: tab.view.webContents.isLoading(),
    ownerThreadId: tab.ownerThreadId,
    ownerBotId: tab.ownerBotId,
  };
}

function currentTabUrl(tab: InternalTab): string {
  const currentUrl = tab.view.webContents.getURL();
  return isPersistableBrowserUrl(currentUrl) ? currentUrl : tab.requestedUrl;
}

export function snapshotScript(revision: number): string {
  return `(() => {
    const revision = ${revision};
    const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]')]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      })
      .slice(0, 500);
    document.querySelectorAll('[data-sahkarmi-ref]').forEach((node) => node.removeAttribute('data-sahkarmi-ref'));
    const elements = nodes.map((node, index) => {
      const ref = revision + ':' + index;
      node.setAttribute('data-sahkarmi-ref', ref);
      const secret = node instanceof HTMLInputElement && (node.type === 'password' || /one-time-code/.test(node.autocomplete));
      const name = (node.getAttribute('aria-label') || node.getAttribute('title') || node.getAttribute('placeholder') || node.innerText || (secret ? '' : node.value) || '').trim().slice(0, 500);
      return {
        ref,
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role'),
        name,
        disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
      };
    });
    return {
      title: document.title,
      url: location.href,
      text: (document.body?.innerText || '').slice(0, 100000),
      elements,
    };
  })()`;
}

/** DevTools access to a built-in browser page, while its debugger is attached. */
function electronCdp(contents: WebContents): UploadCdp {
  return {
    send: (method, params = {}) =>
      contents.debugger.sendCommand(method, params) as Promise<Record<string, unknown>>,
    subscribe: (listener) => {
      const handler = (_event: unknown, method: string, params: Record<string, unknown>) =>
        listener(method, params);
      contents.debugger.on("message", handler);
      return () => {
        contents.debugger.off("message", handler);
      };
    },
  };
}

/** Returns a notice for the coworker when the action needs a follow-up. */
async function performAction(
  contents: WebContents,
  action: BrowserAction,
): Promise<string | undefined> {
  switch (action.type) {
    case "click": {
      const point = await contents.executeJavaScript(
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
        true,
      );
      if (!isInputPoint(point)) throw new Error("Element does not have a clickable position.");
      if (point.direct === true) {
        await contents.executeJavaScript(
          `document.querySelector('[data-sahkarmi-ref=${JSON.stringify(action.ref)}]')?.click()`,
          true,
        );
        await delay(CLICK_FILE_CHOOSER_MS);
        return;
      }
      const picker = await withDevToolsDebugger(contents, () =>
        clickCatchingFilePicker(electronCdp(contents), async () => {
          await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: point.x,
            y: point.y,
          });
          await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: point.x,
            y: point.y,
            button: "left",
            clickCount: 1,
          });
          await contents.debugger.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: point.x,
            y: point.y,
            button: "left",
            clickCount: 1,
          });
        }),
      );
      return picker ? filePickerNotice(action.ref) : undefined;
    }
    case "type": {
      await contents.executeJavaScript(
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
        true,
      );
      await withDevToolsDebugger(contents, () =>
        contents.debugger.sendCommand("Input.insertText", {
          text: action.text.slice(0, 50_000),
        }),
      );
      if (action.submit) pressKey(contents, "Enter");
      return;
    }
    case "key":
      pressKey(contents, action.key);
      return;
    case "scroll":
      await contents.executeJavaScript(
        `window.scrollBy({ top: ${Math.max(-10_000, Math.min(10_000, action.deltaY))}, behavior: 'instant' })`,
        true,
      );
      return;
    case "upload": {
      const files = checkUploadFiles(action.paths);
      await withDevToolsDebugger(contents, () =>
        uploadThroughCdp(electronCdp(contents), action.ref, files),
      );
      return;
    }
    case "back":
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      return;
    case "forward":
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      return;
    case "reload":
      contents.reload();
  }
}

/** DevTools access an upload needs; both the built-in and the Chrome browser provide it. */
export interface UploadCdp {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  subscribe(listener: (method: string, params: Record<string, unknown>) => void): () => void;
}

/**
 * How long after a click its file picker can still open. A slow page on a busy computer can
 * take a few hundred ms; the wait doubles as the page's settle time after a click.
 */
export const CLICK_FILE_CHOOSER_MS = 400;

/**
 * Clicks with the page's file picker intercepted, so a coworker's click never opens a Windows
 * file dialog over the owner's screen. Returns whether a picker opened.
 */
export async function clickCatchingFilePicker(
  cdp: UploadCdp,
  click: () => Promise<void>,
): Promise<boolean> {
  let opened = false;
  let wake = () => {};
  let intercepting = false;
  const unsubscribe = cdp.subscribe((method) => {
    if (method !== "Page.fileChooserOpened") return;
    opened = true;
    wake();
  });
  try {
    try {
      await cdp.send("Page.enable");
      await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
      intercepting = true;
    } catch {
      // A page that cannot intercept still gets the plain click.
    }
    await click();
    if (intercepting && !opened) {
      await new Promise<void>((done) => {
        wake = done;
        setTimeout(done, CLICK_FILE_CHOOSER_MS);
      });
    }
    return opened;
  } finally {
    unsubscribe();
    if (intercepting) {
      await cdp
        .send("Page.setInterceptFileChooserDialog", { enabled: false })
        .catch(() => undefined);
    }
  }
}

/** Shown to the coworker, whatever tool list its runtime saved, so it knows upload exists. */
export function filePickerNotice(ref: string): string {
  return `That click opened the page's file picker. Sahkarmi kept the Windows file dialog closed, so no file is chosen yet. To attach files, call act with action {"type":"upload","ref":${JSON.stringify(ref)},"paths":["<full path of each file>"]} (upload works even if your tool list does not show it). Do not ask the owner to take over for this.`;
}

export const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_BYTES = 200_000_000;
/** How long a click may take to open the page's file picker. */
const FILE_CHOOSER_WAIT_MS = 4_000;

/** Full paths of existing files, at most 10 and 200 MB each. */
export function checkUploadFiles(paths: readonly string[]): string[] {
  if (paths.length === 0) throw new Error("paths needs at least one file.");
  if (paths.length > MAX_UPLOAD_FILES) {
    throw new Error(`Upload at most ${MAX_UPLOAD_FILES} files at a time.`);
  }
  return paths.map((raw) => {
    const path = raw.trim();
    if (!isAbsolute(path)) throw new Error(`Use the full path of the file: ${path}`);
    let info: ReturnType<typeof statSync>;
    try {
      info = statSync(path);
    } catch {
      throw new Error(`File not found: ${path}`);
    }
    if (!info.isFile()) throw new Error(`Not a file: ${path}`);
    if (info.size > MAX_UPLOAD_BYTES) throw new Error(`File is larger than 200 MB: ${path}`);
    return resolve(path);
  });
}

/**
 * Attaches local files to a page. When the reference is (or wraps) a file input, the files are
 * set on it directly. Otherwise the element is clicked with the page's file picker intercepted,
 * so no system dialog opens, and the files go into the input that picker belongs to. Setting
 * the files fires the input's change event, as a person choosing them would.
 */
export async function uploadThroughCdp(
  cdp: UploadCdp,
  ref: string,
  files: readonly string[],
): Promise<number> {
  const selector = JSON.stringify(`[data-sahkarmi-ref=${JSON.stringify(ref)}]`);
  const found = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const node = document.querySelector(${selector});
      if (!(node instanceof HTMLElement)) throw new Error('Element reference is no longer available.');
      const isFile = (el) => el instanceof HTMLInputElement && el.type === 'file';
      if (isFile(node)) return node;
      const label = node.closest('label');
      const candidates = [node.querySelector('input[type=file]'), label && label.control, label && label.querySelector('input[type=file]')];
      return candidates.find(isFile) || null;
    })()`,
    returnByValue: false,
  });
  throwIfException(found);
  const objectId = isRecord(found.result) ? found.result.objectId : undefined;
  if (typeof objectId === "string") {
    const multiple = await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "function () { return this.multiple; }",
      returnByValue: true,
    });
    const chosen =
      isRecord(multiple.result) && multiple.result.value === true ? files : files.slice(0, 1);
    await cdp.send("DOM.setFileInputFiles", { files: [...chosen], objectId });
    await cdp.send("Runtime.releaseObject", { objectId }).catch(() => undefined);
    return chosen.length;
  }

  await cdp.send("Page.enable");
  await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const opened = new Promise<Record<string, unknown>>((done, fail) => {
      timer = setTimeout(
        () =>
          fail(
            new Error(
              "Clicking that element did not open a file picker. Take a fresh snapshot and use the page's Upload, Add photo or Attach button (or its file input) as ref.",
            ),
          ),
        FILE_CHOOSER_WAIT_MS,
      );
      unsubscribe = cdp.subscribe((method, params) => {
        if (method === "Page.fileChooserOpened") done(params);
      });
    });
    opened.catch(() => undefined);
    const pointResult = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const node = document.querySelector(${selector});
        if (!(node instanceof HTMLElement)) throw new Error('Element reference is no longer available.');
        node.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = node.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()`,
      returnByValue: true,
    });
    throwIfException(pointResult);
    const point = isRecord(pointResult.result) ? pointResult.result.value : null;
    if (!isInputPoint(point)) throw new Error("Element does not have a clickable position.");
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await cdp.send(
        "Input.dispatchMouseEvent",
        type === "mouseMoved"
          ? { type, x: point.x, y: point.y }
          : { type, x: point.x, y: point.y, button: "left", clickCount: 1 },
      );
    }
    const chooser = await opened;
    const backendNodeId = chooser.backendNodeId;
    if (typeof backendNodeId !== "number") {
      throw new Error(
        "The page opened a file picker Sahkarmi cannot fill. Ask the owner to take over.",
      );
    }
    const chosen = chooser.mode === "selectMultiple" ? files : files.slice(0, 1);
    await cdp.send("DOM.setFileInputFiles", { files: [...chosen], backendNodeId });
    return chosen.length;
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
    await cdp.send("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => undefined);
  }
}

function throwIfException(response: Record<string, unknown>): void {
  const details = response.exceptionDetails;
  if (!isRecord(details)) return;
  const exception = isRecord(details.exception) ? details.exception.description : undefined;
  throw new Error(
    String(exception ?? details.text ?? "Page script failed.").replace(/^Error: /, ""),
  );
}

export function isInputPoint(value: unknown): value is { x: number; y: number; direct?: boolean } {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

async function withDevToolsDebugger<T>(
  contents: WebContents,
  operation: () => Promise<T>,
): Promise<T> {
  const attachedHere = !contents.debugger.isAttached();
  if (attachedHere) contents.debugger.attach("1.3");
  try {
    return await operation();
  } finally {
    if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
  }
}

function pressKey(contents: WebContents, key: string): void {
  if (!/^[a-zA-Z0-9+_-]{1,32}$/.test(key)) throw new Error("Invalid browser key.");
  contents.sendInputEvent({ type: "keyDown", keyCode: key });
  contents.sendInputEvent({ type: "keyUp", keyCode: key });
}

function parseAction(value: unknown): BrowserAction {
  if (!isRecord(value) || typeof value.type !== "string")
    throw new Error("Invalid browser action.");
  switch (value.type) {
    case "click":
      // A coworker whose saved tool list predates upload may send the files with a click.
      if (Array.isArray(value.paths) && value.paths.length > 0) {
        return parseAction({ ...value, type: "upload" });
      }
      return { type: "click", ref: requiredString(value, "ref") };
    case "type":
      return {
        type: "type",
        ref: requiredString(value, "ref"),
        text: requiredString(value, "text"),
        submit: value.submit === true,
      };
    case "key":
      return { type: "key", key: requiredString(value, "key") };
    case "scroll":
      return { type: "scroll", deltaY: requiredNumber(value, "deltaY") };
    case "upload": {
      const raw = Array.isArray(value.paths)
        ? value.paths
        : typeof value.path === "string"
          ? [value.path]
          : [];
      const paths = raw.filter((item): item is string => typeof item === "string" && !!item.trim());
      if (paths.length === 0) {
        throw new Error("paths is required: full paths of the files to upload.");
      }
      return { type: "upload", ref: requiredString(value, "ref"), paths };
    }
    case "back":
    case "forward":
    case "reload":
      return { type: value.type };
    default:
      throw new Error(`Unknown browser action: ${value.type}`);
  }
}

function requiredString(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== "string" || !value[key].trim()) throw new Error(`${key} is required.`);
  return value[key];
}

function requiredNumber(value: Record<string, unknown>, key: string): number {
  if (typeof value[key] !== "number" || !Number.isFinite(value[key])) {
    throw new Error(`${key} must be a number.`);
  }
  return value[key];
}

export function isSnapshotElement(value: unknown): value is BrowserSnapshot["elements"][number] {
  return (
    isRecord(value) &&
    typeof value.ref === "string" &&
    typeof value.tag === "string" &&
    (typeof value.role === "string" || value.role === null) &&
    typeof value.name === "string" &&
    typeof value.disabled === "boolean"
  );
}

function textResult(value: unknown): DynamicToolResult {
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify(value) }],
  };
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function uniqueDownloadPath(root: string, name: string, reserved: Set<string>): string {
  const extension = extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = join(root, suffix === 1 ? name : `${stem} (${suffix})${extension}`);
    if (!reserved.has(candidate) && !existsSync(candidate)) return candidate;
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
