import { execFile } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerStatus, McpToolInfo } from "../../shared/ipc";
import { diagnose } from "./diagnose";

/** What the test needs: exactly what a coworker's runtime gets (after `launchCommand`). */
export interface HandshakeTarget {
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  url: string;
  headers: Record<string, string>;
  /** The command as the owner wrote it (before cmd /c), for the diagnosis. */
  displayCommand?: string;
}

export interface HandshakeOptions {
  timeoutMs: number;
  firstRun: boolean;
}

export interface HandshakeResult extends McpServerStatus {
  /** For an old SSE address: the Streamable HTTP address that answered instead (MCP-17). */
  workingUrl?: string;
}

const STDERR_LIMIT = 4000;
const MAX_TOOL_NAMES = 20;
const MAX_TOOLS = 100;

/** Ends the server and everything it started (npx → node, uv → python) on Windows. */
export function killProcessTree(pid: number | null | undefined): Promise<void> {
  if (!pid) return Promise.resolve();
  if (process.platform !== "win32") {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    execFile(
      "taskkill",
      ["/T", "/F", "/PID", String(pid)],
      { windowsHide: true, timeout: 10_000 },
      () => resolve(),
    );
  });
}

function tail(text: string): string {
  return text.length > STDERR_LIMIT ? text.slice(-STDERR_LIMIT) : text;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Variants worth trying for an address: as given, then …/sse → …/mcp (MCP-17). */
export function httpCandidates(url: string): string[] {
  const list = [url];
  const swapped = url.replace(/\/sse\/?(\?.*)?$/i, "/mcp$1");
  if (swapped !== url) list.push(swapped);
  // "localhost" can resolve to IPv6 (::1) first while a local server listens only on 127.0.0.1;
  // the same address is tried over IPv4 before the server counts as down.
  for (const candidate of [...list]) {
    const ipv4 = candidate.replace(
      /^(https?:\/\/)localhost(?=[:/?#]|$)/i,
      (_match, scheme: string) => `${scheme}127.0.0.1`,
    );
    if (ipv4 !== candidate) list.push(ipv4);
  }
  return list;
}

async function listTools(client: Client): Promise<McpToolInfo[]> {
  const tools: McpToolInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    for (const tool of page.tools) {
      tools.push({ name: tool.name, description: (tool.description ?? "").slice(0, 300) });
    }
    cursor = page.nextCursor;
  } while (cursor && tools.length < MAX_TOOLS);
  return tools.slice(0, MAX_TOOLS);
}

function success(tools: McpToolInfo[], started: number, stderr: string): HandshakeResult {
  return {
    lastCheckedAt: new Date().toISOString(),
    ok: true,
    toolCount: tools.length,
    toolNames: tools.slice(0, MAX_TOOL_NAMES).map((tool) => tool.name),
    tools,
    error: null,
    stderrTail: tail(stderr),
    diagnosis: null,
    durationMs: Date.now() - started,
  };
}

/**
 * "Test server" (MCP-2): starts the server the way coworkers will, runs `initialize` and
 * `tools/list` with the MCP SDK client, keeps the end of stderr, and always ends the process tree.
 */
export async function testServer(
  target: HandshakeTarget,
  options: HandshakeOptions,
): Promise<HandshakeResult> {
  return target.transport === "http" ? testHttp(target, options) : testStdio(target, options);
}

async function testStdio(
  target: HandshakeTarget,
  options: HandshakeOptions,
): Promise<HandshakeResult> {
  const started = Date.now();
  let stderr = "";
  let exitCode: number | null = null;
  let replied = false;
  let timedOut = false;
  let pid: number | null = null;
  const transport = new StdioClientTransport({
    command: target.command,
    args: target.args,
    env: target.env,
    ...(target.cwd ? { cwd: target.cwd } : {}),
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr = tail(stderr + chunk.toString("utf8"));
  });
  // The transport hides its child; its exit code tells "not recognized" (9009) from a crash.
  const start = transport.start.bind(transport);
  transport.start = async () => {
    await start();
    pid = transport.pid;
    const child = (transport as unknown as { _process?: NodeJS.EventEmitter })._process;
    child?.once("exit", (code: number | null) => {
      exitCode = code;
    });
  };
  const client = new Client({ name: "sahkarmi-test", version: "1.0.0" });
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => {
      await client.connect(transport);
      replied = true;
      return listTools(client);
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`No answer within ${Math.round(options.timeoutMs / 1000)} seconds.`));
      }, options.timeoutMs);
    });
    const tools = await Promise.race([work, timeout]);
    return success(tools, started, stderr);
  } catch (error) {
    // Let a crashing child flush its last stderr lines and exit code.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const text = message(error);
    const code = (error as { code?: unknown }).code;
    return {
      lastCheckedAt: new Date().toISOString(),
      ok: false,
      toolCount: 0,
      toolNames: [],
      error: text,
      stderrTail: tail(stderr),
      diagnosis: diagnose({
        command: target.displayCommand ?? target.command,
        error: typeof code === "string" ? `${text} ${code}` : text,
        stderrTail: stderr,
        exitCode,
        timedOut,
        noReply: !replied,
        firstRun: options.firstRun,
      }),
      durationMs: Date.now() - started,
    };
  } finally {
    if (timer) clearTimeout(timer);
    await killProcessTree(pid ?? transport.pid);
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

async function testHttp(
  target: HandshakeTarget,
  options: HandshakeOptions,
): Promise<HandshakeResult> {
  const started = Date.now();
  let lastError = "";
  let timedOut = false;
  for (const url of httpCandidates(target.url)) {
    const client = new Client({ name: "sahkarmi-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: target.headers },
    });
    let timer: NodeJS.Timeout | undefined;
    try {
      const tools = await Promise.race([
        (async () => {
          await client.connect(transport);
          return listTools(client);
        })(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`No answer within ${Math.round(options.timeoutMs / 1000)} seconds.`));
          }, options.timeoutMs);
        }),
      ]);
      return { ...success(tools, started, ""), ...(url !== target.url ? { workingUrl: url } : {}) };
    } catch (error) {
      lastError = message(error);
    } finally {
      if (timer) clearTimeout(timer);
      await client.close().catch(() => {});
    }
  }
  return {
    lastCheckedAt: new Date().toISOString(),
    ok: false,
    toolCount: 0,
    toolNames: [],
    error: lastError,
    stderrTail: "",
    diagnosis: diagnose({
      command: "",
      error: lastError,
      stderrTail: "",
      exitCode: null,
      timedOut,
      noReply: timedOut,
      firstRun: options.firstRun,
    }),
    durationMs: Date.now() - started,
  };
}
