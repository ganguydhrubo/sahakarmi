import { execFile } from "node:child_process";
import { randomUUID, type UUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import {
  type CanUseTool,
  createSdkMcpServer,
  getSessionMessages,
  type PermissionResult,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
  type McpServerConfig as SdkMcpServerConfig,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type AgentModelId, modelWireId } from "../shared/ipc";
import type { AgentProvider } from "./agent-client";
import { ACT_DESCRIPTION, SNAPSHOT_DESCRIPTION } from "./browser-act";
import { isInterruptMarker, readTranscriptLines } from "./claude-transcript";
import type { ClaudeCliInfo } from "./cli";
import {
  LIST_SKILLS_DESCRIPTION,
  SAVE_SKILL_DESCRIPTION,
  SEARCH_PAST_CHATS_DESCRIPTION,
} from "./learning-tools";
import { claudeMcpServers, type McpServerWire, readCustomMcpServers } from "./mcp-servers";
import {
  type AppServerNotification,
  type AppServerRequest,
  getString,
  isRecord,
  type RequestId,
  type RpcError,
  type ThreadResponse,
} from "./protocol";

const execFileAsync = promisify(execFile);

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

interface ThreadConfig {
  cwd: string;
  model?: string;
  effort?: string;
  developerInstructions: string;
  additionalDirectories: string[];
  /** MCP servers the owner added in Settings. */
  customMcpServers: McpServerWire[];
}

interface ActiveTurn {
  id: string;
  /** The text item now streaming. Text after a tool call starts a new one, like Claude Code. */
  itemId: string;
  segment: number;
  segmentText: string;
  textBreakPending: boolean;
  /** Every text of the turn joined, matched against the SDK's complete assistant messages. */
  text: string;
  assistantMessages: Map<string, string>;
  toolUses: Map<string, { name: string; input: unknown }>;
}

interface ThreadRuntime {
  id: string;
  config: ThreadConfig;
  input: AsyncMessageQueue;
  query: Query;
  activeTurn: ActiveTurn | null;
  consume: Promise<void>;
  /** Claude Code's TaskCreate / TaskUpdate list for this thread, by task id. */
  tasks?: Map<string, { text: string; status: string }>;
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type QueryFactory = (params: Parameters<typeof query>[0]) => Query;

export class ClaudeAgentClient extends EventEmitter<ClientEvents> {
  readonly provider: AgentProvider = "claude";
  readonly #cli: ClaudeCliInfo;
  readonly #createQuery: QueryFactory;
  readonly #threads = new Map<string, ThreadRuntime>();
  readonly #pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  readonly #instanceId = randomUUID();
  #running = false;
  #catalog = CLAUDE_MODELS;

  constructor(cli: ClaudeCliInfo, createQuery: QueryFactory = query) {
    super();
    this.#cli = cli;
    this.#createQuery = createQuery;
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    this.#running = true;
  }

  async stop(): Promise<void> {
    this.#running = false;
    for (const runtime of this.#threads.values()) {
      runtime.input.close();
      runtime.query.close();
    }
    await Promise.allSettled([...this.#threads.values()].map((runtime) => runtime.consume));
    this.#threads.clear();
    for (const pending of this.#pendingServerRequests.values()) {
      pending.reject(new Error("Claude session stopped."));
    }
    this.#pendingServerRequests.clear();
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    if (!this.#running) throw new Error("Claude Agent SDK is not running.");

    switch (method) {
      case "initialize":
        return {} as T;
      case "account/read":
        return (await this.#readAccount()) as T;
      case "account/rateLimits/read":
        return { rateLimits: null, rateLimitsByLimitId: null } as T;
      case "model/list":
        return { data: await this.#readModelCatalog() } as T;
      case "plugin/list":
        return { marketplaces: [] } as T;
      case "thread/start": {
        const threadId = randomUUID();
        await this.#startThread(threadId, readThreadConfig(params), false);
        return { thread: { id: threadId } } as T;
      }
      case "thread/resume": {
        const threadId = requiredString(params, "threadId");
        if (!this.#threads.has(threadId)) {
          await this.#startThread(threadId, readThreadConfig(params), true);
        }
        return { thread: { id: threadId } } as T;
      }
      case "thread/read":
        return (await this.#readThread(requiredString(params, "threadId"))) as T;
      case "turn/start":
        return (await this.#startTurn(params)) as T;
      case "turn/interrupt": {
        const runtime = this.#requireThread(requiredString(params, "threadId"));
        await runtime.query.interrupt();
        return {} as T;
      }
      case "thread/compact/start":
        // Claude Code manages its own context compaction.
        return {} as T;
      default:
        throw new Error(`Claude adapter does not implement ${method}.`);
    }
  }

  notify(): void {
    // Claude Agent SDK has no initialize notification.
  }

  respond(id: RequestId, result: unknown): void {
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.resolve(result);
  }

  respondError(id: RequestId, error: RpcError): void {
    const pending = this.#pendingServerRequests.get(id);
    if (!pending) return;
    this.#pendingServerRequests.delete(id);
    pending.reject(new Error(error.message));
  }

  async #readAccount(): Promise<unknown> {
    try {
      const { stdout } = await execFileAsync(this.#cli.executable, ["auth", "status", "--json"], {
        timeout: 5_000,
        maxBuffer: 64 * 1024,
        shell: process.platform === "win32",
      });
      const status: unknown = JSON.parse(stdout);
      if (!isRecord(status) || status.loggedIn !== true) {
        return { account: null, requiresOpenaiAuth: false };
      }
      return {
        account: {
          type: "claude",
          email: typeof status.email === "string" ? status.email : null,
          planType: typeof status.subscriptionType === "string" ? status.subscriptionType : null,
        },
        requiresOpenaiAuth: false,
      };
    } catch {
      return { account: null, requiresOpenaiAuth: false };
    }
  }

  async #readModelCatalog(): Promise<typeof CLAUDE_MODELS> {
    const runtime = this.#threads.values().next().value as ThreadRuntime | undefined;
    let owned: Query | null = null;
    const input = new AsyncMessageQueue();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let session = runtime?.query;
      if (!session) {
        owned = this.#createQuery({
          prompt: input,
          options: {
            cwd: process.cwd(),
            pathToClaudeCodeExecutable: this.#cli.executable,
            permissionMode: "dontAsk",
            tools: [],
            mcpServers: {},
            settingSources: [],
            persistSession: false,
          },
        });
        session = owned;
      }
      if (typeof session.supportedModels !== "function") return this.#catalog;
      const models = await Promise.race([
        session.supportedModels(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Model discovery timed out")), 6_000);
        }),
      ]);
      if (models.length)
        this.#catalog = models.map((model) => ({
          model: model.resolvedModel ?? model.value,
          displayName: model.displayName,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        }));
    } catch {
      /* Retain the last catalog when an older/offline CLI cannot report models. */
    } finally {
      if (timer) clearTimeout(timer);
      if (owned) {
        input.close();
        owned.close();
      }
    }
    return this.#catalog;
  }

  async #startThread(threadId: string, config: ThreadConfig, resume: boolean): Promise<void> {
    const input = new AsyncMessageQueue();
    const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
      if (toolName === "AskUserQuestion") {
        return this.#requestUserInput(threadId, toolInput, options.toolUseID ?? randomUUID());
      }
      // Sahkarmi's own MCP tools are checked where they run (browser actions, approvals).
      if (toolName.startsWith("mcp__sahkarmi")) {
        return { behavior: "allow", updatedInput: toolInput } satisfies PermissionResult;
      }
      return this.#authorizeTool(threadId, toolName, toolInput);
    };
    // The owner's own servers first, so Sahkarmi's tools always keep their names.
    const mcpServers = {
      ...claudeMcpServers(config.customMcpServers),
      ...this.#createSahkarmiServers(threadId),
    } as Record<string, SdkMcpServerConfig>;
    const claudeQuery = this.#createQuery({
      prompt: input,
      options: {
        cwd: config.cwd,
        pathToClaudeCodeExecutable: this.#cli.executable,
        ...(config.model ? { model: normalizeClaudeModel(config.model) } : {}),
        ...(config.effort ? { effort: normalizeClaudeEffort(config.effort) } : {}),
        ...(resume ? { resume: threadId } : { sessionId: threadId }),
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: config.developerInstructions,
        },
        settingSources: ["user", "project", "local"],
        // Every tool call goes through canUseTool, where Sahkarmi's permission policy decides.
        permissionMode: "default",
        includePartialMessages: true,
        additionalDirectories: config.additionalDirectories,
        canUseTool,
        mcpServers,
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "sahkarmi/0.1.0" },
      },
    });
    const runtime: ThreadRuntime = {
      id: threadId,
      config,
      input,
      query: claudeQuery,
      activeTurn: null,
      consume: Promise.resolve(),
    };
    runtime.consume = this.#consume(runtime);
    this.#threads.set(threadId, runtime);
  }

  async #startTurn(params: unknown): Promise<unknown> {
    const threadId = requiredString(params, "threadId");
    const runtime = this.#requireThread(threadId);
    if (runtime.activeTurn) throw new Error("The Claude thread already has an active turn.");

    const requestedModel = getString(params, "model");
    if (requestedModel && requestedModel !== runtime.config.model) {
      await runtime.query.setModel(normalizeClaudeModel(requestedModel));
      runtime.config.model = requestedModel;
    }
    const requestedEffort = getString(params, "effort");
    if (requestedEffort && requestedEffort !== runtime.config.effort) {
      await runtime.query.setMaxThinkingTokens(thinkingTokens(requestedEffort));
      runtime.config.effort = requestedEffort;
    }

    const clientId = getString(params, "clientUserMessageId");
    const turnId = clientId && isUuid(clientId) ? clientId : randomUUID();
    const text = readInputText(params);
    const activeTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      segment: 0,
      segmentText: "",
      textBreakPending: false,
      text: "",
      assistantMessages: new Map<string, string>(),
      toolUses: new Map<string, { name: string; input: unknown }>(),
    };
    runtime.activeTurn = activeTurn;
    this.emit("notification", {
      method: "turn/started",
      params: { threadId, turn: { id: turnId, status: "inProgress" } },
    });
    runtime.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid: turnId as UUID,
      session_id: threadId,
    });
    return { turn: { id: turnId, status: "inProgress" } };
  }

  async #consume(runtime: ThreadRuntime): Promise<void> {
    try {
      for await (const message of runtime.query) this.#handleMessage(runtime, message);
      if (this.#running) this.#fail(new Error("Claude session stream ended unexpectedly."));
    } catch (error) {
      if (!this.#running) return;
      const activeTurn = runtime.activeTurn;
      if (activeTurn) this.#completeTurn(runtime, "failed", error);
      this.#fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Usage as the SDK reports it: rate-limit windows (verified, claude.ai subscriptions) and the
   * running per-session token/cost totals from result.modelUsage (cost is an SDK estimate).
   */
  #emitUsage(runtime: ThreadRuntime, message: SDKMessage): void {
    if (message.type === "rate_limit_event") {
      const info = message.rate_limit_info;
      this.emit("notification", {
        method: "sahkarmi/usage",
        params: {
          threadId: runtime.id,
          limit: {
            id: info.rateLimitType ?? "current",
            status: info.status,
            resetsAt: typeof info.resetsAt === "number" ? info.resetsAt : null,
          },
        },
      });
      return;
    }
    if (message.type !== "result") return;
    let tokens = 0;
    for (const usage of Object.values(message.modelUsage ?? {})) {
      tokens +=
        (usage.inputTokens ?? 0) +
        (usage.outputTokens ?? 0) +
        (usage.cacheReadInputTokens ?? 0) +
        (usage.cacheCreationInputTokens ?? 0);
    }
    this.emit("notification", {
      method: "sahkarmi/usage",
      params: {
        threadId: runtime.id,
        sessionKey: `${this.#instanceId}:${runtime.id}`,
        tokens,
        costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
      },
    });
  }

  #fail(error: Error): void {
    if (!this.#running) return;
    this.#running = false;
    this.emit("exit", error);
  }

  #handleMessage(runtime: ThreadRuntime, message: SDKMessage): void {
    if (message.type === "rate_limit_event" || message.type === "result") {
      this.#emitUsage(runtime, message);
    }
    if (message.type === "system" && message.subtype === "api_retry") {
      this.emit("notification", {
        method: "sahkarmi/retrying",
        params: {
          threadId: runtime.id,
          attempt: message.attempt,
          maxRetries: message.max_retries,
          delayMs: message.retry_delay_ms,
        },
      });
    }
    if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      const event = message.event as unknown;
      const delta = isRecord(event) ? event.delta : null;
      if (
        event &&
        isRecord(event) &&
        event.type === "content_block_delta" &&
        isRecord(delta) &&
        delta.type === "text_delta" &&
        typeof delta.text === "string"
      ) {
        this.#appendDelta(runtime, delta.text);
      }
      return;
    }

    if (message.type === "user") {
      if (message.parent_tool_use_id !== null) return;
      const turn = runtime.activeTurn;
      if (!turn) return;
      for (const result of toolResultBlocks(message.message)) {
        const use = turn.toolUses.get(result.toolUseId);
        if (!use) continue;
        this.#emitToolItem(runtime, turn.id, result.toolUseId, use, true, result);
      }
      return;
    }

    if (message.type === "assistant") {
      if (message.parent_tool_use_id !== null) return;
      const turn = runtime.activeTurn;
      if (turn) {
        for (const block of toolUseBlocks(message.message)) {
          if (turn.toolUses.has(block.id)) continue;
          turn.toolUses.set(block.id, { name: block.name, input: block.input });
          turn.textBreakPending = true;
          this.#emitToolItem(runtime, turn.id, block.id, block, false, null);
        }
      }
      const text = messageText(message.message);
      if (!turn || !text) return;
      turn.assistantMessages.set(message.uuid, text);
      const completeText = [...turn.assistantMessages.values()].join("");
      if (completeText.startsWith(turn.text)) {
        this.#appendDelta(runtime, completeText.slice(turn.text.length));
      }
      return;
    }

    if (message.type !== "result") return;
    const fallback = message.subtype === "success" ? message.result : "";
    const turn = runtime.activeTurn;
    if (turn) {
      const completeText = [...turn.assistantMessages.values()].join("");
      if (completeText.length > 0 && completeText.startsWith(turn.text)) {
        this.#appendDelta(runtime, completeText.slice(turn.text.length));
      } else if (completeText && turn.segment === 0) {
        turn.text = completeText;
        turn.segmentText = completeText;
      } else if (!turn.text && fallback) this.#appendDelta(runtime, fallback);
    }
    const interrupted =
      message.terminal_reason === "aborted_streaming" ||
      message.terminal_reason === "aborted_tools" ||
      ("errors" in message && message.errors.some((error) => /interrupt|abort/i.test(error)));
    const status = interrupted
      ? "interrupted"
      : message.subtype === "success"
        ? "completed"
        : "failed";
    this.#completeTurn(runtime, status, "errors" in message ? message.errors.join("\n") : null);
  }

  #emitToolItem(
    runtime: ThreadRuntime,
    turnId: string,
    id: string,
    use: { name: string; input: unknown },
    completed: boolean,
    result: { text: string; isError: boolean } | null,
  ): void {
    // Claude keeps its task list in TodoWrite (older CLIs) or TaskCreate / TaskUpdate (newer
    // ones): either is shown as the turn's live plan, like Codex's.
    const todos = use.name === "TodoWrite" && isRecord(use.input) ? use.input.todos : null;
    if (!completed && Array.isArray(todos)) {
      this.#emitPlan(
        runtime,
        turnId,
        todos.filter(isRecord).map((todo) => ({
          step: typeof todo.content === "string" ? todo.content : "",
          status: typeof todo.status === "string" ? todo.status : "pending",
        })),
      );
    } else if (this.#trackTask(runtime, use, completed, result)) {
      this.#emitPlan(
        runtime,
        turnId,
        [...(runtime.tasks?.values() ?? [])].map((task) => ({
          step: task.text,
          status: task.status,
        })),
      );
    }
    this.emit("notification", {
      method: completed ? "item/completed" : "item/started",
      params: {
        threadId: runtime.id,
        turnId,
        item: {
          id: `tool:${id}`,
          type: "toolUse",
          tool: use.name,
          arguments: use.input,
          status: completed ? (result?.isError ? "failed" : "completed") : "inProgress",
          output: result?.text ?? null,
        },
      },
    });
  }

  /** Updates the thread's TaskCreate / TaskUpdate list; true when it changed. */
  #trackTask(
    runtime: ThreadRuntime,
    use: { name: string; input: unknown },
    completed: boolean,
    result: { text: string; isError: boolean } | null,
  ): boolean {
    const input = isRecord(use.input) ? use.input : {};
    if (use.name === "TaskCreate" && completed && result && !result.isError) {
      // The id only arrives in the result: "Task #3 created successfully: …".
      const id = /#(\d+)/.exec(result.text)?.[1];
      const text = typeof input.subject === "string" ? input.subject.trim() : "";
      if (!id || !text) return false;
      runtime.tasks ??= new Map();
      runtime.tasks.set(id, { text, status: "pending" });
      return true;
    }
    if (use.name === "TaskUpdate" && !completed) {
      const id = typeof input.taskId === "string" ? input.taskId.replace(/^#/, "") : null;
      const task = id ? runtime.tasks?.get(id) : undefined;
      if (!id || !task) return false;
      if (input.status === "deleted") runtime.tasks?.delete(id);
      else {
        if (typeof input.status === "string") task.status = input.status;
        if (typeof input.subject === "string" && input.subject.trim()) {
          task.text = input.subject.trim();
        }
      }
      return true;
    }
    return false;
  }

  #emitPlan(
    runtime: ThreadRuntime,
    turnId: string,
    plan: Array<{ step: string; status: string }>,
  ): void {
    this.emit("notification", {
      method: "turn/plan/updated",
      params: { threadId: runtime.id, turnId, explanation: null, plan },
    });
  }

  #appendDelta(runtime: ThreadRuntime, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    if (turn.textBreakPending && turn.segmentText) {
      this.#completeTextItem(runtime, turn);
      turn.segment += 1;
      turn.itemId = `${turn.id}:assistant:${turn.segment}`;
      turn.segmentText = "";
    }
    turn.textBreakPending = false;
    turn.text += delta;
    turn.segmentText += delta;
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        itemId: turn.itemId,
        delta,
      },
    });
  }

  #completeTextItem(runtime: ThreadRuntime, turn: ActiveTurn): void {
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id: turn.itemId, type: "agentMessage", text: turn.segmentText },
      },
    });
  }

  #completeTurn(runtime: ThreadRuntime, status: string, error: unknown): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    this.#completeTextItem(runtime, turn);
    if (status === "failed" && error) {
      this.emit("notification", {
        method: "error",
        params: { threadId: runtime.id, turnId: turn.id, message: String(error) },
      });
    }
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: runtime.id, turn: { id: turn.id, status } },
    });
    runtime.activeTurn = null;
  }

  async #readThread(threadId: string): Promise<ThreadResponse> {
    const runtime = this.#threads.get(threadId);
    const messages = await getSessionMessages(threadId, {
      ...(runtime?.config.cwd ? { dir: runtime.config.cwd } : {}),
    });
    // The SDK's messages carry no times; without them every reopen would stamp these turns "now".
    const lines = await readTranscriptLines(threadId);
    const turns: NonNullable<ThreadResponse["thread"]["turns"]> = [];
    let current: (typeof turns)[number] | null = null;
    let lastStartedAt: number | undefined;
    for (const message of messages) {
      if (message.parent_tool_use_id) continue;
      const text = messageText(message.message);
      const line = lines.get(message.uuid);
      const startedAt = line?.time != null ? line.time / 1_000 : lastStartedAt;
      if (message.type === "user") {
        if (!text) continue;
        lastStartedAt = startedAt;
        if (line?.internal || isInterruptMarker(text)) {
          // Claude Code's own note, not the owner's message: keep the replies after it, no bubble.
          current = { id: message.uuid, status: "completed", startedAt, items: [] };
          turns.push(current);
          continue;
        }
        current = {
          id: message.uuid,
          status: "completed",
          startedAt,
          items: [
            {
              id: message.uuid,
              type: "userMessage",
              clientId: message.uuid,
              content: [{ type: "text", text }],
            },
          ],
        };
        turns.push(current);
      } else if (message.type === "assistant" && text) {
        if (!current) {
          lastStartedAt = startedAt;
          current = { id: message.uuid, status: "completed", startedAt, items: [] };
          turns.push(current);
        }
        current.items?.push({ id: message.uuid, type: "agentMessage", text });
      }
    }
    return { thread: { id: threadId, turns } };
  }

  #createSahkarmiServers(threadId: string) {
    const call = (namespace: string, name: string, args: unknown) =>
      this.#callDynamicTool(threadId, namespace, name, args);
    return {
      sahkarmi_browser: createSdkMcpServer({
        name: "sahkarmi_browser",
        version: "0.1.0",
        tools: [
          tool(
            "open",
            "Open an HTTP(S) URL in Sahkarmi's private browser.",
            { url: z.string() },
            (args) => call("sahkarmi_browser", "open", args),
          ),
          tool("list_tabs", "List Sahkarmi browser tabs.", {}, (args) =>
            call("sahkarmi_browser", "list_tabs", args),
          ),
          tool(
            "snapshot",
            SNAPSHOT_DESCRIPTION,
            { tabId: z.string(), offset: z.number().int().min(0).optional() },
            (args) => call("sahkarmi_browser", "snapshot", args),
          ),
          tool(
            "act",
            ACT_DESCRIPTION,
            {
              tabId: z.string(),
              revision: z.number().int(),
              action: z.object({
                type: z.enum([
                  "click",
                  "type",
                  "key",
                  "paste",
                  "scroll",
                  "upload",
                  "back",
                  "forward",
                  "reload",
                ]),
                ref: z.string().optional(),
                paths: z.array(z.string()).max(10).optional(),
                text: z.string().optional(),
                submit: z.boolean().optional(),
                key: z.string().optional(),
                deltaY: z.number().optional(),
              }),
            },
            (args) => call("sahkarmi_browser", "act", args),
          ),
          tool("screenshot", "Capture the visible browser page.", { tabId: z.string() }, (args) =>
            call("sahkarmi_browser", "screenshot", args),
          ),
          tool("close_tab", "Close an Sahkarmi browser tab.", { tabId: z.string() }, (args) =>
            call("sahkarmi_browser", "close_tab", args),
          ),
        ],
      }),
      sahkarmi: createSdkMcpServer({
        name: "sahkarmi",
        version: "0.1.0",
        tools: [
          tool("list_agents", "List Sahkarmi agents that can receive local messages.", {}, (args) =>
            call("sahkarmi", "list_agents", args),
          ),
          tool(
            "request_approval",
            "Ask the owner to approve an action BEFORE doing it (payments, messages to customers, publishing, form submissions, deleting or sharing data). Returns immediately; the decision arrives later as a message.",
            {
              title: z.string().min(1).max(200),
              details: z.string().max(8_000),
              category: z.enum(["payment", "message", "submission", "data", "other"]),
              amount: z.string().max(60).nullable().optional(),
            },
            (args) => call("sahkarmi", "request_approval", args),
          ),
          tool(
            "request_browser_takeover",
            "Ask the owner to take over the browser for login, OTP/2FA, CAPTCHA or a payment page. Returns immediately; you are messaged when control is handed back.",
            { reason: z.string().min(1).max(4_000) },
            (args) => call("sahkarmi", "request_browser_takeover", args),
          ),
          tool(
            "request_secure_input",
            "Ask the owner to type a password, OTP or PIN into one page field through a secure card in their chat. Pass tabId, revision and ref from a fresh snapshot. You never see the value; you are messaged when it is filled.",
            {
              tabId: z.string().min(1),
              revision: z.number().int(),
              ref: z.string().min(1),
              kind: z.enum(["password", "otp", "pin", "other"]),
              label: z.string().max(80).optional(),
              submit: z.boolean().optional(),
            },
            (args) => call("sahkarmi", "request_secure_input", args),
          ),
          tool(
            "send_message",
            "Send an asynchronous message or local files to Sahkarmi coworkers.",
            {
              recipientBotIds: z.array(z.string()).min(1).max(32),
              text: z.string().min(1).max(100_000),
              paths: z.array(z.string()).max(10).optional(),
              replyToMessageId: z.string().nullable().optional(),
            },
            (args) => call("sahkarmi", "send_message", args),
          ),
          tool(
            "create_coworker",
            "Create a new coworker on the team with a name, role, description, and optional avatar shape/color.",
            {
              name: z.string().min(1).max(80),
              role: z.string().min(1).max(80),
              description: z.string().max(2000).optional(),
              avatarShape: z
                .enum(["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"])
                .optional(),
              avatarColor: z
                .enum([
                  "orange",
                  "blue",
                  "green",
                  "cyan",
                  "yellow",
                  "violet",
                  "magenta",
                  "red",
                  "brown",
                  "black",
                  "gray",
                ])
                .optional(),
            },
            (args) => call("sahkarmi", "create_coworker", args),
          ),
          tool(
            "update_plan",
            "Show the owner your task list for work with three or more steps. Send the whole list each time; mark one step in_progress while you work on it and completed when done.",
            {
              explanation: z.string().max(300).optional(),
              steps: z
                .array(
                  z.object({
                    step: z.string().min(1).max(200),
                    status: z.enum(["pending", "in_progress", "completed"]),
                  }),
                )
                .min(1)
                .max(30),
            },
            (args) => call("sahkarmi", "update_plan", args),
          ),
          tool(
            "save_memory",
            "Save a persistent piece of knowledge, project decision, technical fact, or owner preference into long-term team memory.",
            {
              key: z.string().min(1).max(120),
              content: z.string().min(1).max(8000),
              category: z.enum(["architecture", "preference", "decision", "fact"]).optional(),
              tags: z.array(z.string()).optional(),
            },
            (args) => call("sahkarmi", "save_memory", args),
          ),
          tool(
            "search_memory",
            "Search long-term team memory by keyword to recall previous decisions, standards, or facts.",
            {
              query: z.string(),
              category: z.enum(["architecture", "preference", "decision", "fact"]).optional(),
            },
            (args) => call("sahkarmi", "search_memory", args),
          ),
          tool(
            "list_memories",
            "List all memories currently retained in the team long-term memory hub.",
            {
              category: z.enum(["architecture", "preference", "decision", "fact"]).optional(),
            },
            (args) => call("sahkarmi", "list_memories", args),
          ),
          tool(
            "search_past_chats",
            SEARCH_PAST_CHATS_DESCRIPTION,
            {
              query: z.string().min(2).max(200),
              scope: z.enum(["mine", "team"]).optional(),
              limit: z.number().int().min(1).max(20).optional(),
            },
            (args) => call("sahkarmi", "search_past_chats", args),
          ),
          tool("list_skills", LIST_SKILLS_DESCRIPTION, {}, (args) =>
            call("sahkarmi", "list_skills", args),
          ),
          tool(
            "read_skill",
            "Read one learned or custom skill's full playbook by its id (from list_skills).",
            { id: z.string().min(1).max(80) },
            (args) => call("sahkarmi", "read_skill", args),
          ),
          tool(
            "save_skill",
            SAVE_SKILL_DESCRIPTION,
            {
              name: z.string().min(2).max(120),
              whenToUse: z.string().min(2).max(300),
              steps: z.string().min(2).max(20_000),
              changeNote: z.string().max(300).optional(),
            },
            (args) => call("sahkarmi", "save_skill", args),
          ),
        ],
      }),
    };
  }

  async #callDynamicTool(
    threadId: string,
    namespace: string,
    name: string,
    args: unknown,
  ): Promise<CallToolResult> {
    const runtime = this.#requireThread(threadId);
    const result = await this.#callServerRequest("item/tool/call", {
      threadId,
      turnId: runtime.activeTurn?.id ?? randomUUID(),
      callId: randomUUID(),
      namespace,
      tool: name,
      arguments: args,
    });
    if (!isRecord(result)) return { content: [{ type: "text" as const, text: String(result) }] };
    const content: CallToolResult["content"] = [];
    if (Array.isArray(result.contentItems)) {
      for (const item of result.contentItems) content.push(...dynamicContent(item));
    }
    return { content, isError: result.success === false };
  }

  async #requestUserInput(
    threadId: string,
    input: Record<string, unknown>,
    toolUseId: string,
  ): Promise<PermissionResult> {
    const runtime = this.#requireThread(threadId);
    const rawQuestions = Array.isArray(input.questions) ? input.questions.filter(isRecord) : [];
    const questions = rawQuestions.map((question, index) => ({
      id: `question-${index}`,
      header: typeof question.header === "string" ? question.header : "Question",
      question:
        typeof question.question === "string"
          ? question.question
          : "Claude needs more information.",
      options: Array.isArray(question.options) ? question.options : undefined,
    }));
    const result = await this.#callServerRequest("item/tool/requestUserInput", {
      threadId,
      turnId: runtime.activeTurn?.id ?? randomUUID(),
      itemId: toolUseId,
      questions,
    });
    const responseAnswers = isRecord(result) && isRecord(result.answers) ? result.answers : {};
    const answers = Object.fromEntries(
      questions.map((question) => {
        const entry = responseAnswers[question.id];
        const values = isRecord(entry) && Array.isArray(entry.answers) ? entry.answers : [];
        return [
          question.question,
          values.filter((value): value is string => typeof value === "string").join(", "),
        ];
      }),
    );
    return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
  }

  async #authorizeTool(
    threadId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<PermissionResult> {
    try {
      const verdict = await this.#callServerRequest("sahkarmi/permission", {
        threadId,
        source: "claude",
        toolName,
        input: toolInput,
      });
      if (isRecord(verdict) && verdict.allowed === true) {
        return { behavior: "allow", updatedInput: toolInput };
      }
      const reason = isRecord(verdict) && typeof verdict.reason === "string" ? verdict.reason : "";
      return { behavior: "deny", message: reason || "Blocked by the owner's permission settings." };
    } catch (error) {
      return { behavior: "deny", message: `Permission check failed: ${String(error)}` };
    }
  }

  #callServerRequest(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.#pendingServerRequests.set(id, { resolve, reject });
      this.emit("request", { id, method, params });
    });
  }

  #requireThread(threadId: string): ThreadRuntime {
    const runtime = this.#threads.get(threadId);
    if (!runtime) throw new Error(`Unknown Claude thread: ${threadId}`);
    return runtime;
  }
}

