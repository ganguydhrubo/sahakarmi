import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { managedToolBinary } from "../backend/cli";
import type { AiRuntimeStatus, AiToolId, AiToolUpdate } from "../shared/ipc";

const execFileAsync = promisify(execFile);

const NPM_REGISTRY = "https://registry.npmjs.org";
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1_000;
/** Downloaded versions of one tool kept on disk: the newest, plus one that may still be running. */
const KEPT_TOOL_VERSIONS = 2;

export interface AiToolDefinition {
  id: AiToolId;
  label: string;
  /** npm package that publishes this tool. */
  packageName: string;
  /** Sahkarmi can install this update itself. */
  managed: boolean;
  /** The command that updates the tool when Sahkarmi cannot do it. */
  command: string | null;
}

type DownloadedToolId = "claude" | "codex";

export const AI_TOOLS: AiToolDefinition[] = [
  {
    id: "opencode",
    label: "OpenCode (bundled)",
    packageName: "opencode-ai",
    managed: true,
    command: null,
  },
  {
    id: "codex",
    label: "Codex CLI",
    packageName: "@openai/codex",
    managed: true,
    command: null,
  },
  {
    id: "claude",
    label: "Claude Code",
    packageName: "@anthropic-ai/claude-code",
    managed: true,
    command: null,
  },
];

/** The npm package that carries the OpenCode binary for one platform. */
export function openCodePlatformPackage(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const npmPlatform = platform === "win32" ? "windows" : platform;
  return `opencode-${npmPlatform}-${arch}`;
}

/**
 * The npm package and version that carry the Claude Code or Codex program for one platform.
 * These are the same files `npm install -g` would fetch.
 */
export function toolPlatformPackage(
  toolId: DownloadedToolId,
  version: string,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): { name: string; version: string } {
  return toolId === "claude"
    ? { name: `@anthropic-ai/claude-code-${platform}-${arch}`, version }
    : { name: "@openai/codex", version: `${version}-${platform}-${arch}` };
}

export function openCodeBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "opencode.exe" : "opencode";
}

