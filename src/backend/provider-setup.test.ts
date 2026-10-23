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

/** Stands in for Google's Antigravity ACP server: signed out until `signIn` runs. */
class FakeAcpClient extends EventEmitter {
  requests: string[] = [];
  signIns: string[] = [];
  stopped = false;
  #signedIn: boolean;
  constructor(
    private readonly onSignIn: () => Promise<Record<string, unknown>>,
    signedOut = true,
    private readonly stayLoggedOut = false,
  ) {
    super();
    this.#signedIn = !signedOut;
  }
  start(): void {}
  async request(method: string): Promise<unknown> {
    this.requests.push(method);
    return {};
  }
  async needsSignIn(): Promise<boolean> {
    return !this.#signedIn;
  }
  async signIn(methodId: string): Promise<Record<string, unknown>> {
    this.signIns.push(methodId);
    const result = await this.onSignIn();
    if (!this.stayLoggedOut) this.#signedIn = true;
    return result;
  }
  async stop(): Promise<void> {
    this.stopped = true;
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

  it("connects Google Antigravity with its own Log in with Google, like Claude and Codex", async () => {
    process.env.SAHKARMI_ANTIGRAVITY_PATH = await fakeCli("agy_acp_server", "1.4.2");
    const acpHome = join(root, "home", ".gemini", "antigravity-acp");
    const client = new FakeAcpClient(async () => {
      await mkdir(acpHome, { recursive: true });
      await writeFile(join(acpHome, "acp_token.json"), "{}");
      return { email: "owner@example.in", tierName: "Google AI Pro" };
    });
    const recheck = vi.fn(async () => undefined);
    const states: ProviderSetupState[] = [];
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck,
      home: join(root, "home"),
      antigravityClient: () => client as never,
    });
    setup.on("state", (state) => states.push(state));

    const state = await setup.connect("antigravity");
    expect(client.requests).toEqual(["initialize"]);
    expect(client.signIns).toEqual(["oauth-personal"]);
    expect(client.stopped).toBe(true);
    expect(recheck).toHaveBeenCalledWith("antigravity");
    expect(states.map((s) => s.phase)).toEqual(["checking", "waiting", "connected"]);
    expect(states[1]?.url).toBe("https://accounts.google.com/");
    expect(state.phase).toBe("connected");
    expect(state.message).toBe(
      "Connected to Google Antigravity (owner@example.in · Google AI Pro).",
    );
    expect(JSON.parse(await readFile(join(acpHome, "sahkarmi-account.json"), "utf8"))).toEqual({
      email: "owner@example.in",
      tier: "Google AI Pro",
    });
    delete process.env.SAHKARMI_ANTIGRAVITY_PATH;
  });

  it("skips the sign-in page when Google's server is already signed in", async () => {
    process.env.SAHKARMI_ANTIGRAVITY_PATH = await fakeCli("agy_acp_server", "1.4.2");
    const client = new FakeAcpClient(async () => ({}), false);
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck: vi.fn(async () => undefined),
      home: join(root, "home"),
      antigravityClient: () => client as never,
    });
    const state = await setup.connect("antigravity");
    expect(client.signIns).toEqual([]);
    expect(state.phase).toBe("connected");
    delete process.env.SAHKARMI_ANTIGRAVITY_PATH;
  });

  it("saves a Google AI Studio key for Antigravity and signs in with it", async () => {
    process.env.SAHKARMI_ANTIGRAVITY_PATH = await fakeCli("agy_acp_server", "1.4.2");
    const client = new FakeAcpClient(async () => ({}));
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck: vi.fn(async () => undefined),
      home: join(root, "home"),
      antigravityClient: () => client as never,
    });
    const state = await setup.setApiKey("antigravity", "AIzaSy-test");
    expect(client.signIns).toEqual(["gemini-api-key"]);
    expect(state.phase).toBe("connected");
    expect(process.env.ANTIGRAVITY_API_KEY).toBe("AIzaSy-test");
    expect(
      await readFile(join(root, "home", ".gemini", "antigravity-acp", "api_key.txt"), "utf8"),
    ).toBe("AIzaSy-test");
    delete process.env.SAHKARMI_ANTIGRAVITY_PATH;
    delete process.env.ANTIGRAVITY_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  it("reports a sign-in that Google did not finish instead of pretending it worked", async () => {
    process.env.SAHKARMI_ANTIGRAVITY_PATH = await fakeCli("agy_acp_server", "1.4.2");
    const client = new FakeAcpClient(async () => ({}), true, true);
    const setup = new ProviderSetup({
      toolsDirectory: join(root, "tools"),
      recheck: vi.fn(async () => undefined),
      home: join(root, "home"),
      antigravityClient: () => client as never,
    });
    const state = await setup.connect("antigravity");
    expect(state.phase).toBe("failed");
    expect(state.message).toMatch(/did not finish the sign-in/);
    expect(client.stopped).toBe(true);
    delete process.env.SAHKARMI_ANTIGRAVITY_PATH;
  });
});
