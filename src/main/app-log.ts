import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Plain-text log in the app data folder (logs/sahkarmi.log) so problems on a user's machine can
 * be diagnosed without DevTools. Rotated once to sahkarmi.log.1 when it passes 2 MB.
 */
export class AppLog {
  readonly #path: string;
  #queue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.#path = join(userDataPath, "logs", "sahkarmi.log");
  }

  get path(): string {
    return this.#path;
  }

  write(level: "info" | "warn" | "error", message: string, detail?: unknown): void {
    const extra =
      detail === undefined
        ? ""
        : ` ${detail instanceof Error ? (detail.stack ?? detail.message) : safeJson(detail)}`;
    const line = `${new Date().toISOString()} [${level}] ${message}${extra}\n`;
    this.#queue = this.#queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(join(this.#path, ".."), { recursive: true });
        const size = await stat(this.#path).then(
          (info) => info.size,
          () => 0,
        );
        if (size > MAX_BYTES) await rename(this.#path, `${this.#path}.1`).catch(() => undefined);
        await appendFile(this.#path, line, "utf8");
      })
      .catch(() => undefined);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 4_000);
  } catch {
    return String(value);
  }
}
