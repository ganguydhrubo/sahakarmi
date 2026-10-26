import { execFile } from "node:child_process";
import { constants, existsSync, readdirSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve, win32 } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MINIMUM_CODEX_VERSION = [0, 144, 1] as const;

export interface CodexCliInfo {
  executable: string;
  version: string;
}

export interface ClaudeCliInfo {
  executable: string;
  version: string;
}

/** Any ACP agent found on this machine or set up by Sahkarmi (OpenCode, Google Antigravity). */
export interface AcpCliInfo {
  executable: string;
  version: string;
  bundled: boolean;
}

export class CodexCliError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid" | "outdated",
  ) {
    super(message);
    this.name = "CodexCliError";
  }
}

let toolsDirectory: string | null = null;
let runtimeDirectory: string | null = null;

/** Where Sahkarmi keeps AI tools it downloaded itself (userData/tools). Set once at startup. */
export function setToolsDirectory(directory: string): void {
  toolsDirectory = directory;
}

/** Where Sahkarmi keeps a newer OpenCode runtime it downloaded itself. Set once at startup. */
export function setRuntimeDirectory(directory: string): void {
  runtimeDirectory = directory;
}

/**
 * A newer OpenCode runtime that Sahkarmi downloaded and verified: <runtime>/opencode/<version>/.
 * The newest version wins, so an update takes over from the copy inside the installer.
 */
export function managedOpenCodePaths(platform: NodeJS.Platform = process.platform): string[] {
  if (!runtimeDirectory) return [];
  const root = join(runtimeDirectory, "opencode");
  if (!existsSync(root)) return [];
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareVersionStrings);
  const newest = versions.at(-1);
  if (!newest) return [];
  const binary = platform === "win32" ? "opencode.exe" : "opencode";
  const path = join(root, newest, binary);
  return existsSync(path) ? [path] : [];
}

/**
 * A downloaded Google Antigravity runtime: <runtime>/antigravity/<version>/agy_acp_server(.exe).
 */
export function managedAntigravityPaths(platform: NodeJS.Platform = process.platform): string[] {
  if (!runtimeDirectory) return [];
  const root = join(runtimeDirectory, "antigravity");
  if (!existsSync(root)) return [];
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionStrings);
  const newest = versions.at(-1);
  if (!newest) return [];
  const binary = platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server";
  const path = join(root, newest, binary);
  return existsSync(path) ? [path] : [];
}

function compareVersionStrings(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Codex downloaded by the Connect button: <tools>/codex/bin/codex(.exe). */
export function managedCodexPath(platform: NodeJS.Platform = process.platform): string | null {
  if (!toolsDirectory) return null;
  return join(toolsDirectory, "codex", "bin", platform === "win32" ? "codex.exe" : "codex");
}

/**
 * Claude Code ships inside Sahkarmi with the Claude Agent SDK (one native binary per platform).
 * Packaged builds unpack it from the asar archive so it can run.
 */
export function bundledClaudePaths(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  resourcesPath: string | undefined = (process as { resourcesPath?: string }).resourcesPath,
): string[] {
  const binary = platform === "win32" ? "claude.exe" : "claude";
  const packageDir = join("node_modules", "@anthropic-ai", `claude-agent-sdk-${platform}-${arch}`);
  const paths: string[] = [];
  if (resourcesPath) paths.push(join(resourcesPath, "app.asar.unpacked", packageDir, binary));
  paths.push(resolve(packageDir, binary));
  return paths;
}

export async function resolveCodexCli(): Promise<CodexCliInfo> {
  const override = process.env.SAHKARMI_CODEX_PATH;
  const managed = managedCodexPath();
  const candidates = [
    ...(await collectCandidates("codex", override)),
    ...(!override?.trim() && managed ? [managed] : []),
  ];
  const failures: CodexCliError[] = [];

  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;

    try {
      const stdout = await readCliVersion(candidate);
      const version = parseCodexVersion(stdout);
      if (!isMinimumVersion(version)) {
        throw new CodexCliError(
          `Codex CLI ${version} is too old. Sahkarmi requires 0.144.1 or newer.`,
          "outdated",
        );
      }

      return { executable: candidate, version };
    } catch (error) {
      failures.push(
        error instanceof CodexCliError
          ? error
          : new CodexCliError("Codex CLI was found but could not be started.", "invalid"),
      );
    }
  }

  const outdated = failures.find((failure) => failure.code === "outdated");
  if (outdated) throw outdated;
  if (failures.length > 0) {
    throw new CodexCliError(
      "Codex CLI was found but could not be started. Run `codex --version` in a new terminal.",
      "invalid",
    );
  }

  throw new CodexCliError(
    "Codex CLI was not found. Install Codex, run `codex login`, then restart Sahkarmi.",
    "missing",
  );
}