/** Compares two dotted versions. Returns a positive number when left is newer. */
export function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function versionParts(version: string): number[] {
  return version
    .trim()
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

const SUPPORTED_DIGESTS = new Set(["sha512", "sha384", "sha256", "sha1"]);

/** The sha512 digest npm publishes for a tarball, as "sha512-<base64>". */
export function parseIntegrity(integrity: string): { algorithm: string; digest: Buffer } | null {
  const match = /^([a-z0-9]+)-(.+)$/i.exec(integrity.trim());
  if (!match?.[1] || !match[2]) return null;
  if (!SUPPORTED_DIGESTS.has(match[1].toLowerCase())) return null;
  return { algorithm: match[1].toLowerCase(), digest: Buffer.from(match[2], "base64") };
}

export function verifyFileIntegrity(filePath: string, integrity: string): boolean {
  const parsed = parseIntegrity(integrity);
  if (!parsed) return false;
  const hash = createHash(parsed.algorithm);
  hash.update(readFileSync(filePath));
  const digest = hash.digest();
  return digest.length === parsed.digest.length && digest.equals(parsed.digest);
}

interface NpmRelease {
  version: string;
  tarball: string;
  integrity: string | null;
}

async function fetchJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Sahkarmi desktop" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export async function latestNpmRelease(
  packageName: string,
  version = "latest",
): Promise<NpmRelease> {
  const payload = (await fetchJson(
    `${NPM_REGISTRY}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
  )) as {
    version?: string;
    dist?: { tarball?: string; integrity?: string };
  };
  if (!payload.version) throw new Error(`${packageName} did not report a version.`);
  return {
    version: payload.version,
    tarball: payload.dist?.tarball ?? "",
    integrity: payload.dist?.integrity ?? null,
  };
}

export interface AiRuntimeServiceOptions {
  /** Folder where Sahkarmi keeps a newer OpenCode runtime: <userData>/runtime. */
  runtimeDirectory: string;
  /** Version of the OpenCode runtime that is running right now. */
  currentOpenCodeVersion: () => Promise<string | null>;
  /** Versions of the AI tools installed on this computer. */
  installedToolVersions: () =>
    | Promise<Record<string, string | null>>
    | Record<string, string | null>;
  /** True when the owner allows Sahkarmi to install updates without asking. */
  autoDownload: () => boolean;
  /** A new Claude Code or Codex copy is ready; the app switches to it when coworkers are idle. */
  onToolDownloaded?: (toolId: AiToolId) => void;
  log: (level: "info" | "warn" | "error", message: string) => void;
  platform?: NodeJS.Platform;
  /** Reads a program's version (tests swap it for a fake). */
  readVersion?: (binary: string) => Promise<string | null>;
  arch?: string;
}

export class AiRuntimeService {
  readonly #options: AiRuntimeServiceOptions;
  #status: AiRuntimeStatus = {
    phase: "idle",
    currentVersion: null,
    availableVersion: null,
    progress: null,
    checkedAt: null,
    message: null,
    tools: [],
  };
  #listeners = new Set<(status: AiRuntimeStatus) => void>();
  #working = false;
  /** Each tool is installed on its own at most once per app session. */
  #autoUpdated = new Set<AiToolId>();

  constructor(options: AiRuntimeServiceOptions) {
    this.#options = options;
  }

  getStatus(): AiRuntimeStatus {
    return { ...this.#status, tools: this.#status.tools.map((tool) => ({ ...tool })) };
  }

  onStatus(listener: (status: AiRuntimeStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Looks up the newest versions. Sahkarmi keeps its own copy of OpenCode, Claude Code and Codex,
   * one folder per version, and never changes the owner's own installs: `npm install -g` updated
   * a copy Sahkarmi did not use (Claude's own installer puts claude.exe first) and failed while
   * a coworker was running the old program. Each tool is downloaded on its own at most once per
   * app session, and only when the owner allows automatic updates.
   */
  async check(force = false, autoUpdate = true): Promise<AiRuntimeStatus> {
    if (this.#working) return this.getStatus();
    const lastCheck = this.#status.checkedAt ? Date.parse(this.#status.checkedAt) : 0;
    if (!force && lastCheck && Date.now() - lastCheck < 60_000) return this.getStatus();
    this.#working = true;
    let shouldAutoUpdate = false;
    let openCodeUpdate = false;
    const toolUpdatesToRun: AiToolId[] = [];
    this.#setStatus({ phase: "checking", message: null, progress: null });
    try {
      const platform = this.#options.platform ?? process.platform;
      const arch = this.#options.arch ?? process.arch;
      const installed = await this.#options.installedToolVersions();
      const tools: AiToolUpdate[] = [];

      const openCodePackage = openCodePlatformPackage(platform, arch);
      const openCodeRelease = await latestNpmRelease(openCodePackage).catch(() => null);
      const currentVersion = await this.#options.currentOpenCodeVersion().catch(() => null);
      const openCodeLatest = openCodeRelease?.version ?? null;
      tools.push({
        id: "opencode",
        label: "OpenCode (bundled)",
        installed: currentVersion,
        latest: openCodeLatest,
        managed: true,
        command: null,
        note:
          currentVersion && openCodeLatest && compareVersions(openCodeLatest, currentVersion) > 0
            ? "Sahkarmi downloads this itself. Restart Sahkarmi after it finishes."
            : null,
      });

      for (const tool of AI_TOOLS.filter((entry) => entry.id !== "opencode")) {
        const release = await latestNpmRelease(tool.packageName).catch(() => null);
        const installedVersion = installed[tool.id] ?? null;
        const newer = Boolean(
          installedVersion && release && compareVersions(release.version, installedVersion) > 0,
        );
        const downloaded =
          newer &&
          release !== null &&
          this.#hasDownloaded(tool.id as DownloadedToolId, release.version, platform);
        if (newer && !downloaded) toolUpdatesToRun.push(tool.id);
        tools.push({
          id: tool.id,
          label: tool.label,
          installed: installedVersion,
          latest: release?.version ?? null,
          managed: true,
          command: null,
          ready: downloaded,
          note: downloaded
            ? `v${release?.version} is downloaded. Sahkarmi switches to it when your coworkers are not busy.`
            : newer
              ? "Update now downloads Sahkarmi's own copy. Your own install is not changed."
              : null,
        });
      }

      // Upstream references excluded per Sahkarmi 100% white-label branding
      openCodeUpdate = Boolean(
        currentVersion && openCodeLatest && compareVersions(openCodeLatest, currentVersion) > 0,
      );
      const anyUpdate = Boolean(openCodeUpdate) || toolUpdatesToRun.length > 0;
      this.#setStatus({
        phase: anyUpdate ? "available" : "up-to-date",
        currentVersion,
        availableVersion: openCodeUpdate ? openCodeLatest : null,
        progress: null,
        checkedAt: new Date().toISOString(),
        message: null,
        tools,
      });
      if (openCodeUpdate) toolUpdatesToRun.unshift("opencode");
      shouldAutoUpdate = autoUpdate && this.#options.autoDownload();
    } catch (error) {
      this.#setStatus({
        phase: "error",
        progress: null,
        checkedAt: new Date().toISOString(),
        message: `Could not check the AI tools: ${reasonOf(error)}`,
      });
    } finally {
      this.#working = false;
    }
    if (shouldAutoUpdate) {
      for (const toolId of toolUpdatesToRun) {
        if (this.#autoUpdated.has(toolId)) continue;
        this.#autoUpdated.add(toolId);
        await this.update(toolId);
      }
    }
    return this.getStatus();
  }

  /** Installs one update: the bundled OpenCode runtime, or a user's own npm tool. */
  async update(toolId: AiToolId): Promise<AiRuntimeStatus> {
    if (this.#working) return this.getStatus();
    this.#working = true;
    let succeeded = false;
    try {
      if (toolId === "opencode") {
        await this.#updateOpenCodeRuntime();
      } else {
        await this.#downloadTool(toolId as DownloadedToolId);
      }
      succeeded = true;
    } catch (error) {
      this.#options.log("error", `AI tool update failed: ${reasonOf(error)}`);
      this.#setStatus({
        phase: "error",
        progress: null,
        message: `Could not update: ${reasonOf(error)}`,
      });
    } finally {
      this.#working = false;
    }
    if (succeeded) {
      // Re-read versions, but never chain another install from here.
      const { phase, message } = this.#status;
      await this.check(true, false);
      this.#setStatus({ phase, message });
      if (toolId !== "opencode") this.#options.onToolDownloaded?.(toolId);
    }
    return this.getStatus();
  }

  async #updateOpenCodeRuntime(): Promise<void> {
    const platform = this.#options.platform ?? process.platform;
    const arch = this.#options.arch ?? process.arch;
    const packageName = openCodePlatformPackage(platform, arch);
    const release = await latestNpmRelease(packageName);
    const current = await this.#options.currentOpenCodeVersion().catch(() => null);
    if (current && compareVersions(release.version, current) <= 0) {
      this.#setStatus({
        phase: "up-to-date",
        availableVersion: null,
        progress: null,
        message: `OpenCode ${current} is already the latest version.`,
      });
      return;
    }
    this.#setStatus({
      phase: "updating",
      availableVersion: release.version,
      progress: 0,
      message: `Downloading OpenCode ${release.version}…`,
    });
    const work = mkdtempSync(join(tmpdir(), "sahkarmi-runtime-"));
    try {
      if (!release.tarball) throw new Error("The OpenCode package did not publish a download.");
      const tarball = join(work, "package.tgz");
      await downloadFile(release.tarball, tarball, (percent) =>
        this.#setStatus({ phase: "updating", progress: percent }),
      );
      if (release.integrity && !verifyFileIntegrity(tarball, release.integrity)) {
        throw new Error("The downloaded file did not match the checksum npm published.");
      }
      const extracted = join(work, "extracted");
      mkdirSync(extracted, { recursive: true });
      await extractTarball(tarball, extracted);
      const binary = join(extracted, "package", "bin", openCodeBinaryName(platform));
      if (!existsSync(binary)) throw new Error("The OpenCode package did not contain a runtime.");
      if (platform !== "win32") chmodSync(binary, 0o755);
      const reported = await readBinaryVersion(binary);
      if (reported !== release.version) {
        throw new Error(`The downloaded runtime reported ${reported ?? "no version"}.`);
      }
      const target = join(this.#options.runtimeDirectory, "opencode", release.version);
      mkdirSync(target, { recursive: true });
      const staged = join(target, `${openCodeBinaryName(platform)}.new`);
      copyFileSync(binary, staged);
      if (platform !== "win32") chmodSync(staged, 0o755);
      renameSync(staged, join(target, openCodeBinaryName(platform)));
      await writeFile(
        join(this.#options.runtimeDirectory, "opencode", "current.json"),
        JSON.stringify(
          { version: release.version, installedAt: new Date().toISOString() },
          null,
          2,
        ),
      );
      this.#options.log("info", `Bundled OpenCode runtime updated to ${release.version}`);
      this.#setStatus({
        phase: "updated",
        currentVersion: release.version,
        availableVersion: null,
        progress: 100,
        message: `OpenCode ${release.version} is ready. Restart Sahkarmi to use it.`,
      });
    } finally {
      // Windows can still hold the extracted files for a moment (antivirus, the version probe);
      // a leftover temp folder must not turn a finished update into "Could not update".
      try {
        rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (error) {
        this.#options.log("warn", `Temporary update folder not removed: ${reasonOf(error)}`);
      }
    }
  }

  #hasDownloaded(toolId: DownloadedToolId, version: string, platform: NodeJS.Platform): boolean {
    return existsSync(
      managedToolBinary(toolId, join(this.#options.runtimeDirectory, toolId, version), platform),
    );
  }

  /**
   * Downloads Claude Code or Codex from npm into <runtime>/<tool>/<version>/, next to the older
   * copy, checks npm's checksum and the program's own version, then makes the folder appear in
   * one step. A coworker still running the older copy is not disturbed, and nothing the owner
   * installed is changed.
   */
  async #downloadTool(toolId: DownloadedToolId): Promise<void> {
    const tool = AI_TOOLS.find((entry) => entry.id === toolId);
    if (!tool) throw new Error("Unknown AI tool.");
    const platform = this.#options.platform ?? process.platform;
    const arch = this.#options.arch ?? process.arch;
    const { version } = await latestNpmRelease(tool.packageName);
    const root = join(this.#options.runtimeDirectory, toolId);
    const target = join(root, version);
    const ready = `${tool.label} ${version} is ready. Sahkarmi switches to it when your coworkers are not busy.`;
    if (this.#hasDownloaded(toolId, version, platform)) {
      this.#setStatus({ phase: "updated", progress: null, message: ready });
      return;
    }
    const platformPackage = toolPlatformPackage(toolId, version, platform, arch);
    const release = await latestNpmRelease(platformPackage.name, platformPackage.version);
    if (!release.tarball || !release.integrity) {
      throw new Error(`npm did not publish ${tool.label} ${version} for ${platform}-${arch}.`);
    }
    this.#setStatus({
      phase: "updating",
      progress: 0,
      message: `Downloading ${tool.label} ${version}…`,
    });
    const work = mkdtempSync(join(tmpdir(), `sahkarmi-${toolId}-`));
    const staged = `${target}.partial-${Date.now()}`;
    try {
      const tarball = join(work, "package.tgz");
      await downloadFile(release.tarball, tarball, (percent) =>
        this.#setStatus({ phase: "updating", progress: percent }),
      );
      if (!verifyFileIntegrity(tarball, release.integrity)) {
        throw new Error("The downloaded file did not match the checksum npm published.");
      }
      const extracted = join(work, "extracted");
      mkdirSync(extracted, { recursive: true });
      await extractTarball(tarball, extracted);
      let source = join(extracted, "package");
      if (toolId === "codex") {
        const vendor = join(source, "vendor");
        const [triple] = existsSync(vendor) ? readdirSync(vendor) : [];
        if (!triple) throw new Error("The Codex package did not contain a program.");
        source = join(vendor, triple);
      }
      const binary = managedToolBinary(toolId, source, platform);
      if (!existsSync(binary)) {
        throw new Error(`The ${tool.label} package did not contain a program.`);
      }
      if (platform !== "win32") chmodSync(binary, 0o755);
      const reported = await (this.#options.readVersion ?? readBinaryVersion)(binary);
      if (reported !== version) {
        throw new Error(`The downloaded ${tool.label} reported ${reported ?? "no version"}.`);
      }
      mkdirSync(root, { recursive: true });
      cpSync(source, staged, { recursive: true });
      renameSync(staged, target);
      this.#options.log("info", `${tool.label} ${version} downloaded to ${target}`);
      this.#pruneToolVersions(root);
      this.#setStatus({ phase: "updated", progress: 100, message: ready });
    } finally {
      for (const leftover of [work, staged]) {
        try {
          rmSync(leftover, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch (error) {
          this.#options.log("warn", `Temporary update folder not removed: ${reasonOf(error)}`);
        }
      }
    }
  }

  /** Removes older downloaded versions; one still running stays until a later update. */
  #pruneToolVersions(root: string): void {
    const versions = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersions)
      .reverse();
    for (const old of versions.slice(KEPT_TOOL_VERSIONS)) {
      try {
        rmSync(join(root, old), { recursive: true, force: true });
      } catch {
        /* Still running; removed after a later update. */
      }
    }
  }

  #setStatus(patch: Partial<AiRuntimeStatus>): void {
    this.#status = { ...this.#status, ...patch };
    const snapshot = this.getStatus();
    for (const listener of this.#listeners) listener(snapshot);
  }
}

async function readBinaryVersion(binary: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(binary, ["--version"], {
      timeout: 20_000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs tar from the tarball's folder with relative paths: GNU tar (first on PATH when Git is
 * installed on Windows) reads an absolute "C:\..." path as a remote host and fails.
 */
async function extractTarball(tarball: string, destination: string): Promise<void> {
  const cwd = dirname(tarball);
  await execFileAsync("tar", ["-xzf", basename(tarball), "-C", relative(cwd, destination) || "."], {
    cwd,
    timeout: 120_000,
    windowsHide: true,
  });
}

async function downloadFile(
  url: string,
  destination: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  const response = await fetch(url, {
    headers: { "user-agent": "Sahkarmi desktop" },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`The download failed (${response.status}).`);
  }
  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on("data", (chunk: Buffer) => {
    received += chunk.length;
    onProgress(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0);
  });
  await pipeline(source, createWriteStream(destination));
}

export function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(text))
    return "no internet connection";
  if (/ETIMEDOUT|ERR_TIMED_OUT|timed out|timeout/i.test(text)) return "the connection timed out";
  if (/ECONNRESET|ERR_CONNECTION|socket hang up/i.test(text))
    return "the connection was interrupted";
  if (/checksum|integrity/i.test(text)) return "the downloaded file did not match its checksum";
  // Only a missing npm is "not available"; any other npm failure keeps npm's own reason.
  if (/ENOENT|is not recognized as an internal or external command/i.test(text))
    return "npm is not available on this computer";
  if (/EBUSY|EPERM/i.test(text))
    return "a file of the tool is in use; close its windows and click Update now again";
  const npmError = text.match(/npm (?:ERR!|error) (?!code\b)(.+)/i)?.[1]?.trim();
  return npmError || text || "unexpected error";
}
