import { randomUUID } from "node:crypto";
import type {
  AgentCollaborationMessage,
  AgentExecutionInstance,
  OrchestratorSpecialistRole,
} from "../shared/ipc";

export type CollaborationBusListener = (message: AgentCollaborationMessage) => void;

export class AgentCollaborationBus {
  readonly #listeners = new Set<CollaborationBusListener>();
  readonly #handoffCounts = new Map<string, number>();
  readonly #maxHandoffDepth = 10;

  subscribe(listener: CollaborationBusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  sendMessage(
    runId: string,
    sender: AgentExecutionInstance,
    recipientBotId: string,
    recipientRole: OrchestratorSpecialistRole,
    type: AgentCollaborationMessage["type"],
    summary: string,
    payload: Record<string, unknown> = {},
    recipientInstanceId: string | null = null,
  ): AgentCollaborationMessage {
    const trackingKey = `${runId}:${payload.taskId ?? "global"}`;
    const currentCount = this.#handoffCounts.get(trackingKey) ?? 0;

    if (type === "task_handoff" || type === "task_delegation") {
      if (currentCount >= this.#maxHandoffDepth) {
        throw new Error(
          `Handoff depth limit (${this.#maxHandoffDepth}) exceeded for ${trackingKey}. Halting to prevent infinite loop.`,
        );
      }
      this.#handoffCounts.set(trackingKey, currentCount + 1);
    }

    const message: AgentCollaborationMessage = {
      id: `collab-${randomUUID().slice(0, 8)}`,
      runId,
      senderInstanceId: sender.instanceId,
      senderBotId: sender.botId,
      senderRole: sender.role,
      recipientInstanceId,
      recipientBotId,
      recipientRole,
      type,
      summary,
      payload,
      createdAt: new Date().toISOString(),
    };

    for (const listener of this.#listeners) {
      try {
        listener(message);
      } catch (err) {
        console.error("Error in collaboration bus listener:", err);
      }
    }

    return message;
  }

  resetRun(runId: string): void {
    for (const key of this.#handoffCounts.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.#handoffCounts.delete(key);
      }
    }
  }
}
