import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type AppUpdater,
  CancellationToken,
  type ProgressInfo,
  type UpdateDownloadedEvent,
  type UpdateInfo,
} from "electron-updater";
import type { UpdateStatus } from "../shared/ipc";

type UpdateAdapter = Pick<
  AppUpdater,
  | "disableDifferentialDownload"
  | "allowPrerelease"
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "checkForUpdates"
  | "downloadUpdate"
  | "on"
  | "quitAndInstall"
>;

interface UpdateServiceEvents {
  status: [status: UpdateStatus];
}

/** One "Restart to update" click, kept on disk so the next start can tell whether it worked. */
export interface InstallAttempt {
  version: string;
  count: number;
  at: string;
}

export interface InstallAttemptStore {
  read(): InstallAttempt | null;
  write(attempt: InstallAttempt | null): void;
}

interface UpdateServiceOptions {
  currentVersion: string;
  enabled: boolean;
  /** Stops coworkers and background work; the installer ends whatever is still running. */
  beforeInstall: () => Promise<void>;
  /** Remembers each install attempt across restarts so a failed one is noticed and explained. */
  installAttempts?: InstallAttemptStore;
  /** Called when the installer could not start although beforeInstall already ran. */
  afterFailedInstall?: () => void;
  /** How long the app may keep running after the installer was asked to start. */
  installTimeoutMs?: number;
  /** Replaces the generic "unsupported" text, e.g. for a copy that the Microsoft Store updates. */
  unsupportedMessage?: string;
  initialCheckDelayMs?: number;
  checkIntervalMs?: number;
  stallTimeoutMs?: number;
  retryDelayMs?: number;
  /** False when the owner set "App updates" to ask: found updates wait for a manual download. */
  autoDownload?: () => boolean;
  /**
   * True when this build cannot replace itself (macOS without a Developer ID signature: Apple's
   * updater refuses ad-hoc signed apps). The update is then opened as a normal download.
   */
  manualInstall?: () => Promise<boolean>;
  openDownload?: (version: string) => Promise<void>;
  /**
   * Windows: runs the downloaded installer through Sahkarmi's own helper (see
   * windows-installer.ts) and quits the app. "quit" installs silently as the owner closes the
   * app. Without it, or when it fails, electron-updater's own launcher is used.
   */
  launchInstaller?: (installer: string, version: string, mode: "restart" | "quit") => Promise<void>;
  /** What the helper recorded about the last install, read once at start. */
  installResult?: () => { version: string; code: number } | null;
  /** Plain words for an installer exit code. */
  describeInstallFailure?: (code: number) => string;
}

const DEFAULT_CHECK_INTERVAL = 15 * 60 * 1_000;
/** After this many Restart clicks that changed nothing, the update is handed to the browser. */
const MANUAL_AFTER_FAILURES = 2;
const UNSUPPORTED_MESSAGE = "Updates are available in installed desktop builds.";
const PERMISSION_HINT =
  "choose Yes when Windows asks for permission to run the Sahkarmi installer. (Sahkarmi is free software and not yet signed, so Windows calls it an unknown publisher.)";
const READY_AFTER_FAILED_INSTALL = `The last update did not install. Click Restart again and ${PERMISSION_HINT}`;
const INSTALL_DID_NOT_START = `Click Retry update, then Restart, and ${PERMISSION_HINT} Or get the installer from https://sahkarmi.site`;
const MANUAL_INSTALL_HINT =
  "Automatic install did not work on this PC. Download the update and run the file yourself; choose Yes if Windows asks for permission. The Microsoft Store copy of Sahkarmi updates on its own.";

export function supportsInstalledUpdates(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32";
}

