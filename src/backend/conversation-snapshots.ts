import type { ConversationMessage, ConversationSnapshot } from "../shared/ipc";
import type { DeliveryContext } from "./mailbox-store";
import type { ThreadResponse } from "./protocol";
import { toolCallFromItem } from "./tool-calls";

/**
 * A copy of the snapshot with only its newest `limit` messages (the window's "Load earlier"
 * shows the rest). Without a limit the whole chat is copied.
 */
export function windowedSnapshot(
  snapshot: ConversationSnapshot,
  limit: number | undefined,
): ConversationSnapshot {
  if (!limit || snapshot.messages.length <= limit) {
    const copy = structuredClone(snapshot);
    delete copy.earlierCount;
    return copy;
  }
  const { messages, ...rest } = snapshot;
  return structuredClone({
    ...rest,
    messages: messages.slice(-limit),
    earlierCount: messages.length - limit,
  });
}

/**
 * A short fingerprint of what the window shows: per message its id, status, text length and
 * ending, tool state, files, delivery and reaction. Replaces a JSON copy of the whole chat
 * (megabytes in a long one) that was built on every emit just to skip unchanged ones.
 */
export function conversationFingerprint(snapshot: ConversationSnapshot): string {
  const parts = [snapshot.threadId ?? "", snapshot.activeTurnId ?? ""];
  for (const message of snapshot.messages) {
    parts.push(
      [
        message.id,
        message.status,
        message.text.length,
        message.text.slice(-24),
        message.itemType ?? "",
        message.tool ? `${message.tool.status}:${JSON.stringify(message.tool).length}` : "",
        message.attachments?.length ?? 0,
        message.delivery ? `${message.delivery.status}:${message.delivery.position ?? ""}` : "",
        message.reaction ?? "",
        message.citations?.length ?? 0,
      ].join("|"),
    );
  }
  if (snapshot.plan) {
    parts.push(
      `plan:${snapshot.plan.turnId}:${snapshot.plan.steps.map((step) => step.status[0]).join("")}`,
    );
    parts.push(snapshot.plan.steps.map((step) => step.text.length).join(","));
  }
  return parts.join("\n");
}

/** Same mailbox message, ignoring the reaction (synced separately). */
export function sameMailboxMessage(left: ConversationMessage, right: ConversationMessage): boolean {
  if (left === right) return true;
  return (
    JSON.stringify({ ...left, reaction: null }) === JSON.stringify({ ...right, reaction: null })
  );
}

