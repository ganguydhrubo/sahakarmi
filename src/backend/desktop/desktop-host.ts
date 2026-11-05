import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DESKTOP_HOST_SCRIPT } from "./desktop-host-script";

/** What the desktop service needs from the host; tests pass a fake. */
export interface DesktopHostLike {
  request(body: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

export interface DesktopHostOptions {
  /** Folder the host script is written to (userData/desktop). */
  scriptDir: string;
  /** Sahkarmi's own process ids: their windows are never clicked, typed into or focused. */
  protectedPids: number[];
  powershellPath?: string;
  /** Replaced in tests. */
  spawnImpl?: typeof spawn;
  idleShutdownMs?: number;
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const START_TIMEOUT_MS = 60_000;
const IDLE_SHUTDOWN_MS = 15 * 60_000;

/**
 * One long-lived, hidden Windows PowerShell process that compiles the desktop helper once and
 * then answers JSON lines, so a click costs a pipe write instead of a PowerShell start (about a
 * second, plus the C# compile). Started on first use, stopped after a quiet spell, restarted
 * after a crash or a hung request. Same pattern as the voice host.
 */
export class DesktopHost implements DesktopHostLike {
  readonly #options: DesktopHostOptions;
  readonly #powershell: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  #ready: Promise<void> | null = null;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #idleTimer: NodeJS.Timeout | null = null;
  /** One request at a time: input from two calls must never interleave. */
  #queue: Promise<unknown> = Promise.resolve();
  dpiMode: string | null = null;

  constructor(options: DesktopHostOptions) {
    this.#options = options;
    const system = process.env.SystemRoot ?? "C:\\Windows";
    this.#powershell =
      options.powershellPath ??
      join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }

  request(body: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const run = this.#queue.then(
      () => this.#send(body, timeoutMs),
      () => this.#send(body, timeoutMs),
    );
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #send(body: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    this.#ready ??= this.#start().catch((error) => {
      this.#ready = null;
      throw error;
    });
    await this.#ready;
    const child = this.#child;
    if (!child) throw new Error("The desktop helper is not running.");
    this.#touch();
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("The desktop helper took too long (the app may be busy). Try again."));
        void this.#stop();
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ ...body, id })}\n`);
    });
  }

  async #start(): Promise<void> {
    await mkdir(this.#options.scriptDir, { recursive: true });
    const script = join(this.#options.scriptDir, "desktop-host.ps1");
    // A byte-order mark makes Windows PowerShell 5.1 read the script as UTF-8.
    await writeFile(script, `\uFEFF${DESKTOP_HOST_SCRIPT}`, "utf8");
    const spawnImpl = this.#options.spawnImpl ?? spawn;
    const child = spawnImpl(
      this.#powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-ProtectedPids",
        this.#options.protectedPids.join(","),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    ) as ChildProcessWithoutNullStreams;
    this.#child = child;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const startTimer = setTimeout(() => {
        if (ready) return;
        reject(new Error("The desktop helper did not start in time."));
        child.kill();
      }, START_TIMEOUT_MS);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!ready && message.ready === true) {
          ready = true;
          clearTimeout(startTimer);
          this.dpiMode = typeof message.dpi === "string" ? message.dpi : null;
          resolve();
          return;
        }
        const id = typeof message.id === "number" ? message.id : -1;
        const pending = this.#pending.get(id);
        if (!pending) return;
        this.#pending.delete(id);
        clearTimeout(pending.timer);
        if (message.ok === true) pending.resolve(message);
        else pending.reject(new Error(String(message.error ?? "The desktop action failed.")));
      });
      child.on("exit", (code) => {
        if (this.#child === child) {
          this.#child = null;
          this.#ready = null;
        }
        clearTimeout(startTimer);
        const reason = new Error(
          `The desktop helper stopped (code ${code ?? "?"}). ${lastUsefulLine(stderr)}`.trim(),
        );
        if (!ready) reject(reason);
        for (const pending of this.#pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(reason);
        }
        this.#pending.clear();
      });
      child.on("error", (error) => {
        clearTimeout(startTimer);
        reject(error);
      });
    });
  }

  #touch(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(
      () => void this.#stop(),
      this.#options.idleShutdownMs ?? IDLE_SHUTDOWN_MS,
    );
    this.#idleTimer.unref?.();
  }

  async #stop(): Promise<void> {
    const child = this.#child;
    this.#child = null;
    this.#ready = null;
    if (!child) return;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    await this.#stop();
  }
}

function lastUsefulLine(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1)?.slice(0, 300) ?? "";
}
