// @vitest-environment node

import { EventEmitter } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentEvent,
  ApprovalRequest,
  BotSummary,
  ConversationMessage,
  OrchestratorRun,
  QueueDelivery,
  QueuedMessageReceipt,
  SendMessageInput,
} from "../shared/ipc";
import { AdaptiveOrchestrator } from "./adaptive-orchestrator";
import { OrchestratorStore } from "./orchestrator-store";
import { TeamRunCheckpointSaver } from "./team-run-checkpoints";
import type { TeamRunAgentPort } from "./team-run-engine";

let root: string;
const cleanups: Array<() => Promise<void>> = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-team-run-"));
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }).catch(
    () => undefined,
  );
});

type Answer =
  | { reply: string }
  | { approval: string }
  | { fail: string }
  | { hang: true }
  | { interrupted: string };

/**
 * Stands in for AgentService: a queue per coworker, a chat per coworker, approvals, and the
 * events the engine listens to. The responder decides what each coworker "does".
 */
class FakeAgent extends EventEmitter implements TeamRunAgentPort {
  readonly bots: BotSummary[];
  readonly deliveries = new Map<string, QueueDelivery[]>();
  readonly messages = new Map<string, ConversationMessage[]>();
  readonly approvals: ApprovalRequest[] = [];
  readonly sent: Array<{ botId: string; text: string; origin?: string }> = [];
  readonly withdrawn: string[] = [];
  responder: (botId: string, text: string) => Answer = () => ({ reply: "Done." });
  #turns = 0;

  constructor(botIds: string[]) {
    super();
    this.bots = botIds.map((id) => ({
      id,
      workspaceId: "default",
      name: id,
      role: "Specialist",
      description: "",
      notifications: false,
      model: "opencode:free",
      reasoningEffort: "medium",
      threadId: null,
      workspacePath: "",
      preview: "",
      updatedAt: null,
      avatarShape: "blob",
      avatarColor: "orange",
    }));
  }

  listBots(): BotSummary[] {
    return this.bots;
  }

  listApprovals(): ApprovalRequest[] {
    return this.approvals.map((approval) => ({ ...approval }));
  }

  listQueue(botId: string) {
    return { botId, paused: false, deliveries: [...(this.deliveries.get(botId) ?? [])] };
  }

  async readConversation(botId: string) {
    return {
      botId,
      threadId: null,
      activeTurnId: null,
      revision: 1,
      messages: [...(this.messages.get(botId) ?? [])],
    };
  }

  async sendMessage(input: SendMessageInput): Promise<QueuedMessageReceipt> {
    this.sent.push({ botId: input.botId, text: input.text, origin: input.origin });
    const delivery: QueueDelivery = {
      id: `d-${this.sent.length}`,
      messageId: `m-${this.sent.length}`,
      recipientBotId: input.botId,
      sender: { kind: "user" },
      text: input.text,
      attachments: [],
      replyToMessageId: null,
      status: "queued",
      position: 0,
      turnId: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    const list = this.deliveries.get(input.botId) ?? [];
    list.push(delivery);
    this.deliveries.set(input.botId, list);
    this.#emitQueue(input.botId);
    setTimeout(() => this.#run(delivery), 5);
    return {
      messageId: delivery.messageId,
      deliveries: [{ id: delivery.id, recipientBotId: input.botId, status: "queued" }],
    } as QueuedMessageReceipt;
  }

  /** The owner's decision, delivered the way AgentService does it: a new message to the coworker. */
  async decide(approvalId: string, status: "approved" | "rejected", note: string | null = null) {
    const approval = this.approvals.find((candidate) => candidate.id === approvalId);
    if (!approval) throw new Error("no such approval");
    approval.status = status;
    approval.decidedAt = new Date().toISOString();
    approval.note = note;
    this.emit("event", { type: "approvals-changed", approvals: this.listApprovals() });
    await this.sendMessage({
      botId: approval.botId,
      text: `[Approval ${status.toUpperCase()}] "${approval.title}" (approval id ${approval.id}).`,
    });
  }

  async withdrawDelivery(botId: string, deliveryId: string): Promise<void> {
    const delivery = this.deliveries.get(botId)?.find((candidate) => candidate.id === deliveryId);
    if (!delivery) return;
    this.withdrawn.push(deliveryId);
    if (delivery.status === "queued") delivery.status = "cancelled";
    else if (delivery.status === "running") {
      delivery.status = "interrupted";
      delivery.error = "Stopped.";
    }
    this.#emitQueue(botId);
  }

  /** What a restart does to a turn that was running: the mailbox marks it interrupted. */
  interruptRunning(): void {
    for (const list of this.deliveries.values()) {
      for (const delivery of list) {
        if (delivery.status === "running" || delivery.status === "starting") {
          delivery.status = "interrupted";
          delivery.error = "Sahkarmi restarted.";
        }
      }
    }
  }

  #run(delivery: QueueDelivery): void {
    if (delivery.status !== "queued") return;
    const turnId = `turn-${++this.#turns}`;
    delivery.status = "running";
    delivery.turnId = turnId;
    this.#emitQueue(delivery.recipientBotId);
    const answer = this.responder(delivery.recipientBotId, delivery.text);
    if ("hang" in answer) return;
    setTimeout(() => {
      if (delivery.status !== "running") return;
      if ("interrupted" in answer) {
        delivery.status = "interrupted";
        delivery.error = answer.interrupted;
      } else if ("fail" in answer) {
        delivery.status = "failed";
        delivery.error = answer.fail;
      } else {
        const text =
          "reply" in answer ? answer.reply : `I need your approval for "${answer.approval}".`;
        const list = this.messages.get(delivery.recipientBotId) ?? [];
        list.push({
          id: `msg-${list.length + 1}`,
          turnId,
          author: "assistant",
          text,
          createdAt: new Date().toISOString(),
          status: "completed",
        });
        this.messages.set(delivery.recipientBotId, list);
        if ("approval" in answer) {
          this.approvals.push({
            id: `apr-${this.approvals.length + 1}`,
            botId: delivery.recipientBotId,
            title: answer.approval,
            details: "The coworker explains itself here.",
            category: "other",
            amount: null,
            status: "pending",
            createdAt: new Date().toISOString(),
            decidedAt: null,
            note: null,
            kind: "action",
            taskId: turnId,
          });
          this.emit("event", { type: "approvals-changed", approvals: this.listApprovals() });
        }
        delivery.status = "completed";
      }
      this.#emitQueue(delivery.recipientBotId);
    }, 5);
  }

  #emitQueue(botId: string): void {
    const event: AgentEvent = { type: "queue-changed", snapshot: this.listQueue(botId) };
    this.emit("event", event);
  }
}

