import path from "node:path";
import type { PermissionCategory } from "../shared/ipc";
import type { PermissionRequest } from "./permission-policy";

/** What each kind of paused action means, in words an owner can judge at a glance. */
const WANTS_TO: Record<PermissionCategory, string> = {
  research: "look something up",
  file_read: "read files on your computer",
  file_create: "create a file",
  file_modify: "change a file",
  file_delete: "delete files",
  shell: "run a command on your computer",
  browser_navigation: "open a web page",
  browser_interaction: "click or type on a web page",
  downloads: "download a file",
  external_messages: "send a message to someone outside Sahkarmi",
  publication: "publish or post something online",
  business_actions: "submit or confirm something on a website",
  payments: "make a payment",
  account_settings: "change an account setting",
  official_forms: "submit an official form",
  app_updates: "install an app update",
};

const RISK_NOTE: Partial<Record<PermissionCategory, string>> = {
  file_delete: "Deleted files may not be recoverable.",
  shell: "Commands can change files or settings on this computer.",
  external_messages: "Once sent, a message cannot be taken back.",
  publication: "Anything published can be seen by others straight away.",
  business_actions: "This may place, change or cancel something for real.",
  payments: "Money may leave your account.",
  account_settings: "This changes how your account works.",
  official_forms: "This submits information to an official body.",
};

const FILE_IN_TEXT =
  /(?:[A-Za-z]:)?[\w\-./\\ ]*?[\w-]+\.(?:md|txt|csv|xlsx?|json|js|ts|py|env|pdf|docx?|html?|png|jpe?g)\b/gi;

/** File names the action touches: known paths first, then names spotted in the command text. */
function mentionedFiles(request: PermissionRequest): string[] {
  const found = request.paths.length
    ? request.paths
    : [...request.action.matchAll(FILE_IN_TEXT)].map((match) => match[0].trim());
  return [...new Set(found.map((file) => path.basename(file.replaceAll("\\", "/"))))].slice(0, 5);
}

function placeOf(
  request: PermissionRequest,
  roots: { shared: string; own: string | null },
): string {
  const text = `${request.paths.join(" ")} ${request.action}`.replaceAll("\\", "/").toLowerCase();
  const inside = (root: string | null) =>
    root !== null && root !== "" && text.includes(root.replaceAll("\\", "/").toLowerCase());
  if (inside(roots.own)) return "its own work folder";
  if (inside(roots.shared)) return "your Shared folder";
  if (request.paths.length || /[a-z]:\//.test(text)) return "a folder outside Sahkarmi";
  return "";
}

/** Turns a paused tool call into a plain-language approval card plus folded technical detail. */
export function describePermissionRequest(
  request: PermissionRequest,
  botName: string,
  roots: { shared: string; own: string | null },
): { title: string; details: string; technical: string } {
  const files = mentionedFiles(request);
  const place = placeOf(request, roots);
  const lines = [
    files.length ? `Files: ${files.join(", ")}` : null,
    place ? `Where: ${place}` : null,
    RISK_NOTE[request.category] ?? null,
    `${botName} is waiting. Nothing happens until you choose Approve or Reject.`,
  ];
  return {
    title: `${botName} wants to ${WANTS_TO[request.category] ?? "do something that needs your OK"}`,
    details: lines.filter(Boolean).join("\n"),
    technical: request.action || request.category,
  };
}
