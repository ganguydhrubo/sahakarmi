import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_TERMS_URL, downloadAntigravity, unzipBuffer } from "./antigravity-runtime";

describe("antigravity-runtime", () => {
  it("rejects download when Terms of Service are not accepted", async () => {
    await expect(
      downloadAntigravity({
        runtimeDirectory: "/tmp/runtime",
        termsAccepted: false,
      }),
    ).rejects.toThrow(ANTIGRAVITY_TERMS_URL);
  });

  it("rejects download when SHA-256 does not match pinned hash", async () => {
    const fakeFetch = async () =>
      new Response("corrupted-bytes", { status: 200, statusText: "OK" });

    await expect(
      downloadAntigravity({
        runtimeDirectory: "/tmp/runtime",
        termsAccepted: true,
        platform: "win32",
        arch: "x64",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("SHA-256 mismatch");
  });

  it("unzips files correctly from memory buffer", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "agy-test-"));
    try {
      const filename = "test.txt";
      const fileContent = Buffer.from("Hello Antigravity!");
      const compressed = deflateRawSync(fileContent);

      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0); // signature
      header.writeUInt16LE(20, 4); // version needed
      header.writeUInt16LE(0, 6); // flags
      header.writeUInt16LE(8, 8); // compression method (deflate)
      header.writeUInt16LE(0, 10); // mod time
      header.writeUInt16LE(0, 12); // mod date
      header.writeUInt32LE(0, 14); // crc32
      header.writeUInt32LE(compressed.length, 18); // comp size
      header.writeUInt32LE(fileContent.length, 22); // uncomp size
      header.writeUInt16LE(filename.length, 26); // name length
      header.writeUInt16LE(0, 28); // extra length

      const zip = Buffer.concat([header, Buffer.from(filename, "utf8"), compressed]);
      const extracted = await unzipBuffer(zip, tmp);

      expect(extracted).toHaveLength(1);
      const read = await readFile(extracted[0], "utf8");
      expect(read).toBe("Hello Antigravity!");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
