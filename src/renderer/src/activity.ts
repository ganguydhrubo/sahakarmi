import type { QueueSnapshot, ToolCallSummary } from "../../shared/ipc";
import { type ActivityCategory, type ActivityPhase, format, LABELS } from "./activity-hinglish";
import type { BotMessage } from "./data";

/** Observable facts about one coworker. Nothing here is inferred from elapsed time. */
export interface ActivityInput {
  queue: QueueSnapshot | undefined;
  activeTurnId: string | null | undefined;
  messages: BotMessage[];
  /** A provider reported it will retry the request (Claude api_retry, Codex willRetry). */
  retry: { attempt: number | null; maxRetries: number | null } | null;
  /** The coworker asked the owner a question and is waiting. */
  waitingForUser: boolean;
  /** A tool call is paused in Approvals until the owner decides. */
  waitingForApproval: boolean;
  /** Outcome of the most recent turn, with the time it arrived. */
  outcome: { status: "completed" | "interrupted" | "failed"; at: number } | null;
  now: number;
}

export interface ActivityState {
  phase: ActivityPhase;
  category: ActivityCategory | null;
  /** Real detail from the event (tool name, command), shown verbatim. */
  detail: string | null;
  toolFailed: boolean;
  retry: { attempt: number | null; maxRetries: number | null } | null;
  /** Changes whenever a new real event should replace the primary line. */
  key: string;
}

/** How long the completed / cancelled / failed line stays before the indicator hides. */
export const OUTCOME_VISIBLE_MS = 3_000;

const IDLE: ActivityState = {
  phase: "idle",
  category: null,
  detail: null,
  toolFailed: false,
  retry: null,
  key: "idle",
};

/** Real counts from the last turn's tool cards, so "done" never hides a failed step. */
export function toolTally(messages: BotMessage[]): string | null {
  const lastTurn = [...messages].reverse().find((message) => message.turnId)?.turnId;
  if (!lastTurn) return null;
  const tools = messages.filter((message) => message.turnId === lastTurn && message.tool);
  if (tools.length === 0) return null;
  const failed = tools.filter((message) => message.tool?.status === "failed").length;
  return failed
    ? format(LABELS.outcomeToolsFailed, { count: tools.length, failed })
    : format(LABELS.outcomeTools, { count: tools.length });
}

export function isActivePhase(phase: ActivityPhase): boolean {
  return !["idle", "completed", "cancelled", "failed"].includes(phase);
}

export function deriveActivity(input: ActivityInput): ActivityState {
  const deliveries = input.queue?.deliveries ?? [];
  const starting = deliveries.some((delivery) => delivery.status === "starting");
  const running = deliveries.some((delivery) => delivery.status === "running");
  const active = Boolean(input.activeTurnId) || starting || running;

  if (!active) {
    if (input.waitingForApproval) return state("waiting_approval");
    if (deliveries.some((delivery) => delivery.status === "queued")) {
      return state(input.queue?.paused ? "paused" : "queued");
    }
    if (input.outcome && input.now - input.outcome.at < OUTCOME_VISIBLE_MS) {
      const phase =
        input.outcome.status === "completed"
          ? "completed"
          : input.outcome.status === "interrupted"
            ? "cancelled"
            : "failed";
      return {
        ...state(phase),
        detail: toolTally(input.messages),
        key: `${phase}:${input.outcome.at}`,
      };
    }
    return IDLE;
  }

  if (input.waitingForUser) return state("waiting_user");
  if (input.waitingForApproval) return state("waiting_approval");
  if (input.retry)
    return { ...state("retrying"), retry: input.retry, key: `retrying:${input.retry.attempt}` };

  const turn = currentTurnMessages(input.messages, input.activeTurnId);
  if (turn.length === 0) {
    return state(starting && !input.activeTurnId ? "initializing" : "thinking");
  }

  // A tool that is still running wins, even if text arrived after it (parallel calls).
  const runningTool = [...turn].reverse().find((message) => message.tool?.status === "running");
  if (runningTool?.tool) {
    const category = classifyTool(runningTool.tool);
    return {
      phase: category === "research" ? "researching" : "executing_tool",
      category,
      detail: toolDetail(runningTool.tool),
      toolFailed: false,
      retry: null,
      key: `tool:${runningTool.id}`,
    };
  }

  const last = turn[turn.length - 1];
  if (last?.tool) {
    return {
      phase: "processing_result",
      category: classifyTool(last.tool),
      detail: last.tool.name,
      toolFailed: last.tool.status === "failed",
      retry: null,
      key: `result:${last.id}:${last.tool.status}`,
    };
  }
  if (last?.kind === "thinking") return { ...state("thinking"), key: `thinking:${last.id}` };
  if (last?.streaming) {
    const phase = last.itemType === "final_answer" ? "finalizing" : "generating";
    return { ...state(phase), key: `${phase}:${last.id}` };
  }
  return { ...state("thinking"), key: `thinking-after:${last?.id ?? ""}` };
}

function state(phase: ActivityPhase): ActivityState {
  return { phase, category: null, detail: null, toolFailed: false, retry: null, key: phase };
}

/** Messages of the running turn: by turn id when known, else everything after the last request. */
export function currentTurnMessages(
  messages: BotMessage[],
  turnId: string | null | undefined,
): BotMessage[] {
  if (turnId && messages.some((message) => message.turnId === turnId && message.author === "bot")) {
    return messages.filter((message) => message.turnId === turnId && message.author === "bot");
  }
  let lastRequest = -1;
  messages.forEach((message, index) => {
    if (message.author === "you") lastRequest = index;
  });
  return messages
    .slice(lastRequest + 1)
    .filter((message) => message.author === "bot" && !message.id.startsWith("ui-"));
}

const TEST_COMMAND =
  /\b(test|tests|vitest|jest|pytest|mocha|lint|eslint|biome|tsc|typecheck|build|cargo\s+(test|build)|go\s+(test|build))\b/i;
const CODE_COMMAND =
  /\b(git|npm|npx|bun|bunx|pnpm|yarn|pip3?|poetry|uv|node|deno|cargo|go|make)\b/i;
const READ_TOOL = /\b(read|view|open|list|ls|glob|grep|search|find|cat)\b/i;

export function classifyTool(tool: ToolCallSummary): ActivityCategory {
  const text = `${tool.name} ${tool.input ?? ""}`;
  switch (tool.kind) {
    case "web":
      return "research";
    case "browser":
      return /search/i.test(tool.name) ? "research" : "browser";
    case "command":
      if (TEST_COMMAND.test(text)) return "tests";
      if (CODE_COMMAND.test(text)) return "code";
      return "command";
    case "file":
      return READ_TOOL.test(tool.name) ? "files_read" : "files_write";
    case "coworker":
      return "coworker";
    case "approval":
      return "approval";
    default:
      return /web|search|fetch/i.test(tool.name) ? "research" : "generic";
  }
}

function toolDetail(tool: ToolCallSummary): string {
  const input = tool.input?.split("\n")[0]?.trim() ?? "";
  if (tool.kind === "command" && input) return input.slice(0, 80);
  return tool.name.slice(0, 80);
}
