import { execFile } from "node:child_process";
import { isRecord } from "./protocol";

/**
 * Coworker programs a previous Sahkarmi run started and left behind (the app was force-closed or
 * crashed): found at start and closed, so they stop holding memory. Very conservative on purpose:
 * a process is closed only when ALL of these hold:
 * - its name is one of the coworker engine programs Sahkarmi starts;
 * - its parent process is gone (a live parent means someone still owns it: a terminal, an
 *   editor, another Sahkarmi window);
 * - it started before this Sahkarmi run did;
 * - it clearly comes from Sahkarmi: its program file sits in Sahkarmi's own folders, or its
 *   command line carries a name only Sahkarmi's own launches use.
 * The owner's own terminals and assistant apps fail at least one test and are never touched.
 */

const MB = 1024 * 1024;

export interface EngineProcess {
  pid: number;
  ppid: number;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
  /** Start time in ms since 1970, or null when Windows did not say. */
  createdAt: number | null;
}

export interface LeftoverRules {
  /** This Sahkarmi process; never a candidate. */
  selfPid: number;
  /** When this run started (ms); only older processes can be leftovers. */
  startedAt: number;
  /** Sahkarmi's own program folders (bundled engines, managed tools, runtimes). */
  ownFolders: string[];
  /** Text only Sahkarmi's own engine launches put on the command line. */
  markers: string[];
}

/** The engine programs Sahkarmi starts for coworkers. */
const ENGINE_NAMES = new Set(["claude.exe", "codex.exe", "opencode.exe", "gemini.exe"]);
const ENGINE_PREFIXES = ["agy_", "localharness"];

/** The name of the browser tool server Sahkarmi gives its own Claude coworkers. */
export const SAHKARMI_LAUNCH_MARKERS = ["sahkarmi_browser"];

function isEngineName(name: string): boolean {
  const lower = name.toLowerCase();
  return ENGINE_NAMES.has(lower) || ENGINE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function normaliseFolder(folder: string): string {
  const slashed = folder.replaceAll("/", "\\").toLowerCase();
  return slashed.endsWith("\\") ? slashed : `${slashed}\\`;
}

function inFolder(path: string | null, folders: string[]): boolean {
  if (!path) return false;
  const lower = path.replaceAll("/", "\\").toLowerCase();
  return folders.some((folder) => lower.startsWith(folder));
}

/** The leftovers among `rows` (a list of every process), by the rules above. Pure. */
export function findLeftoverEngines(rows: EngineProcess[], rules: LeftoverRules): EngineProcess[] {
  const alive = new Set(rows.map((row) => row.pid));
  const folders = rules.ownFolders.filter((folder) => folder.trim().length > 3).map(normaliseFolder);
  const markers = rules.markers.filter((marker) => marker.length >= 6);
  return rows.filter((row) => {
    if (!Number.isInteger(row.pid) || row.pid <= 4 || row.pid === rules.selfPid) return false;
    if (!isEngineName(row.name)) return false;
    if (alive.has(row.ppid)) return false;
    if (row.createdAt === null || !(row.createdAt < rules.startedAt)) return false;
    const fromOwnFolder = inFolder(row.executablePath, folders);
    const ownLaunch = markers.some((marker) => row.commandLine?.includes(marker) ?? false);
    return fromOwnFolder || ownLaunch;
  });
}

/** CIM's "/Date(1794160931794)/" (or a plain number) as ms; null otherwise. */
export function parseCimDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = /\/Date\((-?\d+)\)\//.exec(value);
  if (!match) return null;
  const ms = Number(match[1]);
  return Number.isFinite(ms) ? ms : null;
}

/** The JSON list PowerShell prints (one object when there is only one process). */
export function parseEngineProcesses(text: string): EngineProcess[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim() || "[]");
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const rows: EngineProcess[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const pid = Number(item.ProcessId);
    const ppid = Number(item.ParentProcessId);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    rows.push({
      pid,
      ppid,
      name: typeof item.Name === "string" ? item.Name : "",
      executablePath: typeof item.ExecutablePath === "string" ? item.ExecutablePath : null,
      commandLine: typeof item.CommandLine === "string" ? item.CommandLine : null,
      createdAt: parseCimDate(item.CreationDate),
    });
  }
  return rows;
}

/** Every process with what the rules need, from one CIM query (Windows only). */
export function listEngineProcesses(): Promise<EngineProcess[]> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") return resolve([]);
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress",
      ],
      { windowsHide: true, timeout: 20_000, maxBuffer: 32 * MB },
      (error, stdout) => {
        if (error) return resolve([]);
        resolve(parseEngineProcesses(stdout));
      },
    );
  });
}

function killTree(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, (error) =>
      resolve(!error),
    );
  });
}

export interface LeftoverCleanupOptions extends LeftoverRules {
  log: (message: string) => void;
  list?: () => Promise<EngineProcess[]>;
  kill?: (pid: number) => Promise<boolean>;
}

/** Finds and closes the leftovers; every one closed (or not) is logged. Never throws. */
export async function closeLeftoverEngines(options: LeftoverCleanupOptions): Promise<number> {
  try {
    const rows = await (options.list ?? listEngineProcesses)();
    const leftovers = findLeftoverEngines(rows, options);
    let closed = 0;
    for (const row of leftovers) {
      const ok = await (options.kill ?? killTree)(row.pid);
      if (ok) closed += 1;
      options.log(
        `${ok ? "closed" : "could not close"} leftover coworker program ${row.name} (pid ${row.pid}, from ${row.executablePath ?? "unknown path"})`,
      );
    }
    return closed;
  } catch (error) {
    options.log(`leftover check skipped: ${String(error)}`);
    return 0;
  }
}