export class UpdateService extends EventEmitter<UpdateServiceEvents> {
  readonly #updater: UpdateAdapter;
  readonly #options: Required<Omit<UpdateServiceOptions, OptionalOption>> &
    Pick<UpdateServiceOptions, OptionalOption>;
  #status: UpdateStatus;
  #checkTimer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #downloadToken: CancellationToken | null = null;
  #downloadTask: Promise<void> | null = null;
  #stallTimer: ReturnType<typeof setTimeout> | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #retryCount = 0;
  #transferred = 0;
  #stopped = false;
  #installing = false;
  #installTimer: ReturnType<typeof setTimeout> | null = null;
  /** Restart clicks on this PC that left the old version running (from installAttempts). */
  #failedInstalls = 0;
  /** Why the last install left this version running, when the helper recorded it. */
  #failureReason: string | null = null;
  /** The verified installer on disk, from update-downloaded. */
  #downloadedFile: string | null = null;
  /** Install silently when the owner quits (Sahkarmi's helper, not electron-updater's). */
  #installOnQuit = false;

  constructor(updater: UpdateAdapter, options: UpdateServiceOptions) {
    super();
    this.#updater = updater;
    this.#options = {
      ...options,
      initialCheckDelayMs: options.initialCheckDelayMs ?? 12_000,
      checkIntervalMs: options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL,
      stallTimeoutMs: options.stallTimeoutMs ?? 45_000,
      retryDelayMs: options.retryDelayMs ?? 3_000,
      installTimeoutMs: options.installTimeoutMs ?? 20_000,
      autoDownload: options.autoDownload ?? (() => true),
      openDownload: options.openDownload ?? (async () => undefined),
    };
    this.#status = {
      phase: options.enabled ? "idle" : "unsupported",
      currentVersion: options.currentVersion,
      availableVersion: null,
      progress: null,
      checkedAt: null,
      message: options.enabled ? null : (options.unsupportedMessage ?? UNSUPPORTED_MESSAGE),
    };
  }

  start(scheduleChecks = true): void {
    if (this.#started) return;
    this.#started = true;
    // The service owns automatic downloads so it can cancel stalls and retry safely.
    this.#updater.autoDownload = false;
    this.#updater.autoInstallOnAppQuit = false;
    this.#updater.allowPrerelease = false;
    this.#failedInstalls = this.#loadFailedInstalls();

    // Remove half-finished and already-installed update files; a newer finished download stays.
    const pending = pendingUpdatesDir();
    if (pending) void cleanPendingUpdates(pending, this.#options.currentVersion);

    this.#updater.on("checking-for-update", () => {
      this.#setStatus({ phase: "checking", progress: null, message: null });
    });
    this.#updater.on("update-available", (info: UpdateInfo) => {
      this.#setStatus({
        phase: "available",
        availableVersion: info.version,
        progress: null,
        checkedAt: new Date().toISOString(),
        message: this.#failedInstalls >= MANUAL_AFTER_FAILURES ? MANUAL_INSTALL_HINT : null,
      });
    });
    this.#updater.on("update-not-available", () => {
      this.#setStatus({
        phase: "up-to-date",
        availableVersion: null,
        progress: null,
        checkedAt: new Date().toISOString(),
        message: null,
      });
    });
    this.#updater.on("download-progress", (progress: ProgressInfo) => {
      if (!this.#downloadToken || this.#downloadToken.cancelled || this.#stopped) return;
      if (progress.transferred > this.#transferred) {
        this.#transferred = progress.transferred;
        this.#watchDownload();
      }
      this.#setStatus({ phase: "downloading", progress: clampProgress(progress.percent) });
    });
    this.#updater.on("update-downloaded", (info: UpdateInfo) => {
      this.#clearStallTimer();
      this.#retryCount = 0;
      this.#downloadedFile = (info as Partial<UpdateDownloadedEvent>).downloadedFile ?? null;
      // Downloaded and verified: if the owner never clicks Restart, it installs on the next quit.
      // Not after a failed attempt on this PC: that would raise a permission prompt at every quit.
      // With Sahkarmi's own helper, electron-updater must not also start an installer on quit.
      const onQuit = this.#failedInstalls === 0;
      const ownHelper = Boolean(this.#options.launchInstaller && this.#downloadedFile);
      this.#installOnQuit = onQuit && ownHelper;
      this.#updater.autoInstallOnAppQuit = onQuit && !ownHelper;
      this.#setStatus({
        phase: "ready",
        availableVersion: info.version,
        progress: 100,
        message:
          this.#failedInstalls === 0
            ? null
            : this.#failureReason
              ? `The last update did not install. ${this.#failureReason} Click Restart to try again.`
              : READY_AFTER_FAILED_INSTALL,
      });
    });
    this.#updater.on("error", (error: unknown) => {
      // The installer could not be started (no file, blocked, or no permission).
      if (this.#installing) {
        this.#failInstall(error);
        return;
      }
      // downloadUpdate also rejects; its catch owns recovery during a transfer.
      if (!this.#downloadTask && !this.#stopped) this.#setError(error);
    });

    if (scheduleChecks && this.#options.enabled) {
      this.#scheduleCheck(this.#options.initialCheckDelayMs);
    }
  }

  getStatus(): UpdateStatus {
    return { ...this.#status };
  }

  async checkOnWake(): Promise<void> {
    if (this.#status.checkedAt && Date.now() - Date.parse(this.#status.checkedAt) < 60_000) return;
    await this.checkForUpdates();
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    if (!this.#options.enabled || this.#stopped) return this.getStatus();
    if (
      this.#status.phase === "checking" ||
      this.#status.phase === "downloading" ||
      this.#status.phase === "ready" ||
      this.#status.phase === "installing"
    ) {
      return this.getStatus();
    }
    this.#setStatus({ phase: "checking", progress: null, message: null });
    try {
      const result = await this.#updater.checkForUpdates();
      if (this.getStatus().phase === "checking") {
        this.#setStatus(
          result?.isUpdateAvailable
            ? {
                phase: "available",
                availableVersion: result.updateInfo.version,
                checkedAt: new Date().toISOString(),
              }
            : {
                phase: "up-to-date",
                availableVersion: null,
                checkedAt: new Date().toISOString(),
              },
        );
      }
    } catch (error) {
      this.#setError(error);
    } finally {
      this.#scheduleCheck(this.#options.checkIntervalMs);
    }
    if (
      this.#status.phase === "available" &&
      this.#options.autoDownload() &&
      !(await this.#needsManualInstall())
    ) {
      void this.downloadUpdate();
    }
    return this.getStatus();
  }

  async downloadUpdate(): Promise<UpdateStatus> {
    if (!this.#options.enabled || this.#stopped) return this.getStatus();
    if (this.#downloadTask) {
      await this.#downloadTask;
      return this.getStatus();
    }
    if (!this.#status.availableVersion || !["available", "error"].includes(this.#status.phase))
      return this.getStatus();
    // No await unless a check is needed: a download starts in the same tick it was asked for.
    if (
      this.#failedInstalls >= MANUAL_AFTER_FAILURES ||
      (this.#options.manualInstall && (await this.#needsManualInstall()))
    ) {
      const version = this.#status.availableVersion;
      try {
        await this.#options.openDownload(version);
        this.#setStatus({
          phase: "available",
          message:
            this.#failedInstalls >= MANUAL_AFTER_FAILURES
              ? `Version ${version} is downloading in your browser. Open the file when it finishes. If Windows warns, choose "More info" and "Run anyway", then Yes. Sahkarmi closes and installs itself.`
              : `Version ${version} is downloading in your browser. Open it and drag Sahkarmi into Applications to replace this version. (This Mac build is not Apple-signed yet, so it cannot install updates by itself.)`,
        });
      } catch (error) {
        this.#setStatus({
          phase: "error",
          message: `Could not open the download: ${reasonOf(error)}. Get it from https://sahkarmi.site`,
        });
      }
      return this.getStatus();
    }
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#setStatus({ phase: "downloading", progress: 0, message: null });
    const token = new CancellationToken();
    this.#downloadToken = token;
    this.#transferred = 0;
    this.#watchDownload();
    this.#downloadTask = Promise.resolve().then(async () => {
      try {
        await this.#updater.downloadUpdate(token);
      } catch (error) {
        if (this.#stopped) return;
        if (isFileInUse(error)) {
          // Windows still holds the update file (usually an install that is still running).
          // Downloading again cannot help and only fetches the whole installer once more.
          this.#retryCount = 0;
          this.#setStatus({
            phase: "error",
            message:
              "Windows is still using the update file, so an update may be installing. Close Sahkarmi, wait a minute, then open it again.",
          });
          return;
        }
        if (this.#retryCount < 2) {
          this.#retryCount += 1;
          this.#updater.disableDifferentialDownload = true;
          this.#setStatus({
            phase: "error",
            message: `Download interrupted. Retrying automatically (${this.#retryCount}/2)…`,
          });
          this.#retryTimer = setTimeout(() => {
            this.#retryTimer = null;
            void this.downloadUpdate();
          }, this.#options.retryDelayMs);
          this.#retryTimer.unref?.();
        } else {
          this.#retryCount = 0;
          this.#setStatus({
            phase: "error",
            message: `Update download failed: ${reasonOf(error)}. Check your connection and retry, or download it from https://sahkarmi.site`,
          });
        }
      } finally {
        this.#clearStallTimer();
        this.#downloadToken = null;
        this.#downloadTask = null;
      }
    });
    await this.#downloadTask;
    return this.getStatus();
  }

  async #needsManualInstall(): Promise<boolean> {
    if (this.#failedInstalls >= MANUAL_AFTER_FAILURES) return true;
    return (await this.#options.manualInstall?.().catch(() => false)) ?? false;
  }

  /** Attempts recorded for a version newer than the one running never installed. */
  #loadFailedInstalls(): number {
    let result: { version: string; code: number } | null = null;
    try {
      result = this.#options.installResult?.() ?? null;
    } catch {}
    if (result && compareVersions(result.version, this.#options.currentVersion) > 0) {
      this.#failureReason =
        result.code === 0
          ? "It installed into another Sahkarmi folder than the one you opened. Open Sahkarmi from the Start menu, or reinstall it from https://sahkarmi.site."
          : (this.#options.describeInstallFailure?.(result.code) ??
            `The installer stopped with code ${result.code}.`);
    }
    const store = this.#options.installAttempts;
    if (!store) return 0;
    let attempt: InstallAttempt | null = null;
    try {
      attempt = store.read();
    } catch {
      return 0;
    }
    if (!attempt) return 0;
    if (compareVersions(attempt.version, this.#options.currentVersion) > 0) return attempt.count;
    // The attempted version (or a newer one) is running: the update installed after all.
    try {
      store.write(null);
    } catch {}
    return 0;
  }

  #watchDownload(): void {
    this.#clearStallTimer();
    this.#stallTimer = setTimeout(
      () => this.#downloadToken?.cancel(),
      this.#options.stallTimeoutMs,
    );
    this.#stallTimer.unref?.();
  }

  #clearStallTimer(): void {
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = null;
  }

  async installUpdate(): Promise<void> {
    if (this.#status.phase !== "ready") throw new Error("An update is not ready to install.");
    const version = this.#status.availableVersion ?? "";
    this.#setStatus({ phase: "installing", message: null });
    this.#installing = true;
    // Written before the installer runs: if this version is still running at the next start,
    // the install did not happen (Windows asked for permission and got No, or the file was
    // blocked), and the next start says so instead of silently asking to restart again.
    try {
      this.#options.installAttempts?.write({
        version,
        count: this.#failedInstalls + 1,
        at: new Date().toISOString(),
      });
    } catch {}
    // Cleared first: beforeInstall shuts the app down, and its quit step must not start a
    // second, silent install.
    this.#installOnQuit = false;
    await this.#options.beforeInstall();
    if (this.#options.launchInstaller && this.#downloadedFile) {
      this.#updater.autoInstallOnAppQuit = false;
      this.#setStatus({
        message:
          "Installing. Sahkarmi closes now and opens again by itself, usually within a minute (a few minutes if antivirus is checking the new files).",
      });
      try {
        // The helper waits for this app to exit, installs, and reopens Sahkarmi either way.
        await this.#options.launchInstaller(this.#downloadedFile, version, "restart");
        return;
      } catch (error) {
        console.warn(
          "[update] Sahkarmi's install helper did not start; using the updater's",
          error,
        );
      }
    }
    this.#updater.quitAndInstall(false, true);
    // The updater reports "cannot start" at once through its error event; a spawned installer
    // quits the app within a second or two. Anything else is a failure to show, not a hang.
    if (!this.#installing) return;
    this.#installTimer = setTimeout(() => this.#failInstall(null), this.#options.installTimeoutMs);
    this.#installTimer.unref?.();
  }

  #failInstall(error: unknown): void {
    if (!this.#installing) return;
    this.#installing = false;
    if (this.#installTimer) clearTimeout(this.#installTimer);
    this.#installTimer = null;
    this.#failedInstalls += 1;
    this.#updater.autoInstallOnAppQuit = false;
    this.#setStatus({
      phase: "error",
      progress: null,
      message: `${
        error
          ? `Could not start the installer: ${reasonOf(error)}.`
          : "The installer did not start."
      } ${INSTALL_DID_NOT_START}`,
    });
    this.#options.afterFailedInstall?.();
  }

  /**
   * The owner is closing Sahkarmi with an update ready: install it silently once the app has
   * exited. True when the helper started (it then also covers the next start's check).
   */
  async installOnQuit(): Promise<boolean> {
    if (!this.#installOnQuit || this.#status.phase !== "ready") return false;
    const file = this.#downloadedFile;
    const launch = this.#options.launchInstaller;
    if (!file || !launch) return false;
    this.#installOnQuit = false;
    const version = this.#status.availableVersion ?? "";
    try {
      this.#options.installAttempts?.write({
        version,
        count: this.#failedInstalls + 1,
        at: new Date().toISOString(),
      });
    } catch {}
    try {
      await launch(file, version, "quit");
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this.#stopped = true;
    this.#clearStallTimer();
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#downloadToken?.cancel();
    if (this.#checkTimer) clearTimeout(this.#checkTimer);
    this.#checkTimer = null;
  }

  #scheduleCheck(delayMs: number): void {
    if (this.#stopped) return;
    if (this.#checkTimer) clearTimeout(this.#checkTimer);
    this.#checkTimer = setTimeout(() => void this.checkForUpdates(), delayMs);
    this.#checkTimer.unref?.();
  }

  #setError(error?: unknown): void {
    this.#setStatus({
      phase: "error",
      progress: null,
      checkedAt: new Date().toISOString(),
      message: `Could not check for updates: ${reasonOf(error)}. Try again.`,
    });
  }

  #setStatus(patch: Partial<UpdateStatus>): void {
    this.#status = { ...this.#status, ...patch };
    this.emit("status", this.getStatus());
  }
}

