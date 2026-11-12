// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BotSummary, SaveRoutineInput } from "../shared/ipc";
import { parseYesNo, type RoutineExecutor, RoutineStore } from "./routine-store";
import { parseWorkflowJson, routineFromWorkflow, routineWorkflow } from "./workflow-export";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-routine-steps-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

type Decision = "approved" | "rejected" | "timed-out";

/** Answers coworker steps from a script and records approvals and Telegram posts. */
function executor(
  replies: string[],
  decision: Decision = "approved",
): RoutineExecutor & {
  sent: Array<{ botId: string; text: string }>;
  approvals: Array<{ botId: string; question: string; details: string }>;
  telegram: string[];
} {
  const sent: Array<{ botId: string; text: string }> = [];
  const approvals: Array<{ botId: string; question: string; details: string }> = [];
  const telegram: string[] = [];
  return {
    sent,
    approvals,
    telegram,
    async send(botId, text) {
      sent.push({ botId, text });
      return `delivery-${sent.length}`;
    },
    async waitFor() {
      return { ok: true, reply: replies.shift() ?? "done", error: null };
    },
    async askApproval(input) {
      approvals.push(input);
      return decision;
    },
    async sendTelegram(text) {
      telegram.push(text);
    },
  };
}

async function runOnce(
  steps: SaveRoutineInput["steps"],
  exec: RoutineExecutor,
  name = "Weekly report",
) {
  const store = new RoutineStore(root);
  await store.initialize();
  store.start(exec);
  const state = await store.save({ name, steps, cadence: null, enabled: true });
  const routineId = state.routines[0]?.id ?? "";
  await store.runNow(routineId);
  await store.idle();
  store.stop();
  const run = store.state().runs[0];
  if (!run) throw new Error("no run");
  return { store, run };
}

