import { isAbsolute, relative, resolve } from "node:path";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_LEVELS,
  type PermissionCategory,
  type PermissionGrant,
  type PermissionLevel,
  type PermissionPolicyState,
  SENSITIVE_PERMISSION_CATEGORIES,
} from "../shared/ipc";

/**
 * Safe defaults: research and reading are automatic, writing stays inside the coworker's own
 * folder and Shared, anything destructive or outward-facing asks the owner. Nothing is
 * unrestricted by default.
 */
export const DEFAULT_PERMISSION_LEVELS: Record<PermissionCategory, PermissionLevel> = {
  research: "auto",
  file_read: "auto",
  file_create: "workspace",
  file_modify: "workspace",
  file_delete: "ask",
  shell: "ask",
  browser_navigation: "auto",
  browser_interaction: "auto",
  downloads: "workspace",
  external_messages: "ask",
  publication: "ask",
  business_actions: "ask",
  payments: "ask",
  account_settings: "ask",
  official_forms: "ask",
  app_updates: "auto",
};

export function isSensitive(category: PermissionCategory): boolean {
  return SENSITIVE_PERMISSION_CATEGORIES.includes(category);
}

/** Levels the owner may pick for a category. Sensitive ones can never become automatic. */
export function allowedLevels(category: PermissionCategory): PermissionLevel[] {
  if (isSensitive(category)) return ["ask", "deny"];
  if (category === "app_updates") return ["auto", "ask"];
  return [...PERMISSION_LEVELS];
}

export function sanitizeLevels(levels: unknown): Record<PermissionCategory, PermissionLevel> {
  const result = { ...DEFAULT_PERMISSION_LEVELS };
  if (typeof levels !== "object" || levels === null) return result;
  for (const category of PERMISSION_CATEGORIES) {
    const level = (levels as Record<string, unknown>)[category];
    if (typeof level === "string" && allowedLevels(category).includes(level as PermissionLevel)) {
      result[category] = level as PermissionLevel;
    }
  }
  return result;
}

export interface PermissionRequest {
  botId: string | null;
  provider: string;
  category: PermissionCategory;
  /** Human-readable, already redacted summary. */
  action: string;
  /** Absolute paths the action touches, when known. */
  paths: string[];
}

export interface PermissionDecision {
  effective: "allow" | "ask" | "deny";
  level: PermissionLevel;
  reason: string;
  grant: PermissionGrant | null;
}

/** The effective decision for one request. Pure: the caller consumes grants it returns. */
export function decide(
  policy: PermissionPolicyState,
  request: PermissionRequest,
  workspaceRoots: string[],
  now = new Date(),
): PermissionDecision {
  const level = policy.levels[request.category] ?? DEFAULT_PERMISSION_LEVELS[request.category];
  if (level === "deny") {
    return { effective: "deny", level, reason: "Denied by your permission settings.", grant: null };
  }
  if (level === "auto" && !isSensitive(request.category)) {
    return { effective: "allow", level, reason: "Allowed automatically.", grant: null };
  }
  if (level === "workspace" && !isSensitive(request.category)) {
    if (
      request.paths.length > 0 &&
      request.paths.every((path) => insideAny(path, workspaceRoots))
    ) {
      return { effective: "allow", level, reason: "Inside the coworker's folders.", grant: null };
    }
    const why = request.paths.length === 0 ? "Location unknown" : "Outside the coworker's folders";
    return withGrant(policy, request, now, level, `${why}; asking the owner.`);
  }
  return withGrant(policy, request, now, level, "Needs your approval.");
}

function withGrant(
  policy: PermissionPolicyState,
  request: PermissionRequest,
  now: Date,
  level: PermissionLevel,
  reason: string,
): PermissionDecision {
  const grant = policy.grants.find(
    (candidate) =>
      candidate.category === request.category &&
      (candidate.botId === null || candidate.botId === request.botId) &&
      Date.parse(candidate.expiresAt) > now.getTime() &&
      (candidate.usesLeft === null || candidate.usesLeft > 0),
  );
  if (grant) {
    return {
      effective: "allow",
      level,
      reason: `Pre-authorised: ${grant.note || grant.id}`,
      grant,
    };
  }
  return { effective: "ask", level, reason, grant: null };
}

export function insideAny(path: string, roots: string[]): boolean {
  const target = resolve(path);
  return roots.some((root) => {
    const relation = relative(resolve(root), target);
    return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
  });
}

// -----------------------------------------------------------------------------
// Classification of concrete tool calls

const READ_ONLY_SEGMENT =
  /^\s*(ls|dir|pwd|cat|type|head|tail|less|more|wc|grep|rg|find|which|where|echo|date|whoami|tree|stat|file|sort|uniq|cut|basename|dirname|realpath|git\s+(status|log|diff|show|branch|remote\s+-v|rev-parse)|npm\s+(ls|view)|Get-ChildItem|Get-Content|Get-Item|Get-Location|Get-Command|Get-Date|Test-Path|Resolve-Path|Select-Object|Select-String|Where-Object|Sort-Object|Measure-Object|Format-Table|Format-List|Write-Output|Write-Host|Out-String)\b[^<>`$]*$/i;

/** "node --version", "python -V": nothing else on the segment. */
const VERSION_SEGMENT = /^\s*[\w.-]+\s+(--version|-version|-v|-V)\s*$/;

/**
 * Read-only when every part of a chained or piped command only looks (ls; echo; git status |
 * grep x). Redirection, substitution and anything else keep the command in "shell".
 */
function isReadOnlyCommand(command: string): boolean {
  if (/[<>`]|\$\(/.test(command)) return false;
  const segments = command.split(/;|&&|\|\||\|/).filter((part) => part.trim());
  if (segments.length === 0) return false;
  return segments.every(
    (part) =>
      VERSION_SEGMENT.test(part) ||
      (READ_ONLY_SEGMENT.test(part) && !/-delete\b|-exec\b/i.test(part)),
  );
}