/** A short, user-readable reason; the full error goes to the app log through the updater logger. */
export function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (
    /ENOTFOUND|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(text)
  ) {
    return "no internet connection";
  }
  // GitHub's release download servers sometimes answer 502/503/504 for a while (seen 2026-11-08).
  if (/\b50[0-4]\b|Gateway Time-?out|Bad Gateway|Service Unavailable/i.test(text))
    return "GitHub's download server is not answering right now (a problem on GitHub's side), try again later";
  if (/ETIMEDOUT|ERR_TIMED_OUT|timeout/i.test(text)) return "the connection timed out";
  if (/ECONNRESET|ERR_CONNECTION|socket hang up/i.test(text))
    return "the connection was interrupted";
  if (/\b(403|429)\b|rate limit/i.test(text))
    return "GitHub is limiting requests, try again in a few minutes";
  if (/\b404\b|Cannot find .*latest/i.test(text)) return "the update files were not found";
  if (/code signature|signature|codesign/i.test(text))
    return "this build is not signed for automatic updates";
  if (/sha512 checksum mismatch/i.test(text)) return "the downloaded file was damaged";
  return "unexpected error (details are in Export diagnostics)";
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? Math.round(value) : 0));
}

type OptionalOption =
  | "launchInstaller"
  | "installResult"
  | "describeInstallFailure"
  | "beforeInstall"
  | "manualInstall"
  | "installAttempts"
  | "afterFailedInstall"
  | "unsupportedMessage";

