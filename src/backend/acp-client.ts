import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentModelId } from "../shared/ipc";
import type { AgentProvider } from "./agent-client";
import {
  type AccountReadResult,
  type AppServerNotification,
  type AppServerRequest,
  getString,
  isRecord,
  type RequestId,
  type RpcError,
  type ThreadItem,
  type ThreadResponse,
  type TurnRecord,
} from "./protocol";

/**
 * Agent Client Protocol (https://agentclientprotocol.com) adapter.
 *
 * Drives any ACP agent CLI — Gemini CLI (`gemini --acp`) and OpenCode (`opencode acp`) — and
 * translates it into the App Server notifications AgentService already understands, exactly like
 * the Claude adapter does. Sahkarmi's own tools (browser, approvals, coworker messages) reach the
 * agent through a loopback-only MCP server with an unguessable per-session URL.
 */

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

export interface AcpModelOption {
  value: string;
  name: string;
}

export interface AcpAgentConfig {
  provider: Extract<AgentProvider, "gemini" | "opencode">;
  label: string;
  executable: string;
  args: string[];
  /** Folder for Sahkarmi's own per-session transcripts (ACP has no history read API). */
  transcriptDir: string;
  models: Array<{ model: AgentModelId; displayName: string }>;
  readAccount: () => Promise<AccountReadResult>;
  /** Maps a Sahkarmi model id to one of the agent's model values, or null to keep its default. */
  modelValue: (model: AgentModelId, options: AcpModelOption[]) => string | null;
}

interface ActiveTurn {
  /** The model echoed its tool call as text; deltas are held back and the final text cleaned. */
  leakedToolCall?: boolean;
  id: string;
  itemId: string;
  text: string;
  thought: string;
  userText: string;
  tools: Map<string, ThreadItem>;
}

interface AcpSession {
  threadId: string;
  acpSessionId: string;
  cwd: string;
  instructions: string;
  instructionsSent: boolean;
  model: string | null;
  modelOptions: AcpModelOption[];
  activeTurn: ActiveTurn | null;
  mcpToken: string;
}

interface DynamicNamespace {
  name: string;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
}

interface McpRoute {
  threadId: string | null;
  namespaces: Map<string, DynamicNamespace>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const MAX_MCP_BODY_BYTES = 5 * 1024 * 1024;

export class AcpAgentClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider;
  readonly #config: AcpAgentConfig;
  readonly #pending = new Map<number, Pending>();
  readonly #serverRequests = new Map<RequestId, Pending>();
  readonly #sessions = new Map<string, AcpSession>();
  readonly #mcpRoutes = new Map<string, McpRoute>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #buffer = "";
  #nextId = 1;
  #running = false;
  #agentCapabilities: Record<string, unknown> = {};
  #mcpServer: Server | null = null;
  #mcpPort: number | null = null;

  constructor(config: AcpAgentConfig) {
    super();
    this.#config = config;
    this.provider = config.provider;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#child) return;
    const needsShell =
      process.platform === "win32" &&
      [".cmd", ".bat"].includes(extname(this.#config.executable).toLowerCase());
    const child = spawn(this.#config.executable, this.#config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      shell: needsShell,
      windowsHide: true,
    });
    this.#child = child;
    this.#running = true;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#onStdout(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.emit("diagnostic", `${this.#config.label}: ${text.slice(0, 2_000)}`);
    });
    child.once("error", (error) => this.#fail(error));
    child.once("exit", (code, signal) =>
      this.#fail(new Error(`${this.#config.label} exited with ${signal ?? `code ${code}`}.`)),
    );
  }