describe("routine step types", () => {
  it("keeps routines saved before 0.31 working exactly as before", async () => {
    const exec = executor(["Suppliers: A, B", "B is cheapest"]);
    const { run, store } = await runOnce(
      [
        { botId: "arjun", instruction: "Find suppliers" },
        { botId: "asha", instruction: "Compare prices" },
      ],
      exec,
    );
    expect(run.status).toBe("done");
    expect(run.steps.map((step) => step.status)).toEqual(["done", "done"]);
    expect(exec.sent[1]?.text).toContain("Suppliers: A, B");
    // Plain agent steps are stored without a kind, as before.
    expect(store.state().routines[0]?.steps.every((step) => step.kind === undefined)).toBe(true);
  });

  it("goes on after a yes and passes the earlier result through unchanged", async () => {
    const exec = executor([
      "Report: one late payment from Mehta Traders",
      "YES, Mehta is late",
      "Reminder drafted",
    ]);
    const { run } = await runOnce(
      [
        { botId: "asha", instruction: "Write the payments report" },
        { kind: "condition", botId: "asha", instruction: "Is any payment late?" },
        { botId: "vikram", instruction: "Draft a reminder" },
      ],
      exec,
    );
    expect(run.status).toBe("done");
    expect(run.steps.map((step) => step.status)).toEqual(["done", "done", "done"]);
    expect(exec.sent[1]?.text).toContain("yes/no check");
    expect(exec.sent[1]?.text).toContain("Do not do any task");
    // The step after the check sees the report, not the check's answer.
    expect(exec.sent[2]?.text).toContain("Mehta Traders");
    expect(exec.sent[2]?.text).not.toContain("YES, Mehta is late");
  });

  it("stops the run as done after a no", async () => {
    const exec = executor(["All paid", "No, nothing is late"]);
    const { run } = await runOnce(
      [
        { botId: "asha", instruction: "Write the payments report" },
        { kind: "condition", botId: "asha", instruction: "Is any payment late?" },
        { botId: "vikram", instruction: "Draft a reminder" },
      ],
      exec,
    );
    expect(run.status).toBe("done");
    expect(run.steps.map((step) => step.status)).toEqual(["done", "done", "skipped"]);
    expect(exec.sent).toHaveLength(2);
  });

  it("jumps forward after a no and skips the steps in between", async () => {
    const exec = executor(["All paid", "nahi", "Summary sent"]);
    const { run } = await runOnce(
      [
        { id: "s1", botId: "asha", instruction: "Write the payments report" },
        {
          id: "s2",
          kind: "condition",
          botId: "asha",
          instruction: "Is any payment late?",
          onNo: { action: "jump", stepId: "s4" },
        },
        { id: "s3", botId: "vikram", instruction: "Draft a reminder" },
        { id: "s4", botId: "neha", instruction: "Send the weekly summary" },
      ],
      exec,
    );
    expect(run.status).toBe("done");
    expect(run.steps.map((step) => step.status)).toEqual(["done", "done", "skipped", "done"]);
    expect(exec.sent.map((step) => step.botId)).toEqual(["asha", "asha", "neha"]);
    expect(exec.sent[2]?.text).toContain("All paid");
  });

  it("fails the run when a check gets no yes or no", async () => {
    const exec = executor(["Report", "Maybe, hard to say"]);
    const { run } = await runOnce(
      [
        { botId: "asha", instruction: "Write the report" },
        { kind: "condition", botId: "asha", instruction: "Is it good?" },
        { botId: "vikram", instruction: "Send it" },
      ],
      exec,
    );
    expect(run.status).toBe("failed");
    expect(run.steps[1]?.result).toContain("did not answer yes or no");
    expect(run.steps[2]?.status).toBe("skipped");
  });

  it("asks the owner once with the result so far, and goes on when approved", async () => {
    const exec = executor(["Report text", "Posted"]);
    const { run } = await runOnce(
      [
        { botId: "asha", instruction: "Write the report" },
        { kind: "approval", botId: "", instruction: "Post the report?" },
        { botId: "vikram", instruction: "Post it" },
      ],
      exec,
    );
    expect(exec.approvals).toHaveLength(1);
    expect(exec.approvals[0]).toMatchObject({ botId: "asha", question: "Post the report?" });
    expect(exec.approvals[0]?.details).toContain("Report text");
    expect(run.status).toBe("done");
    // The step after the approval still gets the report.
    expect(exec.sent[1]?.text).toContain("Report text");
  });

  it("stops (as done) when the owner says no, and fails when nobody answers", async () => {
    const steps: SaveRoutineInput["steps"] = [
      { botId: "asha", instruction: "Write the report" },
      { kind: "approval", botId: "", instruction: "Post the report?" },
      { botId: "vikram", instruction: "Post it" },
    ];
    const rejected = await runOnce(steps, executor(["Report"], "rejected"));
    expect(rejected.run.status).toBe("done");
    expect(rejected.run.steps.map((step) => step.status)).toEqual(["done", "done", "skipped"]);
    expect(rejected.run.steps[1]?.result).toContain("Not approved");

    await rm(join(root, "routines.json"), { force: true });
    const silent = await runOnce(steps, executor(["Report"], "timed-out"));
    expect(silent.run.status).toBe("failed");
    expect(silent.run.steps[1]?.result).toContain("24 hours");
  });

  it("saves the result to a new file and never overwrites one", async () => {
    const folder = join(root, "out");
    await mkdir(folder);
    const steps: SaveRoutineInput["steps"] = [
      { botId: "asha", instruction: "Write the report" },
      { kind: "output", botId: "", instruction: "", output: { kind: "file", folder } },
    ];
    const first = await runOnce(steps, executor(["# Sales\nUp 12%"]), "Sales: weekly?");
    expect(first.run.status).toBe("done");
    await rm(join(root, "routines.json"), { force: true });
    await runOnce(steps, executor(["# Sales\nUp 13%"]), "Sales: weekly?");
    const files = (await readdir(folder)).sort();
    expect(files).toHaveLength(2);
    // Characters Windows refuses in file names are replaced.
    expect(files.every((file) => file.startsWith("Sales weekly ") && file.endsWith(".md"))).toBe(
      true,
    );
    const texts = await Promise.all(files.map((file) => readFile(join(folder, file), "utf8")));
    expect(texts.join("\n")).toContain("Up 12%");
    expect(texts.join("\n")).toContain("Up 13%");
    expect(first.run.steps[1]?.result).toContain("Saved to");
  });

  it("sends the result to Telegram", async () => {
    const exec = executor(["Daily leads: 4"]);
    const { run } = await runOnce(
      [
        { botId: "asha", instruction: "Count leads" },
        { kind: "output", botId: "", instruction: "", output: { kind: "telegram" } },
      ],
      exec,
      "Lead count",
    );
    expect(run.status).toBe("done");
    expect(exec.telegram).toEqual(["Lead count\n\nDaily leads: 4"]);
  });

  it("refuses routines it could never run", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    const save = (steps: SaveRoutineInput["steps"]) =>
      store.save({ name: "Bad", steps, cadence: null, enabled: true });
    await expect(save([{ kind: "approval", botId: "", instruction: "Go?" }])).rejects.toThrow(
      "coworker step",
    );
    await expect(
      save([
        { kind: "output", botId: "", instruction: "", output: { kind: "telegram" } },
        { botId: "asha", instruction: "Write" },
      ]),
    ).rejects.toThrow("step before it");
    await expect(
      save([
        { id: "a", botId: "asha", instruction: "Write" },
        {
          id: "b",
          kind: "condition",
          botId: "asha",
          instruction: "Good?",
          onNo: { action: "jump", stepId: "a" },
        },
      ]),
    ).rejects.toThrow("later step");
    await expect(
      save([
        { botId: "asha", instruction: "Write" },
        {
          kind: "output",
          botId: "",
          instruction: "",
          output: { kind: "file", folder: join(root, "missing") },
        },
      ]),
    ).rejects.toThrow("does not exist");
  });

  it("drops a deleted coworker's steps and turns a jump to them into a stop", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    await store.save({
      name: "Branchy",
      steps: [
        { id: "s1", botId: "asha", instruction: "Write" },
        {
          id: "s2",
          kind: "condition",
          botId: "asha",
          instruction: "Late?",
          onNo: { action: "jump", stepId: "s4" },
        },
        { id: "s3", botId: "asha", instruction: "Remind" },
        { id: "s4", botId: "vikram", instruction: "Summarise" },
      ],
      cadence: null,
      enabled: true,
    });
    await store.deleteBotData("vikram");
    const steps = store.state().routines[0]?.steps ?? [];
    expect(steps.map((step) => step.id)).toEqual(["s1", "s2", "s3"]);
    expect(steps[1]?.onNo).toEqual({ action: "stop" });
  });
});