/**
 * The Claude SDK starts the CLI directly, without a shell, and Windows refuses to start a
 * .cmd or .bat that way ("spawn EINVAL"). `where claude` lists the npm claude.cmd before
 * claude.exe, so real executables and the bundled binary go first and scripts go last.
 */
export function orderClaudeCandidates(
  found: string[],
  bundled: string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== "win32") return [...found, ...bundled];
  const isScript = (path: string) => [".cmd", ".bat"].includes(extname(path).toLowerCase());
  return [
    ...new Set([...found.filter((path) => !isScript(path)), ...bundled, ...found.filter(isScript)]),
  ];
}

export async function resolveClaudeCli(
  bundled: string[] = bundledClaudePaths(),
): Promise<ClaudeCliInfo> {
  const override = process.env.SAHKARMI_CLAUDE_PATH;
  const candidates = orderClaudeCandidates(
    await collectCandidates("claude", override),
    override?.trim() ? [] : bundled,
  );
  let foundCandidate = false;

  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    foundCandidate = true;

    try {
      const stdout = await readCliVersion(candidate);
      return { executable: candidate, version: parseClaudeVersion(stdout) };
    } catch {
      // Try the next executable candidate.
    }
  }

  if (foundCandidate) {
    throw new CodexCliError(
      "Claude CLI was found but could not be started. Run `claude --version` in a new terminal.",
      "invalid",
    );
  }

  throw new CodexCliError(
    "Claude CLI was not found. Install Claude Code, run `claude auth login`, then restart Sahkarmi.",
    "missing",
  );
}

/**
 * Google's Antigravity ACP server (agy_acp_server), downloaded by the Connect button into
 * <runtime>/antigravity/<version>/. The Antigravity IDE itself is not an agent server and is never used.
 */
export async function resolveAntigravityCli(): Promise<AcpCliInfo> {
  const override = process.env.SAHKARMI_ANTIGRAVITY_PATH?.trim();
  const managed = override ? [] : managedAntigravityPaths();
  const candidates = override
    ? [override]
    : [...managed, ...(await collectCandidates("agy_acp_server", undefined))];
  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    return {
      executable: candidate,
      version: antigravityVersionOf(candidate),
      bundled: managed.includes(candidate),
    };
  }
  throw new CodexCliError(
    "Google Antigravity is not set up yet. Use Connect to set it up.",
    "missing",
  );
}

/** The version folder a managed agy_acp_server sits in, or "unknown" for a copy found on PATH. */
function antigravityVersionOf(executable: string): string {
  const parent = basename(dirname(executable));
  return /^\d+\.\d+\.\d+$/.test(parent) ? parent : "unknown";
}

/**
 * OpenCode ships inside Sahkarmi (resources/bin) so free models work with no install.
 * A runtime that Sahkarmi downloaded itself is newer than the copy in the installer and wins.
 * A user-installed `opencode` on PATH is used only when no bundled copy exists.
 */
export async function resolveOpenCodeCli(
  bundledCandidates: string[] = bundledOpenCodePaths(),
): Promise<AcpCliInfo> {
  const override = process.env.SAHKARMI_OPENCODE_PATH?.trim();
  const managed = override ? [] : managedOpenCodePaths();
  const bundled = override ? [] : bundledCandidates;
  const candidates = override
    ? [override]
    : [...managed, ...bundled, ...(await collectCandidates("opencode", undefined))];
  for (const candidate of candidates) {
    if (!(await isExecutable(candidate))) continue;
    try {
      return {
        executable: candidate,
        version: parseSemver(await readCliVersion(candidate), "OpenCode"),
        bundled: managed.includes(candidate) || bundled.includes(candidate),
      };
    } catch {
      // Try the next executable candidate.
    }
  }
  throw new CodexCliError(
    "OpenCode was not found. Reinstall Sahkarmi, or install it with `npm install -g opencode-ai`.",
    "missing",
  );
}

export function bundledOpenCodePaths(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  resourcesPath: string | undefined = (process as { resourcesPath?: string }).resourcesPath,
): string[] {
  const binary = platform === "win32" ? "opencode.exe" : "opencode";
  const builderOs = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
  const paths: string[] = [];
  if (resourcesPath) paths.push(join(resourcesPath, "bin", binary));
  // Development checkout: `bun run fetch:opencode` downloads it here.
  paths.push(resolve("build", "opencode", `${builderOs}-${arch}`, binary));
  return paths;
}

