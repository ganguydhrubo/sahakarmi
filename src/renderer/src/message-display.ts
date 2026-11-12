import type { BotMessage } from "./data";
import { t } from "./i18n";

/** Notes the app sends a coworker for the owner (approval results, browser hand-back). */
const SYSTEM_NOTE =
  /^\[(Approval (APPROVED|REJECTED)|Browser handed back|Browser takeover declined|Secure input (entered|declined))\]/;

export function isSystemNote(message: BotMessage): boolean {
  return message.author === "you" && SYSTEM_NOTE.test(message.body);
}

/**
 * The note the app sent a coworker, as one plain line for the owner: what was decided, without
 * ids or the instructions meant for the coworker.
 */
export function systemNoteText(body: string): string | null {
  const approval =
    /^\[Approval (APPROVED|REJECTED)\] "([\s\S]*?)"(?: \(approval id [^)]*\))?\./.exec(body);
  if (approval) {
    const title = (approval[2] as string).trim();
    const byColleague = /^Decided by a colleague/m.test(body);
    const note = /^(?:Owner's note|Decided by a colleague[^:\n]*Note): (.+)$/m.exec(body)?.[1];
    const line = t(
      approval[1] === "APPROVED"
        ? byColleague
          ? "noteApprovedForYou"
          : "noteApproved"
        : byColleague
          ? "noteRejectedForYou"
          : "noteRejected",
      { title },
    );
    return note ? `${line}\n${t("noteYourNote", { note: note.trim() })}` : line;
  }
  if (body.startsWith("[Browser handed back]")) return t("noteBrowserBack");
  if (body.startsWith("[Browser takeover declined]")) return t("noteBrowserDeclined");
  const site = / (?:on|for) (\S+?)(?: and pressed Enter)?\./.exec(body)?.[1] ?? "";
  if (body.startsWith("[Secure input entered]")) return t("noteSecureEntered", { site });
  if (body.startsWith("[Secure input declined]")) return t("noteSecureDeclined", { site });
  return null;
}

const ROUTINE_NOTE = /^\[Routine "(.*?)" · step (\d+)\/(\d+)(?: · yes\/no check)?\] ?/;
const DESIGN_NOTE = /^\[Routine design\][\s\S]*?What the owner wants: (.*)/;
const DESIGN_REPLY = /^\s*(?:```(?:json)?\s*)?\{\s*"name"\s*:[\s\S]*"steps"\s*:\s*\[/;

/** "Describe it" asks the orchestrator in its chat; show the request and the JSON reply briefly. */
export function routineDesignNote(message: Pick<BotMessage, "author" | "body">): string | null {
  if (message.author === "you") {
    const match = DESIGN_NOTE.exec(message.body);
    return match ? t("routineDesignAsked", { wish: (match[1] as string).trim() }) : null;
  }
  if (!DESIGN_REPLY.test(message.body)) return null;
  try {
    const start = message.body.indexOf("{");
    const value = JSON.parse(message.body.slice(start, message.body.lastIndexOf("}") + 1)) as {
      name?: unknown;
      steps?: unknown;
    };
    if (!Array.isArray(value.steps)) return null;
    return t("routineDesignReplied", {
      name: typeof value.name === "string" ? value.name : "",
      count: String(value.steps.length),
    });
  } catch {
    return null;
  }
}

/** A step a routine sent a coworker: shown as a quiet card with a label, not as the owner typing. */
export function routineNote(
  message: Pick<BotMessage, "author" | "body">,
): { name: string; step: string; total: string; text: string } | null {
  if (message.author !== "you") return null;
  const match = ROUTINE_NOTE.exec(message.body);
  if (!match) return null;
  return {
    name: match[1] as string,
    step: match[2] as string,
    total: match[3] as string,
    text: message.body.slice(match[0].length),
  };
}

/** One plain line for lists (Tasks, the queue): app notes read as words, not as raw prompts. */
export function friendlyTaskText(text: string): string {
  const message = { author: "you" as const, body: text };
  const system = systemNoteText(text);
  if (system) return system;
  const design = routineDesignNote(message);
  if (design) return design;
  const routine = routineNote(message);
  if (routine)
    return `${routine.name} · ${t("routineNoteStep", { step: routine.step, total: routine.total })}: ${routine.text}`;
  return text;
}