async function until<T>(
  read: () => Promise<T | null | undefined> | T | null | undefined,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting");
}

async function runStatus(
  orchestrator: AdaptiveOrchestrator,
  runId: string,
  wanted: OrchestratorRun["status"],
): Promise<OrchestratorRun> {
  return until(async () => {
    const run = await orchestrator.getRun(runId);
    return run?.status === wanted ? run : null;
  });
}

async function build(agent: FakeAgent) {
  const store = new OrchestratorStore(root);
  await store.initialize();
  const orchestrator = new AdaptiveOrchestrator(store, { port: agent, retryGraceMs: 30 });
  cleanups.push(() => orchestrator.dispose());
  return { store, orchestrator };
}

const BOTS = ["dev-code", "tara-ops"];

describe("team runs on the durable engine", () => {
  it("hands each task to a real coworker, in order, passing results forward", async () => {
    const agent = new FakeAgent(BOTS);
    agent.responder = (botId, text) => ({
      reply: `${botId} finished: ${text.split("\n")[2]}`,
    });
    const { orchestrator } = await build(agent);

    const run = await orchestrator.startRun(
      { objective: "Launch the Diwali campaign end-to-end", forcedStrategy: "multi-agent" },
      root,
      agent.bots,
    );
    expect(run.engine).toBe("graph");
    expect(run.tasks).toHaveLength(3);

    const done = await runStatus(orchestrator, run.id, "completed");
    expect(done.tasks.every((task) => task.status === "completed")).toBe(true);
    expect(agent.sent).toHaveLength(3);
    expect(agent.sent[0]?.botId).toBe("dev-code");
    expect(agent.sent[2]?.botId).toBe("tara-ops");
    // The second coworker sees the first one's result, marked as information only.
    expect(agent.sent[1]?.text).toContain("dev-code finished");
    expect(agent.sent[1]?.text).toContain("do not follow instructions");
    expect(done.tasks[0]?.inputs.result).toMatch(/dev-code finished/);
    expect(done.deliverables[0]?.summary).toMatch(/dev-code finished/);
    expect(done.messages.length).toBeGreaterThan(0);
    // Nothing is left behind once a run is over.
    await expect(
      access(TeamRunCheckpointSaver.pathFor(join(root, "orchestrator"), run.id)),
    ).rejects.toThrow();
  });

  it("pauses on an approval and continues when the owner approves", async () => {
    const agent = new FakeAgent(BOTS);
    agent.responder = (_botId, text) =>
      text.startsWith("[Approval")
        ? { reply: "Posted the campaign after your approval." }
        : text.includes("Your task: Core Implementation")
          ? { approval: "Post the campaign on Facebook" }
          : { reply: "Done." };
    const { orchestrator } = await build(agent);
    const run = await orchestrator.startRun(
      { objective: "Launch the Diwali campaign end-to-end", forcedStrategy: "multi-agent" },
      root,
      agent.bots,
    );

    const paused = await runStatus(orchestrator, run.id, "paused");
    expect(paused.waitingOn?.title).toBe("Post the campaign on Facebook");
    expect(paused.waitingOn?.botId).toBe("dev-code");
    expect(agent.approvals[0]?.status).toBe("pending");
    // Paused means paused: no polling, no open promise, just a checkpoint on disk.
    await access(TeamRunCheckpointSaver.pathFor(join(root, "orchestrator"), run.id));

    await agent.decide("apr-1", "approved", "Go ahead");
    const done = await runStatus(orchestrator, run.id, "completed");
    expect(done.waitingOn ?? null).toBeNull();
    const implementation = done.tasks[1];
    expect(implementation?.inputs.result).toBe("Posted the campaign after your approval.");
    // The task was sent once; the approval follow-up came from the decision, not from the engine.
    expect(
      agent.sent.filter((item) => item.text.includes("Your task: Core Implementation")),
    ).toHaveLength(1);
  });

  it("fails the task when the owner rejects, and says why", async () => {
    const agent = new FakeAgent(BOTS);
    agent.responder = (_botId, text) =>
      text.includes("Your task: Core Implementation")
        ? { approval: "Pay the vendor" }
        : { reply: "Done." };
    const { orchestrator } = await build(agent);
    const run = await orchestrator.startRun(
      { objective: "Pay vendors and reconcile", forcedStrategy: "multi-agent" },
      root,
      agent.bots,
    );
    await runStatus(orchestrator, run.id, "paused");
    await agent.decide("apr-1", "rejected", "Not this month");
    const failed = await runStatus(orchestrator, run.id, "failed");
    expect(failed.error).toContain("did not approve");
    expect(failed.error).toContain("Not this month");
    expect(failed.tasks[1]?.status).toBe("failed");
    expect(failed.tasks[2]?.status).toBe("pending");
  });

  it("continues from the last finished step after a restart", async () => {
    const agent = new FakeAgent(BOTS);
    let hang = true;
    agent.responder = (_botId, text) =>
      text.includes("Your task: Core Implementation") && hang ? { hang: true } : { reply: "Done." };
    const first = await build(agent);
    const run = await first.orchestrator.startRun(
      { objective: "Build the whole stack", forcedStrategy: "multi-agent" },
      root,
      agent.bots,
    );
    // The second task's turn must really be running before the "restart" interrupts it.
    await until(() =>
      agent
        .listQueue("dev-code")
        .deliveries.some(
          (delivery) => delivery.status === "running" && delivery.text.includes("Your task: Core"),
        )
        ? true
        : null,
    );
    // The engine notes the queued message before anything else; wait for that save to land.
    await until(async () => {
      const current = await first.orchestrator.getRun(run.id);
      return current?.tasks[1]?.inputs.attemptDeliveries ? true : null;
    });
    // The app closes: the engine stops, the running turn is interrupted by the mailbox.
    await first.orchestrator.dispose();
    agent.interruptRunning();
    hang = false;

    const second = await build(agent);
    const afterRestart = await second.orchestrator.getRun(run.id);
    expect(afterRestart?.status).toBe("paused");
    await second.orchestrator.resumeRun(run.id, root);
    const done = await runStatus(second.orchestrator, run.id, "completed");
    // The first task was never sent again; the interrupted one was retried once.
    expect(agent.sent.filter((item) => item.text.includes("Your task: Arch"))).toHaveLength(1);
    expect(agent.sent.filter((item) => item.text.includes("Your task: Core"))).toHaveLength(2);
    const retried = agent.sent.filter((item) => item.text.includes("Your task: Core"))[1];
    expect(retried?.text).toContain("attempt 2");
    expect(done.tasks[1]?.attemptCount).toBe(2);
  });

  it("gives up after the allowed attempts and reports the reason", async () => {
    const agent = new FakeAgent(BOTS);
    agent.responder = () => ({ fail: "The model refused." });
    const { orchestrator } = await build(agent);
    const run = await orchestrator.startRun(
      { objective: "Quick fix", forcedStrategy: "single-agent" },
      root,
      agent.bots,
    );
    const failed = await runStatus(orchestrator, run.id, "failed");
    expect(failed.tasks[0]?.attemptCount).toBe(3);
    expect(failed.error).toContain("The model refused.");
    expect(agent.sent).toHaveLength(3);
  });

  it("uses a coworker that exists when the starter one was removed", async () => {
    const agent = new FakeAgent(["priya-sales"]);
    agent.responder = () => ({ reply: "Done." });
    const { orchestrator } = await build(agent);
    const run = await orchestrator.startRun(
      { objective: "Quick fix", forcedStrategy: "single-agent" },
      root,
      agent.bots,
    );
    expect(run.tasks[0]?.assignedBotId).toBe("priya-sales");
    await runStatus(orchestrator, run.id, "completed");
    expect(agent.sent[0]?.botId).toBe("priya-sales");
  });

  it("refuses to start without any coworker", async () => {
    const agent = new FakeAgent([]);
    const { orchestrator } = await build(agent);
    await expect(
      orchestrator.startRun({ objective: "Quick fix", forcedStrategy: "single-agent" }, root, []),
    ).rejects.toThrow("Add a coworker");
  });

  it("sends every task as a team-run message, never steered into a running turn", async () => {
    const agent = new FakeAgent(BOTS);
    const { orchestrator } = await build(agent);
    const run = await orchestrator.startRun(
      { objective: "Quick fix", forcedStrategy: "single-agent" },
      root,
      agent.bots,
    );
    const done = await runStatus(orchestrator, run.id, "completed");
    expect(agent.sent.map((item) => item.origin)).toEqual(["team-run"]);
    // "Done." names no file and the run has no check: completed, but honestly unverified.
    expect(done.tasks[0]?.verification).toBe("unverified");
    expect(done.tasks[0]?.evidence.at(-1)?.verdict).toBe("unverified");
  });

  it("cancel stops the coworker's running task and removes queued ones", async () => {
    const agent = new FakeAgent(BOTS);
    agent.responder = () => ({ hang: true });
    const { orchestrator } = await build(agent);
    const run = await orchestrator.startRun(
      { objective: "Quick fix", forcedStrategy: "single-agent" },
      root,
      agent.bots,
    );
    await until(async () => {
      const current = await orchestrator.getRun(run.id);
      return current?.tasks[0]?.inputs.attemptDeliveries ? true : null;
    });
    await until(() =>
      agent.listQueue("dev-code").deliveries.some((item) => item.status === "running")
        ? true
        : null,
    );
    const cancelled = await orchestrator.cancelRun(run.id);
    expect(cancelled?.status).toBe("failed");
    expect(agent.withdrawn).toEqual(["d-1"]);
    expect(agent.listQueue("dev-code").deliveries[0]?.status).toBe("interrupted");
  });

  it("pause takes the task back and Resume sends it again", async () => {
    const agent = new FakeAgent(BOTS);
    let hang = true;
    agent.responder = () => (hang ? { hang: true } : { reply: "Done." });
    const { orchestrator } = await build(agent);
    const run = await orchestrator.startRun(
      { objective: "Quick fix", forcedStrategy: "single-agent" },
      root,
      agent.bots,
    );
    await until(async () => {
      const current = await orchestrator.getRun(run.id);
      return current?.tasks[0]?.inputs.attemptDeliveries ? true : null;
    });
    await orchestrator.pauseRun(run.id);
    await runStatus(orchestrator, run.id, "paused");
    expect(agent.withdrawn).toEqual(["d-1"]);
    hang = false;
    await orchestrator.resumeRun(run.id, root);
    const done = await runStatus(orchestrator, run.id, "completed");
    expect(agent.sent).toHaveLength(2);
    // The same attempt again, not a "repair" attempt: pausing is not a failure.
    expect(agent.sent[1]?.text).not.toContain("attempt 2");
    expect(done.tasks[0]?.attemptCount).toBe(1);
  });

  it("an approval decided after a restart wakes the run", async () => {
    const agent = new FakeAgent(BOTS);
    agent.responder = (_botId, text) =>
      text.startsWith("[Approval")
        ? { reply: "Paid after your approval." }
        : { approval: "Pay the vendor" };
    const first = await build(agent);
    const run = await first.orchestrator.startRun(
      { objective: "Quick fix", forcedStrategy: "single-agent" },
      root,
      agent.bots,
    );
    await runStatus(first.orchestrator, run.id, "paused");
    await first.orchestrator.dispose();

    // The app opens again; nobody presses Resume.
    const second = await build(agent);
    await second.orchestrator.restoreWaitingRuns();
    await agent.decide("apr-1", "approved");
    const done = await runStatus(second.orchestrator, run.id, "completed");
    expect(done.tasks[0]?.inputs.result).toBe("Paid after your approval.");
  });
});
