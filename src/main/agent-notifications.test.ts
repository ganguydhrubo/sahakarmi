// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AgentEvent, ApprovalRequest, BotSummary } from "../shared/ipc";
import { notificationForAgentEvent, notificationsForNewApprovals } from "./agent-notifications";

const bot = {
  id: "chief",
  name: "Chief",
  notifications: true,
} as BotSummary;

describe("notificationForAgentEvent", () => {
  it("surfaces completed work and prompts for enabled agents", () => {
    expect(notificationForAgentEvent(completed("completed"), [bot])).toEqual({
      title: "Chief",
      body: "Finished working.",
      botId: "chief",
    });
    expect(
      notificationForAgentEvent(
        {
          type: "prompt",
          botId: "chief",
          threadId: "thread-chief",
          turnId: "turn-1",
          requestId: 1,
          questions: [],
        },
        [bot],
      ),
    ).toEqual({ title: "Chief", body: "Needs your input.", botId: "chief" });
  });

  it("ignores disabled agents, non-successful turns, and unrelated events", () => {
    expect(notificationForAgentEvent(completed("failed"), [bot])).toBeNull();
    expect(
      notificationForAgentEvent(completed("completed"), [{ ...bot, notifications: false }]),
    ).toBeNull();
    expect(notificationForAgentEvent({ type: "bots-changed", bots: [] }, [bot])).toBeNull();
  });
});

describe("notificationsForNewApprovals", () => {
  it("notifies once per new pending approval, with the chat and card to open", () => {
    const seen = new Set<string>();
    const first = notificationsForNewApprovals([approval("a1")], [bot], seen);
    expect(first).toEqual([
      {
        title: "Chief needs your approval",
        body: "Run a command in your workspace",
        botId: "chief",
        approvalId: "a1",
      },
    ]);
    // The same request in a later approvals-changed event does not notify again.
    expect(notificationsForNewApprovals([approval("a1"), approval("a2")], [bot], seen)).toEqual([
      expect.objectContaining({ approvalId: "a2" }),
    ]);
  });

  it("skips decided requests and coworkers with notifications off, and forgets old ids", () => {
    const seen = new Set<string>(["old"]);
    expect(
      notificationsForNewApprovals([{ ...approval("a1"), status: "approved" }], [bot], seen),
    ).toEqual([]);
    expect(
      notificationsForNewApprovals([approval("a2")], [{ ...bot, notifications: false }], seen),
    ).toEqual([]);
    expect([...seen]).toEqual(["a2"]);
  });

  it("clips long titles to one notification line", () => {
    const [content] = notificationsForNewApprovals(
      [{ ...approval("a1"), title: "x".repeat(400) }],
      [bot],
      new Set(),
    );
    expect(content?.body.length).toBeLessThanOrEqual(160);
  });
});

function approval(id: string): ApprovalRequest {
  return {
    id,
    botId: "chief",
    title: "Run a command in your workspace",
    details: "",
    category: "other",
    amount: null,
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    note: null,
  } as ApprovalRequest;
}

function completed(status: string): AgentEvent {
  return {
    type: "turn-completed",
    botId: "chief",
    threadId: "thread-chief",
    turnId: "turn-1",
    status,
  };
}
