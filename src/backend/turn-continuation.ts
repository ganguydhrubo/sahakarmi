import type { TurnPlan } from "../shared/ipc";

/**
 * Decides whether a coworker that ended its turn stopped short of its next step, so the app can
 * tell it to carry on instead of the owner babysitting it. English phrases only; in other
 * languages only the plan rule applies.
 */

/** A plan with open steps continues this many times for one request. */
export const MAX_PLAN_CONTINUATIONS = 8;
/** An answer that only announces its next step continues this many times for one request. */
export const MAX_NEXT_STEP_CONTINUATIONS = 2;
/** Longer answers are a report, not a stop before a step. */
const SHORT_ANSWER_CHARS = 400;

/** What the app remembers about one request's continuations. */
export interface ContinuationState {
  count: number;
  /** The open plan steps at the last plan continuation; the same ones again means no progress. */
  openSteps: string | null;
}

export type ContinuationDecision = { kind: "plan"; openSteps: string } | { kind: "next-step" };

/** Words that make the last line a request for a decision, never a question of whether to go on. */
const APPROVAL_WORDS =
  /\b(proceed|go ahead|approv\w*|permission|confirm\w*|deploy\w*|delete|remove|pay|payment|publish\w*|send (it|them|the)|submit\w*|sign\w*|purchase|buy)\b/i;
/** The answer waits for the owner, or only advises. */
const WAITING_WORDS =
  /\b(wait\w*|would|could|let me know|once you|when you|if you|after you|tell me|your (call|decision|choice))\b/i;
const CONTINUE_QUESTION =
  /\b((shall|should|can|may)\s+i|(want|like|need)\s+me\s+to)\s+(continue|carry on|keep going|go on|move on|proceed to the next|do the next|start the next|continue with the next)\b/i;
const NEXT_STEP_START =
  /^(next,?\s*|now,?\s*|then,?\s*)?(i'?ll|i will|i am going to|i'm going to|let me|i can now|i am now going to|i'm now going to|moving on to|the next step is to)\b/i;

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>*#\-•]+/, "").trim())
    .filter(Boolean);
}

function sentences(line: string): string[] {
  return line
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** The last line only asks whether to go on, such as "Shall I continue?". */
export function asksToContinue(text: string): boolean {
  const last = lines(text).at(-1);
  if (!last?.endsWith("?")) return false;
  const parts = sentences(last);
  const question = parts.at(-1) ?? "";
  if (!CONTINUE_QUESTION.test(question) || APPROVAL_WORDS.test(question)) return false;
  // A real question before it ("Which file? Shall I continue?") still needs the owner.
  return !parts.slice(0, -1).some((part) => part.endsWith("?"));
}

/** A short answer that ends on a next step the coworker did not do, such as "I'll now run the tests." */
export function endsOnUndoneStep(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SHORT_ANSWER_CHARS) return false;
  const last = lines(trimmed).at(-1) ?? "";
  const sentence = sentences(last).at(-1) ?? "";
  if (!sentence || sentence.endsWith("?")) return false;
  if (!NEXT_STEP_START.test(sentence)) return false;
  return !WAITING_WORDS.test(sentence) && !APPROVAL_WORDS.test(sentence);
}

/** The steps of this turn's plan that are not finished. */
export function openPlanSteps(plan: TurnPlan | undefined, turnId: string): string[] {
  if (!plan || plan.turnId !== turnId) return [];
  return plan.steps
    .filter((step) => step.status !== "completed")
    .map((step) => step.text.trim())
    .filter(Boolean);
}

export function decideContinuation(input: {
  finalText: string;
  plan: TurnPlan | undefined;
  turnId: string;
  previous: ContinuationState | null;
}): ContinuationDecision | null {
  const count = input.previous?.count ?? 0;
  const lastLine = lines(input.finalText).at(-1) ?? "";
  // "Should I continue with the deploy?" and "I'll now wait for your approval." stop the work.
  const lastSentence = sentences(lastLine).at(-1) ?? "";
  if (APPROVAL_WORDS.test(lastSentence) && !asksToContinue(input.finalText)) return null;
  const open = openPlanSteps(input.plan, input.turnId);
  if (open.length > 0) {
    const openSteps = open.join("\n");
    if (input.previous?.openSteps === openSteps) return null;
    if (count >= MAX_PLAN_CONTINUATIONS) return null;
    return { kind: "plan", openSteps };
  }
  if (count >= MAX_NEXT_STEP_CONTINUATIONS) return null;
  if (asksToContinue(input.finalText) || endsOnUndoneStep(input.finalText)) {
    return { kind: "next-step" };
  }
  return null;
}

/** The message the app sends on the owner's behalf; it never approves a risky action. */
export function continuationNote(decision: ContinuationDecision, count: number): string {
  const limit = decision.kind === "plan" ? MAX_PLAN_CONTINUATIONS : MAX_NEXT_STEP_CONTINUATIONS;
  const why =
    decision.kind === "plan"
      ? `Your plan still has open steps:\n${decision.openSteps
          .split("\n")
          .slice(0, 8)
          .map((step) => `- ${step}`)
          .join("\n")}`
      : "You stopped before your next step.";
  return [
    `[Continue] ${why}`,
    `Carry on with the work now (continuation ${count} of ${limit}); do not ask whether to continue.`,
    "This note approves nothing: for anything that needs the owner's approval, ask through sahkarmi.request_approval as usual and stop.",
    "When everything is done, say so in a sentence.",
  ].join("\n");
}

export function isContinuationText(text: string): boolean {
  return text.startsWith("[Continue] ");
}
