import path from "node:path";
import type { PermissionCategory } from "../shared/ipc";
import { type PermissionRequest, redact } from "./permission-policy";

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

/** What really changes once the owner says yes. */
const IF_APPROVED: Record<PermissionCategory, string> = {
  research: "it will look this up and use the answer in its work. Your files are not changed.",
  file_read: "it can see what is in these files and use it in its work. They are not changed.",
  file_create: "a new file will be saved on your computer.",
  file_modify: "the file will be changed, and its old content may be replaced.",
  file_delete: "the files will be removed and may not be recoverable.",
  shell: "this runs on your computer at once. Commands can change files or settings.",
  browser_navigation: "the page opens in its browser, and the site sees a normal visit.",
  browser_interaction: "it will do this on the page, just as if you had done it yourself.",
  downloads: "the file will be saved on your computer.",
  external_messages: "the message is sent straight away and cannot be taken back.",
  publication: "it goes live straight away, and other people can see it.",
  business_actions:
    "this is done for real. It may send an application or place, change or cancel something.",
  payments: "money may leave your account.",
  account_settings: "this changes how your account works.",
  official_forms: "your information goes to an official body, and that may be hard to undo.",
  app_updates: "the update is installed, and the app may restart.",
};

/** Clicks in these categories send what the page holds, not only the click. */
const SENDS_PAGE_CONTENT = new Set<PermissionCategory>([
  "external_messages",
  "publication",
  "business_actions",
  "payments",
  "account_settings",
  "official_forms",
]);

const FILE_IN_TEXT =
  /(?:[A-Za-z]:)?[\w\-./\\ ]*?[\w-]+\.(?:md|txt|csv|xlsx?|json|js|ts|py|env|pdf|docx?|html?|png|jpe?g)\b/gi;

/** Fields whose typed value is never repeated on a card or in Telegram. */
const PRIVATE_FIELD =
  /pass|otp|one.?time|\bpin\b|cvv|cvc|card|secret|token|aadhaar|\bpan\b|\bssn\b|\bupi\b/i;

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