/** Keeps the last install attempt in `<dir>/update-attempt.json` (written before the app quits). */
export function fileInstallAttemptStore(dir: string): InstallAttemptStore {
  const file = join(dir, "update-attempt.json");
  return {
    read() {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        return null;
      }
      if (typeof parsed !== "object" || parsed === null) return null;
      const { version, count, at } = parsed as Record<string, unknown>;
      if (typeof version !== "string" || !/^\d+\.\d+\.\d+/.test(version)) return null;
      return {
        version,
        count: typeof count === "number" && count > 0 ? Math.floor(count) : 1,
        at: typeof at === "string" ? at : "",
      };
    },
    write(attempt) {
      if (!attempt) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(attempt));
    },
  };
}

/** Where electron-updater keeps downloaded installers on Windows. */
function pendingUpdatesDir(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  return process.platform === "win32" && localAppData
    ? join(localAppData, "sahkarmi-updater", "pending")
    : null;
}

/** -1, 0 or 1, comparing "0.12.1"-style versions number by number. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

const INSTALLER_NAME = /^Sahkarmi-(\d+\.\d+\.\d+)-x64\.exe$/i;

/**
 * Removes update files that can never be used: half-finished downloads (temp-*) and installers
 * for this version or older (they would only install the same version again). A finished
 * download of a newer version, and its update-info.json, are kept so it is not fetched again on
 * every start. Files Windows still holds (a running installer) are left alone.
 */
