import type { BotSummary, ConversationMessage } from "../shared/ipc";

/**
 * Branching a chat: a new coworker, a copy of this one, that starts with the conversation up to
 * one answer. Each coworker has one conversation with its provider, so the copied part is given
 * to the new coworker as context, not replayed.
 */

/** The copied conversation that a branch starts from; longer chats keep their latest part. */
export const BRANCH_TRANSCRIPT_CHARS = 24_000;
const MESSAGE_CHARS = 2_000;

/** "Chief #2", "Chief #3": the next free number after the source's name. */
export function branchName(sourceName: string, existingNames: string[]): string {
  const base = sourceName.replace(/\s+#\d+$/, "").trim() || "Coworker";
  const taken = new Set(existingNames.map((name) => name.trim()));
  for (let index = 2; index < 1_000; index += 1) {
    const candidate = `${base} #${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} #${Date.now()}`;
}

/** The messages a branch copies: everything through the chosen answer, or nothing if it is unknown. */
export function messagesThrough(
  messages: ConversationMessage[],
  messageId: string,
): ConversationMessage[] | null {
  const index = messages.findIndex((message) => message.id === messageId);
  return index === -1 ? null : messages.slice(0, index + 1);
}

/** The context text the new coworker starts with. */
export function branchTranscript(messages: ConversationMessage[]): string {
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
    .map((message) => {
      const who =
        message.author === "assistant" ? "You" : message.author === "agent" ? "Teammate" : "Owner";
      const text = message.text.trim().replace(/\s+/g, " ");
      return `${who}: ${text.length > MESSAGE_CHARS ? `${text.slice(0, MESSAGE_CHARS)}…` : text}`;
    });
  let body = lines.join("\n");
  if (body.length > BRANCH_TRANSCRIPT_CHARS) body = `…${body.slice(-BRANCH_TRANSCRIPT_CHARS)}`;
  return body;
}

/** The prompt lines that give a branched coworker its starting point. */
export function branchPromptLines(source: Pick<BotSummary, "name">, transcript: string): string[] {
  if (!transcript.trim()) return [];
  return [
    `This chat was branched from your colleague "${source.name}". It continues from the conversation below as if it were your own; the owner can still see the original. Do not repeat the earlier answers; pick up from the last one.`,
    "<branched_conversation>",
    transcript.replace(/<\/branched_conversation>/gi, "</branched_conversation​>"),
    "</branched_conversation>",
  ];
}