function siteOf(url: string): string {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

/** A browser step as an owner would say it: the site's real name and the button's own words. */
function browserPhrase(request: PermissionRequest, files: string[]): string | null {
  const browser = request.browser;
  if (!browser) return null;
  const site = siteOf(browser.url);
  const on = site ? `on ${site}` : "on a web page";
  const label = browser.label ? `"${browser.label.slice(0, 80)}"` : "";
  if (browser.type === "open") {
    return site ? `open ${site} in its browser` : "open a web page in its browser";
  }
  if (browser.type === "upload") {
    return `attach ${files.join(", ") || "a file from your computer"} to a form ${on}`;
  }
  const how =
    browser.type === "click"
      ? `pressing ${label || "a button"}`
      : browser.type === "type"
        ? `typing into ${label || "the page"}`
        : browser.type === "paste"
          ? "pasting text into the page"
          : browser.type === "key"
            ? "pressing a key"
            : "using the page";
  switch (request.category) {
    case "payments":
      return `make a payment ${on} by ${how}`;
    case "business_actions":
      return `submit or confirm something ${on} by ${how}`;
    case "publication":
      return `publish or post something ${on} by ${how}`;
    case "external_messages":
      return `send a message ${on} by ${how}`;
    case "account_settings":
      return `change an account setting ${on} by ${how}`;
    case "official_forms":
      return `submit an official form ${on} by ${how}`;
    default:
      return `work ${on} by ${how}`;
  }
}

/** Commands an owner meets often, said plainly. Anything else stays "a command". */
function commandPhrase(command: string): string {
  const text = command.trim();
  const site = text.match(/https?:\/\/[^\s"'`]+/)?.[0];
  const host = site ? siteOf(site) : "";
  if (/^\s*(py|python3?)(\.exe)?\s+-c\b/i.test(text)) {
    return "run a small Python script on your computer";
  }
  if (/^\s*(node|bun)(\.exe)?\s+(-e|--eval)\b/i.test(text)) {
    return "run a small script on your computer";
  }
  const script = text.match(/^\s*(?:py|python3?|node|bun)(?:\.exe)?\s+"?([^\s"]+\.\w+)/i)?.[1];
  if (script) return `run the script ${path.basename(script.replaceAll("\\", "/"))}`;
  if (/\bgit\s+push\b/i.test(text)) return "send code changes to an online code repository";
  if (/\bgit\s+commit\b/i.test(text)) return "save code changes in a project's history";
  if (/\b(npm|pnpm|yarn|bun|pip3?)\s+(install|add|i)\b/i.test(text)) {
    return "install extra software on your computer";
  }
  if (/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b/i.test(text)) {
    return host ? `contact ${host} from your computer` : "contact a website from your computer";
  }
  return WANTS_TO.shell;
}

function actionPhrase(request: PermissionRequest, files: string[], place: string): string {
  const browser = browserPhrase(request, files);
  if (browser) return browser;
  const named = files.join(", ");
  const where = place ? ` in ${place}` : "";
  switch (request.category) {
    case "shell":
      return commandPhrase(request.action);
    case "research": {
      const site = siteOf(request.action);
      if (site) return `look at ${site}`;
      return request.action.includes(" ")
        ? `look up "${request.action.slice(0, 80)}"`
        : WANTS_TO.research;
    }
    case "file_read":
      return named ? `read ${named}${where}` : WANTS_TO.file_read;
    case "file_create":
      return named ? `create ${named}${where}` : WANTS_TO.file_create;
    case "file_modify":
      return named ? `change ${named}${where}` : WANTS_TO.file_modify;
    case "file_delete":
      return named ? `delete ${named}${where}` : WANTS_TO.file_delete;
    default:
      return WANTS_TO[request.category] ?? "do something that needs your OK";
  }
}

function sharedLine(request: PermissionRequest, files: string[]): string | null {
  const browser = request.browser;
  if (!browser) return null;
  const site = siteOf(browser.url);
  const to = site || "the website";
  if (browser.type === "upload") {
    return `What is shared: ${files.join(", ") || "the chosen file"} goes to ${to}.`;
  }
  if (browser.text?.trim()) {
    return PRIVATE_FIELD.test(browser.label)
      ? `What is shared: the private text it typed goes to ${to}. It is not shown here.`
      : `What is shared: "${redact(browser.text, 160)}" goes to ${to}.`;
  }
  return SENDS_PAGE_CONTENT.has(request.category)
    ? `What is shared: whatever is filled in on this page goes to ${to}.`
    : null;
}

function whyLine(request: PermissionRequest, ownerAsked: string | null): string {
  if (request.reason?.trim()) return `Why: ${redact(request.reason, 300)}`;
  if (ownerAsked?.trim()) {
    return `Why: it is working on what you asked for: "${redact(ownerAsked, 160)}"`;
  }
  return "Why: this kind of action is set to need your OK before it happens.";
}

/** Turns a paused tool call into a plain-language approval card plus folded technical detail. */
export function describePermissionRequest(
  request: PermissionRequest,
  botName: string,
  roots: { shared: string; own: string | null },
  ownerAsked: string | null = null,
): { title: string; details: string; technical: string } {
  const files = mentionedFiles(request);
  const place = placeOf(request, roots);
  const phrase = actionPhrase(request, files, place);
  const lines = [
    `${botName} is asking your permission to ${phrase}.`,
    whyLine(request, ownerAsked),
    request.browser?.type === "upload"
      ? "If you approve: a copy of the file leaves your computer and goes to that website."
      : `If you approve: ${IF_APPROVED[request.category] ?? "it will go ahead with this."}`,
    sharedLine(request, files),
    `Nothing happens until you choose. If you reject, ${botName} will not do this.`,
  ];
  return {
    title: `${botName} wants to ${phrase}`,
    details: lines.filter(Boolean).join("\n"),
    technical: request.action || request.category,
  };
}

const MIN_TITLE_WORDS = 4;
const MIN_DETAILS_CHARS = 100;

export const APPROVAL_TOOL_DESCRIPTION =
  "Ask the owner to approve an action BEFORE doing it: payments or money movement, sending anything to customers/vendors, publishing, submitting applications, government or bank forms, deleting data, or sharing personal data. Write for someone who is not technical and cannot see your work. Returns immediately; the decision arrives later as a message.";

export const APPROVAL_TITLE_HELP =
  'One plain sentence saying what you will do and where, e.g. "Send your job application to ABC Technologies". Never a label like "Job Apply Once" or "Submit for Confirming".';

export const APPROVAL_DETAILS_HELP =
  '100 to 500 characters of everyday English, more if truly needed. Say: what you will do; why; which company, website or service is involved; what happens if the owner approves; and what information or content is sent or shared. Name real things, and use no ids, tool names or jargon. Example: "I want to send your job application to ABC Technologies through its careers website, because it matches the roles you asked me to apply for. Your resume and application details will be shared with the company, and the application can\'t be recalled once sent."';

/** Why a coworker's request cannot go to the owner yet; null when it explains itself. */
export function approvalRequestProblem(title: string, details: string): string | null {
  if (
    title.trim().split(/\s+/).length >= MIN_TITLE_WORDS &&
    details.trim().length >= MIN_DETAILS_CHARS
  ) {
    return null;
  }
  return `Not sent to the owner: this request does not explain itself. Call request_approval again. title: ${APPROVAL_TITLE_HELP} details: ${APPROVAL_DETAILS_HELP} Do not perform the action.`;
}
