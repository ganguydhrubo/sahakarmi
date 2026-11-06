import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

/**
 * Windows PATH as it is now, not as it was when Sahkarmi started (MCP-3). Installing uv, Python or
 * Node while the app runs changes the registry, but `process.env.PATH` keeps the old value until a
 * restart. The registry's machine and user Path are read (cached) and merged in front of it.
 */

export type RegistryPathReader = () => Promise<{ machine: string; user: string } | null>;

let cachedPath: string | null = null;
let extraDirectories: string[] = [];

const POWERSHELL_SCRIPT =
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8;" +
  "$m=[Environment]::GetEnvironmentVariable('Path','Machine');" +
  "$u=[Environment]::GetEnvironmentVariable('Path','User');" +
  "[Console]::Out.Write((@{machine=[string]$m;user=[string]$u}|ConvertTo-Json -Compress))";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { windowsHide: true, timeout: 10_000, encoding: "utf8", maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** `reg query` output → the Path value (REG_SZ or REG_EXPAND_SZ), expanded. */
export function parseRegQuery(output: string, env: NodeJS.ProcessEnv = process.env): string {
  const line = output
    .split(/\r?\n/)
    .find((entry) => /^\s+Path\s+REG_(?:EXPAND_)?SZ\s+/i.test(entry));
  const value = line ? line.replace(/^\s+Path\s+REG_(?:EXPAND_)?SZ\s+/i, "").trim() : "";
  return expandWindowsVariables(value, env);
}

export function expandWindowsVariables(
  value: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return value.replace(/%([^%;]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return key ? (env[key] ?? whole) : whole;
  });
}

/** Reads HKLM Session Manager\Environment and HKCU\Environment Path (PowerShell, then reg.exe). */
export const readRegistryPath: RegistryPathReader = async () => {
  if (process.platform !== "win32") return null;
  try {
    const parsed = JSON.parse(
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_SCRIPT]),
    ) as { machine?: unknown; user?: unknown };
    return {
      machine: typeof parsed.machine === "string" ? parsed.machine : "",
      user: typeof parsed.user === "string" ? parsed.user : "",
    };
  } catch {
    try {
      const [machine, user] = await Promise.all([
        run("reg", [
          "query",
          "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
          "/v",
          "Path",
        ]).catch(() => ""),
        run("reg", ["query", "HKCU\\Environment", "/v", "Path"]).catch(() => ""),
      ]);
      return { machine: parseRegQuery(machine), user: parseRegQuery(user) };
    } catch {
      return null;
    }
  }
};

const normal = (directory: string) =>
  directory
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase();

/** Machine Path, then user Path (Windows' own order), then anything only the process had. */
export function mergePathLists(...lists: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of lists) {
    for (const directory of list.split(";")) {
      const key = normal(directory);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(directory.trim());
    }
  }
  return result.join(";");
}

function processPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PATH ?? env.Path ?? "";
}

/** Re-reads the registry PATH. Called when Settings opens, on Re-check, and once at start. */
export async function refreshFreshPath(
  reader: RegistryPathReader = readRegistryPath,
): Promise<string> {
  const registry = await reader().catch(() => null);
  cachedPath = registry
    ? mergePathLists(registry.machine, registry.user, processPath())
    : processPath();
  return freshPath();
}

/** Folders of tools Sahkarmi downloaded (managed uv / Node), searched last. */
export function setManagedToolDirectories(directories: string[]): void {
  extraDirectories = directories.filter(Boolean);
}

/** The merged PATH (or the process PATH before the first refresh). */
export function freshPath(): string {
  return mergePathLists(cachedPath ?? processPath(), extraDirectories.join(";"));
}

/** Test hook. */
export function resetFreshPathForTests(): void {
  cachedPath = null;
  extraDirectories = [];
}

const STORE_STUB = /[\\/]Microsoft[\\/]WindowsApps[\\/](?:python[0-9.]*|python3)(?:\.exe)?$/i;

/**
 * The Microsoft Store "python.exe" in WindowsApps is a stub that opens the Store and exits 9009
 * when no Store Python is installed (MCP-9). It counts only when a real Store Python exists.
 */
export function isStorePythonStub(
  candidate: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!STORE_STUB.test(candidate)) return false;
  const local = env.LOCALAPPDATA ?? "";
  const apps = local ? join(local, "Microsoft", "WindowsApps") : "";
  try {
    return !(
      apps && readdirSync(apps).some((entry) => /^PythonSoftwareFoundation\.Python\./i.test(entry))
    );
  } catch {
    return true;
  }
}

export interface CommandLookup {
  /** The file Windows would start, or null. */
  path: string | null;
  /** Only the Store stub was found. */
  storeStub: boolean;
}

/** Like `where`: a full path that exists, or the first PATH match with a PATHEXT ending. */
export function lookupCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): CommandLookup {
  if (!command) return { path: null, storeStub: false };
  const endings = extname(command)
    ? [""]
    : ["", ...(env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)];
  const candidates =
    isAbsolute(command) || /[\\/]/.test(command)
      ? [command]
      : processPath(env)
          .split(delimiter)
          .filter(Boolean)
          .map((directory) => join(directory, command));
  let storeStub = false;
  for (const candidate of candidates) {
    for (const ending of endings) {
      for (const file of [candidate + ending.toLowerCase(), candidate + ending]) {
        if (!existsSync(file)) continue;
        if (isStorePythonStub(file, env)) {
          storeStub = true;
          continue;
        }
        return { path: file, storeStub: false };
      }
    }
  }
  return { path: null, storeStub };
}

/** Environment names every Windows program expects; nothing else from Sahkarmi is passed on. */
const BASE_VARIABLES = [
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "USERNAME",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "CommonProgramFiles",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
];

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/**
 * The environment a server is started with (MCP-16). Claude Code merges the server's env over its
 * own process env, Codex over a short allow-list, the MCP SDK over a short allow-list too, so the
 * fresh PATH and the basic Windows names are always given explicitly. Sahkarmi's own provider keys
 * are never added: only the names above and the server's own env go in.
 */
export function serverEnvironment(
  own: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
  path: string = freshPath(),
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of BASE_VARIABLES) {
    const value = read(base, name);
    if (value !== undefined) result[name] = value;
  }
  const ownPath = Object.entries(own).find(([key]) => key.toLowerCase() === "path")?.[1];
  for (const [key, value] of Object.entries(own)) {
    if (key.toLowerCase() !== "path") result[key] = value;
  }
  // The server's own PATH (if it set one) comes first; one PATH key only, never Path and PATH.
  result.PATH = ownPath ? mergePathLists(ownPath, path) : path;
  return result;
}
