import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { isRecord } from "./protocol";

/**
 * Windows briefly holds a file that antivirus, search indexing or a sync client just opened; the
 * rename then fails with EPERM, EBUSY or EACCES. A short retry gets through; any other error is real.
 */
export async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

export interface CorruptFileRecovery {
  /** The file that could not be read. */
  path: string;
  /** Where the unreadable copy was moved; nothing is deleted. */
  backupPath: string;
  reason: string;
  at: string;
}

type CorruptFileListener = (recovery: CorruptFileRecovery) => void;
const corruptFileListeners = new Set<CorruptFileListener>();
const recoveredFiles: CorruptFileRecovery[] = [];

/**
 * Main listens here to log a recovery and tell the owner. Recoveries that happened before the
 * listener was added are replayed to it, since stores load before the window exists.
 */
export function onCorruptFileRecovered(listener: CorruptFileListener): () => void {
  corruptFileListeners.add(listener);
  for (const recovery of recoveredFiles) listener(recovery);
  return () => corruptFileListeners.delete(listener);
}

/** Test helper: forget recoveries reported so far. */
export function clearCorruptFileRecoveries(): void {
  recoveredFiles.length = 0;
}

export interface JsonFileOptions {
  /**
   * A file that cannot be parsed or fails validation is moved aside as
   * `<name>.corrupt-<time>` and the fallback is used, instead of failing startup. Only for
   * stores whose defaults are safe (for example permissions fall back to "ask").
   */
  recoverCorrupt?: boolean;
}

/** Small atomic JSON document used by the approval and schedule stores. */
export class JsonFile<T> {
  readonly #path: string;
  readonly #recoverCorrupt: boolean;
  #writeQueue: Promise<void> = Promise.resolve();
  #next: { value: T; done: Promise<void> } | null = null;

  constructor(path: string, options: JsonFileOptions = {}) {
    this.#path = path;
    this.#recoverCorrupt = options.recoverCorrupt === true;
  }

  async read(fallback: () => T, validate: (value: unknown) => value is T): Promise<T> {
    let text: string;
    try {
      text = await readFile(this.#path, "utf8");
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return fallback();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      if (!this.#recoverCorrupt) throw error;
      return this.#recover(fallback, `not valid JSON (${(error as Error).message})`);
    }
    if (!validate(parsed)) {
      if (this.#recoverCorrupt) {
        return this.#recover(fallback, "unexpected contents, or written by a newer Sahkarmi");
      }
      throw new Error(`${this.#path} is corrupt or from a newer Sahkarmi version.`);
    }
    return parsed;
  }

  async #recover(fallback: () => T, reason: string): Promise<T> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.#path}.corrupt-${stamp}`;
    await renameWithRetry(this.#path, backupPath);
    const recovery: CorruptFileRecovery = {
      path: this.#path,
      backupPath,
      reason: `${basename(this.#path)}: ${reason}`,
      at: new Date().toISOString(),
    };
    recoveredFiles.push(recovery);
    for (const listener of corruptFileListeners) {
      try {
        listener(recovery);
      } catch {
        // A failing listener must not undo the recovery.
      }
    }
    return fallback();
  }

  /** Writes waiting behind one in progress collapse into one, so a burst costs two at most. */
  async write(value: T): Promise<void> {
    if (this.#next) {
      this.#next.value = value;
      await this.#next.done;
      return;
    }
    const job = { value, done: Promise.resolve() };
    job.done = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        this.#next = null;
        const serialized = `${JSON.stringify(job.value, null, 2)}\n`;
        const temporaryPath = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
        await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
        await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
        await renameWithRetry(temporaryPath, this.#path);
      });
    this.#next = job;
    this.#writeQueue = job.done;
    await job.done;
  }
}
