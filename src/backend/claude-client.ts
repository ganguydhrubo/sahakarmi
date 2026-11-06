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
import { API_TOOL_NAMESPACE } from "./api-integrations/api-service";
import { CALL_API_DESCRIPTION, LIST_APIS_DESCRIPTION } from "./api-integrations/api-tools";
import {
  APPROVAL_DETAILS_HELP,
  APPROVAL_TITLE_HELP,
  APPROVAL_TOOL_DESCRIPTION,
} from "./approval-wording";
import { ACT_DESCRIPTION, SCREENSHOT_DESCRIPTION, SNAPSHOT_DESCRIPTION } from "./browser-act";
import {
  isInterruptMarker,
  isMissingSessionError,
  prepareResume,
  readTranscriptLines,
  transcriptStamp,
} from "./claude-transcript";
import type { ClaudeCliInfo } from "./cli";
import { desktopSdkServers } from "./desktop/desktop-claude-tools";
import {
  LIST_KNOWLEDGE_BASES_DESCRIPTION,
  LIST_MEMORIES_DESCRIPTION,
  LIST_SKILLS_DESCRIPTION,
  READ_DOCUMENT_SECTION_DESCRIPTION,
  READ_SKILL_DESCRIPTION,
  SAVE_MEMORY_DESCRIPTION,
  SAVE_SKILL_DESCRIPTION,
  SEARCH_KNOWLEDGE_BASE_DESCRIPTION,
  SEARCH_MEMORY_DESCRIPTION,
  SEARCH_PAST_CHATS_DESCRIPTION,
} from "./learning-tools";
import { claudeMcpServers, type McpServerWire, readCustomMcpServers } from "./mcp-servers";
import { readCachedCatalog, writeCachedCatalog } from "./model-catalog";
import {
  type AppServerNotification,
  type AppServerRequest,
  getString,
  isRecord,
  type RequestId,
  type RpcError,
  type ThreadResponse,
} from "./protocol";
import { envForProvider, hideInheritedKeys } from "./secret-store";

const execFileAsync = promisify(execFile);
const PLAN_USAGE_TIMEOUT_MS = 8_000;
/** Model-and-tool steps one Claude turn may take before the SDK stops it. */
export const CLAUDE_MAX_TURNS = 200;

/** One claude.ai plan window (5-hour, weekly, per model) as Claude reports it. */
export interface ClaudePlanLimit {
  id: string;
  label: string | null;
  /** 0–100, or null when Claude gives a status only. */
  usedPercent: number | null;
  resetsAt: string | null;
  status: "ok" | "warning" | "limited" | "unknown";
}

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
  /** The connected-API tools' description, when this coworker may use any web API. */
  apiToolsDescription: string | null;
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
  /** Owner messages added while this turn ran; Claude reads them at its next step. */
  steers: number;
  /** What the owner sent, kept so a turn whose saved session is gone can run in a new one. */
  input?: string;
  /** A result that came while steering messages may still be waiting; the turn ends on idle. */
  deferred?: { status: string; error: string | null; timer: ReturnType<typeof setTimeout> };
}

interface ThreadRuntime {
  id: string;
  config: ThreadConfig;
  input: AsyncMessageQueue;
  query: Query;
  activeTurn: ActiveTurn | null;
  consume: Promise<void>;
  /** Started from a saved session and no usage reported yet: its first total includes older usage. */
  resumedUsage: boolean;
  /** Claude Code's TaskCreate / TaskUpdate list for this thread, by task id. */
  tasks?: Map<string, { text: string; status: string }>;
  /** The CLI reports idle/running, so a turn with steering messages can end at the true end. */
  stateEvents?: boolean;
  /** Last turn start, end or steer: the least recently used runtime closes first. */
  lastUsedAt: number;
}

interface PendingServerRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** The thread waiting for this answer (an approval, a question): it must stay open. */
  threadId: string | null;
}

export interface ClaudeClientOptions {
  /** Where the model list is kept for a day (no throwaway Claude process just to list models). */
  catalogCachePath?: string;
  /** True while the app still needs this thread's process (queued work, an open approval). */
  keepRuntime?: (threadId: string) => boolean;
  /** Settings > Features: close idle Claude processes. */
  idleClose?: () => boolean;
  /** Whether a saved session can be resumed from `cwd` (default: its transcript is on disk). */
  canResume?: (threadId: string, cwd: string) => Promise<boolean>;
}

