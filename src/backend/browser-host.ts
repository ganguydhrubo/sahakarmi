import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
  app,
  type BrowserWindow,
  clipboard,
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
  SocialPlatform,
} from "../shared/ipc";
import { ACT_DESCRIPTION, SCREENSHOT_DESCRIPTION, SNAPSHOT_DESCRIPTION } from "./browser-act";
import { type CdpSend, pasteEventScript, pressCdpKey, typeIntoFocus } from "./browser-keys";
import {
  pagesOverBudget,
  restingSiteMessage,
  SiteCrashGuard,
  siteOfPage,
} from "./browser-guards";
import { persistentBrowserUrl } from "./browser-state";
import { readMemory } from "./memory-pressure";
import type { DynamicToolCallParams, DynamicToolResult } from "./protocol";
import { isRecord } from "./protocol";
import {
  ACCOUNT_COOKIES,
  linkedinAccountFromRedirect,
  siteOfHost,
  siteOfUrl,
} from "./publishing-accounts";

export interface BrowserHostEvents {
  changed: [tabs: BrowserTab[], activeTabId: string | null];
  controlChanged: [state: BrowserControlState];
}

interface InternalTab {
  id: string;
  /**
   * The live page, or null while the tab sleeps. A sleeping tab keeps its address and title and
   * loads again when it is shown or a coworker uses it. Sign-ins live in the shared session, not
   * in the page, so sleeping never signs anyone out.
   */
  view: WebContentsView | null;
  requestedUrl: string;
  /** Last known title, shown while the tab sleeps. */
  title: string;
  /** When the owner or a coworker last used this tab (ms). Idle tabs go to sleep. */
  lastUsed: number;
  /** When the live page was created (ms); a coworker waits for a page that is still loading. */
  liveSince: number;
  /** The owner typed here since the page loaded; the tab never sleeps over their unsaved work. */
  ownerTyped: boolean;
  /** Tabs opened by links in this tab during the current coworker action (target="_blank"). */
  openedTabs: string[];
  /** Coworker operations running on this tab; a busy tab never sleeps. */
  busy: number;
  /** Muted by Sahkarmi while the app window was hidden; unmuted when it shows again. */
  mutedWhileHidden?: boolean;
  ownerThreadId: string | null;
  ownerBotId: string | null;
  revision: number;
  /** Accessible names from the latest snapshot, by element ref (used by permission checks). */
  labels: Map<string, string>;
  queue: Promise<unknown>;
  /** A coworker changed this site in another tab, so this page may show old data. */
  stale: boolean;
  /** The owner pressed a key or clicked here since it went stale; never reload over their work. */
  ownerTouched: boolean;
  /** A coworker typed here since the page loaded; reloading would wipe its unsaved work. */
  coworkerTyped: boolean;
  /** The page is an error (HTTP 400 or more, or it failed to load); reloading never helps. */
  loadFailed: boolean;
  /** When Sahkarmi last reloaded this tab by itself (ms), so it never reloads in a loop. */
  lastAutoReload: number;
}

/** Actions that can change what a site stores (a scroll or a back never does). */
const CHANGING_ACTIONS = new Set<BrowserAction["type"]>([
  "click",
  "type",
  "key",
  "paste",
  "upload",
]);
const OWNER_INPUT = new Set(["mouseDown", "keyDown", "rawKeyDown", "char"]);
/** Actions that leave unsaved input in the page. */
const TYPING_ACTIONS = new Set<BrowserAction["type"]>(["type", "key", "paste", "upload"]);

/**
 * How long to wait before reloading an out-of-date tab: null when it must not be reloaded at
 * all (the owner or a coworker has unsaved input there, or it is an error page), otherwise the
 * milliseconds left until the tab may be reloaded again.
 */
export function staleReloadDelay(
  tab: {
    stale: boolean;
    ownerTouched: boolean;
    /** Keys the owner typed since the page loaded, even before the coworker's change. */
    ownerTyped?: boolean;
    coworkerTyped: boolean;
    loadFailed: boolean;
    lastAutoReload: number;
  },
  now: number,
  minimumGapMs: number,
): number | null {
  if (!tab.stale || tab.ownerTouched || tab.ownerTyped || tab.coworkerTyped || tab.loadFailed) {
    return null;
  }
  return Math.max(0, tab.lastAutoReload + minimumGapMs - now);
}

/**
 * Tabs that show the same site as the tab a coworker just changed. Their page was loaded
 * before the change, so it is out of date (a draft saved in one tab is not in the other).
 * Only the same coworker's tabs: another coworker's browser is signed in separately (often as
 * another account), so its pages are never reloaded because of a colleague's work.
 */
export function sameSiteTabIds(
  tabs: Array<{ id: string; url: string; ownerBotId?: string | null }>,
  actedTabId: string,
  actedUrl: string,
  actedOwnerBotId?: string | null,
): string[] {
  const origin = webOrigin(actedUrl);
  if (!origin) return [];
  return tabs
    .filter(
      (tab) =>
        tab.id !== actedTabId &&
        webOrigin(tab.url) === origin &&
        (actedOwnerBotId === undefined || (tab.ownerBotId ?? null) === actedOwnerBotId),
    )
    .map((tab) => tab.id);
}

/**
 * The tab the browser panel may show to the owner while they look at one coworker: the
 * selected tab when it is that coworker's, otherwise that coworker's most recently used tab,
 * otherwise none (the panel stays empty rather than showing a colleague's page).
 * `viewer` undefined means nobody in particular is looking (the old behaviour).
 */
export function tabForViewer(
  tabs: Array<{
    id: string;
    ownerBotId: string | null;
    ownerThreadId: string | null;
    lastUsed: number;
  }>,
  activeTabId: string | null,
  viewer: { botId: string | null; threadId: string | null } | undefined,
): string | null {
  if (!viewer) return activeTabId;
  const visible = (tab: (typeof tabs)[number]) =>
    tab.ownerBotId
      ? tab.ownerBotId === viewer.botId
      : Boolean(viewer.threadId && tab.ownerThreadId === viewer.threadId);
  const active = tabs.find((tab) => tab.id === activeTabId);
  if (active && visible(active)) return active.id;
  let best: (typeof tabs)[number] | null = null;
  for (const tab of tabs) {
    if (visible(tab) && (!best || tab.lastUsed > best.lastUsed)) best = tab;
  }
  return best?.id ?? null;
}

function webOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

interface StoredBrowserTab {
  id: string;
  url: string;
  ownerThreadId: string | null;
  ownerBotId: string | null;
}

