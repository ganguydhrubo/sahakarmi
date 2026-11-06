import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Python and many build tools break on Windows paths with spaces or non-ASCII letters (the
 * MoneyPrinterTurbo README warns about it). Installs go under userData\mcp when that path is
 * plain, else its 8.3 short form, else a fixed folder on the system drive (audit §11.6).
 */
export function isPlainPath(path: string): boolean {
  return /^[A-Za-z0-9_\-.:~\\/]+$/.test(path);
}

/**
 * Windows' old 260-character limit still applies to pip and many tools unless long paths are
 * switched on; packages like onnxruntime nest ~130 characters deep inside a venv.
 */
export const MAX_ROOT_LENGTH = 80;

const fits = (path: string) => isPlainPath(path) && path.length <= MAX_ROOT_LENGTH;

export type ShortPath = (path: string) => Promise<string | null>;

/** Windows' 8.3 name for an existing folder (null when 8.3 names are switched off). */
export const shortPath: ShortPath = (path) =>
  new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }
    execFile(
      "cmd.exe",
      ["/d", "/s", "/c", `for %I in ("${path.replace(/"/g, "")}") do @echo %~sI`],
      { windowsHide: true, timeout: 5000, encoding: "utf8" },
      (error, stdout) => resolve(error ? null : stdout.trim().split(/\r?\n/).pop()?.trim() || null),
    );
  });

export async function installRoot(
  userDataPath: string,
  options: { shortPath?: ShortPath; systemDrive?: string; username?: string } = {},
): Promise<string> {
  const preferred = join(userDataPath, "mcp");
  await mkdir(preferred, { recursive: true });
  if (fits(preferred)) return preferred;
  const short = await (options.shortPath ?? shortPath)(preferred);
  if (short && fits(short)) return short;
  const drive = options.systemDrive ?? process.env.SystemDrive ?? "C:";
  const user =
    (options.username ?? process.env.USERNAME ?? "owner").replace(/[^A-Za-z0-9_-]/g, "") || "owner";
  const fallback = join(`${drive}\\`, "Sahkarmi-mcp", user);
  await mkdir(fallback, { recursive: true });
  return fallback;
}

/** A folder name for a server: its name, plain letters only. */
export function serverFolderName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48) || "server";
}
