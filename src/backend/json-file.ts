import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isRecord } from "./protocol";

/** Small atomic JSON document used by the approval and schedule stores. */
export class JsonFile<T> {
  readonly #path: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async read(fallback: () => T, validate: (value: unknown) => value is T): Promise<T> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#path, "utf8"));
      if (!validate(parsed)) {
        throw new Error(`${this.#path} is corrupt or from a newer Sahkarmi version.`);
      }
      return parsed;
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return fallback();
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    const serialized = `${JSON.stringify(value, null, 2)}\n`;
    const temporaryPath = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
        await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, this.#path);
      });
    await this.#writeQueue;
  }
}
