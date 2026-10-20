// @vitest-environment node

import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isFrequentCadence, nextRunAfter, occurrencesBetween } from "../shared/cadence";
import type { AgentEvent, QueueDelivery, QueueSnapshot } from "../shared/ipc";
import { createRoutineExecutor } from "./routine-executor";
import { type RoutineExecutor, RoutineStore } from "./routine-store";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-routines-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Records every step and answers from a script. */
function scriptedExecutor(
  answers: Array<{ ok: boolean; reply?: string; error?: string }>,
): RoutineExecutor & { sent: Array<{ botId: string; text: string }> } {
  const sent: Array<{ botId: string; text: string }> = [];
  return {
    sent,
    async send(botId, text) {
      sent.push({ botId, text });
      return `delivery-${sent.length}`;
    },
    async waitFor() {
      const answer = answers.shift() ?? { ok: true, reply: "done" };
      return { ok: answer.ok, reply: answer.reply ?? null, error: answer.error ?? null };
    },
  };
}

const STEPS = [
  { botId: "arjun-research", instruction: "Find three suppliers" },
  { botId: "asha-accounts", instruction: "Compare their prices" },
  { botId: "vikram-sales", instruction: "Draft an email to the cheapest" },
];

describe("RoutineStore", () => {
  it("runs steps in order and passes each reply to the next step", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    const executor = scriptedExecutor([
      { ok: true, reply: "Suppliers: A, B, C" },
      { ok: true, reply: "B is cheapest at ₹40/kg" },
      { ok: true, reply: "Draft ready" },
    ]);
    store.start(executor);
    const state = await store.save({
      name: "Supplier check",
      steps: STEPS,
      cadence: null,
      enabled: true,
    });
    const routineId = state.routines[0]?.id ?? "";
    await store.runNow(routineId);
    await store.idle();
    store.stop();

    expect(executor.sent.map((step) => step.botId)).toEqual(STEPS.map((step) => step.botId));
    expect(executor.sent[0]?.text).toContain('[Routine "Supplier check" · step 1/3]');
    expect(executor.sent[1]?.text).toContain("Suppliers: A, B, C");
    expect(executor.sent[2]?.text).toContain("B is cheapest");
    const [run] = store.state().runs;
    expect(run).toMatchObject({ status: "done", trigger: "manual", routineName: "Supplier check" });
    expect(run?.steps.map((step) => step.status)).toEqual(["done", "done", "done"]);
    expect(run?.steps[1]?.result).toBe("B is cheapest at ₹40/kg");
  });

  it("stops at a failed step and skips the rest", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    const executor = scriptedExecutor([
      { ok: true, reply: "ok" },
      { ok: false, error: "The owner declined this action." },
    ]);
    store.start(executor);
    const state = await store.save({ name: "Pay run", steps: STEPS, cadence: null, enabled: true });
    await store.runNow(state.routines[0]?.id ?? "");
    await store.idle();
    store.stop();

    expect(executor.sent).toHaveLength(2);
    const [run] = store.state().runs;
    expect(run?.status).toBe("failed");
    expect(run?.steps.map((step) => step.status)).toEqual(["done", "failed", "skipped"]);
    expect(run?.steps[1]?.result).toBe("The owner declined this action.");
  });

  it("keeps run history on disk and closes runs interrupted by a restart", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    let waiting: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      waiting = resolve;
    });
    let released = false;
    let release: (() => void) | null = null;
    store.start({
      async send() {
        return "d1";
      },
      waitFor: () =>
        new Promise((resolve) => {
          waiting();
          const done = () => resolve({ ok: true, reply: "late", error: null });
          if (released) done();
          else release = done;
        }),
    });
    const state = await store.save({
      name: "Long",
      steps: STEPS.slice(0, 2),
      cadence: null,
      enabled: true,
    });
    await store.runNow(state.routines[0]?.id ?? "");
    await expect(store.runNow(state.routines[0]?.id ?? "")).rejects.toThrow("already running");
    await started;
    const file = JSON.parse(await readFile(join(root, "routines.json"), "utf8"));
    expect(file.runs[0].status).toBe("running");

    const reopened = new RoutineStore(root);
    await reopened.initialize();
    const [run] = reopened.state().runs;
    expect(run?.status).toBe("failed");
    expect(run?.steps.map((step) => step.status)).toEqual(["failed", "skipped"]);
    released = true;
    (release as (() => void) | null)?.();
    await store.idle();
    store.stop();
  });

  it("runs due routines on schedule and computes the next run", async () => {
    let now = new Date("2026-10-20T09:00:00");
    const store = new RoutineStore(root, () => now);
    await store.initialize();
    const executor = scriptedExecutor([]);
    const state = await store.save({
      name: "Daily report",
      steps: STEPS.slice(0, 1),
      cadence: { kind: "daily", time: "10:00" },
      enabled: true,
    });
    expect(state.routines[0]?.nextRunAt).toBe(new Date("2026-10-20T10:00:00").toISOString());
    store.start(executor);
    await store.idle();
    expect(executor.sent).toHaveLength(0);
    now = new Date("2026-10-20T10:00:30");
    await store.tick();
    await store.idle();
    store.stop();
    expect(executor.sent).toHaveLength(1);
    expect(store.state().runs[0]?.trigger).toBe("schedule");
    expect(store.state().routines[0]?.nextRunAt).toBe(
      new Date("2026-10-21T10:00:00").toISOString(),
    );
  });

  it("needs confirmation for cadences faster than every 5 minutes", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    const input = {
      name: "Spam",
      steps: STEPS.slice(0, 1),
      cadence: { kind: "interval" as const, minutes: 3 },
      enabled: true,
    };
    await expect(store.save(input)).rejects.toThrow("needs confirmation");
    const state = await store.save({ ...input, confirmFrequent: true });
    expect(state.routines).toHaveLength(1);
    await expect(
      store.save({ ...input, cadence: { kind: "interval", minutes: 0 } }),
    ).rejects.toThrow();
  });

  it("removes steps of a deleted coworker and empty routines", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    await store.save({ name: "Mixed", steps: STEPS.slice(0, 2), cadence: null, enabled: true });
    await store.save({
      name: "Only Arjun",
      steps: STEPS.slice(0, 1),
      cadence: null,
      enabled: true,
    });
    await store.deleteBotData("arjun-research");
    const routines = store.state().routines;
    expect(routines.map((routine) => routine.name)).toEqual(["Mixed"]);
    expect(routines[0]?.steps.map((step) => step.botId)).toEqual(["asha-accounts"]);
  });
});