class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  readonly #values: SDKUserMessage[] = [];
  readonly #waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(value: SDKUserMessage): void {
    if (this.#closed) throw new Error("Claude input queue is closed.");
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

const CLAUDE_MODELS = [
  {
    model: "claude-fable-5",
    displayName: "Claude Fable 5",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({
      reasoningEffort,
    })),
  },
  {
    model: "claude-opus-5",
    displayName: "Claude Opus 5",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({
      reasoningEffort,
    })),
  },
  {
    model: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map((reasoningEffort) => ({
      reasoningEffort,
    })),
  },
];

function readThreadConfig(params: unknown): ThreadConfig {
  const roots =
    isRecord(params) && Array.isArray(params.runtimeWorkspaceRoots)
      ? params.runtimeWorkspaceRoots.filter((value): value is string => typeof value === "string")
      : [];
  const cwd = requiredString(params, "cwd");
  return {
    cwd,
    model: getString(params, "model") ?? undefined,
    effort: getString(params, "effort") ?? undefined,
    developerInstructions: getString(params, "developerInstructions") ?? "",
    additionalDirectories: [...new Set([cwd, ...roots])],
    customMcpServers: readCustomMcpServers(params),
  };
}

function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}

function readInputText(params: unknown): string {
  if (!isRecord(params) || !Array.isArray(params.input)) return "";
  return params.input
    .filter(isRecord)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text as string)
    .join("\n");
}

