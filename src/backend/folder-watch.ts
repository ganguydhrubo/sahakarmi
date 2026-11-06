import { type FSWatcher, watch } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, join } from "node:path";

/** Stop watching with this. */
export type StopWatching = () => void;

/**
 * Watches one folder (and its subfolders) and reports files that were added, once each, after
 * they stop growing. Used by "When a file is added to a folder" routine triggers.
 */
export type WatchFolder = (folder: string, onFiles: (files: string[]) => void) => StopWatching;

export interface FolderWatchOptions {
  /** Quiet time after the last change before a batch is reported. */
  settleMs?: number;
  /** A file whose size still changes is checked again this many times before giving up. */
  maxSettleChecks?: number;
  /** The same path is not reported again within this window (Windows fires several events). */
  repeatWindowMs?: number;
  /** At most this many files per batch; a large copy reports the first ones. */
  maxBatch?: number;
}

/**
 * Temporary, partial and system files that are never "a file the owner added": Office lock
 * files, browser downloads in progress, editor swap files and Windows/macOS folder metadata.
 */
export function isIgnoredFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("~$") || lower.startsWith(".~") || lower.startsWith(".")) return true;
  if (lower.endsWith("~")) return true;
  if (lower === "desktop.ini" || lower === "thumbs.db") return true;
  return /\.(tmp|temp|part|partial|crdownload|download|opdownload|swp|lock|lck)$/.test(lower);
}

export function createFolderWatcher(options: FolderWatchOptions = {}): WatchFolder {
  const settleMs = options.settleMs ?? 2_000;
  const maxSettleChecks = options.maxSettleChecks ?? 30;
  const repeatWindowMs = options.repeatWindowMs ?? 60_000;
  const maxBatch = options.maxBatch ?? 20;

  return (folder, onFiles) => {
    let closed = false;
    let watcher: FSWatcher | null = null;
    const candidates = new Set<string>();
    const reported = new Map<string, number>();
    const sizes = new Map<string, { size: number; checks: number }>();
    let timer: NodeJS.Timeout | null = null;

    const schedule = () => {
      if (closed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), settleMs);
      timer.unref?.();
    };

    const flush = async () => {
      timer = null;
      if (closed) return;
      const ready: string[] = [];
      let waiting = false;
      const now = Date.now();
      for (const [path, at] of reported) if (now - at > repeatWindowMs) reported.delete(path);
      for (const path of [...candidates]) {
        const info = await stat(path).catch(() => null);
        if (!info?.isFile()) {
          // Deleted or renamed away, or a folder: not a file to report.
          candidates.delete(path);
          sizes.delete(path);
          continue;
        }
        const previous = sizes.get(path);
        if (!previous || previous.size !== info.size) {
          // Still being written (a copy or a download): look again after another quiet spell.
          const checks = (previous?.checks ?? 0) + 1;
          if (checks > maxSettleChecks) {
            candidates.delete(path);
            sizes.delete(path);
            continue;
          }
          sizes.set(path, { size: info.size, checks });
          waiting = true;
          continue;
        }
        candidates.delete(path);
        sizes.delete(path);
        if (reported.has(path)) continue;
        reported.set(path, now);
        ready.push(path);
      }
      if (waiting) schedule();
      if (ready.length > 0 && !closed) onFiles(ready.slice(0, maxBatch));
    };

    try {
      // Recursive watching is native on Windows (ReadDirectoryChangesW).
      // Only "rename" events: a file created, copied, moved or downloaded into the folder.
      // "change" events are edits to files already there, which are not additions.
      watcher = watch(folder, { recursive: true, persistent: false }, (event, name) => {
        if (closed || !name || event !== "rename") return;
        const relative = name.toString();
        if (relative.split(/[\\/]/).some((part) => isIgnoredFileName(part))) return;
        if (isIgnoredFileName(basename(relative))) return;
        candidates.add(join(folder, relative));
        schedule();
      });
      watcher.on("error", () => {
        // The folder was deleted or the drive went away; the routine simply stops firing.
        watcher?.close();
        watcher = null;
      });
    } catch {
      watcher = null;
    }

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      watcher?.close();
      watcher = null;
    };
  };
}
