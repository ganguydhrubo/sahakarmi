import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { StorageCategory, StorageCategoryId, StorageUsage } from "../shared/ipc";

/** Folder names under <userData>/Partitions for each coworker's own browser data. */
const BOT_PARTITION = /^sahkarmi-browser-(bot-[a-z0-9-]+)$/i;
/** Entries counted per category before a size is reported as "at least". */
const MAX_COUNTED_ENTRIES = 200_000;

export interface StoragePaths {
  userData: string;
  /** <home>/Sahkarmi/Shared/Transfers: files sent with messages. */
  transfersRoot: string;
}

export interface RemovalResult {
  removed: string[];
  failed: string[];
  bytes: number;
}

/** The folder Chromium keeps a coworker's browser data in (partition persist:sahkarmi-browser-<id>). */
export function botPartitionFolder(userData: string, botId: string): string {
  return join(userData, "Partitions", `sahkarmi-browser-${botId}`);
}

/**
 * Removes the browser-data folders of coworkers that no longer exist. Only folders named
 * sahkarmi-browser-bot-<id> are looked at, never the shared browser or any other folder, and
 * nothing is removed when the coworker list is empty (an unreadable bots.json must not look
 * like "every coworker was deleted"). Call it before any coworker's browser session opens.
 */
export async function removeOrphanPartitions(
  userData: string,
  botIds: readonly string[],
): Promise<RemovalResult> {
  const result: RemovalResult = { removed: [], failed: [], bytes: 0 };
  if (botIds.length === 0) return result;
  const known = new Set(botIds.map((id) => id.toLowerCase()));
  const root = join(userData, "Partitions");
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[])) {
    if (!entry.isDirectory()) continue;
    const match = BOT_PARTITION.exec(entry.name);
    if (!match || known.has(match[1].toLowerCase())) continue;
    await removeFolder(join(root, entry.name), result);
  }
  return result;
}

/**
 * A deleted coworker's browser folder, after its session was released. Windows may still hold
 * a file of a session Chromium keeps open until quit; what is left goes at the next start.
 */
export async function removeBotPartition(userData: string, botId: string): Promise<boolean> {
  if (!/^bot-[a-z0-9-]+$/i.test(botId)) return false;
  const result: RemovalResult = { removed: [], failed: [], bytes: 0 };
  await removeFolder(botPartitionFolder(userData, botId), result);
  return result.failed.length === 0;
}

/** Sign-in folders under <userData>/gemini-accounts that no saved Google account uses. */
export async function removeOrphanGeminiHomes(userData: string): Promise<RemovalResult> {
  const result: RemovalResult = { removed: [], failed: [], bytes: 0 };
  const root = join(userData, "gemini-accounts");
  if (!existsSync(root)) return result;
  let listed: unknown;
  try {
    listed = JSON.parse(await readFile(join(userData, "gemini-accounts.json"), "utf8"));
  } catch {
    // Without a readable account list nothing is known to be unused.
    return result;
  }
  const accounts =
    typeof listed === "object" &&
    listed !== null &&
    Array.isArray((listed as { accounts?: unknown }).accounts)
      ? ((listed as { accounts: Array<{ id?: unknown; home?: unknown }> }).accounts ?? [])
      : null;
  if (!accounts) return result;
  const used = new Set(
    accounts.flatMap((account) => [
      typeof account.id === "string" ? account.id.toLowerCase() : "",
      typeof account.home === "string" ? account.home.toLowerCase() : "",
    ]),
  );
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [] as Dirent[])) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (used.has(entry.name.toLowerCase()) || used.has(path.toLowerCase())) continue;
    await removeFolder(path, result);
  }
  return result;
}

/** Older log files (the current log stays). */
export async function removeOldLogs(userData: string): Promise<RemovalResult> {
  const result: RemovalResult = { removed: [], failed: [], bytes: 0 };
  const root = join(userData, "logs");
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!/\.log\.\d+$/i.test(name)) continue;
    await removeFolder(join(root, name), result);
  }
  return result;
}

/** Sizes per category, for Settings > Storage. */
export async function storageUsage(paths: StoragePaths): Promise<StorageUsage> {
  const groups: Record<StorageCategoryId, string[]> = {
    browser: [join(paths.userData, "Partitions"), join(paths.userData, "coworker-browser-profile")],
    runtimes: [join(paths.userData, "runtime"), join(paths.userData, "tools")],
    accounts: [join(paths.userData, "gemini-accounts")],
    attachments: [paths.transfersRoot, join(paths.userData, "attachment-drafts")],
    knowledge: [join(paths.userData, "knowledge")],
    logs: [join(paths.userData, "logs")],
    mailboxArchive: [join(paths.userData, "mailbox-archive")],
  };
  const categories: StorageCategory[] = [];
  for (const [id, folders] of Object.entries(groups) as Array<[StorageCategoryId, string[]]>) {
    let bytes = 0;
    let partial = false;
    for (const folder of folders) {
      const size = await folderSize(folder);
      bytes += size.bytes;
      partial ||= size.partial;
    }
    categories.push({ id, bytes, partial });
  }
  return { categories, measuredAt: new Date().toISOString() };
}

/** Total size of a folder (or file), counting at most MAX_COUNTED_ENTRIES entries. */
export async function folderSize(path: string): Promise<{ bytes: number; partial: boolean }> {
  let bytes = 0;
  let visited = 0;
  const pending = [path];
  while (pending.length) {
    const current = pending.pop() as string;
    const info = await stat(current).catch(() => null);
    if (!info) continue;
    if (info.isFile()) {
      bytes += info.size;
      continue;
    }
    if (!info.isDirectory()) continue;
    for (const entry of await readdir(current, { withFileTypes: true }).catch(
      () => [] as Dirent[],
    )) {
      visited += 1;
      if (visited > MAX_COUNTED_ENTRIES) return { bytes, partial: true };
      const child = join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        const childInfo = await stat(child).catch(() => null);
        if (childInfo) bytes += childInfo.size;
      }
    }
  }
  return { bytes, partial: false };
}

async function removeFolder(path: string, result: RemovalResult): Promise<void> {
  const size = await folderSize(path);
  try {
    await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
    result.removed.push(path);
    result.bytes += size.bytes;
  } catch {
    // Still in use; the next start tries again.
    result.failed.push(path);
  }
}