function parseSemver(output: string, label: string): string {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new CodexCliError(`Unable to read the ${label} version.`, "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseCodexVersion(output: string): string {
  const match = output.match(/(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) throw new CodexCliError("Unable to read the Codex CLI version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function parseClaudeVersion(output: string): string {
  const match = output.match(/(\d+)\.(\d+)\.(\d+)(?:\s+\(Claude Code\))?/i);
  if (!match) throw new CodexCliError("Unable to read the Claude CLI version.", "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function isMinimumVersion(version: string): boolean {
  const parts = version.split(".").map(Number);
  for (let index = 0; index < MINIMUM_CODEX_VERSION.length; index += 1) {
    if (parts[index] > MINIMUM_CODEX_VERSION[index]) return true;
    if (parts[index] < MINIMUM_CODEX_VERSION[index]) return false;
  }
  return true;
}

async function collectCandidates(
  command: string,
  configuredPath: string | undefined,
): Promise<string[]> {
  const candidates: string[] = [];
  const override = configuredPath?.trim();
  if (override) return [override];

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("where.exe", [command], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
      });
      candidates.push(
        ...stdout
          .split(/\r?\n/u)
          .map((path) => path.trim())
          .filter(Boolean),
      );
    } catch {
      // Known Windows install locations are checked next.
    }
    candidates.push(...windowsFallbackPaths(command));
  } else {
    try {
      const { stdout } = await execFileAsync("/bin/zsh", ["-lic", `command -v ${command}`], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
      });
      if (stdout.trim()) candidates.push(stdout.trim());
    } catch {
      // Packaged macOS apps often have a restricted PATH; known locations are checked next.
    }
    candidates.push(...posixFallbackPaths(command));
  }

  return [...new Set(candidates)];
}

export function windowsFallbackPaths(
  command: string,
  userHome = homedir(),
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const paths: string[] = [];
  const appData = environment.APPDATA?.trim();
  const localAppData = environment.LOCALAPPDATA?.trim();

  if (command === "codex" && localAppData) {
    paths.push(win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
  }
  if (command === "claude" && localAppData) {
    paths.push(win32.join(localAppData, "Microsoft", "WinGet", "Links", "claude.exe"));
  }
  if (appData) paths.push(win32.join(appData, "npm", `${command}.cmd`));
  paths.push(
    win32.join(userHome, ".local", "bin", `${command}.exe`),
    win32.join(userHome, ".bun", "bin", `${command}.exe`),
    win32.join(userHome, ".bun", "bin", `${command}.cmd`),
  );
  if (localAppData) {
    paths.push(
      win32.join(localAppData, "pnpm", `${command}.exe`),
      win32.join(localAppData, "pnpm", `${command}.cmd`),
    );
  }

  return paths;
}

function posixFallbackPaths(command: string): string[] {
  const paths = [join(homedir(), ".local", "bin", command)];
  if (command === "claude") paths.push(join(homedir(), ".claude", "local", "claude"));
  if (command === "opencode") paths.push(join(homedir(), ".opencode", "bin", "opencode"));
  paths.push(
    join(homedir(), ".npm-global", "bin", command),
    join(homedir(), ".bun", "bin", command),
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
  );
  return paths;
}

/**
 * `--version` of a 200 MB single-file binary (OpenCode, Google's agent) can take well over
 * 5 s on a cold or busy disk; a short timeout made a working runtime look "not installed".
 */
const CLI_VERSION_TIMEOUT_MS = 25_000;

async function readCliVersion(candidate: string): Promise<string> {
  if (process.platform === "win32" && [".bat", ".cmd"].includes(extname(candidate).toLowerCase())) {
    const commandProcessor = process.env.ComSpec?.trim() || "cmd.exe";
    const escapedCandidate = candidate.replaceAll("%", "%%");
    const { stdout } = await execFileAsync(
      commandProcessor,
      ["/d", "/s", "/c", `""${escapedCandidate}" --version"`],
      {
        timeout: CLI_VERSION_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
    return stdout;
  }

  const { stdout } = await execFileAsync(candidate, ["--version"], {
    timeout: CLI_VERSION_TIMEOUT_MS,
    maxBuffer: 64 * 1024,
    windowsHide: process.platform === "win32",
  });
  return stdout;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
