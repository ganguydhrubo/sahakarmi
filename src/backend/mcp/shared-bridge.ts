import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { killProcessTree } from "./handshake";

/** What the bridge starts for one shared server (the same command a coworker would run). */
export interface SharedLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

interface Running {
  client: Client;
  transport: StdioClientTransport;
  lastUsed: number;
  busy: number;
}

const BODY_LIMIT = 4 * 1024 * 1024;
const START_TIMEOUT_MS = 60_000;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new Error("too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shared mode (MCP-7): a heavy stdio server is started once per app, on first use, and every
 * coworker reaches it through this loopback HTTP endpoint (127.0.0.1, random port, secret token in
 * the path, like the ACP tool bridge). It stops after `idleMs` without calls and when the app quits.
 */
export class SharedMcpBridge {
  readonly #resolve: (id: string) => SharedLaunch | null;
  readonly #idleMs: number;
  readonly #token = randomBytes(24).toString("hex");
  readonly #running = new Map<string, Running>();
  readonly #starting = new Map<string, Promise<Running>>();
  #server: Server | null = null;
  #port: number | null = null;
  #listening: Promise<number> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(resolve: (id: string) => SharedLaunch | null, options: { idleMs?: number } = {}) {
    this.#resolve = resolve;
    this.#idleMs = options.idleMs ?? 10 * 60_000;
  }

  /** The address a runtime gets for server `id`, or null before `listen()` finished. */
  urlFor(id: string): string | null {
    return this.#port === null
      ? null
      : `http://127.0.0.1:${this.#port}/mcp/${this.#token}/${encodeURIComponent(id)}`;
  }

  /** Servers that are running right now. */
  runningIds(): string[] {
    return [...this.#running.keys()];
  }

  listen(): Promise<number> {
    if (!this.#listening) {
      this.#listening = new Promise<number>((resolve, reject) => {
        const server = createServer((request, response) => void this.#handle(request, response));
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          this.#server = server;
          this.#port = (server.address() as AddressInfo).port;
          resolve(this.#port);
        });
      });
      this.#timer = setInterval(() => void this.#stopIdle(), Math.min(60_000, this.#idleMs));
      this.#timer.unref?.();
    }
    return this.#listening;
  }

  /** Stops one server (its settings changed, or it was switched off). */
  async stop(id: string): Promise<void> {
    const running = this.#running.get(id);
    this.#running.delete(id);
    if (!running) return;
    const pid = running.transport.pid;
    await running.client.close().catch(() => {});
    await killProcessTree(pid);
  }

  /** Ends every shared server and the endpoint (app quit). */
  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await Promise.all([...this.#running.keys()].map((id) => this.stop(id)));
    await new Promise<void>((resolve) =>
      this.#server ? this.#server.close(() => resolve()) : resolve(),
    );
    this.#server = null;
    this.#port = null;
    this.#listening = null;
  }

  async #stopIdle(): Promise<void> {
    const now = Date.now();
    for (const [id, running] of this.#running) {
      if (running.busy === 0 && now - running.lastUsed > this.#idleMs) await this.stop(id);
    }
  }

  async #get(id: string): Promise<Running> {
    const running = this.#running.get(id);
    if (running) return running;
    const pending = this.#starting.get(id);
    if (pending) return pending;
    const launch = this.#resolve(id);
    if (!launch) throw new Error("That shared server is no longer set up.");
    const start = (async () => {
      const transport = new StdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: launch.env,
        ...(launch.cwd ? { cwd: launch.cwd } : {}),
        stderr: "pipe",
      });
      transport.stderr?.on("data", () => {});
      const client = new Client({ name: "sahkarmi-shared", version: "1.0.0" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(transport),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("The shared server did not start in time.")),
              START_TIMEOUT_MS,
            );
          }),
        ]);
      } catch (error) {
        await killProcessTree(transport.pid);
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
      const entry: Running = { client, transport, lastUsed: Date.now(), busy: 0 };
      client.onclose = () => {
        if (this.#running.get(id) === entry) this.#running.delete(id);
      };
      this.#running.set(id, entry);
      return entry;
    })();
    this.#starting.set(id, start);
    try {
      return await start;
    } finally {
      this.#starting.delete(id);
    }
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const [, prefix, token, rawId] = (request.url ?? "").split("?")[0]?.split("/") ?? [];
    const id = decodeURIComponent(rawId ?? "");
    if (prefix !== "mcp" || token !== this.#token || !id || !this.#resolve(id)) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 200 : 405).end();
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(request));
    } catch {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }
    const messages = Array.isArray(body) ? body : [body];
    const replies: unknown[] = [];
    for (const message of messages) {
      const reply = await this.#message(id, message);
      if (reply) replies.push(reply);
    }
    if (replies.length === 0) {
      response.writeHead(202).end();
      return;
    }
    sendJson(response, 200, Array.isArray(body) ? replies : replies[0]);
  }

  async #message(id: string, message: unknown): Promise<unknown> {
    if (!isRecord(message) || typeof message.method !== "string") return null;
    const requestId = message.id;
    if (requestId === undefined || requestId === null) return null; // notification
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: requestId, result });
    const fail = (code: number, text: string) => ({
      jsonrpc: "2.0",
      id: requestId,
      error: { code, message: text },
    });
    const params = isRecord(message.params) ? message.params : {};
    if (message.method === "ping") return reply({});
    let running: Running;
    try {
      running = await this.#get(id);
    } catch (error) {
      return fail(-32603, error instanceof Error ? error.message : String(error));
    }
    running.busy += 1;
    running.lastUsed = Date.now();
    try {
      const client = running.client;
      switch (message.method) {
        case "initialize": {
          const capabilities = client.getServerCapabilities() ?? {};
          return reply({
            protocolVersion:
              typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26",
            capabilities: {
              ...(capabilities.tools ? { tools: { listChanged: false } } : {}),
              ...(capabilities.resources ? { resources: {} } : {}),
              ...(capabilities.prompts ? { prompts: {} } : {}),
            },
            serverInfo: client.getServerVersion() ?? { name: id, version: "0" },
            ...(client.getInstructions() ? { instructions: client.getInstructions() } : {}),
          });
        }
        case "tools/list":
          return reply(await client.listTools(params as never));
        case "tools/call":
          return reply(await client.callTool(params as never));
        case "resources/list":
          return reply(await client.listResources(params as never));
        case "resources/read":
          return reply(await client.readResource(params as never));
        case "prompts/list":
          return reply(await client.listPrompts(params as never));
        case "prompts/get":
          return reply(await client.getPrompt(params as never));
        default:
          return fail(-32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      const code = isRecord(error) && typeof error.code === "number" ? error.code : -32603;
      return fail(code, error instanceof Error ? error.message : String(error));
    } finally {
      running.busy -= 1;
      running.lastUsed = Date.now();
    }
  }
}