export function classifyCommand(command: string): PermissionCategory {
  if (isReadOnlyCommand(command)) return "file_read";
  if (/\b(rm|del|rmdir|Remove-Item)\b/i.test(command)) return "file_delete";
  return "shell";
}

/** Claude Code tool names → category. */
export function classifyClaudeTool(
  toolName: string,
  input: Record<string, unknown>,
): { category: PermissionCategory; paths: string[]; action: string } {
  const path = firstString(input, ["file_path", "notebook_path", "path"]);
  const paths = path ? [path] : [];
  switch (toolName) {
    case "Read":
    case "Glob":
    case "Grep":
    case "LS":
      return { category: "file_read", paths, action: `${toolName} ${path ?? ""}`.trim() };
    case "Write":
      return { category: "file_create", paths, action: `Write ${path ?? ""}`.trim() };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { category: "file_modify", paths, action: `${toolName} ${path ?? ""}`.trim() };
    case "Bash":
    case "BashOutput":
    case "KillShell": {
      const command = firstString(input, ["command"]) ?? "";
      return { category: classifyCommand(command), paths: [], action: redact(command) };
    }
    case "WebFetch":
    case "WebSearch":
      return {
        category: "research",
        paths: [],
        action: redact(firstString(input, ["url", "query"]) ?? toolName),
      };
    case "TodoWrite":
    case "Task":
    case "ExitPlanMode":
      return { category: "research", paths: [], action: toolName };
    default:
      return { category: "shell", paths, action: toolName };
  }
}

/** ACP tool-call kinds (Gemini CLI, OpenCode) → category. */
export function classifyAcpTool(
  kind: string | null,
  title: string,
  paths: string[],
  rawInput: unknown,
): PermissionCategory {
  switch (kind) {
    case "read":
    case "search":
    case "think":
      return "file_read";
    case "fetch":
      return "research";
    case "delete":
      return "file_delete";
    case "edit":
    case "move":
      return paths.length > 0 ? "file_modify" : "file_modify";
    case "execute": {
      const command =
        typeof rawInput === "object" && rawInput !== null && "command" in rawInput
          ? String((rawInput as { command: unknown }).command)
          : title;
      return classifyCommand(command);
    }
    default:
      return /web|fetch|search/i.test(title) ? "research" : "shell";
  }
}

const RISK_RULES: Array<{ category: PermissionCategory; pattern: RegExp }> = [
  {
    category: "payments",
    pattern:
      /\b(pay|payment|pay now|checkout|check out|buy now|place order|purchase|transfer|send money|upi|proceed to pay|confirm payment|add money|top ?up)\b|भुगतान|पेमेंट|পেমেন্ট|টাকা পাঠান/i,
  },
  {
    category: "official_forms",
    pattern:
      /\b(file return|submit return|e-?file|gstr|itr|income tax|aadhaar|pan card|verify and submit)\b|रिटर्न|আয়কর/i,
  },
  {
    category: "account_settings",
    pattern:
      /\b(delete account|close account|change password|reset password|two[- ]factor|2fa|security settings|transfer ownership|remove member|deactivate)\b/i,
  },
  {
    category: "publication",
    pattern: /\b(publish|post|share|tweet|go live|upload|schedule post)\b|प्रकाशित|পোস্ট/i,
  },
  {
    category: "external_messages",
    pattern: /\b(send|reply|message|email|whatsapp|sms|invite)\b|भेजें|पाठाएं|পাঠান/i,
  },
  {
    category: "business_actions",
    pattern:
      /\b(submit|confirm|accept order|deliver order|cancel order|refund|apply|sign up|register)\b/i,
  },
];

/**
 * Browser clicks, typing with submit, and key presses. The label is the element's accessible
 * name from the latest page snapshot. Risky labels escalate to a sensitive category, which always
 * needs approval. This is a heuristic safety net on top of the coworker instructions.
 */
export function classifyBrowserAction(
  actionType: string,
  label: string,
  pageUrl: string,
  submit: boolean,
): PermissionCategory {
  if (!["click", "type", "key"].includes(actionType)) return "browser_navigation";
  if (actionType === "type" && !submit) return "browser_interaction";
  const text = `${label} ${actionType === "key" ? "" : ""}`.trim();
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  if (submit && /\.(gov|nic)\.in\b|incometax|gst\.gov/i.test(pageUrl)) return "official_forms";
  return "browser_interaction";
}

// -----------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /(sk|pk|rk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{8,}/g,
  /\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[=:]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /\b\d{12,19}\b/g, // card / account numbers
];

/** Shortens and strips likely secrets before anything is stored or shown. */
export function redact(value: string, max = 240): string {
  let text = value.replace(/\s+/g, " ").trim();
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[redacted]");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function firstString(input: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof input[key] === "string" && input[key]) return input[key] as string;
  }
  return null;
}
