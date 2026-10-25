import type { ApprovalCategory } from "../../shared/ipc";

/**
 * Rules shared by the Composio client and its security guard: which tools may run on their
 * own, which must pause for the owner, how an approval card describes them, and the scrubber
 * that keeps tokens out of chat and logs. No imports from the client, so there is no cycle.
 */

/** Tool slugs are UPPER_SNAKE: the toolkit first, then what the tool does. */
const READ_ONLY_WORDS = new Set([
  "GET",
  "GETS",
  "LIST",
  "LISTS",
  "SEARCH",
  "FETCH",
  "FIND",
  "READ",
  "RETRIEVE",
  "LOOKUP",
  "QUERY",
  "CHECK",
  "COUNT",
  "DESCRIBE",
  "VIEW",
  "SHOW",
  "BROWSE",
  "DOWNLOAD",
  "EXPORT",
  "PREVIEW",
  "HISTORY",
  "INFO",
  "DETAILS",
  "STATUS",
  "SUMMARY",
  "PROFILE",
  "ME",
  "WHOAMI",
  "VERIFY",
  "VALIDATE",
  "SUGGEST",
  "AUTOCOMPLETE",
  "COMPARE",
  "CALCULATE",
  "TRANSLATE",
  "ANALYZE",
  "ANALYSE",
]);

const MUTATING_WORDS = new Set([
  "SEND",
  "POST",
  "CREATE",
  "ADD",
  "INSERT",
  "APPEND",
  "WRITE",
  "UPDATE",
  "PATCH",
  "PUT",
  "EDIT",
  "MODIFY",
  "SET",
  "RENAME",
  "MOVE",
  "COPY",
  "UPLOAD",
  "DELETE",
  "REMOVE",
  "DROP",
  "PURGE",
  "DESTROY",
  "ARCHIVE",
  "UNARCHIVE",
  "TRASH",
  "RESTORE",
  "MERGE",
  "CLOSE",
  "REOPEN",
  "OPEN",
  "CANCEL",
  "PUBLISH",
  "UNPUBLISH",
  "RELEASE",
  "DEPLOY",
  "TRIGGER",
  "RUN",
  "EXECUTE",
  "START",
  "STOP",
  "PAUSE",
  "RESUME",
  "INVITE",
  "KICK",
  "BAN",
  "JOIN",
  "LEAVE",
  "ASSIGN",
  "UNASSIGN",
  "APPROVE",
  "REJECT",
  "SUBMIT",
  "REPLY",
  "FORWARD",
  "COMMENT",
  "REACT",
  "LIKE",
  "FOLLOW",
  "UNFOLLOW",
  "STAR",
  "UNSTAR",
  "PIN",
  "UNPIN",
  "MUTE",
  "UNMUTE",
  "LOCK",
  "UNLOCK",
  "PAY",
  "CHARGE",
  "REFUND",
  "TRANSFER",
  "ORDER",
  "BOOK",
  "SCHEDULE",
  "RESCHEDULE",
  "MARK",
  "LABEL",
  "TAG",
  "UNTAG",
  "REVOKE",
  "ENABLE",
  "DISABLE",
  "GRANT",
  "SHARE",
  "UNSHARE",
  "CLONE",
  "FORK",
  "TRANSITION",
  "RESOLVE",
  "DISMISS",
  "SNOOZE",
  "COMPLETE",
  "ACCEPT",
  "DECLINE",
  "REGISTER",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
  "IMPORT",
  "SYNC",
  "RESET",
  "CLEAR",
  "GENERATE",
  "DRAFT",
  "TWEET",
  "DM",
]);

/** Words that mean "mutating" wherever they appear, even after a read-only verb. */
const HARD_MUTATING_WORDS = new Set([
  "SEND",
  "DELETE",
  "REMOVE",
  "DROP",
  "PURGE",
  "DESTROY",
  "TRASH",
  "PAY",
  "CHARGE",
  "REFUND",
  "TRANSFER",
  "MERGE",
  "PUBLISH",
  "DEPLOY",
  "REVOKE",
  "BAN",
]);