export interface StoredBrowserState {
  version: 1;
  activeTabId: string | null;
  tabs: StoredBrowserTab[];
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

/** What an action returns unless the coworker asks for a snapshot: enough to pick the next step. */
export interface BrowserActStatus {
  tabId: string;
  revision: number;
  title: string;
  url: string;
  /** The address changed, so this is a different page. */
  navigated: boolean;
  /** The page is still loading; a snapshot a moment later sees more. */
  loading: boolean;
  /** Whether refs from the last snapshot still work, or the page was replaced. */
  refs: "valid" | "stale";
  /** The focused element, so typing without a ref goes to a known place. */
  focus: string | null;
  notice?: string;
}

export interface BrowserActOptions {
  /** true: read the page and new refs in the same call. false: a short status only. */
  snapshot?: boolean;
}

/** A tab's ref bookkeeping, shared by both browser engines. */
interface RefTab {
  id: string;
  revision: number;
  labels: Map<string, string>;
}

export type BrowserAction =
  | { type: "click"; ref: string }
  /** Without a ref, types into whatever has focus (e.g. a spreadsheet cell). */
  | { type: "type"; ref?: string; text: string; submit?: boolean }
  | { type: "key"; key: string }
  /** Pastes text (or what is already on the clipboard) into whatever has focus. */
  | { type: "paste"; text?: string }
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
      functionTool("snapshot", SNAPSHOT_DESCRIPTION, {
        type: "object",
        properties: { tabId: { type: "string" }, offset: { type: "integer", minimum: 0 } },
        required: ["tabId"],
        additionalProperties: false,
      }),
      functionTool("act", ACT_DESCRIPTION, {
        type: "object",
        properties: {
          tabId: { type: "string" },
          revision: { type: "integer" },
          snapshot: { type: "boolean" },
          action: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "click",
                  "type",
                  "key",
                  "paste",
                  "scroll",
                  "upload",
                  "back",
                  "forward",
                  "reload",
                ],
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
      functionTool("screenshot", SCREENSHOT_DESCRIPTION, {
        type: "object",
        properties: { tabId: { type: "string" }, ref: { type: "string" } },
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
const PREVIEW_WIDTH = 480;
const PREVIEW_JPEG_QUALITY = 70;
/**
 * A coworker's screenshot: at most this wide, as JPEG. A full-size PNG of a large page took
 * a long encode on the main thread and several MB for the model to read.
 */
const SCREENSHOT_MAX_WIDTH = 1280;
const SCREENSHOT_JPEG_QUALITY = 80;

/** A screenshot as the model gets it: resized to SCREENSHOT_MAX_WIDTH, JPEG. */
/**
 * `cssWidth` is the page's (or element's) width in CSS pixels. Captures come in screen pixels,
 * 1.25-2x larger on scaled Windows displays; scaling back to CSS size makes the picture lighter
 * for the model and its coordinates match the page's.
 */
export function screenshotDataUrl(image: Electron.NativeImage, cssWidth?: number): string {
  const width =
    cssWidth && Number.isFinite(cssWidth) && cssWidth >= 1
      ? Math.min(SCREENSHOT_MAX_WIDTH, Math.round(cssWidth))
      : SCREENSHOT_MAX_WIDTH;
  const small = image.getSize().width > width ? image.resize({ width, quality: "good" }) : image;
  return `data:image/jpeg;base64,${small.toJPEG(SCREENSHOT_JPEG_QUALITY).toString("base64")}`;
}
/** Pages change their title and loading state many times a second; the app hears at most this often. */
const CHANGE_EVENT_MIN_MS = 250;
const PERSIST_DELAY_MS = 500;
const PREVIEW_PAINT_ATTEMPTS = 12;
/** A coworker waits at most this long for a page that just woke up or opened to load. */
const FIRST_LOAD_WAIT_MS = 15_000;

/** The page's picture, or null while it has not painted yet. */
async function captureIfPainted(view: WebContentsView): Promise<string | null> {
  try {
    const image = await withTimeout(view.webContents.capturePage(), 5_000, "Preview timed out.");
    if (image.isEmpty()) return null;
    // A page card is small. A full-size PNG is encoded on the main thread and blocks the whole app.
    const small =
      image.getSize().width > PREVIEW_WIDTH ? image.resize({ width: PREVIEW_WIDTH }) : image;
    return `data:image/jpeg;base64,${small.toJPEG(PREVIEW_JPEG_QUALITY).toString("base64")}`;
  } catch {
    return null;
  }
}

const SHARED_PARTITION = "persist:sahkarmi-browser";
const SIGN_IN_SPLIT_MARKER = "browser-signins-split.json";
/** Session cookies are kept this long past their last change (a site's own expiry wins sooner). */
export const KEPT_SESSION_COOKIE_DAYS = 30;
const COOKIE_KEEP_DELAY_MS = 1_000;

/**
 * The same cookie stored with an expiry, so it survives a restart; null for a cookie that is
 * persistent already or has no usable host.
 */
export function keptSessionCookie(
  cookie: Pick<
    Electron.Cookie,
    | "name"
    | "value"
    | "domain"
    | "hostOnly"
    | "path"
    | "secure"
    | "httpOnly"
    | "session"
    | "sameSite"
  >,
  now: number,
): Electron.CookiesSetDetails | null {
  if (!cookie.session) return null;
  const host = (cookie.domain ?? "").replace(/^\./, "");
  if (!host) return null;
  return {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: Math.floor(now / 1000) + KEPT_SESSION_COOKIE_DAYS * 24 * 60 * 60,
  };
}

/**
 * Which one coworker receives each site's sign-in when the old shared browser is split: the
 * one with the most open pages of that site, then the most recorded uses, then the first seen.
 */
export function signInKeepers(
  tabs: Array<{ botId: string; url: string }>,
  usedPages: Array<{ botId: string; url: string }>,
): Map<string, string> {
  const score = new Map<string, Map<string, number>>();
  const add = (botId: string, url: string, weight: number) => {
    const site = siteOfUrl(url);
    if (!site) return;
    const bots = score.get(site) ?? new Map<string, number>();
    bots.set(botId, (bots.get(botId) ?? 0) + weight);
    score.set(site, bots);
  };
  for (const tab of tabs) add(tab.botId, tab.url, 1_000);
  for (const used of usedPages) add(used.botId, used.url, 1);
  const keepers = new Map<string, string>();
  for (const [site, bots] of score) {
    let best: [string, number] | null = null;
    for (const entry of bots) if (!best || entry[1] > best[1]) best = entry;
    if (best) keepers.set(site, best[0]);
  }
  return keepers;
}

/** Each coworker's browser data lives in a partition of its own. */
export function browserPartition(botId: string): string {
  return `${SHARED_PARTITION}-${botId}`;
}

export interface BrowserRestoreOptions {
  /** The coworker a saved tab's chat belongs to. */
  botOfThread?: (threadId: string) => string | null;
  botIds?: string[];
  /** Pages coworkers are known to have used, besides their saved tabs. */
  usedPages?: Array<{ botId: string; url: string }>;
  /**
   * The same, read only when needed: just once, for the one-time sign-in split. Reading the
   * whole permission audit at every start delayed the window for nothing.
   */
  loadUsedPages?: () => Promise<Array<{ botId: string; url: string }>>;
}

export class BrowserHost implements CoworkerBrowser {
  static readonly CONTROL_IDLE_GRACE_MS = 1_200;
  /** How long after a coworker's last change the owner's open page of that site reloads. */
  /** Quiet time after a coworker's last change before the shown tab is reloaded. */
  static STALE_REFRESH_MS = 5_000;
  /** A tab is reloaded by itself at most this often, however busy the coworker is. */
  static STALE_MIN_GAP_MS = 30_000;
  /** A hidden tab nobody used for this long sleeps: its page is freed, the tab stays listed. */
  static IDLE_SLEEP_MS = 15 * 60_000;
  /** More pages than this are put to sleep, least recently used first. Each one is a process. */
  static MAX_AWAKE_TABS = 6;
  /** A page used more recently than this stays awake whatever the count: a coworker may be on it. */
  static AWAKE_LIMIT_IDLE_MS = 2 * 60_000;
  /** How often idle tabs are looked for. */
  static SLEEP_CHECK_MS = 60_000;
  /**
   * While the PC is short of memory: fewer pages stay awake, a page idle this long may sleep,
   * and the check runs this often. Each awake page is a renderer process of ~100-200 MB.
   */
  static PRESSURE_AWAKE_TABS = { low: 3, critical: 2 } as const;
  static PRESSURE_IDLE_MS = 20_000;
  static PRESSURE_CHECK_MS = 15_000;
  /** A browser's page cache above this size is emptied once after start (sign-ins stay). */
  static CACHE_TRIM_BYTES = 150 * 1024 * 1024;
  static CACHE_TRIM_DELAY_MS = 90_000;
  /** While the window is hidden, a page unused for this long is slowed down and muted. */
  static HIDDEN_QUIET_AFTER_MS = 2 * 60_000;
  readonly takeoverHoldsShownTabOnly = true;
  readonly #window: BrowserWindow;
  readonly #session: Session;
  readonly #botSessions = new Map<string, Session>();
  readonly #downloadsRoot: string;
  readonly #statePath: string;
  #windowHidden = false;
  /** The page on screen, hidden while the window is minimised; shown again with the window. */
  #viewHiddenWithWindow: WebContentsView | null = null;
  readonly #tabs = new Map<string, InternalTab>();
  readonly #listeners = new Set<(...args: BrowserHostEvents["changed"]) => void>();
  #changeTimer: ReturnType<typeof setTimeout> | null = null;
  #changePending = false;
  #persistTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #control = new BrowserControlTracker();
  readonly #reservedDownloadPaths = new Set<string>();
  #downloadAuthorizer: DownloadAuthorizer | null = null;
  #activeTabId: string | null = null;
  /** The owner has taken over: coworkers' new tabs open behind the tab the owner is using. */
  #ownerHolding = false;
  #visible = false;
  /** The coworker whose chat the owner is looking at; the panel shows only that coworker's pages. */
  #viewer: { botId: string | null; threadId: string | null } | undefined = undefined;
  #bounds: BrowserBounds | null = null;
  #attachedView: WebContentsView | null = null;
  readonly #mountedViews = new Set<WebContentsView>();
  #persistQueue: Promise<void> = Promise.resolve();
  #staleRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #sleepTimer: ReturnType<typeof setInterval>;
  #pressureTimer: ReturnType<typeof setTimeout> | null = null;
  #destroyed = false;
  /** Feature switches (Settings > Features); both off keep the old behaviour exactly. */
  #pageBudgetOn: () => boolean = () => false;
  #crashGuardOn: () => boolean = () => false;
  readonly #crashGuard = new SiteCrashGuard();

  constructor(window: BrowserWindow, downloadsRoot: string, statePath: string) {
    this.#window = window;
    this.#downloadsRoot = downloadsRoot;
    this.#statePath = statePath;
    this.#session = session.fromPartition(SHARED_PARTITION, { cache: true });
    this.#configureSession(this.#session);
    this.#sleepTimer = setInterval(() => this.#sleepIdleTabs(), BrowserHost.SLEEP_CHECK_MS);
    this.#sleepTimer.unref?.();
  }

  /**
   * Brings back the saved tabs asleep: only the tab on screen loads now, the rest when they are
   * opened or a coworker uses them. Loading every saved tab at once used gigabytes of memory.
   */
  async restore(options: BrowserRestoreOptions = {}): Promise<void> {
    const state = await readBrowserState(this.#statePath);
    // A coworker's own open() used to record only its chat; name the coworker on those tabs.
    const ownerOf = (stored: StoredBrowserTab) =>
      stored.ownerBotId ??
      (stored.ownerThreadId ? (options.botOfThread?.(stored.ownerThreadId) ?? null) : null);
    await this.#splitSharedSignIns(
      state.tabs.map((stored) => ({ ...stored, ownerBotId: ownerOf(stored) })),
      options,
    );
    this.#scheduleCacheTrim(options.botIds ?? []);
    if (state.tabs.length === 0) return;

    const tabs = state.tabs.map((stored) => {
      const tab = this.#createTab(stored.id, stored.url, stored.ownerThreadId, ownerOf(stored));
      this.#tabs.set(tab.id, tab);
      return tab;
    });
    this.#activeTabId = this.#tabs.has(state.activeTabId ?? "")
      ? state.activeTabId
      : (tabs[0]?.id ?? null);
    this.#syncAttachedView();
    this.#emitChanged();
  }

  /**
   * Before coworkers had a browser each, every sign-in lived in one shared session. Once, each
   * coworker receives the sign-ins of the sites it was actually using, so nobody is logged out and
   * nobody inherits a colleague's other accounts. The shared session is left intact.
   */
  async #splitSharedSignIns(
    tabs: StoredBrowserTab[],
    options: BrowserRestoreOptions,
  ): Promise<void> {
    if (!options.botIds?.length) return;
    const markerPath = join(dirname(this.#statePath), SIGN_IN_SPLIT_MARKER);
    if (existsSync(markerPath)) return;
    const usedPages = options.usedPages ?? (await options.loadUsedPages?.()) ?? [];
    const shared = await this.#session.cookies.get({});
    const sites = new Map<string, Set<string>>();
    const addSite = (botId: string, url: string) => {
      const site = siteOfUrl(url);
      if (!site) return;
      if (!sites.has(botId)) sites.set(botId, new Set());
      sites.get(botId)?.add(site);
    };
    for (const tab of tabs) if (tab.ownerBotId) addSite(tab.ownerBotId, tab.url);
    for (const used of usedPages) addSite(used.botId, used.url);
    // A sign-in is one session on the website's side. Copied into several coworkers' browsers,
    // the first one that logs out, logs in again or switches account ends it for all of them
    // (Facebook then shows "Continue as ..." everywhere). Each site's sign-in goes to one coworker.
    const keeper = signInKeepers(
      tabs.flatMap((tab) => (tab.ownerBotId ? [{ botId: tab.ownerBotId, url: tab.url }] : [])),
      usedPages,
    );
    const onlyBot = options.botIds.length === 1 ? options.botIds[0] : null;
    for (const botId of options.botIds) {
      const wanted = new Set(
        [...(sites.get(botId) ?? [])].filter((site) => (keeper.get(site) ?? botId) === botId),
      );
      const cookies = shared.filter(
        (cookie) => botId === onlyBot || wanted.has(siteOfHost(cookie.domain ?? "")),
      );
      if (cookies.length === 0) continue;
      const target = this.#sessionFor(botId);
      for (const cookie of cookies) {
        const host = (cookie.domain ?? "").replace(/^\./, "");
        await target.cookies
          .set({
            url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path ?? "/"}`,
            name: cookie.name,
            value: cookie.value,
            ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            expirationDate: cookie.expirationDate,
            sameSite: cookie.sameSite,
          })
          .catch(() => undefined);
      }
      await target.cookies.flushStore().catch(() => undefined);
    }
    await writeFile(markerPath, `${JSON.stringify({ splitAt: new Date().toISOString() })}\n`, {
      encoding: "utf8",
    });
  }

  /** A coworker's own browser profile; a tab with no coworker uses the owner's shared one. */
  #sessionFor(botId: string | null): Session {
    if (!botId) return this.#session;
    let botSession = this.#botSessions.get(botId);
    if (!botSession) {
      botSession = session.fromPartition(browserPartition(botId), { cache: true });
      this.#configureSession(botSession);
      this.#keepSignInsAcrossRestarts(botSession, botId);
      this.#botSessions.set(botId, botSession);
    }
    return botSession;
  }

  /**
   * Electron, unlike Chrome with "continue where you left off", drops cookies that have no
   * expiry date when the app closes. Sites such as Facebook can keep the sign-in itself
   * (c_user/xs) in such cookies, so a restart (the daily run) found the coworker signed out with
   * only the "Continue as ..." device cookies left. A coworker's own browser keeps them: a
   * session cookie of a site it has open is stored with an expiry, inside Chromium's own
   * (encrypted) cookie store. A site that signs out still deletes it as usual.
   */
  #keepSignInsAcrossRestarts(target: Session, botId: string): void {
    const pending = new Map<string, Electron.Cookie>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flushLater = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const cookies = [...pending.values()];
        pending.clear();
        void (async () => {
          for (const cookie of cookies) {
            const kept = keptSessionCookie(cookie, Date.now());
            if (kept) await target.cookies.set(kept).catch(() => undefined);
          }
          // On disk now, not on Chromium's own schedule: a killed app keeps its sign-ins.
          await target.cookies.flushStore().catch(() => undefined);
        })();
      }, COOKIE_KEEP_DELAY_MS);
      timer.unref?.();
    };
    target.cookies.on("changed", (_event, cookie, cause, removed) => {
      const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
      // A site that signs out within the delay must not get its cookie written back.
      if (removed && cause !== "overwrite") pending.delete(key);
      if (removed || !cookie.session) {
        flushLater();
        return;
      }
      const site = siteOfHost(cookie.domain ?? "");
      const open = [...this.#tabs.values()].some(
        (tab) => tab.ownerBotId === botId && siteOfUrl(currentTabUrl(tab)) === site,
      );
      if (!open) return;
      pending.set(key, cookie);
      flushLater();
    });
  }

  /**
   * Page caches grew to gigabytes (every coworker has its own). A big one is emptied once, a
   * while after start; cookies, local storage and IndexedDB are never touched, so nobody is
   * signed out.
   */
  #scheduleCacheTrim(botIds: string[]): void {
    const timer = setTimeout(() => {
      void (async () => {
        const sessions = [this.#session, ...botIds.map((botId) => this.#sessionFor(botId))];
        for (const target of sessions) {
          try {
            if ((await target.getCacheSize()) <= BrowserHost.CACHE_TRIM_BYTES) continue;
            await target.clearCache();
            await target.clearCodeCaches({});
          } catch {
            // A cache that cannot be read or cleared is left as it is.
          }
        }
      })();
    }, BrowserHost.CACHE_TRIM_DELAY_MS);
    timer.unref?.();
  }

  /** Which account is signed in to this tab's browser, read from that browser alone. */
  async signedInAccount(tabId: string, platform: SocialPlatform): Promise<string | null> {
    const tabSession = this.#sessionFor(this.#requireTab(tabId).ownerBotId);
    const cookie = ACCOUNT_COOKIES[platform];
    if (cookie) {
      const [found] = await tabSession.cookies.get({ url: cookie.url, name: cookie.name });
      return found?.value || null;
    }
    if (platform !== "linkedin") return null;
    const [member] = await tabSession.cookies.get({
      url: "https://www.linkedin.com",
      name: "li_at",
    });
    if (!member?.value) return null;
    // Asked from inside an open LinkedIn page, the way LinkedIn's own site asks: a bare request
    // from the app was challenged by LinkedIn's bot check, so a signed-in owner read as "could
    // not be verified" and every post was refused.
    const tab = this.#requireTab(tabId);
    const view = tab.view;
    if (view && isLinkedInUrl(currentTabUrl(tab))) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const fromPage = await Promise.race([
        view.webContents.executeJavaScript(LINKEDIN_MEMBER_SCRIPT, false).catch(() => null),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 10_000);
        }),
      ]);
      clearTimeout(timer);
      if (typeof fromPage === "string" && fromPage) return fromPage;
    }
    const response = await tabSession
      .fetch("https://www.linkedin.com/in/me/", {
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      })
      .catch(() => null);
    return linkedinAccountFromRedirect(response?.headers.get("location") ?? null);
  }

  /** A deleted coworker's tabs close and its browser data goes with it. */
  async releaseBot(botId: string): Promise<void> {
    for (const tab of [...this.#tabs.values()]) {
      if (tab.ownerBotId === botId) await this.close(tab.id);
    }
    const botSession =
      this.#botSessions.get(botId) ?? session.fromPartition(browserPartition(botId));
    await botSession.clearStorageData().catch(() => undefined);
    this.#botSessions.delete(botId);
    // Its folder too (cleared data still left ~10 MB each). Chromium may hold a file of the
    // released session until quit; whatever stays is removed at the next start.
    if (/^bot-[a-z0-9-]+$/i.test(botId)) {
      await rm(join(dirname(this.#statePath), "Partitions", `sahkarmi-browser-${botId}`), {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 200,
      }).catch(() => undefined);
    }
  }

  /** During a takeover the panel keeps showing the owner's tab, whatever coworkers open. */
  async setHumanControl(humanInControl: boolean): Promise<void> {
    this.#ownerHolding = humanInControl;
  }

  /**
   * The app window was minimised or hidden (true) or shown again (false). Pages no coworker
   * used in the last two minutes are slowed down and muted, and the page on screen is hidden,
   * so an animated site stops costing CPU and battery while nobody can see it. A page a coworker
   * is working in keeps full speed.
   */
  setWindowHidden(hidden: boolean): void {
    this.#windowHidden = hidden;
    if (hidden) {
      this.#quietHiddenPages();
      return;
    }
    for (const tab of this.#tabs.values()) {
      const contents = tab.view?.webContents;
      if (!contents || contents.isDestroyed()) continue;
      if (tab.mutedWhileHidden) contents.setAudioMuted(false);
      tab.mutedWhileHidden = false;
    }
    const hiddenView = this.#viewHiddenWithWindow;
    this.#viewHiddenWithWindow = null;
    if (hiddenView && hiddenView === this.#attachedView && this.#visible) {
      hiddenView.setVisible(true);
    }
  }

  /** While the window is hidden: quiet every page that went unused for two minutes. */
  #quietHiddenPages(now = Date.now()): void {
    if (!this.#windowHidden) return;
    for (const tab of this.#tabs.values()) {
      const view = tab.view;
      const contents = view?.webContents;
      if (!view || !contents || contents.isDestroyed()) continue;
      if (tab.busy > 0 || now - tab.lastUsed < BrowserHost.HIDDEN_QUIET_AFTER_MS) continue;
      contents.setBackgroundThrottling(true);
      if (!contents.isAudioMuted()) {
        contents.setAudioMuted(true);
        tab.mutedWhileHidden = true;
      }
      // Off-screen pages can draw at a lower rate; on-screen ones stop drawing once hidden.
      if (contents.isOffscreen()) contents.setFrameRate(1);
      if (view === this.#attachedView && view.getVisible()) {
        view.setVisible(false);
        this.#viewHiddenWithWindow = view;
      }
    }
  }

  /** Number of tabs with a live page (for tests and diagnostics). */
  get liveTabCount(): number {
    return [...this.#tabs.values()].filter((tab) => tab.view).length;
  }

  /** Awake pages, all of them or one coworker's (the live meter and the Auto turn cap). */
  awakePageCount(botId?: string): number {
    let count = 0;
    for (const tab of this.#tabs.values()) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      if (botId === undefined || tab.ownerBotId === botId) count += 1;
    }
    return count;
  }

  /** The per-coworker page budget and the crash guard, each behind its own feature switch. */
  configureGuards(options: { pageBudget?: () => boolean; crashGuard?: () => boolean }): void {
    if (options.pageBudget) this.#pageBudgetOn = options.pageBudget;
    if (options.crashGuard) this.#crashGuardOn = options.crashGuard;
  }

  #guardOn(check: () => boolean): boolean {
    try {
      return check();
    } catch {
      return false;
    }
  }

  /** Gives a sleeping tab its live page again; the page starts loading its saved address. */
  #wake(tab: InternalTab): WebContentsView {
    this.#dropDeadPage(tab);
    if (tab.view) {
      tab.lastUsed = Date.now();
      return tab.view;
    }
    const view = this.#attachLiveView(tab);
    void view.webContents.loadURL(tab.requestedUrl, browserLoadOptions()).catch(() => undefined);
    this.#emitChanged();
    return view;
  }

  /** The tab's live page, created (but not loaded) if the tab sleeps. */
  #attachLiveView(tab: InternalTab): WebContentsView {
    tab.lastUsed = Date.now();
    this.#dropDeadPage(tab);
    if (tab.view) return tab.view;
    const view = this.#createView(this.#sessionFor(tab.ownerBotId));
    tab.view = view;
    tab.liveSince = Date.now();
    this.#mountView(view);
    this.#bindTabEvents(tab);
    // Only once a page is loaded: switched on before the first load, the setting never applies.
    view.webContents.on("dom-ready", () => keepPageFocused(view.webContents));
    return view;
  }

  /** A coworker chat's own tab already showing this address, unless the owner typed in it. */
  #reusableTab(
    url: string,
    ownerThreadId: string | null,
    ownerBotId: string | null,
  ): InternalTab | null {
    if (!ownerThreadId && !ownerBotId) return null;
    for (const tab of this.#tabs.values()) {
      const own = ownerBotId ? tab.ownerBotId === ownerBotId : tab.ownerThreadId === ownerThreadId;
      if (!own || tab.ownerTyped || tab.busy > 0) continue;
      if (sameAddress(currentTabUrl(tab), url)) return tab;
    }
    return null;
  }

  /** Like #wake, and waits for a page that has only just started to finish its first load. */
  async #wakeLoaded(tab: InternalTab): Promise<WebContentsView> {
    // A site whose page keeps crashing is not woken for a coworker; it is told why instead.
    if (!livePage(tab.view) && this.#guardOn(this.#crashGuardOn)) {
      const site = siteOfPage(tab.requestedUrl);
      if (this.#crashGuard.isResting(site, Date.now())) throw new Error(restingSiteMessage(site));
    }
    const view = this.#wake(tab);
    const contents = view.webContents;
    // A hidden page's timers are slowed down; a coworker's call runs it at full speed until it ends.
    if (tab.busy > 0) contents.setBackgroundThrottling(false);
    if (contents.isLoading() && Date.now() - tab.liveSince < FIRST_LOAD_WAIT_MS) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, FIRST_LOAD_WAIT_MS);
        function done(): void {
          clearTimeout(timer);
          contents.off("did-stop-loading", done);
          resolve();
        }
        contents.once("did-stop-loading", done);
      });
    }
    return view;
  }

  /** While memory is short, idle pages are looked at every few seconds, not once a minute. */
  #schedulePressureCheck(): void {
    if (this.#pressureTimer || this.#destroyed) return;
    this.#pressureTimer = setTimeout(() => {
      this.#pressureTimer = null;
      if (!this.#destroyed) this.#sleepIdleTabs();
    }, BrowserHost.PRESSURE_CHECK_MS);
    this.#pressureTimer.unref?.();
  }

  /** Frees a tab's page; the tab stays in the list with its address and title. */
  #sleep(tab: InternalTab): void {
    const view = tab.view;
    if (!view) return;
    tab.requestedUrl = persistentBrowserUrl(currentTabUrl(tab));
    tab.title = livePage(view)?.getTitle() || tab.title;
    tab.view = null;
    // Element refs from the old page are gone: the coworker is told to take a fresh snapshot.
    tab.revision += 1;
    tab.stale = false;
    tab.ownerTouched = false;
    this.#unmountView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  /**
   * A tab whose page ended by itself turns into a sleeping tab: it keeps its address and wakes
   * with a fresh page on its next use, instead of breaking every browser call.
   */
  #dropDeadPage(tab: InternalTab): boolean {
    const view = tab.view;
    if (!view || !view.webContents.isDestroyed()) return false;
    tab.view = null;
    tab.revision += 1;
    tab.stale = false;
    this.#unmountView(view);
    return true;
  }

  /**
   * Puts tabs to sleep that nobody used for a while. Never the tab on screen, a tab a coworker
   * is using, one with unsaved typing (owner's or coworker's), or one playing sound.
   */
  #sleepIdleTabs(): void {
    const now = Date.now();
    this.#quietHiddenPages(now);
    const pressure = readMemory().pressure;
    const maxAwake =
      pressure === "ok" ? BrowserHost.MAX_AWAKE_TABS : BrowserHost.PRESSURE_AWAKE_TABS[pressure];
    const idleFloor =
      pressure === "ok" ? BrowserHost.AWAKE_LIMIT_IDLE_MS : BrowserHost.PRESSURE_IDLE_MS;
    if (pressure !== "ok") this.#schedulePressureCheck();
    let slept = this.#keepPageBudget(now);
    const candidates: InternalTab[] = [];
    let awake = 0;
    for (const tab of this.#tabs.values()) {
      if (this.#dropDeadPage(tab)) slept = true;
      const view = tab.view;
      if (!view) continue;
      awake += 1;
      if (this.#visible && this.#attachedView === view) continue;
      if (tab.busy > 0 || tab.ownerTyped || tab.coworkerTyped) continue;
      if (view.webContents.isCurrentlyAudible()) continue;
      if (now - tab.lastUsed < BrowserHost.IDLE_SLEEP_MS) {
        candidates.push(tab);
        continue;
      }
      this.#sleep(tab);
      awake -= 1;
      slept = true;
    }
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const tab of candidates) {
      if (awake <= maxAwake) break;
      if (now - tab.lastUsed < idleFloor) break;
      this.#sleep(tab);
      awake -= 1;
      slept = true;
    }
    if (slept) {
      this.#emitChanged();
      this.#schedulePersist();
    }
  }

  /** A page that must stay awake: on screen, in use, with unsaved typing, or playing sound. */
  #mustStayAwake(tab: InternalTab): boolean {
    const view = tab.view;
    if (!view) return false;
    if (this.#visible && this.#attachedView === view) return true;
    if (tab.busy > 0 || tab.ownerTyped || tab.coworkerTyped) return true;
    return !view.webContents.isDestroyed() && view.webContents.isCurrentlyAudible();
  }

  /**
   * Page budget (feature switch): each coworker keeps at most two awake pages; its least recently
   * used extra page sleeps. Any failure leaves the pages as they are. True when one slept.
   */
  #keepPageBudget(now: number): boolean {
    if (!this.#guardOn(this.#pageBudgetOn)) return false;
    let slept = false;
    try {
      const awake = [...this.#tabs.values()].filter((tab) => livePage(tab.view));
      const over = pagesOverBudget(
        awake.map((tab) => ({
          id: tab.id,
          ownerBotId: tab.ownerBotId,
          lastUsed: tab.lastUsed,
          protected: this.#mustStayAwake(tab),
        })),
        now,
      );
      for (const id of over) {
        const tab = this.#tabs.get(id);
        if (!tab?.view || this.#mustStayAwake(tab)) continue;
        this.#sleep(tab);
        slept = true;
      }
    } catch {
      // The page budget is an extra; the normal sleep rules still run.
    }
    return slept;
  }

  /**
   * Tells the coworker about tabs its action opened (a target="_blank" link, like a job title on
   * Naukri), after they load, so it can read them instead of the page it clicked on.
   */
  async #openedTabsNotice(tab: InternalTab): Promise<string | undefined> {
    const opened = tab.openedTabs.splice(0);
    const tabs = opened.flatMap((id) => {
      const child = this.#tabs.get(id);
      return child ? [child] : [];
    });
    if (tabs.length === 0) return undefined;
    await Promise.all(tabs.map((child) => this.#wakeLoaded(child)));
    const list = tabs
      .map((child) => `tabId ${JSON.stringify(child.id)} (${currentTabUrl(child).slice(0, 200)})`)
      .join(", ");
    return `That action opened a new tab: ${list}. Call snapshot with that tabId to read it; this snapshot is still the tab you acted in.`;
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

  /**
   * Opens a page in a tab. A coworker opening a page it already has open gets that tab back,
   * loaded afresh, instead of a duplicate. `id` (a link's new tab) always makes a new tab.
   */
  async open(
    url: string,
    ownerThreadId: string | null = null,
    ownerBotId: string | null = null,
    id?: string,
  ): Promise<BrowserTab> {
    const normalizedUrl = normalizeBrowserUrl(url);
    const reused =
      id === undefined ? this.#reusableTab(normalizedUrl, ownerThreadId, ownerBotId) : null;
    if (reused) {
      if (this.#mayTakePanel(ownerBotId)) this.#activeTabId = reused.id;
      const view = this.#attachLiveView(reused);
      this.#syncAttachedView();
      this.#emitChanged();
      await view.webContents.loadURL(normalizedUrl, browserLoadOptions()).catch(() => undefined);
      await this.#persistState();
      return toPublicTab(reused);
    }
    const tab = this.#createTab(id ?? randomUUID(), normalizedUrl, ownerThreadId, ownerBotId);

    this.#tabs.set(tab.id, tab);
    const view = this.#attachLiveView(tab);
    if (!this.#activeTabId || this.#mayTakePanel(ownerBotId)) this.#activeTabId = tab.id;
    this.#syncAttachedView();
    this.#emitChanged();
    await this.#persistState();

    try {
      await view.webContents.loadURL(normalizedUrl, browserLoadOptions());
    } catch (error) {
      if (this.#tabs.get(tab.id) === tab) {
        this.#unmountView(view);
        this.#tabs.delete(tab.id);
        tab.view = null;
        view.webContents.close();
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

  /** A coworker's page never replaces another coworker's on the panel the owner is looking at. */
  #mayTakePanel(ownerBotId: string | null): boolean {
    if (this.#ownerHolding) return false;
    // The owner is looking at one coworker: only that coworker's pages may appear there.
    if (this.#visible && this.#viewer) return ownerBotId === this.#viewer.botId;
    const shown = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    return !shown?.ownerBotId || !ownerBotId || shown.ownerBotId === ownerBotId;
  }

  async activate(tabId: string): Promise<void> {
    this.#requireTab(tabId);
    this.#activeTabId = tabId;
    this.#syncAttachedView();
    this.#refreshShownTabIfStale();
    this.#emitChanged();
    await this.#persistState();
  }

  async close(tabId: string): Promise<void> {
    const tab = this.#requireTab(tabId);
    this.#tabs.delete(tabId);
    if (tab.view) {
      const view = tab.view;
      tab.view = null;
      this.#unmountView(view);
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }

    if (this.#activeTabId === tabId) {
      // The same coworker's next page, never a colleague's.
      const sameOwner = [...this.#tabs.values()].find(
        (other) => other.ownerBotId === tab.ownerBotId,
      );
      this.#activeTabId = sameOwner?.id ?? this.#tabs.keys().next().value ?? null;
    }
    this.#syncAttachedView();
    this.#emitChanged();
    await this.#persistState();
  }

  async setVisible(input: BrowserVisibilityInput): Promise<void> {
    if (input.botId !== undefined || input.threadId !== undefined) {
      this.#viewer = { botId: input.botId ?? null, threadId: input.threadId ?? null };
    }
    this.#visible = input.visible;
    if (input.bounds) this.#bounds = validateBounds(input.bounds);
    this.#syncAttachedView();
    if (input.visible) this.#refreshShownTabIfStale();
  }

  /** After a coworker changes a site in one tab, the other tabs of that site go out of date. */
  #markSameSiteStale(acted: InternalTab): void {
    acted.stale = false;
    acted.ownerTouched = false;
    const ids = sameSiteTabIds(
      [...this.#tabs.values()].map((tab) => ({
        id: tab.id,
        url: currentTabUrl(tab),
        ownerBotId: tab.ownerBotId,
      })),
      acted.id,
      currentTabUrl(acted),
      acted.ownerBotId,
    );
    if (ids.length === 0) return;
    for (const id of ids) {
      const tab = this.#tabs.get(id);
      if (!tab) continue;
      if (!tab.stale) tab.ownerTouched = false;
      tab.stale = true;
    }
    // Wait until the coworker stops, so the page is reloaded once with the finished work.
    this.#scheduleStaleRefresh(BrowserHost.STALE_REFRESH_MS);
  }

  #scheduleStaleRefresh(delayMs: number): void {
    if (this.#staleRefreshTimer) clearTimeout(this.#staleRefreshTimer);
    this.#staleRefreshTimer = setTimeout(() => {
      this.#staleRefreshTimer = null;
      this.#refreshShownTabIfStale();
    }, delayMs);
  }

  /**
   * Reloads the page the owner is looking at when a coworker changed its site in another tab.
   * Hidden pages wait until the owner opens them. A page the owner typed or clicked in since
   * is left alone, so their own unsaved work is never lost.
   */
  #refreshShownTabIfStale(): void {
    if (!this.#visible || !this.#activeTabId) return;
    const tab = this.#tabs.get(this.#activeTabId);
    if (!tab) return;
    const wait = staleReloadDelay(tab, Date.now(), BrowserHost.STALE_MIN_GAP_MS);
    if (wait === null) return;
    if (wait > 0) {
      // Reloaded a moment ago: once more after the gap, with whatever the coworker has done.
      this.#scheduleStaleRefresh(wait);
      return;
    }
    if (!tab.view) return;
    tab.stale = false;
    tab.lastAutoReload = Date.now();
    tab.view.webContents.reload();
  }

  async snapshot(tabId: string): Promise<BrowserSnapshot> {
    return this.#enqueue(tabId, async (tab) => {
      const revision = tab.revision + 1;
      return this.#readSnapshot(tab, revision);
    });
  }

  act(tabId: string, revision: number, action: BrowserAction): Promise<BrowserSnapshot>;
  act(
    tabId: string,
    revision: number,
    action: BrowserAction,
    options: BrowserActOptions,
  ): Promise<BrowserSnapshot | BrowserActStatus>;
  async act(
    tabId: string,
    revision: number,
    action: BrowserAction,
    options?: BrowserActOptions,
  ): Promise<BrowserSnapshot | BrowserActStatus> {
    return this.#enqueue(tabId, async (tab) => {
      if (revision !== ANY_REVISION && revision !== tab.revision) {
        throw new Error("Stale browser references. Take a fresh snapshot before acting.");
      }

      const view = await this.#wakeLoaded(tab);
      const beforeUrl = currentTabUrl(tab);
      // A hidden page must be painted to take input, but never over the app: it is shown with
      // only its corner pixel inside the window while the coworker acts on it.
      const restore = view.getVisible() ? null : this.#showOutOfSight(view);
      // Never take keyboard focus: the owner may be typing in the chat while a coworker works.
      // Keys reach the page through DevTools with focus emulation instead.
      let notice: string | undefined;
      tab.openedTabs = [];
      try {
        if (restore) await delay(250);
        notice = await withTimeout(
          performAction(view.webContents, action),
          10_000,
          "Browser action timed out.",
        );
        await delay(50);
      } finally {
        restore?.();
      }
      const opened = await this.#openedTabsNotice(tab);
      if (opened) notice = notice ? `${notice} ${opened}` : opened;
      // Typing that submitted and loaded a new page left nothing unsaved behind.
      if (TYPING_ACTIONS.has(action.type) && tab.revision === revision) tab.coworkerTyped = true;
      if (CHANGING_ACTIONS.has(action.type)) this.#markSameSiteStale(tab);
      // A click has already waited for the page while watching for its file picker.
      if (action.type !== "click") await delay(250);
      if (options?.snapshot === false) {
        // The short answer: the page text and refs are read only when the coworker asks.
        const raw = await withTimeout(
          view.webContents.executeJavaScript(statusScript(), true),
          10_000,
          "Browser status timed out.",
        );
        return actStatusFrom(tab, raw, beforeUrl, currentTabUrl(tab), notice);
      }
      const nextRevision = tab.revision + 1;
      const snapshot = await this.#readSnapshot(tab, nextRevision);
      return notice ? { ...snapshot, notice } : snapshot;
    });
  }

  async screenshot(tabId: string, ref?: string): Promise<string> {
    return this.#enqueue(tabId, async (tab) => {
      // Chromium cannot capture a hidden page ("display surface not available"): paint it
      // out of sight first, as previews do.
      const view = await this.#wakeLoaded(tab);
      const restore = view.getVisible() ? null : this.#showOutOfSight(view);
      try {
        if (restore) await delay(PREVIEW_PAINT_MS);
        let clip: Electron.Rectangle | undefined;
        if (ref) {
          const raw = await withTimeout(
            view.webContents.executeJavaScript(elementRectScript(ref), true),
            10_000,
            "Browser screenshot timed out.",
          );
          clip = elementClip(raw);
          await delay(100);
        }
        const image = await withTimeout(
          view.webContents.capturePage(clip),
          10_000,
          "Browser screenshot timed out.",
        );
        return screenshotDataUrl(image, clip?.width ?? view.getBounds().width);
      } finally {
        restore?.();
      }
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
      // A sleeping tab has no picture, and a page card is no reason to wake it.
      if (!view) return null;
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
    if (this.#changeTimer) clearTimeout(this.#changeTimer);
    if (this.#persistTimer) clearTimeout(this.#persistTimer);
    this.#changeTimer = null;
    this.#persistTimer = null;
    try {
      await this.#persistState();
      // Sign-ins made in the last moments are written to disk before the app closes.
      await Promise.all(
        [this.#session, ...this.#botSessions.values()].map((target) =>
          target.cookies.flushStore().catch(() => undefined),
        ),
      );
    } finally {
      if (this.#staleRefreshTimer) clearTimeout(this.#staleRefreshTimer);
      clearInterval(this.#sleepTimer);
      this.#destroyed = true;
      if (this.#pressureTimer) clearTimeout(this.#pressureTimer);
      this.#pressureTimer = null;
      for (const tab of this.#tabs.values()) {
        if (!tab.view) continue;
        this.#unmountView(tab.view);
        if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
        tab.view = null;
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
    return {
      id,
      view: null,
      requestedUrl,
      title: "",
      lastUsed: Date.now(),
      liveSince: 0,
      ownerTyped: false,
      openedTabs: [],
      busy: 0,
      ownerThreadId,
      ownerBotId,
      revision: 0,
      labels: new Map(),
      queue: Promise.resolve(),
      stale: false,
      ownerTouched: false,
      coworkerTyped: false,
      loadFailed: false,
      lastAutoReload: 0,
    };
  }

  #createView(viewSession: Session): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: viewSession,
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

  #configureSession(target: Session): void {
    const userAgent = browserUserAgent(target.getUserAgent());
    target.setUserAgent(userAgent, preferredBrowserLanguageCodes());
    target.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: browserRequestHeaders(details.requestHeaders, userAgent, details.url),
      });
    });
    target.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    target.setPermissionCheckHandler(() => false);
    target.on("will-download", (_event, item, contents) => {
      const safeName = basename(item.getFilename()).replace(/[^a-zA-Z0-9._ -]/g, "_");
      const downloadPath = uniqueDownloadPath(
        this.#downloadsRoot,
        safeName || `download-${Date.now()}`,
        this.#reservedDownloadPaths,
      );
      this.#reservedDownloadPaths.add(downloadPath);
      item.setSavePath(downloadPath);
      item.once("done", () => this.#reservedDownloadPaths.delete(downloadPath));
      const authorize = this.#downloadAuthorizer;
      if (!authorize) return;
      // Held until the permission policy answers: "downloads" set to deny stops it, ask asks.
      item.pause();
      const tab = [...this.#tabs.values()].find(
        (candidate) => candidate.view?.webContents === contents,
      );
      void authorize({
        botId: tab?.ownerBotId ?? null,
        threadId: tab?.ownerThreadId ?? null,
        url: item.getURL(),
        fileName: basename(downloadPath),
        path: downloadPath,
      })
        .catch(() => false)
        .then((allowed) => {
          const state = item.getState();
          if (!allowed) {
            if (state === "progressing" || state === "interrupted") item.cancel();
            return;
          }
          // A long wait for the owner can drop the connection; pick up where it stopped.
          if (state === "progressing" || (state === "interrupted" && item.canResume())) {
            item.resume();
          }
        });
    });
  }

  #bindTabEvents(tab: InternalTab): void {
    const view = tab.view;
    if (!view) return;
    const contents = view.webContents;
    // Events from a page that was put to sleep no longer describe the tab.
    const current = () => tab.view === view;
    const changed = () => {
      if (current()) this.#emitChanged();
    };
    contents.once("destroyed", () => {
      if (!current() || this.#destroyed) return;
      this.#dropDeadPage(tab);
      this.#syncAttachedView();
      this.#emitChanged();
    });
    // A crashed page (often memory) would stay blank: the tab sleeps and its next use loads
    // the address again in a fresh page.
    contents.once("render-process-gone", () => {
      if (!current() || this.#destroyed) return;
      if (this.#guardOn(this.#crashGuardOn)) {
        this.#crashGuard.noteCrash(siteOfPage(currentTabUrl(tab)), Date.now());
      }
      this.#sleep(tab);
      this.#syncAttachedView();
      this.#emitChanged();
    });
    contents.on("did-start-loading", changed);
    contents.on("did-stop-loading", changed);
    contents.on("did-finish-load", () => {
      if (!current() || !this.#guardOn(this.#crashGuardOn)) return;
      this.#crashGuard.noteLoaded(siteOfPage(currentTabUrl(tab)), Date.now());
    });
    contents.on("page-title-updated", (_event, title) => {
      if (current()) tab.title = title;
      changed();
    });
    contents.on("input-event", (_event, input) => {
      if (!current() || !OWNER_INPUT.has(input.type)) return;
      tab.lastUsed = Date.now();
      if (tab.stale) tab.ownerTouched = true;
      // Keys typed outside a coworker action are the owner's own unsaved work.
      if (input.type !== "mouseDown" && tab.busy === 0) tab.ownerTyped = true;
    });
    contents.on("did-navigate", (_event, url, httpResponseCode) => {
      if (!current()) return;
      // A full load reads the site afresh.
      tab.stale = false;
      tab.ownerTyped = false;
      tab.ownerTouched = false;
      tab.coworkerTyped = false;
      tab.loadFailed = httpResponseCode >= 400;
      if (isPersistableBrowserUrl(url)) tab.requestedUrl = persistentBrowserUrl(url);
      tab.revision += 1;
      changed();
      this.#schedulePersist();
    });
    contents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
      // -3 is a load the page itself cancelled (a redirect or a new navigation), not an error.
      if (current() && isMainFrame && errorCode !== -3) tab.loadFailed = true;
    });
    contents.on("did-navigate-in-page", (_event, url) => {
      if (!current()) return;
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
        // A coworker's action is told about this tab, so it can read the page it opened.
        const childId = randomUUID();
        if (tab.busy > 0) tab.openedTabs.push(childId);
        void this.open(url, tab.ownerThreadId, tab.ownerBotId, childId).catch(() => undefined);
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
            session: this.#sessionFor(tab.ownerBotId),
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

  async #readSnapshot(tab: InternalTab, requested: number): Promise<BrowserSnapshot> {
    const view = await this.#wakeLoaded(tab);
    // Waking the tab may have counted its first load as a navigation.
    const revision = Math.max(requested, tab.revision + 1);
    const raw = await withTimeout(
      view.webContents.executeJavaScript(snapshotScript(revision), true),
      10_000,
      "Browser snapshot timed out.",
    );
    if (!isRecord(raw)) throw new Error("Browser returned an invalid snapshot.");
    tab.revision = revision;
    const snapshot: BrowserSnapshot = {
      tabId: tab.id,
      revision,
      title: typeof raw.title === "string" ? raw.title.slice(0, 500) : "",
      url: typeof raw.url === "string" ? raw.url : currentTabUrl(tab),
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

  /**
   * Types the owner's password or code into the sign-in field. Sites like Facebook redraw the
   * form and change the address (index.php?next=...) without loading a new page, which made the
   * coworker's ref stale; on the same origin the field is found again (the one the coworker
   * pointed at, else the focused or the only visible password / code field). Another origin is
   * refused, and the value is never logged, stored or returned.
   */
  async fillSecureField(tabId: string, input: SecureFillInput): Promise<void> {
    await this.#enqueue(tabId, async (tab) => {
      const view = await this.#wakeLoaded(tab);
      const marker = `secure-${randomUUID()}`;
      const found = await withTimeout(
        view.webContents.executeJavaScript(
          secureFieldScript(input.ref, input.kind, input.origin, marker),
          true,
        ),
        10_000,
        "The page did not answer.",
      );
      if (!isRecord(found) || typeof found.ref !== "string") {
        throw new Error(
          isRecord(found) && typeof found.error === "string"
            ? found.error
            : "The field was not found.",
        );
      }
      const ref = found.ref;
      const restore = view.getVisible() ? null : this.#showOutOfSight(view);
      try {
        if (restore) await delay(250);
        await withTimeout(
          performAction(view.webContents, {
            type: "type",
            ref,
            text: input.text,
            submit: input.submit,
          }),
          10_000,
          "Typing timed out.",
        );
      } finally {
        restore?.();
        if (ref === marker) {
          void view.webContents
            .executeJavaScript(
              `document.querySelector('[data-sahkarmi-ref=${JSON.stringify(marker)}]')?.removeAttribute('data-sahkarmi-ref')`,
              true,
            )
            .catch(() => undefined);
        }
      }
      // Element refs from before are not trusted after a sign-in step.
      tab.revision += 1;
    });
  }

  /** Every download waits for this answer; without one, downloads go ahead as before. */
  setDownloadAuthorizer(authorizer: DownloadAuthorizer | null): void {
    this.#downloadAuthorizer = authorizer;
  }

  /** What a browser action would touch: the element's label and the page address. */
  describeTarget(tabId: string, ref: string | null): { label: string; url: string } {
    const tab = this.#tabs.get(tabId);
    if (!tab) return { label: "", url: "" };
    return {
      label: ref ? (tab.labels.get(ref) ?? "") : "",
      url: currentTabUrl(tab),
    };
  }

  #syncAttachedView(): void {
    if (this.#visible && this.#viewer) {
      // Never show a colleague's page on this coworker's panel.
      const shown = tabForViewer([...this.#tabs.values()], this.#activeTabId, this.#viewer);
      if (!shown) {
        this.#attachedView?.setVisible(false);
        return;
      }
      if (shown !== this.#activeTabId) {
        this.#activeTabId = shown;
        this.#emitChanged();
      }
    }
    const tab = this.#activeTabId ? this.#tabs.get(this.#activeTabId) : null;
    if (!this.#visible || !this.#bounds || !tab) {
      this.#attachedView?.setVisible(false);
      return;
    }

    // The owner opened this tab on screen: a resting site may be used again.
    if (!livePage(tab.view) && this.#guardOn(this.#crashGuardOn)) {
      this.#crashGuard.noteSuccess(siteOfPage(tab.requestedUrl));
    }
    const view = this.#wake(tab);
    if (this.#attachedView !== view) {
      this.#attachedView?.setVisible(false);
      this.#mountView(view);
      this.#attachedView = view;
    }
    view.setBounds(fitInWindow(this.#bounds, this.#window.getContentSize()));
    view.setVisible(true);
    view.webContents.invalidate();
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
    tab.busy += 1;
    const result = tab.queue.then(() => operation(tab));
    const settled = result.finally(() => {
      tab.busy -= 1;
      tab.lastUsed = Date.now();
      if (tab.busy === 0) livePage(tab.view)?.setBackgroundThrottling(true);
    });
    tab.queue = settled.catch(() => undefined);
    return settled;
  }

  /** The first change goes out at once; a burst after it is sent once, with the latest state. */
  #emitChanged(): void {
    if (this.#changeTimer) {
      this.#changePending = true;
      return;
    }
    this.#sendChanged();
    this.#changeTimer = setTimeout(() => {
      this.#changeTimer = null;
      if (this.#changePending) this.#emitChanged();
    }, CHANGE_EVENT_MIN_MS);
    this.#changePending = false;
  }

  #sendChanged(): void {
    const tabs = this.listTabs();
    for (const listener of this.#listeners) listener(tabs, this.#activeTabId);
  }

  #schedulePersist(): void {
    if (this.#persistTimer) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      void this.#persistState().catch((error) => {
        console.error("Unable to persist browser tabs:", error);
      });
    }, PERSIST_DELAY_MS);
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

export type SecureFieldKind = "password" | "otp" | "pin" | "other";

export interface SecureFillInput {
  /** The field the coworker pointed at; may be gone after the site redrew its form. */
  ref: string;
  kind: SecureFieldKind;
  /** The origin the owner was told; nothing is typed anywhere else. */
  origin: string;
  text: string;
  submit: boolean;
}

/**
 * Runs in the page: finds the field for the owner's secret and returns its ref, or an error.
 * Order: the coworker's ref if it is still a fitting field, the focused fitting field, then
 * the only fitting field visible on the page. "other" fields are only ever the coworker's ref.
 */
export function secureFieldScript(
  ref: string,
  kind: SecureFieldKind,
  origin: string,
  marker: string,
): string {
  return `(() => {
    const origin = ${JSON.stringify(origin)};
    const kind = ${JSON.stringify(kind)};
    if (location.origin !== origin) {
      return { error: 'The page is no longer on ' + origin + ', so nothing was typed.' };
    }
    const usable = (el) => {
      if (!(el instanceof HTMLInputElement) || el.disabled || el.readOnly || el.type === 'hidden') return false;
      if (el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    const codeLike = (el) =>
      el.autocomplete === 'one-time-code' || el.inputMode === 'numeric' ||
      el.type === 'tel' || el.type === 'number' ||
      (el.maxLength > 0 && el.maxLength <= 10) ||
      /otp|code|pin|verif|token/i.test([el.name, el.id, el.placeholder, el.getAttribute('aria-label') || ''].join(' '));
    const fits = (el) =>
      usable(el) && (kind === 'password' ? el.type === 'password' : kind === 'other' ? true :
        ['text', 'tel', 'number', 'password', ''].includes(el.type) && codeLike(el));
    const shown = (el) => { const rect = el.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    const ref = ${JSON.stringify(ref)};
    const own = ref ? document.querySelector('[data-sahkarmi-ref=' + JSON.stringify(ref) + ']') : null;
    if (own && kind === 'other' && own instanceof HTMLElement) return { ref };
    if (own && fits(own)) return { ref };
    if (kind === 'other') return { error: 'The field is no longer on the page. Use Take over to type it yourself.' };
    let pick = null;
    const active = document.activeElement;
    if (active && fits(active)) pick = active;
    if (!pick) {
      let found = [...document.querySelectorAll('input')].filter(fits);
      if (kind !== 'password') {
        const hinted = found.filter((el) => el.autocomplete === 'one-time-code');
        if (hinted.length > 0) found = hinted;
      }
      const onScreen = found.filter(shown);
      if (onScreen.length > 0) found = onScreen;
      if (found.length > 1) {
        return { error: 'More than one field on the page could take it, so nothing was typed. Use Take over to type it yourself.' };
      }
      pick = found[0] || null;
    }
    if (!pick) return { error: 'The field is no longer on the page. Use Take over to type it yourself.' };
    const existing = pick.getAttribute('data-sahkarmi-ref');
    if (existing) return { ref: existing };
    pick.setAttribute('data-sahkarmi-ref', ${JSON.stringify(marker)});
    return { ref: ${JSON.stringify(marker)} };
  })()`;
}

/** What every browser engine needs for the tools: open, read, act, capture and close tabs. */
export interface BrowserToolTarget {
  readonly activeTabId: string | null;
  listTabs(): BrowserTab[];
  open(url: string, ownerThreadId?: string | null, ownerBotId?: string | null): Promise<BrowserTab>;
  snapshot(tabId: string): Promise<BrowserSnapshot>;
  act(tabId: string, revision: number, action: BrowserAction): Promise<BrowserSnapshot>;
  act(
    tabId: string,
    revision: number,
    action: BrowserAction,
    options: BrowserActOptions,
  ): Promise<BrowserSnapshot | BrowserActStatus>;
  screenshot(tabId: string, ref?: string): Promise<string>;
  close(tabId: string): Promise<void>;
}

/** The coworker browser as the rest of the app sees it, whichever engine runs it. */
/** A file a page started downloading, and the tab's coworker (null on the owner's own tab). */
export interface DownloadRequest {
  botId: string | null;
  threadId: string | null;
  url: string;
  fileName: string;
  path: string;
}

export type DownloadAuthorizer = (request: DownloadRequest) => Promise<boolean>;

export interface CoworkerBrowser extends BrowserToolTarget {
  restore(options?: BrowserRestoreOptions): Promise<void>;
  /** Routes downloads through the permission policy (the built-in browser). */
  setDownloadAuthorizer?(authorizer: DownloadAuthorizer | null): void;
  /** Which account is signed in for this tab; absent where it cannot be read, so publishing stops. */
  signedInAccount?(tabId: string, platform: SocialPlatform): Promise<string | null>;
  releaseBot?(botId: string): Promise<void>;
  /** The app window was minimised/hidden (true) or shown (false); hidden pages are quietened. */
  setWindowHidden?(hidden: boolean): void;
  /** Awake pages, all or one coworker's (the built-in browser). */
  awakePageCount?(botId?: string): number;
  /** Page budget and crash guard switches (the built-in browser). */
  configureGuards?(options: { pageBudget?: () => boolean; crashGuard?: () => boolean }): void;
  /** Types the owner's secret into the sign-in field, found again if the page redrew it. */
  fillSecureField?(tabId: string, input: SecureFillInput): Promise<void>;
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
  /**
   * True when a takeover holds only the tab the owner is working in, so other coworkers keep
   * using their own tabs. False or missing: the whole browser is the owner's during a takeover.
   */
  readonly takeoverHoldsShownTabOnly?: boolean;
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

/** An act without a revision and without a ref: no element refs to go stale. */
export const ANY_REVISION = -1;

function revisionFromRef(action: BrowserAction): number {
  const ref = "ref" in action ? action.ref : undefined;
  if (!ref) return ANY_REVISION;
  const revision = Number(ref.split(":")[0]);
  if (!Number.isInteger(revision)) throw new Error("revision must be a number.");
  return revision;
}

/** Characters of a snapshot sent to a coworker: well inside every runtime's tool-result limit. */
export const SNAPSHOT_BUDGET = 60_000;
const MIN_SNAPSHOT_TEXT = 8_000;
const ELEMENT_NAME_CHARS = 120;
const MIN_ELEMENT_NAME_CHARS = 24;

function textOffset(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
}

/** A snapshot as the coworker reads it: one short line per element instead of an object. */
export type FittedSnapshot = Omit<BrowserSnapshot, "elements"> & {
  elements: string[];
  textOffset?: number;
  textLength?: number;
  nextOffset?: number;
};

/** "4:17 button[tab] (disabled) Inbox": what a coworker needs to pick a ref, nothing more. */
export function elementLine(element: BrowserSnapshot["elements"][number], name: string): string {
  const role = element.role && element.role !== element.tag ? `[${element.role}]` : "";
  const disabled = element.disabled ? " (disabled)" : "";
  return `${element.ref} ${element.tag}${role}${disabled}${name ? ` ${name}` : ""}`;
}

/**
 * Shortens a snapshot for a coworker. Every element stays (they are what it acts on), as one
 * line each with a shorter name; the page text gets what is left and can be read on with offset.
 */
export function fitSnapshot(snapshot: BrowserSnapshot, offset: number): FittedSnapshot {
  // Names get shorter only on a crowded page (hundreds of buttons), never below a readable label.
  const unnamed = JSON.stringify(snapshot.elements.map((element) => elementLine(element, "")));
  const perName = Math.floor(
    (SNAPSHOT_BUDGET - MIN_SNAPSHOT_TEXT - unnamed.length) / Math.max(1, snapshot.elements.length),
  );
  const nameChars = Math.min(ELEMENT_NAME_CHARS, Math.max(MIN_ELEMENT_NAME_CHARS, perName));
  const elements = snapshot.elements.map((element) =>
    elementLine(
      element,
      element.name.length > nameChars ? `${element.name.slice(0, nameChars)}…` : element.name,
    ),
  );
  const room = Math.max(MIN_SNAPSHOT_TEXT, SNAPSHOT_BUDGET - JSON.stringify(elements).length);
  const start = Math.min(offset, snapshot.text.length);
  const text = snapshot.text.slice(start, start + room);
  const end = start + text.length;
  if (start === 0 && end === snapshot.text.length) return { ...snapshot, elements };
  return {
    ...snapshot,
    text,
    elements,
    textOffset: start,
    textLength: snapshot.text.length,
    ...(end < snapshot.text.length ? { nextOffset: end } : {}),
  };
}

/** The tab a call names; some runtimes call it pageId. */
function browserTabId(args: Record<string, unknown>): string {
  const pageId = args.pageId;
  if (typeof args.tabId !== "string" && typeof pageId === "string" && pageId.trim()) return pageId;
  return requiredString(args, "tabId");
}

/** Tabs from before a coworker was recorded on them still belong to the chat that opened them. */
export function isOwnTab(
  tab: Pick<BrowserTab, "ownerBotId" | "ownerThreadId">,
  caller: { botId?: string; threadId: string },
): boolean {
  return tab.ownerBotId ? tab.ownerBotId === caller.botId : tab.ownerThreadId === caller.threadId;
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
    if (params.botId && params.tool !== "open" && params.tool !== "list_tabs") {
      const tabId = browserTabId(args);
      const tab = browser.listTabs().find((candidate) => candidate.id === tabId);
      if (tab && !isOwnTab(tab, params)) {
        throw new Error(
          `Page ${tabId} belongs to another coworker's browser, so it was not touched. Open your own page with open.`,
        );
      }
    }
    switch (params.tool) {
      case "open": {
        const url = requiredString(args, "url");
        const tab = await browser.open(url, params.threadId, params.botId ?? null);
        control.updateTab(params, tab.id);
        return textResult({ tab });
      }
      case "list_tabs": {
        if (!params.botId) {
          return textResult({ tabs: browser.listTabs(), activeTabId: browser.activeTabId });
        }
        const tabs = browser.listTabs().filter((tab) => isOwnTab(tab, params));
        const shown = tabs.some((tab) => tab.id === browser.activeTabId);
        return textResult({ tabs, activeTabId: shown ? browser.activeTabId : null });
      }
      case "snapshot": {
        const snapshot = await browser.snapshot(browserTabId(args));
        return textResult(fitSnapshot(snapshot, textOffset(args.offset)));
      }
      case "act": {
        const tabId = browserTabId(args);
        const action = parseAction(args.action);
        // Some runtimes leave revision out: a ref ("3:17") carries its own, and an action
        // without a ref (a key, a scroll) does not depend on it.
        const revision =
          typeof args.revision === "number" ? args.revision : revisionFromRef(action);
        const result = await browser.act(tabId, revision, action, {
          snapshot: args.snapshot === true,
        });
        return textResult("elements" in result ? fitSnapshot(result, 0) : result);
      }
      case "screenshot": {
        const ref = typeof args.ref === "string" && args.ref.trim() ? args.ref.trim() : undefined;
        const imageUrl = await browser.screenshot(browserTabId(args), ref);
        return { success: true, contentItems: [{ type: "inputImage", imageUrl }] };
      }
      case "close_tab": {
        await browser.close(browserTabId(args));
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
        action === "paste" ||
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
  // Layout sizes carry float noise (1236.0000122): rounding that up made the page a pixel wider
  // than the panel and the window, so its right edge was cut off.
  const x = Math.max(0, Math.floor(bounds.x + 0.01));
  const y = Math.max(0, Math.floor(bounds.y + 0.01));
  const right = Math.max(x + 1, Math.ceil(bounds.x + bounds.width - 0.01));
  const bottom = Math.max(y + 1, Math.ceil(bounds.y + bounds.height - 0.01));
  return { x, y, width: right - x, height: bottom - y };
}

/** Keeps the page inside the window, so no part of it is ever drawn past the edge. */
export function fitInWindow(bounds: BrowserBounds, [width, height]: number[]): BrowserBounds {
  if (!width || !height) return bounds;
  const x = Math.min(bounds.x, width - 1);
  const y = Math.min(bounds.y, height - 1);
  return {
    x,
    y,
    width: Math.max(1, Math.min(bounds.width, width - x)),
    height: Math.max(1, Math.min(bounds.height, height - y)),
  };
}

/**
 * The page of a view, or null once it is gone. A page can end by itself (a site calling
 * window.close(), its process killed while memory is short); reading it then throws
 * "Object has been destroyed", which broke the tab list for every coworker until a restart.
 */
export function livePage<T extends { isDestroyed(): boolean }>(
  view: { webContents: T } | null | undefined,
): T | null {
  const contents = view?.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

function toPublicTab(tab: InternalTab): BrowserTab {
  const contents = livePage(tab.view);
  return {
    id: tab.id,
    title: contents?.getTitle() || tab.title || "New tab",
    url: currentTabUrl(tab),
    loading: contents?.isLoading() ?? false,
    ownerThreadId: tab.ownerThreadId,
    ownerBotId: tab.ownerBotId,
  };
}

/** The signed-in member's public id, read by the page itself (LinkedIn's own "me" request). */
const LINKEDIN_MEMBER_SCRIPT = `(async () => {
  try {
    const token = /JSESSIONID="?([^";]+)/.exec(document.cookie)?.[1];
    if (!token) return null;
    const response = await fetch("/voyager/api/me", {
      credentials: "include",
      headers: { "csrf-token": token, "x-restli-protocol-version": "2.0.0", accept: "application/json" },
    });
    if (!response.ok) return null;
    const me = await response.json();
    return me?.miniProfile?.publicIdentifier ?? me?.publicIdentifier ?? null;
  } catch {
    return null;
  }
})()`;

export function isLinkedInUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  } catch {
    return false;
  }
}

function currentTabUrl(tab: InternalTab): string {
  const currentUrl = livePage(tab.view)?.getURL() ?? "";
  return isPersistableBrowserUrl(currentUrl) ? currentUrl : tab.requestedUrl;
}

/** The same page, ignoring a trailing slash and the #part. */
export function sameAddress(left: string, right: string): boolean {
  const clean = (url: string) => url.replace(/#.*$/, "").replace(/\/+$/, "");
  return clean(left) === clean(right);
}

export function snapshotScript(revision: number): string {
  return `(() => {
    const revision = ${revision};
    // Stops at 500 visible elements: big pages (Instagram, Sheets) have thousands.
    const nodes = [];
    for (const node of document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],[tabindex]')) {
      const visible = typeof node.checkVisibility === 'function'
        ? node.checkVisibility({ visibilityProperty: true })
        : getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).display !== 'none';
      if (!visible) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && nodes.push(node) >= 500) break;
    }
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

/** The little a coworker needs after an action: where the page is and whether its refs hold. */
export function statusScript(): string {
  return `(() => {
    const active = document.activeElement;
    const describe = (node) => {
      if (!node || node === document.body || node === document.documentElement) return null;
      const ref = node.getAttribute('data-sahkarmi-ref');
      const name = (node.getAttribute('aria-label') || node.getAttribute('placeholder') || node.getAttribute('title') || node.innerText || '').trim().slice(0, 80);
      return (ref ? ref + ' ' : '') + node.tagName.toLowerCase() + (name ? ' ' + name : '');
    };
    return {
      title: document.title,
      url: location.href,
      loading: document.readyState !== 'complete',
      refs: document.querySelectorAll('[data-sahkarmi-ref]').length,
      focus: describe(active),
    };
  })()`;
}

const REF_PATTERN = /^\d+:\d+$/;

/** Where one element of the last snapshot sits on screen, after scrolling it into view. */
export function elementRectScript(ref: string): string {
  if (!REF_PATTERN.test(ref)) throw new Error("ref must look like 4:17.");
  return `(() => {
    const node = document.querySelector('[data-sahkarmi-ref="${ref}"]');
    if (!node) return null;
    node.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = node.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  })()`;
}

/** The capture area for an element, inside the viewport and never empty. */
export function elementClip(raw: unknown): { x: number; y: number; width: number; height: number } {
  if (!isRecord(raw)) {
    throw new Error(
      "That element is no longer on the page (it changed). Take a fresh snapshot and use the new ref.",
    );
  }
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const x = Math.max(0, Math.floor(number(raw.x)));
  const y = Math.max(0, Math.floor(number(raw.y)));
  const width = Math.max(1, Math.min(4_000, Math.ceil(number(raw.width) + number(raw.x) - x)));
  const height = Math.max(1, Math.min(4_000, Math.ceil(number(raw.height) + number(raw.y) - y)));
  return { x, y, width, height };
}

/** Builds the status an action returns; a page that lost its ref stamps makes old refs stale. */
export function actStatusFrom(
  tab: RefTab,
  raw: unknown,
  beforeUrl: string,
  fallbackUrl: string,
  notice: string | undefined,
): BrowserActStatus {
  const page = isRecord(raw) ? raw : {};
  const url = typeof page.url === "string" ? page.url : fallbackUrl;
  const stamped = typeof page.refs === "number" ? page.refs : 0;
  // A reload or a new document drops the stamps: old refs must be refused, never misapplied.
  const stale = stamped === 0;
  if (stale && tab.labels.size > 0) {
    tab.revision += 1;
    tab.labels = new Map();
  }
  return {
    tabId: tab.id,
    revision: tab.revision,
    title: typeof page.title === "string" ? page.title.slice(0, 500) : "",
    url,
    navigated: !sameAddress(beforeUrl, url),
    loading: page.loading === true,
    refs: stale ? "stale" : "valid",
    focus: typeof page.focus === "string" ? page.focus.slice(0, 120) : null,
    ...(notice ? { notice } : {}),
  };
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
          if (!(node instanceof Element)) return { error: 'That element is no longer on the page (it changed). Take a fresh snapshot and use the new ref.' };
          node.scrollIntoView({ block: 'center', inline: 'center' });
          if (typeof node.focus === 'function') node.focus();
          const rect = node.getBoundingClientRect();
          return {
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            direct: node instanceof HTMLAnchorElement && node.hasAttribute('download'),
          };
        })()`,
        true,
      );
      if (isRecord(point) && typeof point.error === "string") throw new Error(point.error);
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
      const text = action.text.slice(0, 50_000);
      if (action.ref === undefined) {
        await withFocusedPage(contents, async (send) => {
          await typeIntoFocus(send, text);
          if (action.submit) await pressCdpKey(send, "Enter");
        });
        return;
      }
      const ref = action.ref;
      // Focus emulation goes on before the field is focused, so the page treats it as the
      // focused field without the owner's chat box losing the keyboard.
      await withFocusedPage(contents, async (send) => {
        await contents.executeJavaScript(
          `(() => {
          const node = document.querySelector('[data-sahkarmi-ref=${JSON.stringify(ref)}]');
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
            throw new Error('Element does not accept text. To type into a spreadsheet cell or another focused part of the page, click it, then send type without ref.');
          }
        })()`,
          true,
        );
        await send("Input.insertText", { text });
        if (action.submit) await pressCdpKey(send, "Enter");
      });
      return;
    }
    case "key":
      await withFocusedPage(contents, (send) => pressCdpKey(send, action.key));
      return;
    case "paste":
      await pasteIntoFocus(contents, action.text);
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

/**
 * Lets a coworker's page behave as if it had keyboard focus for its whole life, without taking
 * the keyboard from the owner. Switching it on only for each action made the page lose and
 * regain focus between a click and the typing after it, which can end a spreadsheet cell edit.
 * The DevTools connection stays attached; the actions below reuse it.
 */
function keepPageFocused(contents: WebContents): void {
  try {
    if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    void contents.debugger
      .sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true })
      .catch(() => undefined);
  } catch {
    // DevTools is open on this page; actions turn focus emulation on themselves.
  }
}

/**
 * Runs keyboard input with the page treated as focused. The owner is usually typing in the chat,
 * not the page, and sites like Google Sheets ignore keys while their page has no focus.
 */
async function withFocusedPage(
  contents: WebContents,
  operation: (send: CdpSend) => Promise<void>,
): Promise<void> {
  await withDevToolsDebugger(contents, async () => {
    const send: CdpSend = (method, params) => contents.debugger.sendCommand(method, params);
    await send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await operation(send);
  });
}

/**
 * Pastes into whatever has focus. Spreadsheets turn tab-separated lines into rows and columns.
 * The text goes to the page directly, never through the system clipboard: the owner's clipboard
 * is left alone, and the page needs no keyboard focus (the owner may be typing in the chat).
 * Without text, what the owner copied is pasted.
 */
async function pasteIntoFocus(contents: WebContents, text: string | undefined): Promise<void> {
  const pasted = (text ?? clipboard.readText()).slice(0, 500_000);
  if (!pasted) throw new Error("Nothing to paste: give the text to paste.");
  await withFocusedPage(contents, async (send) => {
    const outcome = await contents.executeJavaScript(pasteEventScript(pasted), true);
    // A plain field ignores a paste event it did not get from the keyboard: type the text in.
    if (outcome !== "handled") await send("Input.insertText", { text: pasted });
  });
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
    case "type": {
      const ref = typeof value.ref === "string" && value.ref.trim() ? value.ref : undefined;
      return {
        type: "type",
        ...(ref ? { ref } : {}),
        text: requiredString(value, "text"),
        submit: value.submit === true,
      };
    }
    case "key":
      return { type: "key", key: requiredString(value, "key") };
    case "paste":
      return typeof value.text === "string" && value.text
        ? { type: "paste", text: value.text }
        : { type: "paste" };
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
