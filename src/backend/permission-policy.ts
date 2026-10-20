import { isAbsolute, relative, resolve } from "node:path";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_LEVELS,
  type PermissionCategory,
  type PermissionGrant,
  type PermissionLevel,
  type PermissionPolicyState,
  type SafetyLimits,
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
  destructive: "ask",
  credentials: "ask",
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

/**
 * Hard limits that live outside the model's context window, so they survive compaction and
 * cannot be talked away by a prompt.
 */
export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxToolCallsPerTurn: 80,
  maxTurnMinutes: 30,
  maxRepeatedCalls: 6,
  maxOutboundPerHour: 20,
};

const LIMIT_RANGES: Record<keyof SafetyLimits, [number, number]> = {
  maxToolCallsPerTurn: [5, 1000],
  maxTurnMinutes: [1, 240],
  maxRepeatedCalls: [2, 50],
  maxOutboundPerHour: [1, 500],
};

export function sanitizeLimits(value: unknown): SafetyLimits {
  const result = { ...DEFAULT_SAFETY_LIMITS };
  if (typeof value !== "object" || value === null) return result;
  for (const key of Object.keys(LIMIT_RANGES) as Array<keyof SafetyLimits>) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const [min, max] = LIMIT_RANGES[key];
      result[key] = Math.min(max, Math.max(min, Math.round(raw)));
    }
  }
  return result;
}

/** Outward-facing categories that count towards the hourly outbound cap. */
export const OUTBOUND_CATEGORIES: PermissionCategory[] = [
  "external_messages",
  "publication",
  "business_actions",
  "payments",
];

