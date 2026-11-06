import type { QueuedMessageReceipt, SendMessageInput } from "../shared/ipc";
import { type DeliveryWaitPort, waitForDelivery } from "./delivery-wait";
import type { RoutineExecutor } from "./routine-store";

/** The parts of AgentService a routine needs. */
export interface RoutineAgentPort extends DeliveryWaitPort {
  sendMessage(input: SendMessageInput): Promise<QueuedMessageReceipt>;
}

/** A step waiting on approvals can take a while, but never forever. */
const DEFAULT_STEP_TIMEOUT_MS = 6 * 60 * 60_000;

/**
 * Sends each routine step through the normal owner queue, so permissions, approvals and the
 * emergency controls apply exactly as if the owner had typed it. A step always waits for a
 * turn of its own: it never joins a running one.
 */
export function createRoutineExecutor(
  agent: RoutineAgentPort,
  stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
): RoutineExecutor {
  return {
    async send(botId, text) {
      const receipt = await agent.sendMessage({ botId, text, origin: "routine" });
      const delivery = receipt.deliveries.find((candidate) => candidate.recipientBotId === botId);
      if (!delivery) throw new Error("The step could not be queued.");
      return delivery.id;
    },
    async waitFor(botId, deliveryId) {
      const outcome = await waitForDelivery(agent, botId, deliveryId, {
        timeoutMs: stepTimeoutMs,
      });
      if (!outcome.ok) {
        return {
          ok: false,
          reply: null,
          // The shared wait speaks of "the task"; a routine calls it a step.
          error: (outcome.error ?? "The step did not finish.").replace(/^The task /, "The step "),
        };
      }
      return { ok: true, reply: outcome.reply, error: null };
    },
  };
}