describe("cadence occurrences", () => {
  it("lists real occurrences from the stored next run", () => {
    const start = new Date("2026-10-19T00:00:00");
    const end = new Date("2026-10-26T00:00:00");
    const daily = occurrencesBetween(
      { kind: "daily", time: "09:00" },
      new Date("2026-10-19T09:00:00").toISOString(),
      start,
      end,
    );
    expect(daily).toHaveLength(7);
    const weekdays = occurrencesBetween(
      { kind: "weekdays", time: "09:00" },
      new Date("2026-10-19T09:00:00").toISOString(),
      start,
      end,
    );
    expect(weekdays).toHaveLength(5);
    const once = occurrencesBetween(
      { kind: "once", at: "2026-10-22T15:00:00.000Z" },
      "2026-10-22T15:00:00.000Z",
      start,
      end,
    );
    expect(once).toHaveLength(1);
    expect(occurrencesBetween({ kind: "hourly" }, null, start, end)).toEqual([]);
  });

  it("caps very frequent cadences and steps intervals from the last run", () => {
    const from = new Date("2026-10-20T10:00:00");
    expect(nextRunAfter({ kind: "interval", minutes: 30 }, from)?.toISOString()).toBe(
      new Date("2026-10-20T10:30:00").toISOString(),
    );
    const many = occurrencesBetween(
      { kind: "interval", minutes: 1 },
      from.toISOString(),
      from,
      new Date("2026-10-27T10:00:00"),
      100,
    );
    expect(many).toHaveLength(100);
    expect(isFrequentCadence({ kind: "interval", minutes: 3 })).toBe(true);
    expect(isFrequentCadence({ kind: "interval", minutes: 5 })).toBe(false);
  });
});

describe("routine executor", () => {
  it("waits for the delivery and reads the coworker's final reply", async () => {
    const events = new EventEmitter();
    let delivery: QueueDelivery = {
      id: "d1",
      messageId: "m1",
      recipientBotId: "asha-accounts",
      sender: { kind: "user" },
      text: "x",
      attachments: [],
      replyToMessageId: null,
      status: "running",
      position: null,
      turnId: "t1",
      error: null,
      createdAt: "2026-10-20T10:00:00.000Z",
    };
    const snapshot = (): QueueSnapshot => ({
      botId: "asha-accounts",
      paused: false,
      deliveries: [delivery],
    });
    const executor = createRoutineExecutor({
      sendMessage: async () => ({
        messageId: "m1",
        deliveries: [{ id: "d1", recipientBotId: "asha-accounts", status: "queued", position: 0 }],
      }),
      listQueue: snapshot,
      readConversation: async () => ({
        botId: "asha-accounts",
        threadId: "th",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "a1",
            turnId: "t1",
            author: "assistant",
            text: "Working on it",
            itemType: "commentary",
            createdAt: "",
            status: "completed",
          },
          {
            id: "a2",
            turnId: "t1",
            author: "assistant",
            text: "Reconciled 42 invoices",
            createdAt: "",
            status: "completed",
          },
        ],
      }),
      on: (name, listener) => events.on(name, listener),
      off: (name, listener) => events.off(name, listener),
    });
    expect(await executor.send("asha-accounts", "Reconcile")).toBe("d1");
    const waiting = executor.waitFor("asha-accounts", "d1");
    delivery = { ...delivery, status: "completed" };
    events.emit("event", { type: "queue-changed", snapshot: snapshot() } satisfies AgentEvent);
    expect(await waiting).toEqual({ ok: true, reply: "Reconciled 42 invoices", error: null });
  });

  it("reports a failed or timed-out step", async () => {
    const events = new EventEmitter();
    const port = {
      sendMessage: async () => ({ messageId: "m", deliveries: [] }),
      listQueue: (): QueueSnapshot => ({ botId: "b", paused: false, deliveries: [] }),
      readConversation: async () => {
        throw new Error("unused");
      },
      on: (name: "event", listener: (event: AgentEvent) => void) => events.on(name, listener),
      off: (name: "event", listener: (event: AgentEvent) => void) => events.off(name, listener),
    };
    const executor = createRoutineExecutor(port, 20);
    await expect(executor.send("b", "x")).rejects.toThrow("could not be queued");
    expect((await executor.waitFor("b", "missing")).ok).toBe(false);
  });
});
