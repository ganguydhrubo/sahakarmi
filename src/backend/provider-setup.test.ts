// @vitest-environment node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderSetupState } from "../shared/ipc";
import { managedCodexPath, setToolsDirectory } from "./cli";
import { CODEX_VERSION, ProviderSetup } from "./provider-setup";

let root: string;
const originalClaude = process.env.SAHKARMI_CLAUDE_PATH;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-provider-setup-"));
  setToolsDirectory(join(root, "tools"));
});

afterEach(async () => {
  if (originalClaude === undefined) delete process.env.SAHKARMI_CLAUDE_PATH;
  else process.env.SAHKARMI_CLAUDE_PATH = originalClaude;
  await rm(root, { recursive: true, force: true });
});

class FakeLogin extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = { written: [] as string[], write: (text: string) => this.stdin.written.push(text) };
  exitCode: number | null = null;
  kill = vi.fn();
  finish(code: number) {
    this.exitCode = code;
    this.emit("exit", code);
  }
}

async function fakeCli(name: string, version: string): Promise<string> {
  const path = join(root, process.platform === "win32" ? `${name} mock.cmd` : name);
  await writeFile(
    path,
    process.platform === "win32"
      ? `@echo off\r\necho ${version}\r\n`
      : `#!/bin/sh\necho "${version}"\n`,
  );
  await chmod(path, 0o755);
  return path;
}

describe("ProviderSetup", () => {
  it("runs Claude's own sign-in, relays the link and pasted code, then re-checks", async () => {
    process.env.SAHKARMI_CLAUDE_PATH = await fakeCli("claude", "2.1.0 (Claude Code)");
    const login = new FakeLogin();
    const spawnImpl = vi.fn((..._args: unknown[]) => login);
    const recheck = vi.fn(async () => undefined);
    const states: ProviderSetupState[] = [];
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck,
      spawnImpl: spawnImpl as never,
    });
    setup.on("state", (state) => states.push(state));

    const done = setup.connect("claude");
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalled());
    if (process.platform === "win32") {
      expect(spawnImpl.mock.calls[0]?.[1]).toEqual([
        "/d",
        "/s",
        "/c",
        expect.stringContaining('"auth" "login"'),
      ]);
      expect(spawnImpl.mock.calls[0]?.[2]).toMatchObject({ windowsVerbatimArguments: true });
    } else {
      expect(spawnImpl.mock.calls[0]?.[1]).toEqual(["auth", "login"]);
    }
    login.stdout.write(
      "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true\nPaste code here if prompted > ",
    );
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe("needs-code"));
    expect(states.at(-1)?.url).toBe("https://claude.com/cai/oauth/authorize?code=true");

    setup.submitCode("claude", "  abc#123  ");
    expect(login.stdin.written).toEqual(["abc#123\n"]);
    login.finish(0);
    const final = await done;
    expect(recheck).toHaveBeenCalledWith("claude");
    expect(final.phase).toBe("connected");
  });

  it("reports a failed sign-in with the provider's own message", async () => {
    process.env.SAHKARMI_CLAUDE_PATH = await fakeCli("claude", "2.1.0 (Claude Code)");
    const login = new FakeLogin();
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck: vi.fn(async () => undefined),
      spawnImpl: (() => login) as never,
    });
    const done = setup.connect("claude");
    await vi.waitFor(() => expect(login.listenerCount("exit")).toBe(1));
    login.stderr.write("Invalid code. Please try again.\n");
    await new Promise((resolve) => setTimeout(resolve, 10));
    login.finish(1);
    const final = await done;
    expect(final).toMatchObject({ phase: "failed", message: "Invalid code. Please try again." });
  });

  it("downloads Codex, verifies its checksum and unpacks it into the tools folder", async () => {
    const triple = "x86_64-unknown-linux-musl";
    const packageDir = join(root, "pkg", "package", "vendor", triple, "bin");
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, "codex"), "#!/bin/sh\necho codex-cli 0.163.0\n");
    const tarball = join(root, "codex.tgz");
    execFileSync("tar", ["-czf", tarball, "-C", join(root, "pkg"), "package"]);
    const bytes = await readFile(tarball);
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(`/${CODEX_VERSION}-linux-x64`)
        ? Response.json({
            dist: { tarball: "https://registry.npmjs.org/@openai/codex/-/codex.tgz", integrity },
          })
        : new Response(bytes, { headers: { "content-length": String(bytes.length) } }),
    );
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck: vi.fn(async () => undefined),
      fetchImpl: fetchImpl as never,
      platform: "linux",
      arch: "x64",
    });
    const executable = await setup.installCodex();
    expect(executable).toBe(managedCodexPath("linux"));
    expect((await stat(executable)).isFile()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://registry.npmjs.org/@openai/codex/${CODEX_VERSION}-linux-x64`,
    );
  });

  it("refuses a Codex download whose checksum does not match", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/-/")
        ? new Response(new Uint8Array([1, 2, 3]))
        : Response.json({
            dist: {
              tarball: "https://registry.npmjs.org/@openai/codex/-/codex.tgz",
              integrity: "sha512-AAAA",
            },
          }),
    );
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck: vi.fn(async () => undefined),
      fetchImpl: fetchImpl as never,
      platform: "linux",
      arch: "x64",
    });
    await expect(setup.installCodex()).rejects.toThrow(/checksum/);
  });

  it("opens a terminal for Gemini's Google sign-in and waits for Check again", async () => {
    process.env.SAHKARMI_GEMINI_PATH = join(root, "missing-gemini");
    const openTerminal = vi.fn(async () => undefined);
    const recheck = vi.fn(async () => undefined);
    const setup = new ProviderSetup({ toolsDirectory: join(root, "tools"), recheck, openTerminal });
    const state = await setup.connect("gemini");
    expect(openTerminal).toHaveBeenCalledWith(
      "npm install -g @google/gemini-cli && gemini",
      "Gemini sign-in",
    );
    expect(state.phase).toBe("terminal");
    expect((await setup.check("gemini")).phase).toBe("connected");
    delete process.env.SAHKARMI_GEMINI_PATH;
  });

  it("connects Google Antigravity and saves its API key", async () => {
    process.env.SAHKARMI_ANTIGRAVITY_PATH = await fakeCli("agy_acp_server", "1.0.0");
    const recheck = vi.fn(async () => undefined);
    const setup = new ProviderSetup({ toolsDirectory: join(root, "tools"), recheck });

    const state = await setup.connect("antigravity");
    expect(recheck).toHaveBeenCalledWith("antigravity");
    expect(state.phase).toBe("connected");

    const keyState = await setup.setApiKey("antigravity", "test-antigravity-key");
    expect(keyState.phase).toBe("connected");
    expect(process.env.ANTIGRAVITY_API_KEY).toBe("test-antigravity-key");
    delete process.env.SAHKARMI_ANTIGRAVITY_PATH;
    delete process.env.ANTIGRAVITY_API_KEY;
  });
});
