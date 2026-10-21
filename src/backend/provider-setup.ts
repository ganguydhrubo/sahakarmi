import { type ChildProcess, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { AgentProviderId, ProviderSetupState } from "../shared/ipc";
import { managedCodexPath, resolveClaudeCli, resolveCodexCli, resolveGeminiCli } from "./cli";

/** Codex build fetched by Connect when none is installed (Apache-2.0, published by OpenAI on npm). */
export const CODEX_VERSION = "0.163.0";
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const URL_PATTERN = /https:\/\/[^\s"'<>]+/;

export interface ProviderSetupOptions {
  toolsDirectory: string;
  /** Re-checks a provider after sign-in so the app switches it to Connected. */
  recheck: (provider: AgentProviderId) => Promise<void>;
  /** Opens a terminal window running a command (Gemini's sign-in is interactive). */
  openTerminal?: (command: string, title: string) => Promise<void>;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  platform?: NodeJS.Platform;
  arch?: string;
}

interface ProviderSetupEvents {
  state: [state: ProviderSetupState];
}

/**
 * One-click "Connect" for each AI provider. It never handles passwords: it starts the provider's
 * own sign-in (which opens the provider's page in the browser) and only relays the sign-in link
 * and, for Claude, the one-time code the owner pastes back.
 */
export class ProviderSetup extends EventEmitter<ProviderSetupEvents> {
  readonly #options: ProviderSetupOptions;
  readonly #states = new Map<AgentProviderId, ProviderSetupState>();
  readonly #logins = new Map<AgentProviderId, ChildProcess>();

  constructor(options: ProviderSetupOptions) {
    super();
    this.#options = options;
  }

  list(): ProviderSetupState[] {
    return [...this.#states.values()].map((state) => ({ ...state }));
  }

  async connect(provider: AgentProviderId): Promise<ProviderSetupState> {
    this.cancel(provider);
    try {
      switch (provider) {
        case "codex":
          await this.#loginWithProcess(provider, await this.#codexExecutable(), ["login"]);
          break;
        case "claude": {
          const claude = await resolveClaudeCli();
          await this.#loginWithProcess(provider, claude.executable, ["auth", "login"]);
          break;
        }
        case "gemini":
          await this.#connectGemini();
          break;
        case "opencode":
          await this.check(provider);
          break;
      }
    } catch (error) {
      this.#set(provider, { phase: "failed", message: messageOf(error) });
    }
    return this.#get(provider);
  }

  /** Claude shows a one-time code on its sign-in page; the owner pastes it here. */
  submitCode(provider: AgentProviderId, code: string): ProviderSetupState {
    const login = this.#logins.get(provider);
    const trimmed = code.trim();
    if (!login?.stdin || !trimmed) throw new Error("No sign-in is waiting for a code.");
    if (trimmed.length > 4_096 || /[\r\n]/.test(trimmed)) throw new Error("That code looks wrong.");
    login.stdin.write(`${trimmed}\n`);
    this.#set(provider, { phase: "waiting", message: "Checking the code…" });
    return this.#get(provider);
  }

  /** Saves an API key for the provider, writes it to environment and disk, and connects. */
  async setApiKey(provider: AgentProviderId, apiKey: string): Promise<ProviderSetupState> {
    const key = apiKey.trim();
    if (!key) throw new Error("API key cannot be empty.");
    if (provider === "gemini") {
      process.env.GEMINI_API_KEY = key;
      process.env.GOOGLE_API_KEY = key;
      if (process.platform === "win32") {
        try {
          execFile(
            "powershell",
            [
              "-NoProfile",
              "-Command",
              `[System.Environment]::SetEnvironmentVariable('GEMINI_API_KEY', '${key.replace(/'/g, "''")}', 'User')`,
            ],
            { windowsHide: true },
            () => {},
          );
        } catch {
          // ignore
        }
      }
      try {
        const geminiDir = join(homedir(), ".gemini");
        await mkdir(geminiDir, { recursive: true });
        await writeFile(join(geminiDir, "gemini_api_key.txt"), key, "utf8");
      } catch {
        // ignore
      }
    } else if (provider === "codex") {
      process.env.OPENAI_API_KEY = key;
      if (process.platform === "win32") {
        try {
          execFile(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `[System.Environment]::SetEnvironmentVariable('OPENAI_API_KEY', '${key.replace(/'/g, "''")}', 'User')`,
            ],
            { windowsHide: true },
            () => {},
          );
        } catch {
          // ignore
        }
      }
      try {
        const codexDir = join(homedir(), ".codex");
        await mkdir(codexDir, { recursive: true });
        await writeFile(join(codexDir, "openai_api_key.txt"), key, "utf8");
      } catch {
        // ignore
      }
    } else if (provider === "claude") {
      process.env.ANTHROPIC_API_KEY = key;
      if (process.platform === "win32") {
        try {
          execFile(
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `[System.Environment]::SetEnvironmentVariable('ANTHROPIC_API_KEY', '${key.replace(/'/g, "''")}', 'User')`,
            ],
            { windowsHide: true },
            () => {},
          );
        } catch {
          // ignore
        }
      }
      try {
        const claudeDir = join(homedir(), ".claude");
        await mkdir(claudeDir, { recursive: true });
        await writeFile(join(claudeDir, "anthropic_api_key.txt"), key, "utf8");
      } catch {
        // ignore
      }
    }

    try {
      await this.#options.recheck(provider);
      this.#set(provider, {
        phase: "connected",
        message: "API key saved! Provider connected.",
        url: null,
      });
    } catch (error) {
      this.#set(provider, { phase: "failed", message: messageOf(error) });
    }
    return this.#get(provider);
  }

  /** Re-checks the provider (after a terminal sign-in, or to retry). */
  async check(provider: AgentProviderId): Promise<ProviderSetupState> {
    this.#set(provider, { phase: "checking", message: null });
    try {
      await this.#options.recheck(provider);
      this.#set(provider, { phase: "connected", message: null, url: null });
    } catch (error) {
      this.#set(provider, { phase: "failed", message: messageOf(error) });
    }
    return this.#get(provider);
  }

  cancel(provider: AgentProviderId): void {
    const login = this.#logins.get(provider);
    this.#logins.delete(provider);
    if (login && login.exitCode === null) login.kill();
  }

  stop(): void {
    for (const provider of [...this.#logins.keys()]) this.cancel(provider);
  }

  async #codexExecutable(): Promise<string> {
    try {
      return (await resolveCodexCli()).executable;
    } catch {
      await this.installCodex();
      return (await resolveCodexCli()).executable;
    }
  }

  /** Downloads the official Codex build for this computer into userData/tools/codex. */
  async installCodex(): Promise<string> {
    const platform = this.#options.platform ?? process.platform;
    const arch = this.#options.arch ?? process.arch;
    if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) {
      throw new Error(`Codex is not available for ${platform}-${arch}.`);
    }
    const fetchImpl = this.#options.fetchImpl ?? fetch;
    const spec = `${CODEX_VERSION}-${platform}-${arch}`;
    this.#set("codex", {
      phase: "installing",
      message: "Getting ChatGPT (Codex) ready…",
      progress: 0,
    });
    const metadataResponse = await fetchImpl(`https://registry.npmjs.org/@openai/codex/${spec}`);
    if (!metadataResponse.ok)
      throw new Error(`Could not find Codex ${spec} (${metadataResponse.status}).`);
    const metadata = (await metadataResponse.json()) as {
      dist?: { tarball?: string; integrity?: string };
    };
    const tarball = metadata.dist?.tarball;
    const integrity = metadata.dist?.integrity;
    if (!tarball?.startsWith("https://registry.npmjs.org/") || !integrity?.startsWith("sha512-")) {
      throw new Error("The Codex download information is incomplete.");
    }

    const work = join(this.#options.toolsDirectory, `codex-download-${Date.now()}`);
    await mkdir(work, { recursive: true });
    try {
      const archive = join(work, "codex.tgz");
      const response = await fetchImpl(tarball);
      if (!response.ok || !response.body)
        throw new Error(`Codex download failed (${response.status}).`);
      const total = Number(response.headers.get("content-length")) || 0;
      const hash = createHash("sha512");
      let received = 0;
      let lastProgress = -1;
      const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
      body.on("data", (chunk: Buffer) => {
        hash.update(chunk);
        received += chunk.length;
        const progress = total ? Math.floor((received / total) * 100) : null;
        if (progress !== null && progress !== lastProgress) {
          lastProgress = progress;
          this.#set("codex", { phase: "installing", progress });
        }
      });
      await pipeline(body, createWriteStream(archive));
      if (`sha512-${hash.digest("base64")}` !== integrity) {
        throw new Error("The Codex download was damaged (checksum mismatch). Try again.");
      }
      await extract(archive, work);
      const vendor = join(work, "package", "vendor");
      const [triple] = await readdir(vendor);
      if (!triple) throw new Error("The Codex download is empty.");
      const target = join(this.#options.toolsDirectory, "codex");
      await rm(target, { recursive: true, force: true });
      await cp(join(vendor, triple), target, { recursive: true });
      const executable = managedCodexPath(platform);
      if (!executable || !(await stat(executable).catch(() => null))) {
        throw new Error("Codex was downloaded but its program is missing.");
      }
      this.#set("codex", {
        phase: "waiting",
        message: "Codex is ready. Opening sign-in…",
        progress: null,
      });
      return executable;
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Runs the provider's own sign-in. It opens the browser itself; the link is also shown in the
   * app in case the browser did not open. Finishes when the provider confirms the sign-in.
   */
  #loginWithProcess(provider: AgentProviderId, executable: string, args: string[]): Promise<void> {
    const spawnImpl = this.#options.spawnImpl ?? spawn;
    this.#set(provider, {
      phase: "waiting",
      message: "Sign in on the page that opened in your browser.",
      url: null,
      progress: null,
    });
    const windowsShim = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
    const launchExecutable = windowsShim ? process.env.ComSpec || "cmd.exe" : executable;
    // Arguments here are fixed provider login commands, never text from the user or browser.
    const launchArgs = windowsShim
      ? [
          "/d",
          "/s",
          "/c",
          `""${executable.replaceAll("%", "%%")}" ${args.map((arg) => `"${arg}"`).join(" ")}"`,
        ]
      : args;
    const child = spawnImpl(launchExecutable, launchArgs, {
      windowsVerbatimArguments: windowsShim,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    this.#logins.set(provider, child);
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Sign-in took too long. Click Connect to try again."));
      }, LOGIN_TIMEOUT_MS);
      timer.unref?.();
      let output = "";
      const onOutput = (chunk: Buffer) => {
        output = `${output}${chunk.toString("utf8")}`.slice(-8_000);
        const url = URL_PATTERN.exec(output)?.[0];
        const current = this.#get(provider);
        if (url && current.url !== url) this.#set(provider, { url });
        if (/paste (the )?code/i.test(output) && current.phase !== "needs-code") {
          this.#set(provider, {
            phase: "needs-code",
            message: "After signing in, copy the code shown on the page and paste it here.",
          });
        }
      };
      child.stdout?.on("data", onOutput);
      child.stderr?.on("data", onOutput);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        if (this.#logins.get(provider) === child) this.#logins.delete(provider);
        if (code === 0) {
          void this.check(provider).then(() => resolvePromise());
          return;
        }
        if (code === null) {
          resolvePromise();
          return;
        }
        reject(new Error(lastLine(output) || `Sign-in ended without success (code ${code}).`));
      });
    });
  }

  async #connectGemini(): Promise<void> {
    if (!this.#options.openTerminal) throw new Error("Gemini sign-in needs a terminal window.");
    let command: string;
    try {
      command = quote((await resolveGeminiCli()).executable);
    } catch {
      command = "npm install -g @google/gemini-cli && gemini";
    }
    await this.#options.openTerminal(command, "Gemini sign-in");
    this.#set("gemini", {
      phase: "terminal",
      message:
        "A window opened: choose “Login with Google” and finish in the browser, then close it and click Check again.",
      url: null,
    });
  }

  #get(provider: AgentProviderId): ProviderSetupState {
    return (
      this.#states.get(provider) ?? {
        provider,
        phase: "idle",
        message: null,
        url: null,
        progress: null,
      }
    );
  }

  #set(provider: AgentProviderId, patch: Partial<Omit<ProviderSetupState, "provider">>): void {
    const next = { ...this.#get(provider), ...patch, provider };
    this.#states.set(provider, next);
    this.emit("state", { ...next });
  }
}

function extract(archive: string, directory: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile("tar", ["-xzf", archive, "-C", directory], { windowsHide: true }, (error) =>
      error ? reject(new Error(`Could not unpack Codex: ${error.message}`)) : resolvePromise(),
    );
  });
}

function quote(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

function lastLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.replace(URL_PATTERN, "").trim())
      .filter(Boolean)
      .at(-1) ?? ""
  ).slice(0, 200);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
