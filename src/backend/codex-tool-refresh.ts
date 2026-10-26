import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ConversationMessage } from "../shared/ipc";

const LEDGER_FILE = "codex-thread-tools.json";
const MAX_LEDGER_ENTRIES = 500;
const CARRY_OVER_MESSAGES = 20;
const CARRY_OVER_MESSAGE_CHARS = 600;
const CARRY_OVER_TOTAL_CHARS = 6_000;

/**
 * What a tool list can do, without its wording: tool names, parameters and allowed values. A
 * reworded description does not make an open chat out of date; a new tool or a new action does.
 */
export function toolShape(tools: unknown[]): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => key !== "description")
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, strip(item)]),
      );
    }
    return value;
  };
  return createHash("sha256")
    .update(JSON.stringify(strip(tools)))
    .digest("hex")
    .slice(0, 16);
}

interface LedgerEntry {
  shape: string;
  /** The chat this one took over from when the tools changed, so its history still shows. */
  previousThreadId: string | null;
  createdAt: string;
}

/**
 * Codex fixes a chat's tools when the chat starts and cannot change them later. This remembers
 * which tool list each Codex chat started with, so a chat from before an update can be replaced.
 */
export class CodexThreadLedger {
  readonly #path: string;
  #entries: Record<string, LedgerEntry> | null = null;
  #writes: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.#path = join(userDataPath, LEDGER_FILE);
  }

  async #load(): Promise<Record<string, LedgerEntry>> {
    if (this.#entries) return this.#entries;
    try {
      const raw = JSON.parse(await readFile(this.#path, "utf8"));
      this.#entries = raw && typeof raw === "object" ? (raw as Record<string, LedgerEntry>) : {};
    } catch {
      this.#entries = {};
    }
    return this.#entries;
  }

  async get(threadId: string): Promise<LedgerEntry | null> {
    return (await this.#load())[threadId] ?? null;
  }

  async record(threadId: string, shape: string, previousThreadId: string | null): Promise<void> {
    const entries = await this.#load();
    entries[threadId] = { shape, previousThreadId, createdAt: new Date().toISOString() };
    const ids = Object.keys(entries);
    if (ids.length > MAX_LEDGER_ENTRIES) {
      ids
        .sort((left, right) =>
          (entries[left]?.createdAt ?? "").localeCompare(entries[right]?.createdAt ?? ""),
        )
        .slice(0, ids.length - MAX_LEDGER_ENTRIES)
        .forEach((id) => {
          delete entries[id];
        });
    }
    const text = JSON.stringify(entries);
    this.#writes = this.#writes.then(() => writeFile(this.#path, text, "utf8")).catch(() => {});
    await this.#writes;
  }

  /** The older chats this one continues, newest first (at most `limit`). */
  async previousThreads(threadId: string, limit = 3): Promise<string[]> {
    const chain: string[] = [];
    let current = (await this.get(threadId))?.previousThreadId ?? null;
    while (current && chain.length < limit && !chain.includes(current)) {
      chain.push(current);
      current = (await this.get(current))?.previousThreadId ?? null;
    }
    return chain;
  }
}

/**
 * The recent conversation, written for the coworker's new chat so it carries on where it left
 * off. Only what the owner and the coworker said; no tool output or thinking notes.
 */
export function carryOverNote(messages: ConversationMessage[]): string | null {
  const lines = messages
    .filter(
      (message) =>
        (message.author === "user" ||
          message.author === "assistant" ||
          message.author === "agent") &&
        message.itemType !== "commentary" &&
        message.itemType !== "toolCall" &&
        !message.tool &&
        message.text.trim(),
    )
    .slice(-CARRY_OVER_MESSAGES)
    .map((message) => {
      const who =
        message.author === "assistant" ? "You" : message.author === "agent" ? "Teammate" : "Owner";
      const text = message.text.trim().replace(/\s+/g, " ");
      return `${who}: ${text.length > CARRY_OVER_MESSAGE_CHARS ? `${text.slice(0, CARRY_OVER_MESSAGE_CHARS)}…` : text}`;
    });
  if (lines.length === 0) return null;
  let body = lines.join("\n");
  if (body.length > CARRY_OVER_TOTAL_CHARS) body = `…${body.slice(-CARRY_OVER_TOTAL_CHARS)}`;
  return [
    "Sahkarmi was updated and gave you new tools, so this is a fresh chat. The owner still sees the earlier messages. The latest part of the earlier chat:",
    "--- earlier chat ---",
    body,
    "--- end of earlier chat ---",
    "Carry on from there. Do not mention the update unless the owner asks; use search_past_chats if you need more of the earlier chat.",
  ].join("\n");
}

/** Older chats' messages before the current chat's, renaming any id the current chat also uses. */
export function joinThreadHistory(
  older: Array<{ threadId: string; messages: ConversationMessage[] }>,
  current: ConversationMessage[],
): ConversationMessage[] {
  const seen = new Set(current.map((message) => message.id));
  const earlier: ConversationMessage[] = [];
  for (const { threadId, messages } of older) {
    for (const message of messages) {
      const id = seen.has(message.id) ? `${threadId}:${message.id}` : message.id;
      seen.add(id);
      earlier.push(id === message.id ? message : { ...message, id });
    }
  }
  return [...earlier, ...current];
}