export async function cleanPendingUpdates(dir: string, currentVersion: string): Promise<void> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  const isOld = (fileName: string) => {
    const version = fileName.match(INSTALLER_NAME)?.[1];
    return version ? compareVersions(version, currentVersion) <= 0 : false;
  };
  for (const name of names) {
    let remove = name.startsWith("temp-") || isOld(name);
    if (name === "update-info.json") {
      try {
        const info = JSON.parse(await readFile(join(dir, name), "utf8")) as { fileName?: unknown };
        remove = typeof info.fileName !== "string" || isOld(info.fileName);
      } catch {
        remove = true;
      }
    }
    if (remove) await rm(join(dir, name), { force: true }).catch(() => {});
  }
}

/** True for "the file is in use" errors (a running installer holds its own file). */
export function isFileInUse(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return /\bEPERM\b|\bEBUSY\b|operation not permitted|resource busy or locked/i.test(text);
}

/**
 * The name of a Sahkarmi installer that is running right now, from `tasklist /FO CSV /NH`
 * output. An installer that finds Sahkarmi open waits for it, so opening the app during an
 * install leaves both stuck.
 */
export function runningInstallerName(tasklistCsv: string, currentVersion: string): string | null {
  for (const line of tasklistCsv.split(/\r?\n/)) {
    const name = line.match(/^"([^"]+)"/)?.[1];
    const version = name?.match(INSTALLER_NAME)?.[1];
    // An installer for this version or an older one can only be a leftover (seen: a 0.8.0
    // installer stuck for a day), never an update this app should wait for.
    if (name && version && compareVersions(version, currentVersion) > 0) return name;
  }
  return null;
}