  async stop(): Promise<void> {
    this.#running = false;
    const child = this.#child;
    this.#child = null;
    for (const pending of [...this.#pending.values(), ...this.#serverRequests.values()]) {
      pending.reject(new Error(`${this.#config.label} stopped.`));
    }
    this.#pending.clear();
    this.#serverRequests.clear();
    await new Promise<void>((resolve) => {
      if (!this.#mcpServer) return resolve();
      this.#mcpServer.close(() => resolve());
      this.#mcpServer.closeAllConnections?.();
    });
    this.#mcpServer = null;
    this.#mcpPort = null;
    if (!child || child.exitCode !== null) return;
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => child.kill("SIGKILL"), 2_000);
      child.once("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (!this.#running) throw new Error(`${this.#config.label} is not running.`);
    switch (method) {
      case "initialize": {
        const result = await this.#call<Record<string, unknown>>("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "sahkarmi", title: "Sahkarmi", version: "0.2.2" },
        });
        this.#agentCapabilities = isRecord(result.agentCapabilities)
          ? result.agentCapabilities
          : {};
        return {} as T;
      }
      case "account/read":
        return (await this.#config.readAccount()) as T;
      case "account/rateLimits/read":
        return { rateLimits: null, rateLimitsByLimitId: null } as T;
      case "model/list":
        return {
          data: this.#config.models.map((model) => ({
            model: model.model,
            displayName: model.displayName,
          })),
        } as T;
      case "plugin/list":
        return { marketplaces: [] } as T;
      case "thread/start":
        return { thread: { id: (await this.#openSession(params, null)).threadId } } as T;
      case "thread/resume": {
        const threadId = requiredString(params, "threadId");
        const existing = this.#sessions.get(threadId);
        if (existing) {
          // Profile changes re-resume the thread; resend the standing instructions next turn.
          existing.instructions =
            getString(params, "developerInstructions") ?? existing.instructions;
          existing.instructionsSent = false;
        } else {
          await this.#openSession(params, threadId);
        }
        return { thread: { id: threadId } } as T;
      }
      case "thread/read":
        return (await this.#readTranscript(requiredString(params, "threadId"))) as T;
      case "turn/start":
        return (await this.#startTurn(params)) as T;
      case "turn/interrupt": {
        const session = this.#requireSession(requiredString(params, "threadId"));
        this.#write({
          jsonrpc: "2.0",
          method: "session/cancel",
          params: { sessionId: session.acpSessionId },
        });
        return {} as T;
      }
      case "thread/compact/start":
        // ACP agents manage their own context windows.
        return {} as T;
      default:
        throw new Error(`${this.#config.label} adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // ACP has no "initialized" notification.
  }

  respond(id: RequestId, result: unknown): void {
    const pending = this.#serverRequests.get(id);
    if (!pending) return;
    this.#serverRequests.delete(id);
    pending.resolve(result);
  }

  respondError(id: RequestId, error: RpcError): void {
    const pending = this.#serverRequests.get(id);
    if (!pending) return;
    this.#serverRequests.delete(id);
    pending.reject(new Error(error.message));
  }

  // ---------------------------------------------------------------------------
  // Sessions and turns

  async #openSession(params: unknown, existingThreadId: string | null): Promise<AcpSession> {
    const cwd = requiredString(params, "cwd");
    const mcpToken = randomBytes(24).toString("hex");
    const route: McpRoute = { threadId: existingThreadId, namespaces: readNamespaces(params) };
    this.#mcpRoutes.set(mcpToken, route);
    const mcpServers = await this.#mcpServersFor(mcpToken, route);

    let result: Record<string, unknown> | null = null;
    let acpSessionId = existingThreadId;
    if (existingThreadId && this.#agentCapabilities.loadSession === true) {
      try {
        result = await this.#call("session/load", { sessionId: existingThreadId, cwd, mcpServers });
      } catch (error) {
        this.emit(
          "diagnostic",
          `${this.#config.label}: could not reload session (${String(error)})`,
        );
      }
    }
    if (!result) {
      result = await this.#call<Record<string, unknown>>("session/new", { cwd, mcpServers });
      acpSessionId = requiredString(result, "sessionId");
    }
    const threadId = existingThreadId ?? (acpSessionId as string);
    route.threadId = threadId;
    const session: AcpSession = {
      threadId,
      acpSessionId: acpSessionId as string,
      cwd,
      instructions: getString(params, "developerInstructions") ?? "",
      instructionsSent: false,
      model: null,
      modelOptions: readModelOptions(result),
      activeTurn: null,
      mcpToken,
    };
    this.#sessions.set(threadId, session);
    await this.#applyModel(session, getString(params, "model"));
    return session;
  }

  async #applyModel(session: AcpSession, model: string | null): Promise<void> {
    if (!model || model === session.model) return;
    session.model = model;
    const value = this.#config.modelValue(model as AgentModelId, session.modelOptions);
    if (!value) return;
    try {
      await this.#call("session/set_config_option", {
        sessionId: session.acpSessionId,
        configId: "model",
        value,
      });
    } catch {
      try {
        await this.#call("session/set_model", { sessionId: session.acpSessionId, modelId: value });
      } catch (error) {
        this.emit(
          "diagnostic",
          `${this.#config.label}: could not select ${value} (${String(error)})`,
        );
      }
    }
  }

  async #startTurn(params: unknown): Promise<unknown> {
    const session = this.#requireSession(requiredString(params, "threadId"));
    if (session.activeTurn)
      throw new Error(`The ${this.#config.label} session already has an active turn.`);
    await this.#applyModel(session, getString(params, "model"));

    const clientId = getString(params, "clientUserMessageId");
    const turnId = clientId && isUuid(clientId) ? clientId : randomUUID();
    const { text, links } = readInput(params);
    const turn: ActiveTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      text: "",
      thought: "",
      userText: text,
      tools: new Map(),
    };
    session.activeTurn = turn;

    const prompt: Array<Record<string, unknown>> = [];
    const instructions =
      !session.instructionsSent && session.instructions
        ? `<sahkarmi_coworker_instructions>\n${session.instructions}\n</sahkarmi_coworker_instructions>\n\n`
        : "";
    session.instructionsSent = true;
    prompt.push({ type: "text", text: `${instructions}${text}` });
    for (const path of links) {
      prompt.push({ type: "resource_link", uri: pathToFileURL(path).href, name: basename(path) });
    }

    this.emit("notification", {
      method: "turn/started",
      params: { threadId: session.threadId, turn: { id: turnId, status: "inProgress" } },
    });
    void this.#call<Record<string, unknown>>("session/prompt", {
      sessionId: session.acpSessionId,
      prompt,
    }).then(
      (result) =>
        this.#finishTurn(session, turn, stopStatus(getString(result, "stopReason")), null),
      (error) => this.#finishTurn(session, turn, "failed", error),
    );
    return { turn: { id: turnId, status: "inProgress" } };
  }

  #finishTurn(session: AcpSession, turn: ActiveTurn, status: string, error: unknown): void {
    if (session.activeTurn !== turn) return;
    session.activeTurn = null;
    const threadId = session.threadId;
    for (const tool of turn.tools.values()) {
      if (tool.status === "inProgress") {
        tool.status = status === "completed" ? "completed" : "failed";
        this.#emitItem(threadId, turn.id, tool, true);
      }
    }
    if (turn.thought.trim()) {
      this.#emitItem(
        threadId,
        turn.id,
        {
          id: `${turn.id}:thought`,
          type: "agentMessage",
          text: turn.thought.trim(),
          phase: "commentary",
        },
        true,
      );
    }
    this.#emitItem(
      threadId,
      turn.id,
      { id: turn.itemId, type: "agentMessage", text: stripLeakedToolCalls(turn.text) },
      true,
    );
    if (status === "failed" && error) {
      this.emit("notification", {
        method: "error",
        params: { threadId, turnId: turn.id, message: errorMessage(error) },
      });
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId, turn: { id: turn.id, status } },
    });
    void this.#appendTranscript(session, turn, status).catch((cause) =>
      this.emit("diagnostic", `${this.#config.label}: transcript not saved (${String(cause)})`),
    );
  }

  #handleSessionUpdate(params: unknown): void {
    const sessionId = getString(params, "sessionId");
    const update = isRecord(params) && isRecord(params.update) ? params.update : null;
    if (!sessionId || !update) return;
    const session = [...this.#sessions.values()].find((item) => item.acpSessionId === sessionId);
    const turn = session?.activeTurn;
    // Updates outside a turn are history replays from session/load; Sahkarmi keeps its own.
    if (!session || !turn) return;

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const delta = contentText(update.content);
        if (!delta) return;
        turn.text += delta;
        if (turn.leakedToolCall || LEAKED_TOOL_CALL_HINT.test(turn.text)) {
          turn.leakedToolCall = true;
          return;
        }
        this.emit("notification", {
          method: "item/agentMessage/delta",
          params: { threadId: session.threadId, turnId: turn.id, itemId: turn.itemId, delta },
        });
        return;
      }
      case "agent_thought_chunk":
        turn.thought += contentText(update.content);
        return;
      case "tool_call":
      case "tool_call_update": {
        const toolCallId = getString(update, "toolCallId");
        if (!toolCallId) return;
        const previous = turn.tools.get(toolCallId);
        const status = toolStatus(getString(update, "status")) ?? previous?.status ?? "inProgress";
        const item: ThreadItem = {
          id: `tool:${toolCallId}`,
          type: "toolUse",
          tool: getString(update, "title") ?? previous?.tool ?? getString(update, "kind") ?? "tool",
          arguments: update.rawInput ?? previous?.arguments ?? null,
          output: toolOutput(update) ?? previous?.output ?? null,
          status,
        };
        turn.tools.set(toolCallId, item);
        this.#emitItem(session.threadId, turn.id, item, status !== "inProgress");
        return;
      }
      default:
        return;
    }
  }

  #emitItem(threadId: string, turnId: string, item: ThreadItem, completed: boolean): void {
    this.emit("notification", {
      method: completed ? "item/completed" : "item/started",
      params: { threadId, turnId, item },
    });
  }

  #requireSession(threadId: string): AcpSession {
    const session = this.#sessions.get(threadId);
    if (!session) throw new Error(`Unknown ${this.#config.label} session: ${threadId}`);
    return session;
  }

  // ---------------------------------------------------------------------------
  // Transcripts (ACP has no "read thread" call, so Sahkarmi keeps its own history)

  #transcriptPath(threadId: string): string {
    return join(this.#config.transcriptDir, `${threadId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
  }

  async #readTranscript(threadId: string): Promise<ThreadResponse> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.#transcriptPath(threadId), "utf8"));
      const turns =
        isRecord(parsed) && Array.isArray(parsed.turns) ? (parsed.turns as TurnRecord[]) : [];
      return { thread: { id: threadId, turns } };
    } catch {
      return { thread: { id: threadId, turns: [] } };
    }
  }

  async #appendTranscript(session: AcpSession, turn: ActiveTurn, status: string): Promise<void> {
    const { thread } = await this.#readTranscript(session.threadId);
    const turns = thread.turns ?? [];
    turns.push({
      id: turn.id,
      status,
      startedAt: Math.floor(Date.now() / 1_000),
      items: [
        {
          id: turn.id,
          type: "userMessage",
          clientId: turn.id,
          content: [{ type: "text", text: turn.userText }],
        },
        ...turn.tools.values(),
        ...(turn.text
          ? [{ id: turn.itemId, type: "agentMessage", text: stripLeakedToolCalls(turn.text) }]
          : []),
      ],
    });
    await mkdir(this.#config.transcriptDir, { recursive: true, mode: 0o700 });
    const path = this.#transcriptPath(session.threadId);
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ version: 1, turns: turns.slice(-500) })}\n`, {
      mode: 0o600,
    });
    await rename(temporary, path);
  }

  // ---------------------------------------------------------------------------
  // Loopback MCP bridge for Sahkarmi's dynamic tools

  async #mcpServersFor(token: string, route: McpRoute): Promise<unknown[]> {
    const capabilities = isRecord(this.#agentCapabilities.mcpCapabilities)
      ? this.#agentCapabilities.mcpCapabilities
      : {};
    if (route.namespaces.size === 0) return [];
    if (capabilities.http !== true) {
      this.emit(
        "diagnostic",
        `${this.#config.label} does not accept HTTP MCP servers; Sahkarmi tools are unavailable to it.`,
      );
      return [];
    }
    const port = await this.#ensureMcpServer();
    return [...route.namespaces.keys()].map((namespace) => ({
      type: "http",
      name: namespace,
      url: `http://127.0.0.1:${port}/mcp/${token}/${encodeURIComponent(namespace)}`,
      headers: [],
    }));
  }

  async #ensureMcpServer(): Promise<number> {
    if (this.#mcpPort !== null) return this.#mcpPort;
    const server = createServer((request, response) => void this.#handleMcpHttp(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.#mcpServer = server;
    this.#mcpPort = (server.address() as AddressInfo).port;
    return this.#mcpPort;
  }

  async #handleMcpHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const [, prefix, token, rawNamespace] = (request.url ?? "").split("/");
    const route = prefix === "mcp" && token ? this.#mcpRoutes.get(token) : undefined;
    const namespace = route?.namespaces.get(decodeURIComponent(rawNamespace ?? ""));
    if (!route || !namespace) {
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
      const reply = await this.#handleMcpMessage(route, namespace, message);
      if (reply) replies.push(reply);
    }
    if (replies.length === 0) {
      response.writeHead(202).end();
      return;
    }
    sendJson(response, 200, Array.isArray(body) ? replies : replies[0]);
  }

  async #handleMcpMessage(
    route: McpRoute,
    namespace: DynamicNamespace,
    message: unknown,
  ): Promise<unknown> {
    if (!isRecord(message) || typeof message.method !== "string") return null;
    const id = message.id;
    if (id === undefined || id === null) return null; // notification
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id, result });
    const fail = (code: number, text: string) => ({
      jsonrpc: "2.0",
      id,
      error: { code, message: text },
    });
    switch (message.method) {
      case "initialize":
        return reply({
          protocolVersion: getString(message.params, "protocolVersion") ?? "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: namespace.name, version: "0.2.2" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: namespace.tools });
      case "tools/call": {
        const name = getString(message.params, "name");
        if (!name || !route.threadId) return fail(-32602, "Unknown tool or session.");
        const session = this.#sessions.get(route.threadId);
        try {
          const result = await this.#callServerRequest("item/tool/call", {
            threadId: route.threadId,
            turnId: session?.activeTurn?.id ?? randomUUID(),
            callId: randomUUID(),
            namespace: namespace.name,
            tool: name,
            arguments: isRecord(message.params) ? (message.params.arguments ?? {}) : {},
          });
          return reply(toMcpResult(result));
        } catch (error) {
          return reply({ content: [{ type: "text", text: errorMessage(error) }], isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${message.method}`);
    }
  }

  #callServerRequest(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#serverRequests.set(id, { resolve, reject });
      this.emit("request", { id, method, params });
    });
  }

  // ---------------------------------------------------------------------------
  // JSON-RPC over stdio

  #call<T>(method: string, params: unknown): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: (value) => resolve(value as T), reject });
      try {
        this.#write({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  #write(message: unknown): void {
    if (!this.#child?.stdin.writable) throw new Error(`${this.#config.label} is not running.`);
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #onStdout(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      newline = this.#buffer.indexOf("\n");
      if (!line) continue;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        this.emit("diagnostic", `${this.#config.label}: ${line.slice(0, 500)}`);
        continue;
      }
      this.#onMessage(message);
    }
  }

  #onMessage(message: unknown): void {
    if (!isRecord(message)) return;
    const method = typeof message.method === "string" ? message.method : null;
    const id = message.id as RequestId | undefined;
    if (!method && typeof id === "number") {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      if (isRecord(message.error)) {
        pending.reject(new Error(getString(message.error, "message") ?? "ACP request failed."));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (!method) return;
    if (id === undefined) {
      if (method === "session/update") this.#handleSessionUpdate(message.params);
      return;
    }
    this.#write(this.#answerAgentRequest(id, method, message.params));
  }

  #answerAgentRequest(id: RequestId, method: string, params: unknown): unknown {
    if (method === "session/request_permission") {
      // Same stance as the other providers: coworkers run with the access the owner granted.
      // Money, customer messages and submissions go through Sahkarmi approvals instead.
      const options =
        isRecord(params) && Array.isArray(params.options) ? params.options.filter(isRecord) : [];
      const choice =
        options.find((option) => option.kind === "allow_always") ??
        options.find((option) => option.kind === "allow_once") ??
        options[0];
      return choice
        ? {
            jsonrpc: "2.0",
            id,
            result: { outcome: { outcome: "selected", optionId: choice.optionId } },
          }
        : { jsonrpc: "2.0", id, result: { outcome: { outcome: "cancelled" } } };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Sahkarmi does not implement ${method}.` },
    };
  }

  #fail(error: Error): void {
    if (!this.#running) return;
    this.#running = false;
    this.#child = null;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.emit("exit", error);
  }
}

// -----------------------------------------------------------------------------
// Helpers

function readNamespaces(params: unknown): Map<string, DynamicNamespace> {
  const namespaces = new Map<string, DynamicNamespace>();
  const dynamicTools =
    isRecord(params) && Array.isArray(params.dynamicTools) ? params.dynamicTools : [];
  for (const entry of dynamicTools) {
    if (!isRecord(entry) || entry.type !== "namespace" || typeof entry.name !== "string") continue;
    const tools = Array.isArray(entry.tools)
      ? entry.tools.filter(isRecord).map((tool) => ({
          name: String(tool.name),
          description: typeof tool.description === "string" ? tool.description : "",
          inputSchema: tool.inputSchema ?? tool.parameters ?? { type: "object", properties: {} },
        }))
      : [];
    namespaces.set(entry.name, { name: entry.name, tools });
  }
  return namespaces;
}

export function readModelOptions(result: unknown): AcpModelOption[] {
  if (!isRecord(result)) return [];
  const configOptions = Array.isArray(result.configOptions)
    ? result.configOptions.filter(isRecord)
    : [];
  const modelConfig = configOptions.find(
    (option) => option.id === "model" || option.category === "model",
  );
  if (modelConfig && Array.isArray(modelConfig.options)) {
    return modelConfig.options
      .filter(isRecord)
      .filter((option) => typeof option.value === "string")
      .map((option) => ({
        value: option.value as string,
        name: String(option.name ?? option.value),
      }));
  }
  // Older ACP agents expose models as { availableModels: [{ modelId, name }] }.
  const models =
    isRecord(result.models) && Array.isArray(result.models.availableModels)
      ? result.models.availableModels.filter(isRecord)
      : [];
  return models
    .filter((model) => typeof model.modelId === "string")
    .map((model) => ({
      value: model.modelId as string,
      name: String(model.name ?? model.modelId),
    }));
}

function readInput(params: unknown): { text: string; links: string[] } {
  const items =
    isRecord(params) && Array.isArray(params.input) ? params.input.filter(isRecord) : [];
  const text = items
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
  const links = items
    .filter(
      (item) =>
        (item.type === "mention" || item.type === "localImage") && typeof item.path === "string",
    )
    .map((item) => item.path as string);
  return { text, links };
}

function contentText(content: unknown): string {
  if (isRecord(content) && content.type === "text" && typeof content.text === "string")
    return content.text;
  return "";
}

function toolStatus(status: string | null): string | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "pending" || status === "in_progress") return "inProgress";
  return null;
}

function toolOutput(update: Record<string, unknown>): string | null {
  const parts: string[] = [];
  if (Array.isArray(update.content)) {
    for (const block of update.content.filter(isRecord)) {
      if (block.type === "content") parts.push(contentText(block.content));
      else if (block.type === "diff" && typeof block.path === "string")
        parts.push(`Edited ${block.path}`);
    }
  }
  const text = parts.filter(Boolean).join("\n");
  if (text) return text;
  if (update.rawOutput === undefined || update.rawOutput === null) return null;
  return typeof update.rawOutput === "string" ? update.rawOutput : JSON.stringify(update.rawOutput);
}

function stopStatus(stopReason: string | null): string {
  if (stopReason === "cancelled") return "interrupted";
  if (stopReason === "refusal") return "failed";
  return "completed";
}

function toMcpResult(result: unknown): { content: unknown[]; isError: boolean } {
  const content: unknown[] = [];
  if (isRecord(result) && Array.isArray(result.contentItems)) {
    for (const item of result.contentItems.filter(isRecord)) {
      if (item.type === "inputText" && typeof item.text === "string") {
        content.push({ type: "text", text: item.text });
      } else if (item.type === "inputImage" && typeof item.imageUrl === "string") {
        const match = item.imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
        if (match) content.push({ type: "image", mimeType: match[1], data: match[2] });
      }
    }
  }
  return { content, isError: isRecord(result) && result.success === false };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_MCP_BODY_BYTES) {
        reject(new Error("MCP request too large."));
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
  response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Some free models print their tool call as text ("type=tool_call tool=… <|func_arg_name|>…"). */
const LEAKED_TOOL_CALL_HINT = /type=tool_call\s+tool=|<\|func_arg_(?:name|value)\|>/;

export function stripLeakedToolCalls(text: string): string {
  if (!LEAKED_TOOL_CALL_HINT.test(text)) return text;
  return text
    .replace(/\u200b?type=tool_call\s+tool=[^\s<]+(?:<\|func_arg_(?:name|value)\|>[^<]*)*/g, "")
    .replace(/<\|[a-z_]+\|>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
