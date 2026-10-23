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
import type { AcpAgentClient } from "./acp-client";
import {
  ANTIGRAVITY_ACCOUNT_FILE,
  antigravityAcpHome,
  createAntigravityClient,
  readAntigravityAccount,
} from "./acp-providers";
import { ANTIGRAVITY_TERMS_URL, downloadAntigravity } from "./antigravity-runtime";
import {
  type AcpCliInfo,
  managedCodexPath,
  resolveAntigravityCli,
  resolveClaudeCli,
  resolveCodexCli,
} from "./cli";

/** Codex build fetched by Connect when none is installed (Apache-2.0, published by OpenAI on npm). */
export const CODEX_VERSION = "0.163.0";
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const URL_PATTERN = /https:\/\/[^\s"'<>]+/;
/** Google's server returns from `authenticate` once the owner finishes the sign-in page. */
const ANTIGRAVITY_SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface ProviderSetupOptions {
  toolsDirectory: string;
  /** Where downloaded agent runtimes live (Google's Antigravity server goes under it). */
  runtimeDirectory?: string;
  /** Re-checks a provider after sign-in so the app switches it to Connected. */
  recheck: (provider: AgentProviderId) => Promise<void>;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  platform?: NodeJS.Platform;
  arch?: string;
  /** Home folder (tests point it at a temporary one). */
  home?: string;
  /** Builds the ACP client used for the Antigravity sign-in (tests supply a fake). */
  antigravityClient?: (cli: AcpCliInfo) => AcpAgentClient;
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
  #antigravitySignIn: AcpAgentClient | null = null;

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
        case "antigravity":
          await this.#connectAntigravity();
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
    if (provider === "codex") {
      process.env.OPENAI_API_KEY = key;
      persistUserEnvironment("OPENAI_API_KEY", key);
      await saveKeyFile(join(this.#home(), ".codex"), "openai_api_key.txt", key);
    } else if (provider === "claude") {
      process.env.ANTHROPIC_API_KEY = key;
      persistUserEnvironment("ANTHROPIC_API_KEY", key);
      await saveKeyFile(join(this.#home(), ".claude"), "anthropic_api_key.txt", key);
    } else if (provider === "antigravity") {
      // Google's server accepts a Google AI Studio key through its `gemini-api-key` sign-in method.
      process.env.ANTIGRAVITY_API_KEY = key;
      process.env.GEMINI_API_KEY = key;
      process.env.GOOGLE_API_KEY = key;
      persistUserEnvironment("GEMINI_API_KEY", key);
      await saveKeyFile(antigravityAcpHome(this.#home()), "api_key.txt", key);
      try {
        await this.#connectAntigravity("gemini-api-key");
      } catch (error) {
        this.#set(provider, { phase: "failed", message: messageOf(error) });
      }
      return this.#get(provider);
    } else {
      throw new Error("This provider does not use an API key.");
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
    if (provider === "antigravity" && this.#antigravitySignIn) {
      const client = this.#antigravitySignIn;
      this.#antigravitySignIn = null;
      void client.stop().catch(() => undefined);
    }
  }

  stop(): void {
    for (const provider of [...this.#logins.keys()]) this.cancel(provider);
    this.cancel("antigravity");
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

  /**
   * Google Antigravity, the same way as Claude and Codex: get Google's agent server (downloaded
   * once), ask it whether it is signed in, and if not run its own "Log in with Google" sign-in,
   * which opens the Google page in the browser. No terminal, no password handled by Sahkarmi.
   */
  async #connectAntigravity(methodId: "oauth-personal" | "gemini-api-key" = "oauth-personal") {
    const executable = await this.installAntigravity();
    const cli: AcpCliInfo = {
      executable,
      version: antigravityVersionOf(executable),
      bundled: true,
    };
    this.#set("antigravity", {
      phase: "checking",
      message:
        "Starting Google's Antigravity agent and checking your sign-in (about a minute the first time)…",
      url: null,
      progress: null,
    });
    const transcripts = join(this.#options.toolsDirectory, "antigravity-sign-in");
    const client =
      this.#options.antigravityClient?.(cli) ?? createAntigravityClient(cli, transcripts);
    this.#antigravitySignIn = client;
    const diagnostics: string[] = [];
    client.on("diagnostic", (message) => diagnostics.push(message));
    client.on("exit", () => undefined);
    try {
      client.start();
      await client.request("initialize", {});
      let signedIn = !(await client.needsSignIn());
      let noted: { email: string | null; tier: string | null } | null = null;
      if (!signedIn) {
        this.#set("antigravity", {
          phase: "waiting",
          message:
            methodId === "gemini-api-key"
              ? "Checking the API key with Google…"
              : "Sign in with Google on the page that opened in your browser.",
          url: methodId === "gemini-api-key" ? null : "https://accounts.google.com/",
        });
        const result = await client.signIn(methodId, ANTIGRAVITY_SIGN_IN_TIMEOUT_MS);
        noted = accountFromSignIn(result);
        signedIn = !(await client.needsSignIn());
      }
      if (!signedIn) {
        throw new Error(
          lastDiagnostic(diagnostics) ||
            "Google did not finish the sign-in. Click Connect to try again.",
        );
      }
      await this.#noteAntigravityAccount(noted);
    } finally {
      if (this.#antigravitySignIn === client) this.#antigravitySignIn = null;
      await client.stop().catch(() => undefined);
    }
    await this.#options.recheck("antigravity");
    const account = await readAntigravityAccount(this.#home());
    const who = [account.account?.email, account.account?.tier].filter(Boolean).join(" · ");
    this.#set("antigravity", {
      phase: "connected",
      message: `Connected to Google Antigravity${who ? ` (${who})` : ""}.`,
      url: null,
      progress: null,
    });
  }

  /** Downloads Google's Antigravity server for this computer when it is not there yet. */
  async installAntigravity(): Promise<string> {
    try {
      return (await resolveAntigravityCli()).executable;
    } catch {
      // Not downloaded yet.
    }
    const runtimeDirectory = this.#options.runtimeDirectory;
    if (!runtimeDirectory) throw new Error("Sahkarmi has no runtime folder for downloads.");
    this.#set("antigravity", {
      phase: "installing",
      message: `Getting Google Antigravity ready (Google's terms apply: ${ANTIGRAVITY_TERMS_URL})…`,
      url: null,
      progress: 0,
    });
    return downloadAntigravity({
      runtimeDirectory,
      // Clicking Connect on the tile, which names the terms, is the owner's acceptance.
      termsAccepted: true,
      platform: this.#options.platform,
      arch: this.#options.arch,
      fetchImpl: this.#options.fetchImpl,
      onProgress: (progress) => this.#set("antigravity", { phase: "installing", progress }),
    });
  }

  /** Remembers which Google account and tier the sign-in reported, next to the server's own token. */
  async #noteAntigravityAccount(noted: { email: string | null; tier: string | null } | null) {
    if (!noted || (!noted.email && !noted.tier)) return;
    try {
      const home = antigravityAcpHome(this.#home());
      await mkdir(home, { recursive: true });
      await writeFile(join(home, ANTIGRAVITY_ACCOUNT_FILE), `${JSON.stringify(noted)}\n`, "utf8");
    } catch {
      // The note is only for the Connected label.
    }
  }

  #home(): string {
    return this.#options.home ?? homedir();
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

/** Email and tier from Google's `authenticate` result, whichever fields it includes. */
export function accountFromSignIn(result: Record<string, unknown>): {
  email: string | null;
  tier: string | null;
} {
  const pick = (source: unknown, keys: string[]): string | null => {
    if (!source || typeof source !== "object") return null;
    for (const key of keys) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };
  const nested = [result, result.account, result.user, result._meta, result.meta];
  let email: string | null = null;
  let tier: string | null = null;
  for (const source of nested) {
    email ??= pick(source, ["email", "userEmail", "user_email"]);
    tier ??= pick(source, ["tierName", "tier_name", "tier", "plan", "planName"]);
  }
  return { email, tier };
}

function antigravityVersionOf(executable: string): string {
  const parent = executable.split(/[\\/]/).at(-2) ?? "";
  return /^\d+\.\d+\.\d+$/.test(parent) ? parent : "unknown";
}

function lastDiagnostic(diagnostics: string[]): string {
  return (diagnostics.at(-1) ?? "").replace(/^[^:]+:\s*/, "").slice(0, 200);
}

/** Keeps a key for next time (Windows user environment); best effort, never blocks Connect. */
function persistUserEnvironment(name: string, value: string): void {
  if (process.platform !== "win32") return;
  try {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `[System.Environment]::SetEnvironmentVariable('${name}', '${value.replace(/'/g, "''")}', 'User')`,
      ],
      { windowsHide: true },
      () => {},
    );
  } catch {
    // ignore
  }
}

async function saveKeyFile(directory: string, fileName: string, key: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), key, "utf8");
  } catch {
    // ignore
  }
}

function extract(archive: string, directory: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile("tar", ["-xzf", archive, "-C", directory], { windowsHide: true }, (error) =>
      error ? reject(new Error(`Could not unpack Codex: ${error.message}`)) : resolvePromise(),
    );
  });
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
