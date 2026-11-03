import { describe, expect, it } from "vitest";
import type { TurnPlan } from "../shared/ipc";
import {
  asksToContinue,
  continuationNote,
  decideContinuation,
  endsOnUndoneStep,
  MAX_NEXT_STEP_CONTINUATIONS,
  MAX_PLAN_CONTINUATIONS,
} from "./turn-continuation";

const plan = (turnId: string, ...steps: Array<[string, "pending" | "completed"]>): TurnPlan => ({
  turnId,
  explanation: null,
  steps: steps.map(([text, status]) => ({ text, status })),
});

describe("asking whether to go on", () => {
  it("recognises a plain continue question", () => {
    expect(asksToContinue("Step one is done. Shall I continue?")).toBe(true);
    expect(asksToContinue("Step one is done.\nWant me to continue with the next step?")).toBe(true);
  });

  it("stops on approval questions and real questions", () => {
    expect(asksToContinue("Proceed?")).toBe(false);
    expect(asksToContinue("Should I go ahead?")).toBe(false);
    expect(asksToContinue("Should I continue with the deploy?")).toBe(false);
    expect(asksToContinue("Which file do you mean? Shall I continue?")).toBe(false);
  });
});

describe("a short answer that ends on its next step", () => {
  it("continues when the step was not done", () => {
    expect(endsOnUndoneStep("The fix is written. I'll now run the tests.")).toBe(true);
    expect(endsOnUndoneStep("Next, I'll update the invoice sheet.")).toBe(true);
  });

  it("stops when the answer waits or advises, or is long", () => {
    expect(endsOnUndoneStep("I'll now wait for your approval.")).toBe(false);
    expect(endsOnUndoneStep("Next, I would restart the service.")).toBe(false);
    expect(endsOnUndoneStep(`${"Report line. ".repeat(40)}I'll now run the tests.`)).toBe(false);
    expect(endsOnUndoneStep("All done. The invoice is in Shared.")).toBe(false);
  });
});

describe("the decision", () => {
  it("continues a plan with open steps up to the limit, and stops when nothing moves", () => {
    const open = plan("t1", ["Write the fix", "completed"], ["Run the tests", "pending"]);
    const first = decideContinuation({
      finalText: "Done with step one.",
      plan: open,
      turnId: "t1",
      previous: null,
    });
    expect(first).toEqual({ kind: "plan", openSteps: "Run the tests" });
    expect(
      decideContinuation({
        finalText: "Done with step one.",
        plan: open,
        turnId: "t1",
        previous: { count: 1, openSteps: "Run the tests" },
      }),
    ).toBeNull();
    expect(
      decideContinuation({
        finalText: "Done.",
        plan: open,
        turnId: "t1",
        previous: { count: MAX_PLAN_CONTINUATIONS, openSteps: "Other" },
      }),
    ).toBeNull();
  });

  it("ignores a plan from an earlier turn", () => {
    expect(
      decideContinuation({
        finalText: "All good.",
        plan: plan("old", ["Pending", "pending"]),
        turnId: "t2",
        previous: null,
      }),
    ).toBeNull();
  });

  it("continues a no-plan answer at most twice per request", () => {
    expect(
      decideContinuation({
        finalText: "Shall I continue?",
        plan: undefined,
        turnId: "t",
        previous: null,
      }),
    ).toEqual({ kind: "next-step" });
    expect(
      decideContinuation({
        finalText: "I'll now run the tests.",
        plan: undefined,
        turnId: "t",
        previous: { count: MAX_NEXT_STEP_CONTINUATIONS, openSteps: null },
      }),
    ).toBeNull();
  });

  it("never continues past an approval question, even with open plan steps", () => {
    expect(
      decideContinuation({
        finalText: "The build is ready. Should I proceed with the deploy?",
        plan: plan("t", ["Deploy", "pending"]),
        turnId: "t",
        previous: null,
      }),
    ).toBeNull();
  });

  it("writes a note that approves nothing", () => {
    const note = continuationNote({ kind: "plan", openSteps: "Run the tests\nShip it" }, 2);
    expect(note.startsWith("[Continue] ")).toBe(true);
    expect(note).toContain("- Run the tests");
    expect(note).toContain(`continuation 2 of ${MAX_PLAN_CONTINUATIONS}`);
    expect(note).toContain("approves nothing");
  });
});