export function snapshotFromThread(
  botId: string,
  thread: ThreadResponse["thread"],
  findDelivery: (deliveryId: string) => DeliveryContext | null,
): ConversationSnapshot {
  const messages: ConversationMessage[] = [];
  // A turn with no known time follows the one before it; "now" would move it to the end.
  let nextFallbackTime: number | undefined;
  for (const turn of thread.turns ?? []) {
    const items = turn.items ?? [];
    const firstUserItem = items.find(
      (item) => item.type === "userMessage" && typeof item.clientId === "string",
    );
    const firstDelivery = firstUserItem?.clientId ? findDelivery(firstUserItem.clientId) : null;
    const deliveryTime = firstDelivery ? Date.parse(firstDelivery.delivery.createdAt) : Number.NaN;
    const turnStartedAt = turn.startedAt ? turn.startedAt * 1_000 : Number.NaN;
    const baseTime = Number.isFinite(deliveryTime)
      ? deliveryTime
      : Number.isFinite(turnStartedAt)
        ? turnStartedAt
        : (nextFallbackTime ?? Date.now());
    nextFallbackTime = baseTime + items.length;
    for (const [itemIndex, item] of items.entries()) {
      const createdAt = new Date(baseTime + itemIndex).toISOString();
      if (item.type === "userMessage" && typeof item.id === "string") {
        const delivery = item.clientId ? findDelivery(item.clientId) : null;
        // The same message went out again on the same conversation; show it once.
        if (delivery?.retried) continue;
        const text = (item.content ?? [])
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text)
          .join("\n");
        if (text) {
          messages.push({
            id: delivery?.delivery.id ?? item.id,
            turnId: turn.id,
            author: delivery?.delivery.sender.kind === "bot" ? "agent" : "user",
            source: delivery?.delivery.sender.kind === "bot" ? "agent" : "user",
            senderBotId:
              delivery?.delivery.sender.kind === "bot" ? delivery.delivery.sender.botId : undefined,
            replyToMessageId: delivery?.delivery.replyToMessageId,
            attachments: delivery?.delivery.attachments,
            delivery: delivery
              ? {
                  id: delivery.delivery.id,
                  status: delivery.delivery.status,
                  position: delivery.delivery.position,
                }
              : undefined,
            text: delivery?.delivery.text ?? text,
            createdAt: delivery?.delivery.createdAt ?? createdAt,
            status: "completed",
          });
        }
      }
      const tool = toolCallFromItem(item, true);
      if (tool && typeof item.id === "string") {
        messages.push({
          id: item.id,
          turnId: turn.id,
          author: "assistant",
          text: "",
          createdAt,
          status: "completed",
          itemType: "toolCall",
          tool,
        });
        continue;
      }
      if (item.type === "agentMessage" && typeof item.id === "string" && item.text) {
        messages.push({
          id: item.id,
          turnId: turn.id,
          author: "assistant",
          text: item.text,
          createdAt,
          status: normalizeCompletionStatus(turn.status ?? "completed"),
          itemType: typeof item.phase === "string" ? item.phase : "agentMessage",
        });
      }
    }
  }
  sortConversationMessages(messages);
  return { botId, threadId: thread.id, activeTurnId: null, revision: 0, messages };
}

export function mergeConversationSnapshots(
  stored: ConversationSnapshot,
  live: ConversationSnapshot,
): ConversationSnapshot {
  const messages = new Map(stored.messages.map((message) => [message.id, message]));
  for (const message of live.messages) messages.set(message.id, message);
  const merged: ConversationSnapshot = {
    botId: live.botId,
    threadId: live.threadId ?? stored.threadId,
    activeTurnId: live.activeTurnId,
    revision: live.revision,
    messages: [...messages.values()],
  };
  sortConversationMessages(merged.messages);
  return merged;
}

export function sortConversationMessages(messages: ConversationMessage[]): void {
  // Parse each timestamp once, not on every comparison (n log n Date.parse calls per emit).
  const times = new Map<ConversationMessage, number>();
  const timeOf = (message: ConversationMessage): number => {
    let time = times.get(message);
    if (time === undefined) {
      time = Date.parse(message.createdAt);
      times.set(message, time);
    }
    return time;
  };
  messages.sort((left, right) => {
    if (left.turnId && left.turnId === right.turnId) {
      const rankDifference = turnMessageRank(left) - turnMessageRank(right);
      if (rankDifference !== 0) return rankDifference;
    }
    const leftTime = timeOf(left);
    const rightTime = timeOf(right);
    if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
    return leftTime - rightTime;
  });
}

function turnMessageRank(message: ConversationMessage): number {
  if (message.exchange?.direction === "incoming" || message.author === "user") return 0;
  if (message.author === "assistant" && message.itemType === "commentary") return 1;
  if (message.author === "assistant" && message.itemType === "toolCall") return 1;
  if (message.exchange?.direction === "outgoing") return 2;
  if (message.author === "assistant") return 3;
  return 2;
}

export function newAssistantMessage(id: string, turnId: string): ConversationMessage {
  return {
    id,
    turnId,
    author: "assistant",
    text: "",
    createdAt: new Date().toISOString(),
    status: "streaming",
    itemType: "agentMessage",
  };
}

export function normalizeCompletionStatus(status: string): ConversationMessage["status"] {
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  return "completed";
}
