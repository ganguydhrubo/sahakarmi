import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = /^\d+\.\d+\.\d+$/;
/** Sahkarmi's own download staging folders in %TEMP% (AI tools, OpenCode). */
const STAGING = /^sahkarmi-(?:runtime|claude|codex|opencode)-/;
const STAGING_MAX_AGE_MS = 60 * 60_000;

export interface CleanupResult {
  removed: string[];
  failed: string[];
}

function compare(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

async function versionsIn(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && VERSION.test(entry.name))
    .map((entry) => entry.name)
    .sort(compare)
    .reverse();
}

/**
 * Removes AI-tool copies Sahkarmi itself downloaded and no longer uses, before any of them
 * starts: every version of Claude Code, Codex and OpenCode under <userData>/runtime except
 * the one in use (the newest; for OpenCode the one current.json names), the legacy
 * <userData>/tools/codex once a runtime copy exists, and download staging folders in %TEMP%
 * that are over an hour old. Updates used to keep the previous copy (300-480 MB each), and one
 * still running during an update was never removed later, so they piled up.
 * Nothing the owner installed, and no sign-in, chat or browser data, is touched.
 */
export async function cleanUpRuntimes(
  userData: string,
  temp = tmpdir(),
  now = Date.now(),
): Promise<CleanupResult> {
  const result: CleanupResult = { removed: [], failed: [] };
  const remove = async (path: string) => {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
      result.removed.push(path);
    } catch {
      // In use (a tool still running): the next start tries again.
      result.failed.push(path);
    }
  };
  const runtime = join(userData, "runtime");
  for (const tool of ["claude", "codex", "opencode"]) {
    const root = join(runtime, tool);
    const versions = await versionsIn(root);
    let keep = versions[0];
    if (tool === "opencode") {
      const current = await readFile(join(root, "current.json"), "utf8")
        .then((text) => (JSON.parse(text) as { version?: unknown }).version)
        .catch(() => undefined);
      if (typeof current === "string" && versions.includes(current)) keep = current;
    }
    if (!keep) continue;
    for (const version of versions) if (version !== keep) await remove(join(root, version));
    // Half-finished copies from an interrupted download.
    for (const entry of await readdir(root).catch(() => [] as string[])) {
      if (/\.partial-\d+$/.test(entry)) await remove(join(root, entry));
    }
  }
  const legacyCodex = join(userData, "tools", "codex");
  if ((await versionsIn(join(runtime, "codex"))).length && existsSync(legacyCodex)) {
    await remove(legacyCodex);
  }
  // Half-written saves (mailbox.json.<pid>.<id>.tmp) left by a crash or a locked rename.
  for (const entry of await readdir(userData).catch(() => [] as string[])) {
    if (!/\.json\.\d+\.[0-9a-f-]{36}\.tmp$/i.test(entry)) continue;
    const path = join(userData, entry);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && now - info.mtimeMs > STAGING_MAX_AGE_MS) await remove(path);
  }
  for (const entry of await readdir(temp).catch(() => [] as string[])) {
    if (!STAGING.test(entry)) continue;
    const path = join(temp, entry);
    const info = await stat(path).catch(() => null);
    if (info?.isDirectory() && now - info.mtimeMs > STAGING_MAX_AGE_MS) await remove(path);
  }
  return result;
}
