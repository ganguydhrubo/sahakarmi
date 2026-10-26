import type { ToolCallKind, ToolCallSummary } from "../shared/ipc";
import { isRecord, type ThreadItem } from "./protocol";

// Mirrors SAHKARMI_BROWSER_NAMESPACE without importing the Electron-bound browser host.
const SAHKARMI_BROWSER_NAMESPACE = "sahkarmi_browser";

const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
  "toolUse",
]);

const MAX_FIELD_LENGTH = 4_000;

export function isToolItem(item: ThreadItem): boolean {
  return TOOL_ITEM_TYPES.has(item.type);
}

/**
 * Maps an App Server (or Claude adapter) thread item to the compact card shown in the thread.
 * Returns null for items that are not tool calls.
 */
const PLAN_TOOL = /(^|[_.])update_plan$|^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/;

export function toolCallFromItem(item: ThreadItem, completed: boolean): ToolCallSummary | null {
  if (!isToolItem(item)) return null;
  const status = toolStatus(item, completed);
  switch (item.type) {
    case "commandExecution":
      return {
        name: "Run command",
        kind: "command",
        status,
        input: clip(stringField(item.command) ?? joinCommand(item.command)),
        output: clip(stringField(item.aggregatedOutput)),
      };
    case "fileChange": {
      const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
      return {
        name: changes.length === 1 ? "Edit file" : `Edit ${changes.length} files`,
        kind: "file",
        status,
        input: clip(changes.map((change) => stringField(change.path) ?? "").join("\n")),
        output: null,
      };
    }
    case "webSearch":
      return {
        name: "Web search",
        kind: "web",
        status,
        input: clip(stringField(item.query)),
        output: null,
      };
    default: {
      const namespace = stringField(item.namespace) ?? stringField(item.server);
      const tool = stringField(item.tool) ?? stringField(item.name) ?? "tool";
      // Task-list tools show as the live plan card, not as tool rows.
      if (PLAN_TOOL.test(tool)) return null;
      return {
        name: friendlyToolName(namespace, tool),
        kind: toolKind(namespace, tool),
        status,
        input: clip(serialize(item.arguments ?? item.input)),
        output: clip(resultText(item)),
      };
    }
  }
}

function toolStatus(item: ThreadItem, completed: boolean): ToolCallSummary["status"] {
  const raw = stringField(item.status)?.toLowerCase();
  if (raw === "failed" || raw === "declined" || item.success === false || item.error)
    return "failed";
  if (completed || raw === "completed") return "completed";
  return "running";
}

function toolKind(namespace: string | null, tool: string): ToolCallKind {
  const name = `${namespace ?? ""}.${tool}`.toLowerCase();
  if (namespace === SAHKARMI_BROWSER_NAMESPACE || name.includes("browser")) return "browser";
  if (name.includes("request_approval")) return "approval";
  if (
    name.includes("send_message") ||
    name.includes("list_agents") ||
    name.includes("create_coworker")
  )
    return "coworker";
  if (name.includes("search") || name.includes("fetch")) return "web";
  if (/\b(bash|shell|exec)\b/.test(name)) return "command";
  if (/(read|write|edit|glob|grep)/.test(tool.toLowerCase())) return "file";
  return "tool";
}

const FRIENDLY_NAMES: Record<string, string> = {
  open: "Open page",
  list_tabs: "List tabs",
  snapshot: "Read page",
  act: "Use page",
  screenshot: "Screenshot",
  close_tab: "Close tab",
  list_agents: "Check team",
  create_coworker: "Create coworker",
  send_message: "Message coworker",
  request_approval: "Ask for approval",
  request_browser_takeover: "Ask you to take over",
  request_secure_input: "Ask you for a password or OTP",
};

function friendlyToolName(namespace: string | null, tool: string): string {
  const bare = tool.replace(/^mcp__[^_]+(?:_[^_]+)*__/, "");
  return FRIENDLY_NAMES[bare] ?? (namespace ? `${namespace} · ${bare}` : bare);
}

function resultText(item: ThreadItem): string | null {
  if (typeof item.error === "string") return item.error;
  if (isRecord(item.error) && typeof item.error.message === "string") return item.error.message;
  const contentItems = Array.isArray(item.contentItems)
    ? item.contentItems
    : isRecord(item.result) && Array.isArray(item.result.content)
      ? item.result.content
      : null;
  if (contentItems) {
    return contentItems
      .filter(isRecord)
      .map((content) =>
        typeof content.text === "string"
          ? content.text
          : content.type === "inputImage"
            ? "[image]"
            : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return serialize(item.result ?? item.output);
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function joinCommand(value: unknown): string | null {
  return Array.isArray(value) && value.every((part) => typeof part === "string")
    ? value.join(" ")
    : null;
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function clip(value: string | null): string | null {
  if (!value) return null;
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}\n…` : value;
}
