import type { AgentEvent, ConversationSnapshot, QueueDelivery, QueueSnapshot } from "../shared/ipc";

/** The parts of AgentService needed to follow one queued message to its reply. */
export interface DeliveryWaitPort {
  listQueue(botId: string): QueueSnapshot;
  readConversation(botId: string): Promise<ConversationSnapshot>;
  on(event: "event", listener: (event: AgentEvent) => void): unknown;
  off(event: "event", listener: (event: AgentEvent) => void): unknown;
}

export interface DeliveryOutcome {
  ok: boolean;
  /** The coworker's final reply text for the turn, when it sent one. */
  reply: string | null;
  error: string | null;
  turnId: string | null;
  /** The delivery that finished: the one asked for, or the copy it was re-sent as. */
  deliveryId: string;
}

const TERMINAL = new Set<QueueDelivery["status"]>([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
/** A failed copy is re-sent (another model, a brief-fault retry) within moments: wait that long. */
export const RETRY_LINK_GRACE_MS = 5_000;

/** The last non-commentary assistant text of one turn. */
export async function readTurnReply(
  port: Pick<DeliveryWaitPort, "readConversation">,
  botId: string,
  turnId: string,
): Promise<string | null> {
  const snapshot = await port.readConversation(botId).catch(() => null);
  return (
    [...(snapshot?.messages ?? [])]
      .reverse()
      .find(
        (message) =>
          message.author === "assistant" &&
          message.turnId === turnId &&
          message.itemType !== "commentary" &&
          message.text.trim(),
      )?.text ?? null
  );
}

/**
 * Waits for a queued message to finish and reads the coworker's reply for that turn. A copy
 * that failed and was sent again is followed to the new copy. Resolves (never rejects): on
 * timeout, removal or abort the outcome says so; `aborted` tells an abort apart.
 */
export function waitForDelivery(
  port: DeliveryWaitPort,
  botId: string,
  deliveryId: string,
  options: { timeoutMs: number; signal?: AbortSignal; retryGraceMs?: number },
): Promise<DeliveryOutcome & { aborted?: boolean }> {
  const grace = options.retryGraceMs ?? RETRY_LINK_GRACE_MS;
  return new Promise((resolve) => {
    let target = deliveryId;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (outcome: DeliveryOutcome & { aborted?: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      port.off("event", listener);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const failure = (error: string, turnId: string | null = null) =>
      finish({ ok: false, reply: null, error, turnId, deliveryId: target });
    const check = () => {
      if (settled) return;
      const delivery = port
        .listQueue(botId)
        .deliveries.find((candidate) => candidate.id === target);
      if (!delivery) {
        failure("The task was removed from the queue.");
        return;
      }
      if (delivery.retriedAs) {
        target = delivery.retriedAs;
        if (graceTimer) clearTimeout(graceTimer);
        graceTimer = null;
        check();
        return;
      }
      if (!TERMINAL.has(delivery.status)) return;
      if (delivery.status === "completed") {
        settled = true;
        clearTimeout(timer);
        port.off("event", listener);
        options.signal?.removeEventListener("abort", onAbort);
        const turnId = delivery.turnId;
        void (turnId ? readTurnReply(port, botId, turnId) : Promise.resolve(null)).then((reply) =>
          resolve({ ok: true, reply, error: null, turnId, deliveryId: target }),
        );
        return;
      }
      // Give a re-send a moment to be linked before calling it a failure.
      if (graceTimer) return;
      const error = delivery.error ?? `The task was ${delivery.status}.`;
      const turnId = delivery.turnId;
      graceTimer = setTimeout(() => {
        graceTimer = null;
        const latest = port
          .listQueue(botId)
          .deliveries.find((candidate) => candidate.id === target);
        if (latest?.retriedAs) check();
        else failure(error, turnId);
      }, grace);
      graceTimer.unref?.();
    };
    const listener = (event: AgentEvent) => {
      if (event.type === "queue-changed" && event.snapshot.botId === botId) check();
    };
    const onAbort = () =>
      finish({
        ok: false,
        reply: null,
        error: "Paused.",
        turnId: null,
        deliveryId: target,
        aborted: true,
      });
    const timer = setTimeout(() => failure("The task did not finish in time."), options.timeoutMs);
    timer.unref?.();
    port.on("event", listener);
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    check();
  });
}