/** What a suggest-only coworker may still do: look, never touch. */
export const READ_ONLY_CATEGORIES: PermissionCategory[] = [
  "research",
  "file_read",
  "browser_navigation",
];

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
  /**
   * Set when the turn read untrusted content (or looked injected) and this action could carry
   * data out. Forces a fresh owner decision: no automatic level or pre-authorisation applies.
   */
  escalate?: string;
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
  if (policy.emergencyStop?.active) {
    return { effective: "deny", level, reason: "Emergency stop is on.", grant: null };
  }
  if (
    request.botId &&
    policy.suggestOnlyBots?.includes(request.botId) &&
    !READ_ONLY_CATEGORIES.includes(request.category)
  ) {
    return {
      effective: "deny",
      level,
      reason: "Suggest-only mode: describe the change for the owner instead of making it.",
      grant: null,
    };
  }
  if (level === "deny") {
    return { effective: "deny", level, reason: "Denied by your permission settings.", grant: null };
  }
  if (request.escalate) {
    return { effective: "ask", level, reason: request.escalate, grant: null };
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

const READ_ONLY_COMMAND =
  /^\s*(ls|dir|pwd|cat|type|head|tail|less|more|wc|grep|rg|find|which|where|echo|date|whoami|tree|stat|file|git\s+(status|log|diff|show|branch)|npm\s+(ls|view)|python3?\s+--version|node\s+--version)\b[^|;&><]*$/i;

/**
 * Commands that can wipe data or history in one go (the Replit, PocketOS and Supabase class of
 * incidents). Always need the owner, even when shell access is otherwise granted.
 */
const DESTRUCTIVE_COMMAND = new RegExp(
  [
    String.raw`\brm\s+(-[a-z]*[rf][a-z]*\s+)+`,
    String.raw`\bRemove-Item\b.*-Recurse`,
    String.raw`\b(rmdir|rd)\s+/s\b`,
    String.raw`\bdel\s+/[sq]\b`,
    String.raw`\b(drop|truncate)\s+(table|database|schema|index|collection)\b`,
    String.raw`\bdelete\s+from\b`,
    String.raw`\bdropDatabase\b`,
    String.raw`\bgit\s+push\b.*(--force\b|-f\b|--mirror\b|--delete\b|\s:\S|\s\+\S)`,
    String.raw`\bgit\s+reset\s+--hard\b`,
    String.raw`\bgit\s+clean\s+-[a-z]*f`,
    String.raw`\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)`,
    String.raw`\bgit\s+branch\s+-D\b`,
    String.raw`\bgit\s+filter-(branch|repo)\b`,
    String.raw`\bprisma\s+(migrate\s+reset|db\s+push)\b`,
    String.raw`--accept-data-loss\b`,
    String.raw`\bsupabase\s+db\s+reset\b`,
    String.raw`\b(rails|rake)\s+db:(drop|reset)\b`,
    String.raw`\bmanage\.py\s+flush\b`,
    String.raw`\bvolume[_-]?delete\b`,
    String.raw`\b(railway|fly|flyctl|heroku|vercel|netlify)\b.*\b(delete|destroy|remove|rm)\b`,
    String.raw`\bkubectl\s+delete\b`,
    String.raw`\bterraform\s+(destroy|apply\b.*-destroy)`,
    String.raw`\baws\s+\S+\s+(rm|delete-\S+|terminate-\S+)\b`,
    String.raw`\bgcloud\b.*\bdelete\b`,
    String.raw`\baz\b.*\bdelete\b`,
    String.raw`\bdocker\s+(system|volume|image|container)\s+prune\b`,
    String.raw`\bdocker\s+volume\s+rm\b`,
    String.raw`\bgh\s+(repo|release)\s+delete\b`,
    String.raw`\bcurl\b.*(-X\s*DELETE|--request\s+DELETE)`,
    String.raw`\b(mkfs|dd\s+if=|format\s+[a-z]:|diskpart|shred)\b`,
    String.raw`\bfind\b.*\s-delete\b`,
    String.raw`>\s*/dev/sd`,
  ].join("|"),
  "i",
);

/** Secrets on disk: reading these is how one-time codes and keys leak. */
const CREDENTIAL_PATH =
  /(^|[\\/\s"'])(\.env(\.[\w-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.pgpass|id_(rsa|ed25519|ecdsa|dsa)|[\w-]*\.(pem|key|p12|pfx|keystore|jks)|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|token(s)?\.json|service[-_]account[\w-]*\.json)(?=$|[\s"'\\/;|&>])|[\\/]\.(ssh|aws|gnupg|kube|docker)([\\/]|$)|Login Data|Cookies\b|keychain/i;

/** Commands that print secrets to the agent. */
const CREDENTIAL_COMMAND =
  /^\s*(printenv|env|set|export\s+-p)\s*$|\b(printenv|echo\s+\$\{?\w*(KEY|TOKEN|SECRET|PASS)\w*)\b|\bgh\s+auth\s+token\b|\bsecurity\s+find-\w+-password\b|\bgcloud\s+auth\s+print-\w*token\b|\bkubectl\s+config\s+view\b.*--raw|\baws\s+configure\s+get\b|\bgit\s+credential\b|\bcmdkey\s+\/list\b|\bnpm\s+token\b/i;

export function isCredentialPath(path: string): boolean {
  return CREDENTIAL_PATH.test(path);
}

export function classifyCommand(command: string): PermissionCategory {
  if (DESTRUCTIVE_COMMAND.test(command)) return "destructive";
  if (CREDENTIAL_COMMAND.test(command) || CREDENTIAL_PATH.test(command)) return "credentials";
  if (READ_ONLY_COMMAND.test(command)) return "file_read";
  if (/\b(rm|del|rmdir|Remove-Item)\b/i.test(command)) return "file_delete";
  return "shell";
}

/** Reading a secrets file escalates to the credentials category, whatever the tool. */
function withCredentialCheck(category: PermissionCategory, paths: string[]): PermissionCategory {
  return paths.some(isCredentialPath) ? "credentials" : category;
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
      return {
        category: withCredentialCheck("file_read", paths),
        paths,
        action: `${toolName} ${path ?? ""}`.trim(),
      };
    case "Write":
      return {
        category: withCredentialCheck("file_create", paths),
        paths,
        action: `Write ${path ?? ""}`.trim(),
      };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return {
        category: withCredentialCheck("file_modify", paths),
        paths,
        action: `${toolName} ${path ?? ""}`.trim(),
      };
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
  return withCredentialCheck(classifyAcpKind(kind, title, paths, rawInput), paths);
}

function classifyAcpKind(
  kind: string | null,
  title: string,
  _paths: string[],
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
      return "file_modify";
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

const SECRET_FIELD =
  /\b(password|passcode|passwd|otp|one[- ]time|verification code|security code|2fa|mfa|pin|cvv|cvc|card number|upi pin|mpin|secret)\b|पासवर्ड|ओटीपी|পাসওয়ার্ড/i;

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
  // Typing into a password, OTP, PIN or CVV field always needs the owner (the Instinct class).
  if (actionType === "type" && SECRET_FIELD.test(label)) return "credentials";
  if (actionType === "type" && !submit) return "browser_interaction";
  const text = `${label} ${actionType === "key" ? "" : ""}`.trim();
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  if (submit && /\.(gov|nic)\.in\b|incometax|gst\.gov/i.test(pageUrl)) return "official_forms";
  return "browser_interaction";
}

// -----------------------------------------------------------------------------
// Untrusted content: prompt-injection markers and exfiltration-shaped actions

const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your)\b.{0,30}\b(instructions?|prompts?|rules?|directions?|context)\b/i,
  /\b(new|updated|real|actual)\s+(system\s+)?(instructions?|prompt|directive)s?\s*:/i,
  /\byou\s+are\s+now\b.{0,40}\b(assistant|agent|ai|mode|dan)\b/i,
  /(^|\n)\s*(system|assistant)\s*:\s/i,
  /<\/?\s*(system|instructions?|im_start|im_end)\s*>/i,
  /\b(reveal|print|show|output|repeat)\b.{0,30}\b(system prompt|your instructions|hidden prompt)\b/i,
  /\b(send|email|forward|post|upload|exfiltrate|transmit)\b.{0,60}\b(api[ _-]?keys?|passwords?|credentials?|tokens?|secrets?|otp|\.env|private keys?|cookies?)\b/i,
  /\b(do not|don't|never)\s+(tell|inform|notify|mention)\b.{0,30}\b(user|owner|human)\b/i,
  /\bact\s+as\b.{0,30}\b(admin|developer mode|root|jailbroken)\b/i,
  /\b(legally binding|no takesies)\b/i,
];

/** Returns the matched fragment when text from an untrusted source looks like an injection. */
export function detectInjection(text: string): string | null {
  const sample = text.length > 200_000 ? text.slice(0, 200_000) : text;
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(sample);
    if (match) return redact(match[0], 120);
  }
  return null;
}

/**
 * Actions that could carry data out of the machine. After a turn has read untrusted content,
 * these escalate to the owner (the "lethal trifecta": private data + untrusted input + a way out).
 */
export function looksLikeExfiltration(category: PermissionCategory, action: string): boolean {
  if (["external_messages", "publication", "business_actions", "payments"].includes(category)) {
    return true;
  }
  if (category === "shell" || category === "file_read") {
    if (
      /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|nc|ncat|netcat|scp|sftp|rsync|ftp|ssh)\b/i.test(
        action,
      )
    ) {
      return true;
    }
    if (/\b(fetch|requests\.(post|put)|urllib|http\.request|axios)\b/i.test(action)) return true;
  }
  if (category === "research" || category === "browser_navigation") {
    const url = /https?:\/\/[^\s"']+/i.exec(action)?.[0];
    if (!url) return false;
    try {
      const parsed = new URL(url);
      // Long query strings or fragments are the usual way data rides out in a URL.
      return (
        parsed.search.length + parsed.hash.length > 120 ||
        /[A-Za-z0-9+/=_-]{60,}/.test(parsed.pathname)
      );
    } catch {
      return false;
    }
  }
  return false;
}

// -----------------------------------------------------------------------------

const SECRET_PATTERNS: RegExp[] = [
  /(sk|pk|rk|ghp|gho|github_pat|xox[abp])[-_][A-Za-z0-9_-]{8,}/g,
  /\b(api[_-]?key|token|secret|password|passwd|pwd)\s*[=:]\s*\S+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /\b\d{12,19}\b/g, // card / account numbers
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(otp|one[- ]time (pass)?code|verification code)\D{0,12}\d{4,8}\b/gi,
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
