import { EventEmitter } from "node:events";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type AppUpdater,
  CancellationToken,
  type ProgressInfo,
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

interface UpdateServiceOptions {
  currentVersion: string;
  enabled: boolean;
  beforeInstall: () => Promise<void>;
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
}

const DEFAULT_CHECK_INTERVAL = 15 * 60 * 1_000;

export function supportsInstalledUpdates(platform: NodeJS.Platform): boolean {
  return platform === "darwin" || platform === "win32";
}

export class UpdateService extends EventEmitter<UpdateServiceEvents> {
  readonly #updater: UpdateAdapter;
  readonly #options: Required<Omit<UpdateServiceOptions, "beforeInstall" | "manualInstall">> &
    Pick<UpdateServiceOptions, "beforeInstall" | "manualInstall">;
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

  constructor(updater: UpdateAdapter, options: UpdateServiceOptions) {
    super();
    this.#updater = updater;
    this.#options = {
      ...options,
      initialCheckDelayMs: options.initialCheckDelayMs ?? 12_000,
      checkIntervalMs: options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL,
      stallTimeoutMs: options.stallTimeoutMs ?? 45_000,
      retryDelayMs: options.retryDelayMs ?? 3_000,
      autoDownload: options.autoDownload ?? (() => true),
      openDownload: options.openDownload ?? (async () => undefined),
    };
    this.#status = {
      phase: options.enabled ? "idle" : "unsupported",
      currentVersion: options.currentVersion,
      availableVersion: null,
      progress: null,
      checkedAt: null,
      message: options.enabled ? null : "Updates are available in installed desktop builds.",
    };
  }

  start(scheduleChecks = true): void {
    if (this.#started) return;
    this.#started = true;
    // The service owns automatic downloads so it can cancel stalls and retry safely.
    this.#updater.autoDownload = false;
    this.#updater.autoInstallOnAppQuit = false;
    this.#updater.allowPrerelease = false;

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
        message: null,
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
      // Downloaded and verified: if the owner never clicks Restart, it installs on the next quit.
      this.#updater.autoInstallOnAppQuit = true;
      this.#setStatus({
        phase: "ready",
        availableVersion: info.version,
        progress: 100,
        message: null,
      });
    });
    this.#updater.on("error", (error: unknown) => {
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
    if (this.#options.manualInstall && (await this.#needsManualInstall())) {
      const version = this.#status.availableVersion;
      try {
        await this.#options.openDownload(version);
        this.#setStatus({
          phase: "available",
          message: `Version ${version} is downloading in your browser. Open it and drag Sahkarmi into Applications to replace this version. (This Mac build is not Apple-signed yet, so it cannot install updates by itself.)`,
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
    return (await this.#options.manualInstall?.().catch(() => false)) ?? false;
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
    this.#setStatus({ phase: "installing", message: null });
    await this.#options.beforeInstall();
    this.#updater.quitAndInstall(false, true);
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
