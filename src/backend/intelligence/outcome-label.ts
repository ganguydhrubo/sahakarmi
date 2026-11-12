import type { OutcomeRow } from "./intelligence-db";

/**
 * What one finished piece of work teaches, as weighted successes and failures.
 *
 * The coworker's own "done" is the weakest evidence: an inconclusive success counts half.
 * Outside evidence (files, the owner's check, a reviewer) counts fully, and the owner's own
 * 👍 / 👎 or correction counts most. Work the owner cancelled, work cut off by a restart, and
 * outcomes the owner excluded teach nothing.
 */
export interface OutcomeLabel {
  successes: number;
  failures: number;
  /** For the failure model: did it fail? */
  failed: boolean;
  /** Why this label, in a few words. */
  basis: string;
}

export function labelOf(
  outcome: Pick<OutcomeRow, "excluded" | "status" | "feedback" | "verification" | "errorSignature">,
): OutcomeLabel | null {
  if (outcome.excluded) return null;
  if (outcome.feedback === "good") {
    return { successes: 1.5, failures: 0, failed: false, basis: "owner marked it good" };
  }
  if (outcome.feedback === "bad") {
    return { successes: 0, failures: 1.5, failed: true, basis: "owner marked it bad" };
  }
  if (outcome.status === "running" || outcome.status === "cancelled") return null;
  if (outcome.status === "interrupted") {
    // Stopped by the owner or by a restart: not the coworker's result either way.
    return null;
  }
  switch (outcome.verification) {
    case "verified":
      return { successes: 1, failures: 0, failed: false, basis: "verified by outside evidence" };
    case "partial":
      return { successes: 0.5, failures: 0.5, failed: false, basis: "partly verified" };
    case "failed":
      return { successes: 0, failures: 1, failed: true, basis: "evidence shows it failed" };
    default:
      break;
  }
  if (outcome.status === "failed") {
    return { successes: 0, failures: 1, failed: true, basis: "the turn failed" };
  }
  // Finished, nothing outside the coworker's word could be checked.
  return { successes: 0.5, failures: 0, failed: false, basis: "finished, not verified" };
}

/** 1 for success, 0 for failure, fractions for mixed evidence; null when it teaches nothing. */
export function labelValue(label: OutcomeLabel | null): number | null {
  if (!label) return null;
  const total = label.successes + label.failures;
  return total > 0 ? label.successes / total : null;
}
