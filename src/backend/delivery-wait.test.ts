// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { AgentEvent, QueueDelivery } from "../shared/ipc";
import { type DeliveryWaitPort, waitForDelivery } from "./delivery-wait";

class FakeQueue extends EventEmitter implements DeliveryWaitPort {
  deliveries: QueueDelivery[] = [];
  replies = new Map<string, string>();

  listQueue(botId: string) {
    return { botId, paused: false, deliveries: this.deliveries.map((item) => ({ ...item })) };
  }

  async readConversation(botId: string) {
    return {
      botId,
      threadId: null,
      activeTurnId: null,
      revision: 1,
      messages: [...this.replies].map(([turnId, text], index) => ({
        id: `m-${index}`,
        turnId,
        author: "assistant" as const,
        text,
        createdAt: new Date().toISOString(),
        status: "completed" as const,
      })),
    };
  }

  add(id: string, patch: Partial<QueueDelivery> = {}): QueueDelivery {
    const delivery: QueueDelivery = {
      id,
      messageId: `msg-${id}`,
      recipientBotId: "dev",
      sender: { kind: "user" },
      text: "Do the task",
      attachments: [],
      replyToMessageId: null,
      status: "queued",
      position: 1,
      turnId: null,
      error: null,
      createdAt: new Date().toISOString(),
      ...patch,
    };
    this.deliveries.push(delivery);
    return delivery;
  }

  update(id: string, patch: Partial<QueueDelivery>): void {
    const delivery = this.deliveries.find((item) => item.id === id);
    if (delivery) Object.assign(delivery, patch);
    const event: AgentEvent = { type: "queue-changed", snapshot: this.listQueue("dev") };
    this.emit("event", event);
  }
}

describe("waitForDelivery", () => {
  it("reads the reply of the turn that finished", async () => {
    const queue = new FakeQueue();
    queue.add("d-1");
    const wait = waitForDelivery(queue, "dev", "d-1", { timeoutMs: 5_000 });
    queue.replies.set("turn-1", "All done, saved report.pdf");
    queue.update("d-1", { status: "completed", turnId: "turn-1" });
    await expect(wait).resolves.toMatchObject({
      ok: true,
      reply: "All done, saved report.pdf",
      deliveryId: "d-1",
    });
  });

  it("follows a failed copy to the one it was sent again as", async () => {
    const queue = new FakeQueue();
    queue.add("d-1");
    const wait = waitForDelivery(queue, "dev", "d-1", { timeoutMs: 5_000, retryGraceMs: 2_000 });
    // The provider was overloaded: the copy fails first, the re-send is linked a moment later.
    queue.update("d-1", { status: "failed", error: "Overloaded", turnId: "turn-1" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    queue.add("d-2");
    queue.update("d-1", { retriedAs: "d-2" });
    queue.replies.set("turn-2", "Done on the second try.");
    queue.update("d-2", { status: "completed", turnId: "turn-2" });
    await expect(wait).resolves.toMatchObject({
      ok: true,
      reply: "Done on the second try.",
      deliveryId: "d-2",
    });
  });

  it("reports a failure once no re-send follows", async () => {
    const queue = new FakeQueue();
    queue.add("d-1");
    const wait = waitForDelivery(queue, "dev", "d-1", { timeoutMs: 5_000, retryGraceMs: 30 });
    queue.update("d-1", { status: "failed", error: "The model refused." });
    await expect(wait).resolves.toMatchObject({ ok: false, error: "The model refused." });
  });

  it("stops waiting when aborted", async () => {
    const queue = new FakeQueue();
    queue.add("d-1");
    const controller = new AbortController();
    const wait = waitForDelivery(queue, "dev", "d-1", {
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(wait).resolves.toMatchObject({ ok: false, aborted: true });
  });
});
