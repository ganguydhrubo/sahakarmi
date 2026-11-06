import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { AgentProvider } from "./agent-client";
import { JsonLineDecoder } from "./jsonl";
import {
  type AppServerNotification,
  type AppServerRequest,
  isRecord,
  type RequestId,
  type RpcError,
  type RpcMessage,
} from "./protocol";
import { envForProvider } from "./secret-store";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

export class AppServerError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AppServerError";
  }
}

export class CodexAppServerClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider = "codex";
  readonly #executable: string;
  readonly #requestTimeoutMs: number;
  #decoder = new JsonLineDecoder();
  readonly #pending = new Map<RequestId, PendingRequest>();
  #process: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  #stopping = false;

  constructor(executable: string, requestTimeoutMs = 30_000) {
    super();
    this.#executable = executable;
    this.#requestTimeoutMs = requestTimeoutMs;
  }

  get running(): boolean {
    return this.#process !== null && this.#process.exitCode === null;
  }

  start(): void {
    if (this.running) return;

    this.#stopping = false;
    this.#decoder = new JsonLineDecoder((line) =>
      this.emit("diagnostic", redactDiagnostic(`Skipped a non-JSON line from Codex: ${line}`)),
    );
    // Codex gets its own key only, not the other providers' keys.
    const launch = codexLaunch(
      this.#executable,
      ["app-server", "--listen", "stdio://"],
      process.platform,
      envForProvider("codex", process.env),
    );
    const child = spawn(launch.command, launch.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: launch.env,
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim,
    });
    this.#process = child;

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.#decoder.push(chunk)) this.#handleMessage(message);
      } catch (error) {
        this.#fail(new Error(`Codex protocol error: ${String(error)}`), child);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const diagnostic = chunk.toString("utf8").trim();
      if (diagnostic) this.emit("diagnostic", redactDiagnostic(diagnostic));
    });

    child.once("error", (error) => this.#fail(error, child));
    child.once("exit", (code, signal) => {
      const suffix = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.#fail(new Error(`Codex App Server exited with ${suffix}.`), child);
    });
  }

  async stop(): Promise<void> {
    const child = this.#process;
    if (!child) return;

    this.#stopping = true;
    this.#process = null;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Codex App Server stopped."));
    }
    this.#pending.clear();

    child.stdin.end();
    if (child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        if (child.exitCode === null) killTree(child, "SIGKILL");
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
      killTree(child, "SIGTERM");
    });
  }

  request<T>(method: string, params: unknown, timeoutMs = this.#requestTimeoutMs): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });

      try {
        this.#write({ method, id, params });
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.#write({ method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.#write({ id, result });
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#write({ id, error });
  }

  #write(message: unknown): void {
    if (!this.running || !this.#process) {
      throw new Error("Codex App Server is not running.");
    }
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleMessage(message: RpcMessage): void {
    if ("method" in message) {
      if ("id" in message) {
        this.emit("request", {
          method: message.method,
          id: message.id,
          params: message.params,
        });
      } else {
        this.emit("notification", { method: message.method, params: message.params });
      }
      return;
    }

    const pending = this.#pending.get(message.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.#pending.delete(message.id);

    if (message.error && isRecord(message.error)) {
      const code = typeof message.error.code === "number" ? message.error.code : -1;
      const text =
        typeof message.error.message === "string" ? message.error.message : "Unknown error";
      pending.reject(new AppServerError(text, code, message.error.data));
      return;
    }

    pending.resolve(message.result);
  }

  #fail(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#process !== child) return;
    this.#process = null;

    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();

    if (child.exitCode === null) killTree(child, "SIGTERM");
    if (!this.#stopping) this.emit("exit", error);
  }
}

interface CodexLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  verbatim: boolean;
}

/**
 * How to start Codex without a shell. `shell: true` broke on paths with spaces and left
 * cmd.exe + node.exe wrappers whose codex.exe child outlived a stop. The npm shim (codex.cmd)
 * only runs node, which starts the native codex.exe from the platform package, so that exe is
 * started directly with the same env the shim sets. If it can't be found, cmd.exe runs the
 * script with a quoted path (still no `shell: true`) and the tree kill ends the whole chain.
 */
export function codexLaunch(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): CodexLaunch {
  const isScript =
    platform === "win32" && [".cmd", ".bat"].includes(extname(executable).toLowerCase());
  if (!isScript) return { command: executable, args, env: environment, verbatim: false };
  const native = npmNativeCodex(executable);
  if (native) {
    return {
      command: native.executable,
      args,
      env: {
        ...environment,
        CODEX_MANAGED_PACKAGE_ROOT: native.packageRoot,
        CODEX_MANAGED_BY_NPM: "1",
      },
      verbatim: false,
    };
  }
  const quoted = [executable, ...args].map((part) => `"${part.replaceAll("%", "%%")}"`).join(" ");
  return {
    command: environment.ComSpec?.trim() || "cmd.exe",
    args: ["/d", "/s", "/c", `"${quoted}"`],
    env: environment,
    verbatim: true,
  };
}

const WINDOWS_TRIPLES: Record<string, string> = {
  x64: "x86_64-pc-windows-msvc",
  arm64: "aarch64-pc-windows-msvc",
};

/** The codex.exe an npm/pnpm/bun shim at `<dir>/codex.cmd` would start. */
export function npmNativeCodex(
  shim: string,
  arch: string = process.arch,
): { executable: string; packageRoot: string } | null {
  const triple = WINDOWS_TRIPLES[arch];
  if (!triple) return null;
  const packageRoot = join(dirname(shim), "node_modules", "@openai", "codex");
  const platformPackage = `codex-win32-${arch}`;
  const vendors = [
    join(packageRoot, "node_modules", "@openai", platformPackage, "vendor"),
    join(dirname(shim), "node_modules", "@openai", platformPackage, "vendor"),
    join(packageRoot, "vendor"),
  ];
  for (const vendor of vendors) {
    for (const executable of [
      join(vendor, triple, "bin", "codex.exe"),
      join(vendor, triple, "codex", "codex.exe"),
    ]) {
      if (existsSync(executable)) return { executable, packageRoot };
    }
  }
  return null;
}

/** Ends Codex and everything it started (shell tools, MCP servers), like the ACP client does. */
function killTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (process.platform === "win32" && child.pid) {
    execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {
      if (child.exitCode === null) child.kill(signal);
    });
    return;
  }
  child.kill(signal);
}

export function redactDiagnostic(message: string): string {
  return message
    .replace(/(?:sk|sess|Bearer|token)[-_a-zA-Z0-9.=]{8,}/gi, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .slice(0, 2_000);
}
