import type {
  AgentEvent,
  ConversationSnapshot,
  QueuedMessageReceipt,
  QueueSnapshot,
  SendMessageInput,
} from "../shared/ipc";
import type { RoutineExecutor } from "./routine-store";

/** The parts of AgentService a routine needs. */
export interface RoutineAgentPort {
  sendMessage(input: SendMessageInput): Promise<QueuedMessageReceipt>;
  listQueue(botId: string): QueueSnapshot;
  readConversation(botId: string): Promise<ConversationSnapshot>;
  on(event: "event", listener: (event: AgentEvent) => void): unknown;
  off(event: "event", listener: (event: AgentEvent) => void): unknown;
}

const TERMINAL = new Set(["completed", "failed", "interrupted", "cancelled"]);
/** A step waiting on approvals can take a while, but never forever. */
const DEFAULT_STEP_TIMEOUT_MS = 6 * 60 * 60_000;

/**
 * Sends each routine step through the normal owner queue, so permissions, approvals and the
 * emergency controls apply exactly as if the owner had typed it.
 */
export function createRoutineExecutor(
  agent: RoutineAgentPort,
  stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
): RoutineExecutor {
  return {
    async send(botId, text) {
      const receipt = await agent.sendMessage({ botId, text });
      const delivery = receipt.deliveries.find((candidate) => candidate.recipientBotId === botId);
      if (!delivery) throw new Error("The step could not be queued.");
      return delivery.id;
    },
    waitFor(botId, deliveryId) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = async () => {
          const delivery = agent
            .listQueue(botId)
            .deliveries.find((candidate) => candidate.id === deliveryId);
          if (!delivery) {
            settle({ ok: false, reply: null, error: "The step was removed from the queue." });
            return;
          }
          if (!TERMINAL.has(delivery.status)) return;
          if (delivery.status !== "completed") {
            settle({
              ok: false,
              reply: null,
              error: delivery.error ?? `The step was ${delivery.status}.`,
            });
            return;
          }
          let reply: string | null = null;
          if (delivery.turnId) {
            const snapshot = await agent.readConversation(botId).catch(() => null);
            reply =
              [...(snapshot?.messages ?? [])]
                .reverse()
                .find(
                  (message) =>
                    message.author === "assistant" &&
                    message.turnId === delivery.turnId &&
                    message.itemType !== "commentary" &&
                    message.text.trim(),
                )?.text ?? null;
          }
          settle({ ok: true, reply, error: null });
        };
        const listener = (event: AgentEvent) => {
          if (event.type === "queue-changed" && event.snapshot.botId === botId) void finish();
        };
        const timer = setTimeout(
          () => settle({ ok: false, reply: null, error: "The step did not finish in time." }),
          stepTimeoutMs,
        );
        timer.unref?.();
        function settle(result: { ok: boolean; reply: string | null; error: string | null }) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          agent.off("event", listener);
          resolve(result);
        }
        agent.on("event", listener);
        void finish();
      });
    },
  };
}
