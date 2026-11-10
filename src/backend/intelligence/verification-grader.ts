import type { OrchestratorVerificationEvidence } from "../../shared/ipc";
import { parseTestSummary, replySignals } from "./error-signature";
import type { VerificationGrade } from "./intelligence-db";

/**
 * Grades finished work as verified, partially verified, failed or inconclusive.
 *
 * Only evidence Sahkarmi produced itself is TRUSTED: files it found on disk, the owner's check
 * command it ran, a reviewer's verdict, tool calls whose results it saw fail. What a coworker
 * writes in its reply is a CLAIM: it can lower a grade (an admitted failure, an exception) but
 * never raise one. With nothing trusted either way, the grade is "inconclusive" — never
 * "verified" because the coworker said so.
 */

export interface GradeInput {
  /** How the turn ended. */
  status: "succeeded" | "failed" | "interrupted" | "cancelled";
  reply: string | null;
  /** Evidence from VerificationRepairEngine / the team-run engine (trusted). */
  evidence: readonly OrchestratorVerificationEvidence[];
  toolCalls: number;
  toolErrors: number;
  /** "Done means" lines of a team-run task, if any. */
  acceptanceCriteria?: readonly string[];
}

export interface GradeResult {
  grade: VerificationGrade;
  reasons: string[];
  trustedPassed: number;
  trustedFailed: number;
  /** Negative signals from the reply or tools (lower a grade, never raise it). */
  warnings: number;
  /** Share of acceptance criteria whose key words appear in the reply (a claim, shown only). */
  criteriaCoverage: number | null;
}

const STOP_WORDS = new Set(
  "the a an and or of to in on for with by is are be been it its this that these those all any no not as at from into must should will can done means each every".split(
    " ",
  ),
);

function keyWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
    (word) => !STOP_WORDS.has(word),
  );
}

export function criteriaCoverage(criteria: readonly string[], reply: string | null): number | null {
  if (!criteria.length) return null;
  const replyWords = new Set(keyWords(reply ?? ""));
  let covered = 0;
  for (const criterion of criteria) {
    const words = keyWords(criterion);
    if (!words.length) continue;
    const hits = words.filter((word) => replyWords.has(word)).length;
    if (hits / words.length >= 0.5) covered += 1;
  }
  return Math.round((covered / criteria.length) * 1000) / 1000;
}

export function gradeVerification(input: GradeInput): GradeResult {
  const reasons: string[] = [];
  let trustedPassed = 0;
  let trustedFailed = 0;
  let warnings = 0;

  for (const item of input.evidence) {
    const verdict = item.verdict ?? (item.passed ? "passed" : "failed");
    if (verdict === "passed") {
      trustedPassed += 1;
      reasons.push(`✓ ${item.type}: ${item.summary}`);
    } else if (verdict === "failed") {
      trustedFailed += 1;
      reasons.push(`✗ ${item.type}: ${item.summary}`);
    } else {
      reasons.push(`? ${item.type}: ${item.summary}`);
    }
    // A check command's own output (trusted, Sahkarmi ran it).
    if (item.type === "check" || item.type === "test") {
      const tests = parseTestSummary(item.output);
      if (tests) {
        if (tests.failed > 0) {
          trustedFailed += verdict === "failed" ? 0 : 1;
          reasons.push(`✗ tests: ${tests.failed} failed, ${tests.passed} passed (${tests.format})`);
        } else if (tests.passed > 0) {
          reasons.push(`✓ tests: ${tests.passed} passed (${tests.format})`);
        }
      }
    }
  }

  if (input.toolErrors > 0) {
    warnings += 1;
    reasons.push(
      `! ${input.toolErrors} of ${input.toolCalls} tool call${input.toolCalls === 1 ? "" : "s"} failed during the work`,
    );
  }
  const signals = replySignals(input.reply);
  if (signals.failurePhrases.length) {
    warnings += 1;
    reasons.push(`! the reply admits a problem (${signals.failurePhrases.join(", ")})`);
  }
  if (signals.exceptions.length) {
    warnings += 1;
    reasons.push(`! the reply shows an error (${signals.exceptions.join(", ")})`);
  }
  const claimedTests = parseTestSummary(input.reply);
  if (claimedTests && claimedTests.failed > 0) {
    warnings += 1;
    reasons.push(`! the reply reports ${claimedTests.failed} failing test(s) (its claim)`);
  } else if (claimedTests && claimedTests.passed > 0) {
    reasons.push(`· the reply says ${claimedTests.passed} tests passed (its claim, not checked)`);
  }
  const coverage = criteriaCoverage(input.acceptanceCriteria ?? [], input.reply);
  if (coverage !== null) {
    reasons.push(
      `· the reply mentions ${Math.round(coverage * 100)}% of the "done means" points (its claim)`,
    );
    if (coverage < 0.5) warnings += 1;
  }

  let grade: VerificationGrade;
  if (input.status === "failed") {
    grade = "failed";
    reasons.unshift("✗ the turn ended with an error");
  } else if (!input.reply?.trim() && input.status === "succeeded" && trustedPassed === 0) {
    grade = "failed";
    reasons.unshift("✗ no reply");
  } else if (trustedFailed > 0) {
    grade = trustedPassed > 0 ? "partial" : "failed";
  } else if (trustedPassed > 0) {
    grade = warnings > 0 ? "partial" : "verified";
  } else if (signals.failurePhrases.length > 0 && input.toolErrors > 0) {
    // Nothing trusted passed, the coworker admits failure and tools failed: believe the bad news.
    grade = "failed";
  } else {
    grade = "inconclusive";
    reasons.push("· nothing outside the coworker's own word could be checked");
  }
  return {
    grade,
    reasons: reasons.slice(0, 12),
    trustedPassed,
    trustedFailed,
    warnings,
    criteriaCoverage: coverage,
  };
}
