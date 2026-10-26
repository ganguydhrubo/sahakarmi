// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
  reasonOf,
  toolPlatformPackage,
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

describe("Claude Code and Codex packages", () => {
  it("names the npm package that carries each program", () => {
    expect(toolPlatformPackage("claude", "2.1.310", "win32", "x64")).toEqual({
      name: "@anthropic-ai/claude-code-win32-x64",
      version: "2.1.310",
    });
    expect(toolPlatformPackage("codex", "0.164.0", "win32", "x64")).toEqual({
      name: "@openai/codex",
      version: "0.164.0-win32-x64",
    });
  });
});

describe("update failure reasons", () => {
  it("says npm is missing only when it is", () => {
    expect(reasonOf(new Error("spawn npm.cmd ENOENT"))).toBe(
      "npm is not available on this computer",
    );
    expect(
      reasonOf(
        new Error(
          "Command failed: npm.cmd install -g @openai/codex@latest\nnpm error code EBUSY\nnpm error syscall rename",
        ),
      ),
    ).toMatch(/in use/);
    expect(
      reasonOf(
        new Error(
          "Command failed: npm.cmd install -g x\nnpm error code E403\nnpm error 403 Forbidden - GET https://registry.npmjs.org/x",
        ),
      ),
    ).toBe("403 Forbidden - GET https://registry.npmjs.org/x");
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
      if (url.includes("claude-code")) {
        return jsonResponse({ version: "9.9.9", dist: { tarball: "", integrity: null } });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof globalThis.fetch;

    try {
      const service = new AiRuntimeService({
        runtimeDirectory: join(tmpdir(), "sahkarmi-runtime-test"),
        currentOpenCodeVersion: async () => "1.19.3",
        installedToolVersions: () => ({ codex: "0.162.0", claude: "2.1.304" }),
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
      expect(codex?.managed).toBe(true);
      expect(codex?.command).toBeNull();
      expect(codex?.note).toContain("own copy");
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

  it("downloads its own Claude Code copy next to the old one and never runs npm", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "sahkarmi-runtime-test-"));
    const work = await mkdtemp(join(tmpdir(), "sahkarmi-claude-pkg-"));
    temporaryPaths.push(runtimeDirectory, work);
    // An older copy that a coworker may still be running stays where it is.
    await mkdir(join(runtimeDirectory, "claude", "2.1.304"), { recursive: true });
    await writeFile(join(runtimeDirectory, "claude", "2.1.304", "claude.exe"), "old");
    await mkdir(join(work, "package"), { recursive: true });
    await writeFile(join(work, "package", "claude.exe"), "new program");
    execFileSync("tar", ["-czf", "pkg.tgz", "package"], { cwd: work });
    const tarball = readFileSync(join(work, "pkg.tgz"));
    const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/claude-code.tgz")) return new Response(tarball, { status: 200 });
      if (url.includes("claude-code-win32-x64")) {
        return jsonResponse({
          version: "2.1.310",
          dist: { tarball: "https://registry.npmjs.org/x/claude-code.tgz", integrity },
        });
      }
      if (url.includes("claude-code")) {
        return jsonResponse({ version: "2.1.310", dist: { tarball: "", integrity: null } });
      }
      if (url.includes("codex")) {
        return jsonResponse({ version: "0.164.0", dist: { tarball: "", integrity: null } });
      }
      return jsonResponse({ version: "1.19.4", dist: { tarball: "", integrity: null } });
    }) as typeof globalThis.fetch;
    const downloaded: string[] = [];
    try {
      const service = new AiRuntimeService({
        runtimeDirectory,
        currentOpenCodeVersion: async () => "1.19.4",
        installedToolVersions: () => ({ codex: "0.164.0", claude: "2.1.304" }),
        autoDownload: () => false,
        log: () => undefined,
        onToolDownloaded: (toolId) => downloaded.push(toolId),
        readVersion: async (binary) =>
          readFileSync(binary, "utf8") === "new program" ? "2.1.310" : null,
        platform: "win32",
        arch: "x64",
      });
      const status = await service.update("claude");
      expect(status.message).toContain("Claude Code 2.1.310 is ready");
      expect(readFileSync(join(runtimeDirectory, "claude", "2.1.310", "claude.exe"), "utf8")).toBe(
        "new program",
      );
      expect(existsSync(join(runtimeDirectory, "claude", "2.1.304", "claude.exe"))).toBe(true);
      expect(readdirSync(join(runtimeDirectory, "claude")).sort()).toEqual(["2.1.304", "2.1.310"]);
      expect(downloaded).toEqual(["claude"]);
      // Until the app switches over, the tool shows as downloaded, not as an update to click.
      const claude = status.tools.find((tool) => tool.id === "claude");
      expect(claude?.ready).toBe(true);
      expect(claude?.note).toContain("is downloaded");

      // A second click does not download it again.
      const before = requests.length;
      await service.update("claude");
      expect(requests.some((url, index) => index >= before && url.endsWith(".tgz"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("refuses a download whose checksum does not match", async () => {
    const runtimeDirectory = await mkdtemp(join(tmpdir(), "sahkarmi-runtime-test-"));
    temporaryPaths.push(runtimeDirectory);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(".tgz")) return new Response("tampered", { status: 200 });
      if (url.includes("codex")) {
        return jsonResponse({
          version: "0.165.0",
          dist: {
            tarball: "https://registry.npmjs.org/x/codex.tgz",
            integrity: `sha512-${createHash("sha512").update("original").digest("base64")}`,
          },
        });
      }
      return jsonResponse({ version: "1.0.0", dist: { tarball: "", integrity: null } });
    }) as typeof globalThis.fetch;
    try {
      const service = new AiRuntimeService({
        runtimeDirectory,
        currentOpenCodeVersion: async () => "1.0.0",
        installedToolVersions: () => ({ codex: "0.164.0" }),
        autoDownload: () => false,
        log: () => undefined,
        platform: "win32",
        arch: "x64",
      });
      const status = await service.update("codex");
      expect(status.phase).toBe("error");
      expect(status.message).toContain("checksum");
      expect(existsSync(join(runtimeDirectory, "codex"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