describe("parseYesNo", () => {
  it("reads the first word in English, Hindi and Bengali", () => {
    expect(parseYesNo("YES. Two invoices are late.")).toBe(true);
    expect(parseYesNo("**No** — all paid")).toBe(false);
    expect(parseYesNo("Haan, ek late hai")).toBe(true);
    expect(parseYesNo("nahi")).toBe(false);
    expect(parseYesNo("हाँ, एक बाकी है")).toBe(true);
    expect(parseYesNo("नहीं")).toBe(false);
    expect(parseYesNo("হ্যাঁ")).toBe(true);
    expect(parseYesNo("না")).toBe(false);
    expect(parseYesNo("Maybe")).toBeNull();
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo(null)).toBeNull();
  });
});

describe("workflow files with step types", () => {
  it("export then import keeps checks, jumps, approvals and outputs", async () => {
    const store = new RoutineStore(root);
    await store.initialize();
    const state = await store.save({
      name: "Payments",
      steps: [
        { id: "s1", botId: "asha", instruction: "Write the payments report" },
        {
          id: "s2",
          kind: "condition",
          botId: "asha",
          instruction: "Is any payment late?",
          onNo: { action: "jump", stepId: "s4" },
        },
        { id: "s3", kind: "approval", botId: "", instruction: "Send reminders?" },
        { id: "s4", kind: "output", botId: "", instruction: "", output: { kind: "telegram" } },
      ],
      cadence: null,
      enabled: true,
    });
    const routine = state.routines[0];
    if (!routine) throw new Error("no routine");
    const bots = [{ id: "asha", name: "Asha", role: "Accounts" }] as BotSummary[];
    const doc = routineWorkflow(routine, state, bots);
    expect(doc.coworkers.map((coworker) => coworker.name)).toEqual(["Asha"]);
    expect(doc.steps[1]).toMatchObject({ kind: "condition", by: "Asha", ifNoSkipTo: 4 });
    expect(doc.steps[3]).toMatchObject({ kind: "output", by: "", sendTo: "telegram" });

    const imported = parseWorkflowJson(JSON.stringify(doc));
    const input = routineFromWorkflow(imported, { Asha: "asha" }, bots);
    const steps = input.steps;
    expect(steps.map((step) => step.kind ?? "agent")).toEqual([
      "agent",
      "condition",
      "approval",
      "output",
    ]);
    expect(steps[1]?.onNo).toEqual({ action: "jump", stepId: steps[3]?.id });
    // The imported routine saves and is valid as it is.
    await expect(store.save(input)).resolves.toBeTruthy();
  });

  it("reads workflow files from before 0.31 as plain coworker steps", () => {
    const doc = parseWorkflowJson(
      JSON.stringify({
        format: "sahkarmi.workflow/v1",
        name: "Old",
        steps: [{ by: "Asha", do: "Write" }],
      }),
    );
    expect(doc.steps).toEqual([{ by: "Asha", do: "Write" }]);
  });
});