function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

function toolUseBlocks(message: unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content
    .filter(isRecord)
    .filter(
      (block) =>
        (block.type === "tool_use" || block.type === "server_tool_use") &&
        typeof block.id === "string" &&
        typeof block.name === "string",
    )
    .map((block) => ({ id: block.id as string, name: block.name as string, input: block.input }));
}

function toolResultBlocks(
  message: unknown,
): Array<{ toolUseId: string; text: string; isError: boolean }> {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "tool_result" && typeof block.tool_use_id === "string")
    .map((block) => ({
      toolUseId: block.tool_use_id as string,
      text:
        typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .filter(isRecord)
                .map((part) => (typeof part.text === "string" ? part.text : ""))
                .filter(Boolean)
                .join("\n")
            : "",
      isError: block.is_error === true,
    }));
}

function dynamicContent(value: unknown): CallToolResult["content"] {
  if (!isRecord(value)) return [];
  if (value.type === "inputText" && typeof value.text === "string") {
    return [{ type: "text" as const, text: value.text }];
  }
  if (value.type === "inputImage" && typeof value.imageUrl === "string") {
    const match = value.imageUrl.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) return [{ type: "image" as const, mimeType: match[1], data: match[2] }];
  }
  return [];
}

function normalizeClaudeModel(model: string): string {
  return modelWireId(model as AgentModelId);
}

function normalizeClaudeEffort(effort: string): "low" | "medium" | "high" | "xhigh" | "max" {
  return ["low", "medium", "high", "xhigh", "max"].includes(effort)
    ? (effort as "low" | "medium" | "high" | "xhigh" | "max")
    : "high";
}

function thinkingTokens(effort: string): number {
  return { low: 2_000, medium: 8_000, high: 16_000, xhigh: 32_000, max: 64_000 }[effort] ?? 16_000;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
