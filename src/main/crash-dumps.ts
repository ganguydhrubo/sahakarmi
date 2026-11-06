import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/** Crash dumps kept on this computer; older ones are deleted. */
export const KEEP_CRASH_DUMPS = 5;

/**
 * Deletes all but the newest `keep` crash dumps (*.dmp) under Electron's crashDumps folder.
 * Dumps never leave the computer (uploads are off); they are kept only so a crash can be looked
 * at, and a crash loop must not fill the disk. Returns how many were deleted.
 */
export async function pruneCrashDumps(directory: string, keep = KEEP_CRASH_DUMPS): Promise<number> {
  const dumps: Array<{ path: string; mtimeMs: number }> = [];
  const walk = async (folder: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".dmp")) {
        const info = await stat(path).catch(() => null);
        if (info) dumps.push({ path, mtimeMs: info.mtimeMs });
      }
    }
  };
  await walk(directory, 0);
  dumps.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let deleted = 0;
  for (const dump of dumps.slice(Math.max(0, keep))) {
    await rm(dump.path, { force: true })
      .then(() => {
        deleted += 1;
      })
      .catch(() => undefined);
  }
  return deleted;
}

/**
 * Error text for the log without the owner's secrets: API keys and bearer tokens are masked and
 * the home folder is shortened. Stack frames are kept so the crash can be traced.
 */
export function redactErrorForLog(error: unknown, home: string): string {
  const raw =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
      : String(error);
  let text = raw;
  if (home) text = text.split(home).join("~");
  return text
    .replace(/\b(sk|rk|pk|ghp|gho|ghs|github_pat|xox[abpr]|AIza)[-_A-Za-z0-9]{12,}/g, "[redacted]")
    .replace(
      /\b(Bearer|token|api[_-]?key|password|secret)(["':=\s]+)[^\s"',;]{6,}/gi,
      "$1$2[redacted]",
    )
    .slice(0, 8_000);
}