const PAYMENT_WORDS = new Set([
  "PAY",
  "PAYMENT",
  "PAYMENTS",
  "CHARGE",
  "REFUND",
  "INVOICE",
  "TRANSFER",
  "PAYOUT",
  "CHECKOUT",
  "BILL",
  "SUBSCRIPTION",
]);
const PAYMENT_TOOLKITS = new Set(["STRIPE", "RAZORPAY", "PAYPAL", "SQUARE", "PADDLE", "CHARGEBEE"]);
const MESSAGE_WORDS = new Set([
  "SEND",
  "REPLY",
  "FORWARD",
  "MESSAGE",
  "MESSAGES",
  "EMAIL",
  "EMAILS",
  "MAIL",
  "CHAT",
  "DM",
  "NOTIFY",
  "POST",
  "COMMENT",
  "TWEET",
  "INVITE",
  "SMS",
  "WHATSAPP",
]);
const DATA_WORDS = new Set([
  "DELETE",
  "REMOVE",
  "DROP",
  "PURGE",
  "DESTROY",
  "TRASH",
  "ARCHIVE",
  "REVOKE",
  "CLEAR",
  "RESET",
]);
const SUBMISSION_WORDS = new Set([
  "SUBMIT",
  "PUBLISH",
  "RELEASE",
  "DEPLOY",
  "MERGE",
  "APPROVE",
  "REGISTER",
  "ORDER",
  "BOOK",
]);

function words(toolSlug: string): string[] {
  return toolSlug
    .toUpperCase()
    .replace(/-/g, "_")
    .split("_")
    .filter((word) => word.length > 0);
}

/**
 * Read-only tools run on their own; anything that sends, creates, changes or deletes pauses
 * for the owner. The first verb in the slug decides, hard words count anywhere, and a slug
 * with no recognisable verb is treated as mutating: the owner's accounts are at stake.
 */
export function isActionSensitive(toolSlug: string): boolean {
  const parts = words(toolSlug);
  if (parts.some((word) => HARD_MUTATING_WORDS.has(word))) return true;
  for (const word of parts) {
    if (MUTATING_WORDS.has(word)) return true;
    if (READ_ONLY_WORDS.has(word)) return false;
  }
  return true;
}

export function classifyActionCategory(toolSlug: string): ApprovalCategory {
  const parts = words(toolSlug);
  if (parts.some((word) => PAYMENT_WORDS.has(word) || PAYMENT_TOOLKITS.has(word))) {
    return "payment";
  }
  if (parts.some((word) => DATA_WORDS.has(word))) return "data";
  if (parts.some((word) => SUBMISSION_WORDS.has(word))) return "submission";
  if (parts.some((word) => MESSAGE_WORDS.has(word))) return "message";
  return "other";
}

/** "GMAIL_SEND_EMAIL" with toolkit "gmail" reads "Send email". */
export function describeTool(toolSlug: string, toolkitSlug?: string): string {
  let slug = toolSlug.toUpperCase().replace(/-/g, "_");
  if (toolkitSlug) {
    const prefix = `${toolkitSlug.toUpperCase().replace(/-/g, "_")}_`;
    if (slug.startsWith(prefix)) slug = slug.slice(prefix.length);
  }
  const text = slug.toLowerCase().replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : toolSlug;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_SECRET]"],
  [/\bxox[baprs]-[0-9A-Za-z-]{10,}/g, "[REDACTED_SECRET]"],
  [/\bgh[pousr][_-][A-Za-z0-9]{20,}/g, "[REDACTED_SECRET]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_SECRET]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_SECRET]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "[REDACTED_SECRET]"],
  [/\bya29\.[A-Za-z0-9_-]{20,}/g, "[REDACTED_SECRET]"],
  [/\brzp_(?:live|test)_[A-Za-z0-9]{10,}/g, "[REDACTED_SECRET]"],
  [/\bBearer\s+[A-Za-z0-9_.-]{20,}/gi, "Bearer [REDACTED_SECRET]"],
  [
    /"(access_token|refresh_token|id_token|api_key|apikey|api_secret|client_secret|secret|password|token|private_key)"\s*:\s*"[^"]*"/gi,
    '"$1": "[REDACTED_SECRET]"',
  ],
];

/** Strips known token shapes from text. JSON stays valid: only values are replaced. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

/** Scrubs any value. Structured data comes back structured; text comes back as text. */
export function scrubValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value !== "object") return value;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return "[unserialisable tool output]";
  }
  const redacted = redactSecrets(serialized);
  if (redacted === serialized) return value;
  try {
    return JSON.parse(redacted);
  } catch {
    return redacted;
  }
}
