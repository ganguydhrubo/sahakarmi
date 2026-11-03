import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The optional "smarter search" model: a small static embedding table (model2vec) the owner
 * downloads once, on purpose. Nothing is fetched unless the owner clicks Install; the files
 * are checked against pinned SHA-256 hashes before they are used; Remove deletes them again.
 */

export interface ModelFile {
  name: string;
  url: string;
  sha256: string;
  size: number;
}

export interface SemanticModelManifest {
  id: string;
  name: string;
  /** Vector length. */
  dim: number;
  license: string;
  source: string;
  files: ModelFile[];
}

/** potion-base-8M by The Minish Lab (MIT): 29,528 WordPiece tokens x 256 floats. */
export const POTION_BASE_8M: SemanticModelManifest = {
  id: "potion-base-8M",
  name: "potion-base-8M",
  dim: 256,
  license: "MIT",
  source: "huggingface.co/minishlab/potion-base-8M",
  files: [
    {
      name: "config.json",
      url: "https://huggingface.co/minishlab/potion-base-8M/resolve/main/config.json",
      sha256: "2a6ac0e9aaa356a68a5688070db78fc3a464fefe85d2f06a1905ce3718687553",
      size: 202,
    },
    {
      name: "tokenizer.json",
      url: "https://huggingface.co/minishlab/potion-base-8M/resolve/main/tokenizer.json",
      sha256: "e67e803f624fb4d67dea1c730d06e1067e1b14d830e2c2202569e3ef0f70bb50",
      size: 683_666,
    },
    {
      name: "model.safetensors",
      url: "https://huggingface.co/minishlab/potion-base-8M/resolve/main/model.safetensors",
      sha256: "f65d0f325faadc1e121c319e2faa41170d3fa07d8c89abd48ca5358d9a223de2",
      size: 30_236_760,
    },
  ],
};

export type ModelState = "absent" | "downloading" | "ready" | "error";

export interface ModelStoreStatus {
  state: ModelState;
  /** Bytes received so far and the total, while downloading. */
  received: number;
  total: number;
  error: string | null;
}

export interface ModelProgress {
  received: number;
  total: number;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

const INSTALLED_FILE = "installed.json";

export class EmbeddingModelStore {
  readonly manifest: SemanticModelManifest;
  readonly folder: string;
  readonly #fetch: FetchLike;
  #installing: Promise<void> | null = null;
  #received = 0;
  #error: string | null = null;
  #installed: boolean | null = null;

  constructor(root: string, manifest = POTION_BASE_8M, fetchImpl: FetchLike = globalThis.fetch) {
    this.manifest = manifest;
    this.folder = join(root, "models", manifest.id);
    this.#fetch = fetchImpl;
  }

  get total(): number {
    return this.manifest.files.reduce((sum, file) => sum + file.size, 0);
  }

  /** True when every file is present with the pinned hash recorded at install time. */
  async isInstalled(): Promise<boolean> {
    if (this.#installed !== null) return this.#installed;
    try {
      const record = JSON.parse(await readFile(join(this.folder, INSTALLED_FILE), "utf8")) as {
        files?: Record<string, string>;
      };
      for (const file of this.manifest.files) {
        if (record.files?.[file.name] !== file.sha256) throw new Error("hash changed");
        const info = await stat(join(this.folder, file.name));
        if (info.size !== file.size) throw new Error("size changed");
      }
      this.#installed = true;
    } catch {
      this.#installed = false;
    }
    return this.#installed;
  }

  async status(): Promise<ModelStoreStatus> {
    if (this.#installing) {
      return { state: "downloading", received: this.#received, total: this.total, error: null };
    }
    if (await this.isInstalled()) {
      return { state: "ready", received: this.total, total: this.total, error: null };
    }
    return {
      state: this.#error ? "error" : "absent",
      received: 0,
      total: this.total,
      error: this.#error,
    };
  }

  /**
   * Downloads the files one by one into `<name>.part`, hashing as the bytes arrive; a file whose
   * hash or size differs from the manifest is thrown away. A second call while one runs joins it.
   */
  install(onProgress?: (progress: ModelProgress) => void, signal?: AbortSignal): Promise<void> {
    if (!this.#installing) {
      this.#error = null;
      this.#received = 0;
      this.#installing = this.#install(onProgress, signal).finally(() => {
        this.#installing = null;
      });
    }
    return this.#installing;
  }

  async #install(
    onProgress: ((progress: ModelProgress) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    try {
      await mkdir(this.folder, { recursive: true });
      let done = 0;
      for (const file of this.manifest.files) {
        const target = join(this.folder, file.name);
        if (await this.#matches(target, file)) {
          done += file.size;
          this.#received = done;
          onProgress?.({ received: done, total: this.total });
          continue;
        }
        const part = `${target}.part`;
        await rm(part, { force: true });
        const response = await this.#fetch(file.url, { signal });
        if (!response.ok || !response.body) {
          throw new Error(`Download failed (${response.status}) for ${file.name}.`);
        }
        const hash = createHash("sha256");
        const handle = await open(part, "w");
        let written = 0;
        try {
          for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
            written += chunk.byteLength;
            if (written > file.size) throw new Error(`${file.name} is larger than expected.`);
            hash.update(chunk);
            await handle.write(chunk);
            this.#received = done + written;
            onProgress?.({ received: this.#received, total: this.total });
          }
        } finally {
          await handle.close();
        }
        if (written !== file.size || hash.digest("hex") !== file.sha256) {
          await rm(part, { force: true });
          throw new Error(`${file.name} did not match the expected checksum; nothing was kept.`);
        }
        await rename(part, target);
        done += file.size;
      }
      await writeFile(
        join(this.folder, INSTALLED_FILE),
        JSON.stringify(
          {
            id: this.manifest.id,
            installedAt: new Date().toISOString(),
            files: Object.fromEntries(this.manifest.files.map((file) => [file.name, file.sha256])),
          },
          null,
          2,
        ),
      );
      this.#installed = true;
    } catch (error) {
      this.#installed = false;
      this.#error =
        signal?.aborted || (error instanceof Error && error.name === "AbortError")
          ? "Download cancelled."
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(this.#error);
    }
  }

  async remove(): Promise<void> {
    this.#installed = false;
    this.#error = null;
    await rm(this.folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  async #matches(path: string, file: ModelFile): Promise<boolean> {
    try {
      const info = await stat(path);
      if (info.size !== file.size) return false;
      const digest = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
      return digest === file.sha256;
    } catch {
      return false;
    }
  }
}
