import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddingModelStore, type SemanticModelManifest } from "./embedding-model-store";

let tmp: string;
let server: Server;
let origin = "";
const FILES: Record<string, Buffer> = {
  "config.json": Buffer.from(JSON.stringify({ normalize: true }), "utf8"),
  "tokenizer.json": Buffer.from(JSON.stringify({ model: { type: "WordPiece" } }), "utf8"),
  "model.safetensors": Buffer.alloc(70_000, 7),
};
let served: string[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sahkarmi-model-store-"));
  served = [];
  server = createServer((request, response) => {
    const name = (request.url ?? "").split("/").pop() ?? "";
    served.push(name);
    const body = FILES[name];
    if (!body) {
      response.writeHead(404);
      response.end("missing");
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    // Two writes, so the client sees more than one chunk.
    response.write(body.subarray(0, Math.floor(body.length / 2)));
    response.end(body.subarray(Math.floor(body.length / 2)));
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  origin = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : "";
});

afterEach(async () => {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function manifest(overrides: Partial<Record<string, string>> = {}): SemanticModelManifest {
  return {
    id: "tiny-test",
    name: "tiny-test",
    dim: 4,
    license: "MIT",
    source: "local test server",
    files: Object.entries(FILES).map(([name, body]) => ({
      name,
      url: `${origin}/${name}`,
      sha256: overrides[name] ?? createHash("sha256").update(body).digest("hex"),
      size: body.length,
    })),
  };
}

describe("EmbeddingModelStore", () => {
  it("downloads every file with progress, verifies hashes and records the install", async () => {
    const store = new EmbeddingModelStore(tmp, manifest());
    expect(await store.status()).toMatchObject({ state: "absent", received: 0 });
    const progress: number[] = [];
    await store.install((p) => progress.push(p.received));
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.at(-1)).toBe(store.total);
    expect(progress.every((value, i) => i === 0 || value >= (progress[i - 1] ?? 0))).toBe(true);

    expect(await store.isInstalled()).toBe(true);
    expect(await store.status()).toMatchObject({ state: "ready", received: store.total });
    const names = (await readdir(store.folder)).sort();
    expect(names).toEqual(["config.json", "installed.json", "model.safetensors", "tokenizer.json"]);
    expect(await readFile(join(store.folder, "model.safetensors"))).toEqual(
      FILES["model.safetensors"],
    );

    // A second install does not touch the network: every file already matches.
    served = [];
    await store.install();
    expect(served).toEqual([]);

    // A fresh store over the same folder sees the install.
    expect(await new EmbeddingModelStore(tmp, manifest()).isInstalled()).toBe(true);

    await store.remove();
    expect(await store.isInstalled()).toBe(false);
    expect(await store.status()).toMatchObject({ state: "absent" });
  });

  it("keeps nothing when a file's hash is not the pinned one", async () => {
    const store = new EmbeddingModelStore(tmp, manifest({ "model.safetensors": "00".repeat(32) }));
    await expect(store.install()).rejects.toThrow(/checksum/);
    expect(await store.isInstalled()).toBe(false);
    expect(await store.status()).toMatchObject({ state: "error" });
    const names = await readdir(store.folder);
    expect(names.some((name) => name.endsWith(".part"))).toBe(false);
    expect(names).not.toContain("installed.json");
    expect(names).not.toContain("model.safetensors");
    // The sound files before it were kept, so a retry only fetches the broken one.
    expect(names).toContain("config.json");
  });

  it("reports an HTTP failure and a cancelled download", async () => {
    const missing = manifest();
    missing.files[2] = {
      ...(missing.files[2] as (typeof missing.files)[number]),
      url: `${origin}/nope`,
    };
    const store = new EmbeddingModelStore(tmp, missing);
    await expect(store.install()).rejects.toThrow(/404/);
    expect((await store.status()).error).toMatch(/404/);

    const controller = new AbortController();
    controller.abort();
    const cancelled = new EmbeddingModelStore(join(tmp, "b"), manifest(), (url, init) =>
      fetch(url, { signal: init?.signal }),
    );
    await expect(cancelled.install(undefined, controller.signal)).rejects.toThrow(/cancelled/);
  });

  it("does not trust an installed.json whose hashes differ from the manifest", async () => {
    const store = new EmbeddingModelStore(tmp, manifest());
    await store.install();
    const changed = manifest({ "config.json": "11".repeat(32) });
    expect(await new EmbeddingModelStore(tmp, changed).isInstalled()).toBe(false);
  });
});
