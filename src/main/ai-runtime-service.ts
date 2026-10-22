import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { AiRuntimeStatus, AiToolId, AiToolUpdate } from "../shared/ipc";

const execFileAsync = promisify(execFile);

const NPM_REGISTRY = "https://registry.npmjs.org";
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1_000;
const NPM_INSTALL_TIMEOUT_MS = 15 * 60 * 1_000;

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
    managed: false,
    command: "npm install -g @openai/codex@latest",
  },
  {
    id: "claude",
    label: "Claude Code",
    packageName: "@anthropic-ai/claude-code",
    managed: false,
    command: "npm install -g @anthropic-ai/claude-code@latest",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    packageName: "@google/gemini-cli",
    managed: false,
    command: "npm install -g @google/gemini-cli@latest",
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

export async function latestNpmRelease(packageName: string): Promise<NpmRelease> {
  const payload = (await fetchJson(
    `${NPM_REGISTRY}/${encodeURIComponent(packageName)}/latest`,
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
  log: (level: "info" | "warn" | "error", message: string) => void;
  platform?: NodeJS.Platform;
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

  async check(force = false): Promise<AiRuntimeStatus> {
    if (this.#working) return this.getStatus();
    const lastCheck = this.#status.checkedAt ? Date.parse(this.#status.checkedAt) : 0;
    if (!force && lastCheck && Date.now() - lastCheck < 60_000) return this.getStatus();
    this.#working = true;
    let shouldAutoUpdate = false;
    let openCodeUpdate = false;
    const npmUpdatesToRun: AiToolId[] = [];
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
        const hasUpdate =
          installedVersion && release && compareVersions(release.version, installedVersion) > 0;
        if (hasUpdate) npmUpdatesToRun.push(tool.id);
        tools.push({
          id: tool.id,
          label: tool.label,
          installed: installedVersion,
          latest: release?.version ?? null,
          managed: true,
          command: tool.command,
          note: hasUpdate ? "Will be updated automatically in the background." : null,
        });
      }

      // Upstream references excluded per Sahkarmi 100% white-label branding
      openCodeUpdate = Boolean(
        currentVersion && openCodeLatest && compareVersions(openCodeLatest, currentVersion) > 0,
      );
      const anyUpdate = Boolean(openCodeUpdate) || npmUpdatesToRun.length > 0;
      this.#setStatus({
        phase: anyUpdate ? "available" : "up-to-date",
        currentVersion,
        availableVersion: openCodeUpdate ? openCodeLatest : null,
        progress: null,
        checkedAt: new Date().toISOString(),
        message: null,
        tools,
      });
      shouldAutoUpdate = anyUpdate && this.#options.autoDownload();
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
      if (openCodeUpdate) await this.update("opencode");
      for (const toolId of npmUpdatesToRun) {
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
      if (toolId === "openbot") {
        throw new Error("Upstream OpenBot releases are not merged into Sahkarmi by design.");
      }
      if (toolId === "opencode") {
        await this.#updateOpenCodeRuntime();
      } else {
        await this.#updateNpmTool(toolId);
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
      await this.check(true);
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
      rmSync(work, { recursive: true, force: true });
    }
  }

  async #updateNpmTool(toolId: AiToolId): Promise<void> {
    const tool = AI_TOOLS.find((entry) => entry.id === toolId);
    if (!tool) throw new Error("Unknown AI tool.");
    this.#setStatus({
      phase: "updating",
      progress: null,
      message: `Updating ${tool.label}…`,
    });
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    await execFileAsync(npm, ["install", "-g", `${tool.packageName}@latest`], {
      timeout: NPM_INSTALL_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    this.#options.log("info", `${tool.label} updated with npm install -g`);
    this.#setStatus({
      phase: "updated",
      progress: 100,
      message: `${tool.label} was updated. Restart Sahkarmi so it picks up the new version.`,
    });
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

async function extractTarball(tarball: string, destination: string): Promise<void> {
  await execFileAsync("tar", ["-xzf", tarball, "-C", destination], {
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
  if (/npm|ENOENT/i.test(text)) return "npm is not available on this computer";
  return text || "unexpected error";
}