type QueryFactory = (params: Parameters<typeof query>[0]) => Query;

export class ClaudeAgentClient extends EventEmitter<ClientEvents> {
  /** A Claude process (~450 MB) with no turn for this long closes; the next message reopens it. */
  static IDLE_CLOSE_MS = 10 * 60_000;
  /** At most this many Claude processes stay open; the least recently used idle one closes. */
  static MAX_LIVE_RUNTIMES = 3;
  static IDLE_CHECK_MS = 60_000;
  static CATALOG_MAX_AGE_MS = 24 * 60 * 60_000;
  readonly provider: AgentProvider = "claude";
  readonly #cli: ClaudeCliInfo;
  readonly #createQuery: QueryFactory;
  readonly #options: ClaudeClientOptions;
  readonly #threads = new Map<string, ThreadRuntime>();
  /** Threads whose process was closed while idle: their settings, to resume them on the next turn. */
  readonly #parked = new Map<string, ThreadConfig>();
  readonly #pendingServerRequests = new Map<RequestId, PendingServerRequest>();
  #running = false;
  #catalog = CLAUDE_MODELS;
  #catalogCheckedAt = 0;
  /** The last chat read per thread with its transcript's stamp: an unchanged file is not parsed again. */
  readonly #threadReads = new Map<string, { stamp: string; response: ThreadResponse }>();
  #idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    cli: ClaudeCliInfo,
    createQuery: QueryFactory = query,
    options: ClaudeClientOptions = {},
  ) {
    super();
    this.#cli = cli;
    this.#createQuery = createQuery;
    this.#options = options;
  }

  get running(): boolean {
    return this.#running;
  }

  /** Claude processes open right now (one per open conversation). */
  get liveRuntimes(): number {
    return this.#threads.size;
  }

  /** True while this thread's Claude process is open (a turn on it starts no new process). */
  hasLiveRuntime(threadId: string): boolean {
    return this.#threads.has(threadId);
  }

  start(): void {
    this.#running = true;
    if (!this.#idleTimer) {
      this.#idleTimer = setInterval(
        () => this.closeIdleRuntimes(),
        ClaudeAgentClient.IDLE_CHECK_MS,
      );
      this.#idleTimer.unref?.();
    }
  }

  /**
   * Closes the Claude process of every conversation idle for IDLE_CLOSE_MS (no turn, no
   * approval or question waiting, nothing queued). Its session stays on disk, so the next
   * message resumes it with the whole context. Returns the closed thread ids.
   */
  closeIdleRuntimes(now = Date.now()): string[] {
    if (this.#options.idleClose && !this.#options.idleClose()) return [];
    const closed: string[] = [];
    for (const runtime of [...this.#threads.values()]) {
      if (now - runtime.lastUsedAt < ClaudeAgentClient.IDLE_CLOSE_MS) continue;
      if (!this.#canClose(runtime)) continue;
      this.#park(runtime, "idle for 10 minutes");
      closed.push(runtime.id);
    }
    return closed;
  }

  #canClose(runtime: ThreadRuntime): boolean {
    if (runtime.activeTurn) return false;
    for (const pending of this.#pendingServerRequests.values()) {
      if (pending.threadId === runtime.id) return false;
    }
    return !this.#options.keepRuntime?.(runtime.id);
  }

  /** Over the cap: close the least recently used idle conversations' processes. */
  #enforceRuntimeCap(keep: string): void {
    if (this.#options.idleClose && !this.#options.idleClose()) return;
    const excess = this.#threads.size - ClaudeAgentClient.MAX_LIVE_RUNTIMES;
    if (excess <= 0) return;
    const candidates = [...this.#threads.values()]
      .filter((runtime) => runtime.id !== keep && this.#canClose(runtime))
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
      .slice(0, excess);
    for (const runtime of candidates) this.#park(runtime, "more than 3 Claude chats open");
  }

  #park(runtime: ThreadRuntime, reason: string): void {
    this.#threads.delete(runtime.id);
    this.#parked.set(runtime.id, runtime.config);
    runtime.input.close();
    runtime.query.close();
    this.emit(
      "diagnostic",
      `Closed an idle Claude process (${reason}); it resumes on the next message.`,
    );
  }

  /** The thread's runtime, reopened from its saved session when it was closed while idle. */
  async #liveThread(threadId: string): Promise<ThreadRuntime> {
    const live = this.#threads.get(threadId);
    if (live) return live;
    const parked = this.#parked.get(threadId);
    if (!parked) return this.#requireThread(threadId);
    await this.#startThread(threadId, parked, true);
    return this.#requireThread(threadId);
  }

  async stop(): Promise<void> {
    this.#running = false;
    if (this.#idleTimer) clearInterval(this.#idleTimer);
    this.#idleTimer = null;
    this.#parked.clear();
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
      case "sahkarmi/planLimits/read":
        return { limits: await this.#readPlanLimits() } as T;
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
          this.#parked.delete(threadId);
          await this.#startThread(threadId, readThreadConfig(params), true);
        }
        return { thread: { id: threadId } } as T;
      }
      case "thread/read":
        return (await this.#readThread(requiredString(params, "threadId"))) as T;
      case "turn/start":
        return (await this.#startTurn(params)) as T;
      case "thread/release": {
        // A deleted coworker's session: close its Claude process instead of leaving it running.
        const threadId = requiredString(params, "threadId");
        this.#parked.delete(threadId);
        const runtime = this.#threads.get(threadId);
        if (runtime) {
          this.#threads.delete(runtime.id);
          runtime.input.close();
          runtime.query.close();
        }
        return {} as T;
      }
      case "turn/steer":
        return this.#steerTurn(params) as T;
      case "turn/interrupt": {
        const threadId = requiredString(params, "threadId");
        // Closed while idle: nothing is running to stop.
        if (!this.#threads.has(threadId) && this.#parked.has(threadId)) return {} as T;
        const runtime = this.#requireThread(threadId);
        await runtime.query.interrupt();
        if (runtime.activeTurn?.deferred) this.#completeTurn(runtime, "interrupted", null);
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
    // A busy PC (Gemini starting, several coworkers running) can take longer than a few seconds
    // to start the CLI; a timeout used to read as "signed out" and queued every message. One
    // retry with a longer limit, and a shell only for a .cmd/.bat (claude.exe starts directly).
    const run = () =>
      execFileAsync(this.#cli.executable, ["auth", "status", "--json"], {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
        shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(this.#cli.executable),
      });
    try {
      const { stdout } = await run().catch(run);
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
    } catch (error) {
      // Logged, so a failing check is never again mistaken for a signed-out account.
      this.emit("diagnostic", `Claude sign-in check failed: ${messageOfError(error)}`);
      return { account: null, requiresOpenaiAuth: false };
    }
  }

  async #readModelCatalog(): Promise<typeof CLAUDE_MODELS> {
    // The list changes with Claude Code releases, not by the minute: a day-old copy is fine, and
    // reading it otherwise started a throwaway Claude process on every 15-minute refresh.
    const fresh = Date.now() - this.#catalogCheckedAt < ClaudeAgentClient.CATALOG_MAX_AGE_MS;
    if (fresh) return this.#catalog;
    const cachePath = this.#options.catalogCachePath;
    if (cachePath) {
      const cached = await readCachedCatalog<typeof CLAUDE_MODELS>(
        cachePath,
        this.#cli.version,
        ClaudeAgentClient.CATALOG_MAX_AGE_MS,
      );
      if (cached?.length) {
        this.#catalog = cached;
        this.#catalogCheckedAt = Date.now();
        return this.#catalog;
      }
    }
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
            env: cleanClaudeEnvironment(process.env),
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
      if (models.length) this.#catalogCheckedAt = Date.now();
      if (models.length)
        this.#catalog = models.map((model) => {
          const id = model.resolvedModel ?? model.value;
          // The CLI lists models, not efforts: a Claude model keeps every level it supports.
          const known = CLAUDE_MODELS.find((candidate) => candidate.model === id);
          return {
            model: id,
            displayName: model.displayName,
            defaultReasoningEffort: known?.defaultReasoningEffort ?? "high",
            supportedReasoningEfforts:
              known?.supportedReasoningEfforts ??
              CLAUDE_EFFORTS.map((reasoningEffort) => ({ reasoningEffort })),
          };
        });
      if (models.length && cachePath) {
        await writeCachedCatalog(cachePath, this.#cli.version, this.#catalog).catch(
          () => undefined,
        );
      }
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
    // A session Claude has no transcript for (deleted, cleaned up by Claude, or saved under
    // another account) cannot resume: asking anyway fails every turn with "No conversation
    // found". It starts as a new session under the same id instead.
    if (resume) {
      const canResume = this.#options.canResume ?? prepareResume;
      resume = await canResume(threadId, config.cwd).catch(() => true);
    }
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
      ...withoutClaudeKey(claudeMcpServers(config.customMcpServers)),
      ...this.#createSahkarmiServers(threadId, config.apiToolsDescription),
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
        // Only the owner's own Claude settings. A coworker can write files in its folder, so
        // .claude/settings.json there must never load: its allow rules and hooks run before
        // canUseTool and would bypass Sahkarmi's permission policy. The coworker's rules
        // (AGENTS.md / CLAUDE.md) still reach Claude through developerInstructions.
        settingSources: CLAUDE_SETTING_SOURCES,
        // Every tool call goes through canUseTool, where Sahkarmi's permission policy decides.
        permissionMode: "default",
        includePartialMessages: true,
        // A runaway tool loop stops here instead of running all night on the owner's plan.
        maxTurns: CLAUDE_MAX_TURNS,
        additionalDirectories: config.additionalDirectories,
        canUseTool,
        mcpServers,
        env: {
          ...cleanClaudeEnvironment(process.env),
          CLAUDE_AGENT_SDK_CLIENT_APP: "sahkarmi/0.1.0",
          // Lets a turn the owner steered end only when Claude has read every added message.
          CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
        },
      },
    });
    const runtime: ThreadRuntime = {
      id: threadId,
      config,
      input,
      query: claudeQuery,
      activeTurn: null,
      consume: Promise.resolve(),
      resumedUsage: resume,
      lastUsedAt: Date.now(),
    };
    runtime.consume = this.#consume(runtime);
    this.#threads.set(threadId, runtime);
    this.#parked.delete(threadId);
    this.#enforceRuntimeCap(threadId);
  }

  async #startTurn(params: unknown): Promise<unknown> {
    const threadId = requiredString(params, "threadId");
    const runtime = await this.#liveThread(threadId);
    if (runtime.activeTurn) throw new Error("The Claude thread already has an active turn.");
    runtime.lastUsedAt = Date.now();

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
      steers: 0,
      input: text,
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

  /**
   * An owner message typed while Claude works joins the running turn, as in Claude Code: Claude
   * reads it at its next step instead of the work being stopped or the message waiting.
   */
  #steerTurn(params: unknown): { turnId: string } {
    const runtime = this.#requireThread(requiredString(params, "threadId"));
    const turn = runtime.activeTurn;
    if (!turn || turn.deferred || turn.id !== getString(params, "expectedTurnId")) {
      throw new Error("The Claude turn to steer is no longer running.");
    }
    // Without idle reports the turn could end before Claude reads the message; queue it instead.
    if (!runtime.stateEvents) throw new Error("This Claude version cannot take messages mid-task.");
    const text = readInputText(params);
    if (!text) throw new Error("A steering message needs text.");
    const clientId = getString(params, "clientUserMessageId");
    turn.steers += 1;
    runtime.lastUsedAt = Date.now();
    runtime.input.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      priority: "next",
      ...(clientId && isUuid(clientId) ? { uuid: clientId as UUID } : {}),
      session_id: runtime.id,
    });
    return { turnId: turn.id };
  }

  async #consume(runtime: ThreadRuntime): Promise<void> {
    let failure: unknown;
    try {
      for await (const message of runtime.query) this.#handleMessage(runtime, message);
      failure = new Error("Claude session stream ended unexpectedly.");
    } catch (error) {
      failure = error;
    }
    if (!this.#running || this.#threads.get(runtime.id) !== runtime) return;
    await this.#recoverThread(runtime, failure);
  }

  /**
   * Each coworker has its own Claude process, so one that fails affects only that coworker.
   * (It used to stop the whole Claude provider: every other coworker's running turn was
   * dropped as "process exited", and three such failures blocked Claude until a restart.)
   * A turn whose saved session is gone runs again at once in a new session; anything else
   * fails the turn, and the next message opens the thread again.
   */
  async #recoverThread(runtime: ThreadRuntime, failure: unknown): Promise<void> {
    this.#threads.delete(runtime.id);
    runtime.input.close();
    runtime.query.close();
    const turn = runtime.activeTurn;
    const replay =
      isMissingSessionError(failure) && turn && !turn.text && !turn.toolUses.size && turn.input;
    if (replay) {
      try {
        await this.#startThread(runtime.id, runtime.config, false);
        const fresh = this.#requireThread(runtime.id);
        fresh.activeTurn = turn;
        fresh.input.push({
          type: "user",
          message: { role: "user", content: turn.input ?? "" },
          parent_tool_use_id: null,
          uuid: turn.id as UUID,
          session_id: runtime.id,
        });
        return;
      } catch (error) {
        failure = error;
        this.#threads.delete(runtime.id);
      }
    }
    if (turn) this.#completeTurn(runtime, "failed", failure);
    // The next message reopens it (resumed if its transcript is there, otherwise new).
    this.#parked.set(runtime.id, runtime.config);
  }

  /**
   * Usage as the SDK reports it: rate-limit windows (verified, claude.ai subscriptions) and the
   * running per-session token/cost totals from result.modelUsage (cost is an SDK estimate).
   * A resumed session's totals start from where the saved session left off, so the counter is
   * keyed by the session id and kept across restarts, like Codex thread totals.
   */
  #emitUsage(runtime: ThreadRuntime, message: SDKMessage): void {
    if (message.type === "rate_limit_event") {
      this.emit("notification", {
        method: "sahkarmi/usage",
        params: { threadId: runtime.id, limits: rateLimitWindows(message.rate_limit_info) },
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
    const turn = message.usage;
    const resumed = runtime.resumedUsage;
    runtime.resumedUsage = false;
    this.emit("notification", {
      method: "sahkarmi/usage",
      params: {
        threadId: runtime.id,
        sessionKey: `thread:claude:${runtime.id}`,
        persistent: true,
        resumed,
        tokens,
        // This turn's main-loop calls only: used when a resumed total cannot be split.
        turnTokens: turn
          ? (turn.input_tokens ?? 0) +
            (turn.output_tokens ?? 0) +
            (turn.cache_read_input_tokens ?? 0) +
            (turn.cache_creation_input_tokens ?? 0)
          : null,
        costUsd: typeof message.total_cost_usd === "number" ? message.total_cost_usd : null,
      },
    });
  }

  /**
   * The claude.ai plan windows behind /usage, read without sending a prompt. The SDK marks this
   * call experimental, so any failure just means "no fresh reading" (null).
   */
  async #readPlanLimits(): Promise<ClaudePlanLimit[] | null> {
    const runtime = this.#threads.values().next().value as ThreadRuntime | undefined;
    let owned: Query | null = null;
    const input = new AsyncMessageQueue();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      let session = runtime?.query;
      if (!session) {
        // No chat is open yet: a short-lived session reads the plan without sending a prompt.
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
            env: cleanClaudeEnvironment(process.env),
          },
        });
        session = owned;
      }
      const read = session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof read !== "function") return null;
      const usage = await Promise.race([
        read.call(session),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), PLAN_USAGE_TIMEOUT_MS);
        }),
      ]);
      return usage ? planUsageWindows(usage) : null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      if (owned) {
        input.close();
        owned.close();
      }
    }
  }

  #handleMessage(runtime: ThreadRuntime, message: SDKMessage): void {
    if (message.type === "rate_limit_event" || message.type === "result") {
      this.#emitUsage(runtime, message);
    }
    if (message.type === "system" && message.subtype === "session_state_changed") {
      runtime.stateEvents = true;
      const deferred = runtime.activeTurn?.deferred;
      if (message.state === "idle" && deferred) {
        this.#completeTurn(runtime, deferred.status, deferred.error);
      }
      return;
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
    const error =
      message.subtype === "error_max_turns"
        ? `Stopped after ${CLAUDE_MAX_TURNS} steps in one turn, so a loop cannot run forever. Ask the coworker to continue if the work is not finished.`
        : "errors" in message
          ? message.errors.join("\n")
          : null;
    if (turn && turn.steers > 0 && runtime.stateEvents && status !== "interrupted") {
      // A steering message may still run as its own pass; its reply belongs to this turn.
      if (turn.deferred) clearTimeout(turn.deferred.timer);
      const timer = setTimeout(
        () => this.#completeTurn(runtime, status, error),
        STEER_IDLE_WAIT_MS,
      );
      timer.unref?.();
      turn.deferred = { status, error, timer };
      return;
    }
    this.#completeTurn(runtime, status, error);
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
    if (turn.deferred) clearTimeout(turn.deferred.timer);
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
    runtime.lastUsedAt = Date.now();
  }

  async #readThread(threadId: string): Promise<ThreadResponse> {
    // A running turn is still writing; otherwise an unchanged transcript gives the same chat.
    const busy = Boolean(this.#threads.get(threadId)?.activeTurn);
    const stamp = busy ? null : await transcriptStamp(threadId).catch(() => null);
    const cached = this.#threadReads.get(threadId);
    if (stamp && cached?.stamp === stamp) return structuredClone(cached.response);
    const response = await this.#parseThread(threadId);
    if (stamp) {
      this.#threadReads.set(threadId, { stamp, response: structuredClone(response) });
      // A handful of open chats is plenty; the oldest entry goes first.
      if (this.#threadReads.size > 20) {
        const oldest = this.#threadReads.keys().next().value;
        if (oldest !== undefined) this.#threadReads.delete(oldest);
      }
    }
    return response;
  }

  async #parseThread(threadId: string): Promise<ThreadResponse> {
    const cwd = this.#threads.get(threadId)?.config.cwd ?? this.#parked.get(threadId)?.cwd;
    const messages = await getSessionMessages(threadId, {
      ...(cwd ? { dir: cwd } : {}),
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

  #createSahkarmiServers(threadId: string, apiToolsDescription: string | null = null) {
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
              snapshot: z.boolean().optional(),
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
          tool(
            "screenshot",
            SCREENSHOT_DESCRIPTION,
            { tabId: z.string(), ref: z.string().optional() },
            (args) => call("sahkarmi_browser", "screenshot", args),
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
            APPROVAL_TOOL_DESCRIPTION,
            {
              title: z.string().min(1).max(200).describe(APPROVAL_TITLE_HELP),
              details: z.string().max(8_000).describe(APPROVAL_DETAILS_HELP),
              category: z.enum(["payment", "message", "submission", "data", "other"]),
              amount: z.string().max(60).nullable().optional(),
            },
            (args) => call("sahkarmi", "request_approval", args),
          ),
          tool(
            "list_approvals",
            "List the coworkers' approval requests you hold authority to decide.",
            {},
            (args) => call("sahkarmi", "list_approvals", args),
          ),
          tool(
            "decide_approval",
            "Approve or reject a coworker's request, only if the owner gave you authority for its kind. Never for your own requests.",
            {
              approvalId: z.string().min(1),
              decision: z.enum(["approved", "rejected"]),
              note: z.string().max(2_000).optional(),
            },
            (args) => call("sahkarmi", "decide_approval", args),
          ),
          tool(
            "delegate_approval_authority",
            "CEO only: pass part of the approval authority the owner gave you to one employee. An empty categories list takes it back.",
            {
              botId: z.string().min(1),
              categories: z.array(z.enum(["payment", "message", "submission", "data", "other"])),
              hours: z.number().positive().optional(),
            },
            (args) => call("sahkarmi", "delegate_approval_authority", args),
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
            SAVE_MEMORY_DESCRIPTION,
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
            SEARCH_MEMORY_DESCRIPTION,
            {
              query: z.string(),
              category: z.enum(["architecture", "preference", "decision", "fact"]).optional(),
              limit: z.number().int().min(1).max(50).optional(),
            },
            (args) => call("sahkarmi", "search_memory", args),
          ),
          tool(
            "list_memories",
            LIST_MEMORIES_DESCRIPTION,
            {
              category: z.enum(["architecture", "preference", "decision", "fact"]).optional(),
              limit: z.number().int().min(1).max(50).optional(),
              offset: z.number().int().min(0).optional(),
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
          tool("list_knowledge_bases", LIST_KNOWLEDGE_BASES_DESCRIPTION, {}, (args) =>
            call("sahkarmi", "list_knowledge_bases", args),
          ),
          tool(
            "search_knowledge_base",
            SEARCH_KNOWLEDGE_BASE_DESCRIPTION,
            {
              query: z.string().min(2).max(300),
              knowledgeBaseId: z.string().optional(),
              limit: z.number().int().min(1).max(20).optional(),
            },
            (args) => call("sahkarmi", "search_knowledge_base", args),
          ),
          tool(
            "read_document_section",
            READ_DOCUMENT_SECTION_DESCRIPTION,
            {
              knowledgeBaseId: z.string().min(1),
              documentId: z.string().min(1),
              page: z.number().int().min(1).optional(),
              chunkIndex: z.number().int().min(0).optional(),
            },
            (args) => call("sahkarmi", "read_document_section", args),
          ),
          tool("list_skills", LIST_SKILLS_DESCRIPTION, {}, (args) =>
            call("sahkarmi", "list_skills", args),
          ),
          tool(
            "read_skill",
            READ_SKILL_DESCRIPTION,
            { id: z.string().min(1).max(90), type: z.enum(["learned", "custom"]).optional() },
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
      ...desktopSdkServers(call),
      ...(apiToolsDescription ? apiSdkServer(call, apiToolsDescription) : {}),
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
    const threadId = getString(params, "threadId");
    return new Promise((resolve, reject) => {
      this.#pendingServerRequests.set(id, { resolve, reject, threadId });
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

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

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

/**
 * Windows from a rate_limit_event. Claude sends utilization as a fraction (0.76 = 76 %) and,
 * besides the window that triggered the event, every window in `unifiedWindows`.
 */
export function rateLimitWindows(info: unknown): ClaudePlanLimit[] {
  if (!isRecord(info)) return [];
  const windows = new Map<string, ClaudePlanLimit>();
  const add = (id: string, value: unknown) => {
    if (!isRecord(value)) return;
    const utilization = typeof value.utilization === "number" ? value.utilization : null;
    windows.set(id, {
      id,
      label: null,
      usedPercent: utilization === null ? null : Math.round(utilization * 1_000) / 10,
      resetsAt:
        typeof value.resetsAt === "number" ? new Date(value.resetsAt * 1_000).toISOString() : null,
      status: limitStatus(value.status),
    });
  };
  if (isRecord(info.unifiedWindows)) {
    for (const [id, window] of Object.entries(info.unifiedWindows)) add(id, window);
  }
  add(typeof info.rateLimitType === "string" ? info.rateLimitType : "current", info);
  return [...windows.values()];
}

/** Windows from the SDK's /usage data (utilization already 0–100). */
export function planUsageWindows(usage: unknown): ClaudePlanLimit[] | null {
  const limits = isRecord(usage) && isRecord(usage.rate_limits) ? usage.rate_limits : null;
  if (!limits) return null;
  const windows: ClaudePlanLimit[] = [];
  const add = (id: string, label: string | null, value: unknown) => {
    if (!isRecord(value) || typeof value.utilization !== "number") return;
    const percent = value.utilization;
    windows.push({
      id,
      label,
      usedPercent: percent,
      resetsAt: typeof value.resets_at === "string" ? value.resets_at : null,
      // Claude itself warns from 75 % of a window (surpassedThreshold 0.75).
      status: percent >= 100 ? "limited" : percent >= 75 ? "warning" : "ok",
    });
  };
  for (const id of ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"])
    add(id, null, limits[id]);
  if (Array.isArray(limits.model_scoped)) {
    for (const scoped of limits.model_scoped) {
      const name = isRecord(scoped) ? getString(scoped, "display_name") : null;
      if (name) add(`model:${name.toLowerCase()}`, `Weekly (${name})`, scoped);
    }
  }
  return windows;
}

function limitStatus(status: unknown): ClaudePlanLimit["status"] {
  return status === "rejected"
    ? "limited"
    : status === "allowed_warning"
      ? "warning"
      : status === "allowed"
        ? "ok"
        : "unknown";
}

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
    apiToolsDescription: readApiToolsDescription(params),
  };
}

function readApiToolsDescription(params: unknown): string | null {
  const tools = isRecord(params) && Array.isArray(params.dynamicTools) ? params.dynamicTools : [];
  const entry = tools.find(
    (tool) => isRecord(tool) && tool.type === "namespace" && tool.name === API_TOOL_NAMESPACE,
  );
  return isRecord(entry) && typeof entry.description === "string" ? entry.description : null;
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

type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Claude takes five levels; the lighter and heavier ones other providers list map to the nearest. */
export function normalizeClaudeEffort(effort: string): ClaudeEffort {
  if (effort === "none" || effort === "minimal") return "low";
  if (effort === "ultra") return "max";
  return ["low", "medium", "high", "xhigh", "max"].includes(effort)
    ? (effort as ClaudeEffort)
    : "high";
}

export function thinkingTokens(effort: string): number {
  return (
    {
      none: 1_024,
      minimal: 1_024,
      low: 2_000,
      medium: 8_000,
      high: 16_000,
      xhigh: 32_000,
      max: 64_000,
      ultra: 64_000,
    }[effort] ?? 16_000
  );
}

/** Filesystem settings a coworker's Claude loads: the user's only, never the workspace's. */
export const CLAUDE_SETTING_SOURCES: Array<"user" | "project" | "local"> = ["user"];

/** How long a steered turn waits for Claude's idle report before it is closed anyway. */
const STEER_IDLE_WAIT_MS = 90_000;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Sahkarmi started from inside a Claude Code session inherits that session's variables, which
 * make a coworker's Claude think it is nested in it. Its own login settings are kept.
 */
export function cleanClaudeEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // Claude gets its own key only: the other providers' keys stay out of its shell and tools.
  return Object.fromEntries(
    Object.entries(envForProvider("claude", env)).filter(
      ([name]) =>
        name !== "CLAUDECODE" &&
        name !== "CLAUDE_CODE_ENTRYPOINT" &&
        !name.startsWith("CLAUDE_CODE_SSE"),
    ),
  );
}

/** The owner's stdio MCP servers would inherit Claude's key from its environment; hide it. */
function withoutClaudeKey(
  servers: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      name,
      server.type === "stdio"
        ? {
            ...server,
            env: hideInheritedKeys((server.env ?? {}) as Record<string, string>, "claude"),
          }
        : server,
    ]),
  );
}

function messageOfError(error: unknown): string {
  const detail = error as { message?: unknown; stderr?: unknown; code?: unknown; killed?: unknown };
  const stderr = typeof detail?.stderr === "string" ? detail.stderr.trim().slice(-400) : "";
  const base = typeof detail?.message === "string" ? detail.message : String(error);
  return [base.split("\n")[0], detail?.killed ? "(timed out)" : "", stderr]
    .filter(Boolean)
    .join(" ");
}

/** The owner's connected web APIs, for a Claude coworker that may use at least one. */
function apiSdkServer(
  call: (namespace: string, name: string, args: unknown) => Promise<CallToolResult>,
  description: string,
) {
  return {
    [API_TOOL_NAMESPACE]: createSdkMcpServer({
      name: API_TOOL_NAMESPACE,
      version: "0.1.0",
      instructions: description,
      tools: [
        tool(
          "list_apis",
          `${LIST_APIS_DESCRIPTION} ${description}`,
          { search: z.string().max(200).optional() },
          (args) => call(API_TOOL_NAMESPACE, "list_apis", args),
        ),
        tool(
          "call_api",
          CALL_API_DESCRIPTION,
          {
            api: z.string().min(1).max(120),
            operation: z.string().max(120).optional(),
            method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).optional(),
            path: z.string().max(2_000).optional(),
            params: z.record(z.string(), z.unknown()).optional(),
            body: z.unknown().optional(),
            approval_id: z.string().max(120).optional(),
          },
          (args) => call(API_TOOL_NAMESPACE, "call_api", args),
        ),
      ],
    }),
  };
}
