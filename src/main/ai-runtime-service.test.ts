// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AiRuntimeService,
  compareVersions,
  openCodeBinaryName,
  openCodePlatformPackage,
  parseIntegrity,
  verifyFileIntegrity,
} from "./ai-runtime-service";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("OpenCode runtime naming", () => {
  it("maps the platform to the npm package that carries the binary", () => {
    expect(openCodePlatformPackage("win32", "x64")).toBe("opencode-windows-x64");
    expect(openCodePlatformPackage("darwin", "arm64")).toBe("opencode-darwin-arm64");
    expect(openCodePlatformPackage("linux", "x64")).toBe("opencode-linux-x64");
  });

  it("names the binary per platform", () => {
    expect(openCodeBinaryName("win32")).toBe("opencode.exe");
    expect(openCodeBinaryName("linux")).toBe("opencode");
  });
});

describe("version comparison", () => {
  it("orders versions by number, not by text", () => {
    expect(compareVersions("1.20.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.19.3", "1.19.3")).toBe(0);
    expect(compareVersions("0.4.6", "0.10.0")).toBeLessThan(0);
    expect(compareVersions("1.20", "1.20.0")).toBe(0);
  });
});

describe("npm integrity", () => {
  it("parses the sha512 digest npm publishes", () => {
    const parsed = parseIntegrity("sha512-4kw8H0Qfp0t7CyU7+yvbUbi+abc=");
    expect(parsed?.algorithm).toBe("sha512");
    expect(parsed?.digest.length).toBeGreaterThan(0);
  });

  it("rejects a digest that does not match the file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sahkarmi-integrity-"));
    temporaryPaths.push(directory);
    const file = join(directory, "package.tgz");
    await writeFile(file, "hello");
    const digest = createHash("sha512").update("hello").digest("base64");
    expect(verifyFileIntegrity(file, `sha512-${digest}`)).toBe(true);
    expect(
      verifyFileIntegrity(file, `sha512-${createHash("sha512").update("other").digest("base64")}`),
    ).toBe(false);
    expect(verifyFileIntegrity(file, "not-an-integrity")).toBe(false);
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AI runtime service", () => {
  it("reports a newer OpenCode runtime as available", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("opencode-windows-x64")) {
        return jsonResponse({
          version: "1.20.0",
          dist: { tarball: "https://example.invalid/opencode.tgz", integrity: "sha512-abc=" },
        });
      }
      if (url.includes("opencode-ai")) {
        return jsonResponse({ version: "1.20.0", dist: { tarball: "", integrity: null } });
      }
      if (url.includes("@openai/codex") || url.includes("%40openai%2Fcodex")) {
        return jsonResponse({ version: "0.163.0", dist: { tarball: "", integrity: null } });
      }
      if (url.includes("claude-code") || url.includes("gemini-cli")) {
        return jsonResponse({ version: "9.9.9", dist: { tarball: "", integrity: null } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof globalThis.fetch;

    try {
      const service = new AiRuntimeService({
        runtimeDirectory: join(tmpdir(), "sahkarmi-runtime-test"),
        currentOpenCodeVersion: async () => "1.19.3",
        installedToolVersions: () => ({ codex: "0.162.0", claude: "2.1.304", gemini: "0.63.0" }),
        autoDownload: () => false,
        log: () => undefined,
        platform: "win32",
        arch: "x64",
      });
      const status = await service.check();
      expect(status.phase).toBe("available");
      expect(status.availableVersion).toBe("1.20.0");
      const opencode = status.tools.find((tool) => tool.id === "opencode");
      expect(opencode?.installed).toBe("1.19.3");
      expect(opencode?.latest).toBe("1.20.0");
      expect(opencode?.managed).toBe(true);
      const codex = status.tools.find((tool) => tool.id === "codex");
      expect(codex?.installed).toBe("0.162.0");
      expect(codex?.latest).toBe("0.163.0");
      expect(codex?.command).toContain("npm install -g");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps a downloaded runtime outside the installed app folder", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "sahkarmi-runtime-test-"));
    temporaryPaths.push(runtimeDirectory);
    await mkdir(join(runtimeDirectory, "opencode", "1.20.0"), { recursive: true });
    await writeFile(join(runtimeDirectory, "opencode", "1.20.0", "opencode.exe"), "binary");
    const service = new AiRuntimeService({
      runtimeDirectory,
      currentOpenCodeVersion: async () => "1.19.3",
      installedToolVersions: () => ({}),
      autoDownload: () => false,
      log: () => undefined,
    });
    expect(service.getStatus().phase).toBe("idle");
  });
});
