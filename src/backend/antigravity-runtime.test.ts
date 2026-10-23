import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANTIGRAVITY_PINS,
  ANTIGRAVITY_TERMS_URL,
  ANTIGRAVITY_VERSION,
  downloadAntigravity,
  managedAntigravityExecutable,
  unzipBuffer,
} from "./antigravity-runtime";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "agy-test-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Builds a real ZIP (local headers, central directory, end record) the way archivers write it. */
function buildZip(files: Array<{ name: string; data: Buffer; store?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const payload = file.store ? file.data : deflateRawSync(file.data);
    const method = file.store ? 0 : 8;
    const name = Buffer.from(file.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, payload);
    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

describe("antigravity-runtime", () => {
  it("points at Google's published archives and the version folder they unpack to", () => {
    expect(ANTIGRAVITY_PINS["win32-x64"]?.url).toBe(
      `https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-${ANTIGRAVITY_VERSION}-windows-x86_64.zip`,
    );
    expect(ANTIGRAVITY_PINS["darwin-arm64"]?.url).toContain("/macos/");
    expect(ANTIGRAVITY_PINS["linux-x64"]?.url).toContain("/linux/");
    for (const pin of Object.values(ANTIGRAVITY_PINS)) expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(managedAntigravityExecutable("/runtime", "win32", "x64")).toBe(
      join("/runtime", "antigravity", ANTIGRAVITY_VERSION, "agy_acp_server.exe"),
    );
    expect(managedAntigravityExecutable("/runtime", "linux", "arm64")).toBeNull();
  });

  it("refuses to download before Google's terms are accepted", async () => {
    await expect(
      downloadAntigravity({ runtimeDirectory: tmp, termsAccepted: false }),
    ).rejects.toThrow(ANTIGRAVITY_TERMS_URL);
  });

  it("refuses a download whose SHA-256 does not match the pin", async () => {
    const fakeFetch = async () => new Response("corrupted-bytes", { status: 200 });
    await expect(
      downloadAntigravity({
        runtimeDirectory: tmp,
        termsAccepted: true,
        platform: "win32",
        arch: "x64",
        fetchImpl: fakeFetch as unknown as typeof fetch,
      }),
    ).rejects.toThrow("SHA-256 mismatch");
    await expect(stat(join(tmp, "antigravity"))).rejects.toThrow();
  });

  it("unpacks deflated and stored entries from a real archive layout", async () => {
    const zip = buildZip([
      { name: "agy_acp_server.exe", data: Buffer.from("server bytes") },
      { name: "localharness_external.exe", data: Buffer.from("harness bytes"), store: true },
    ]);
    const extracted = await unzipBuffer(zip, tmp);
    expect(extracted).toHaveLength(2);
    expect(await readFile(join(tmp, "agy_acp_server.exe"), "utf8")).toBe("server bytes");
    expect(await readFile(join(tmp, "localharness_external.exe"), "utf8")).toBe("harness bytes");
  });

  it("never writes outside the target folder", async () => {
    const zip = buildZip([{ name: "../evil.txt", data: Buffer.from("x") }]);
    await expect(unzipBuffer(zip, tmp)).rejects.toThrow(/unsafe path/);
  });
});
