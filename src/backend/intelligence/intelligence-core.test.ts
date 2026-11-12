// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { OrchestratorTask } from "../../shared/ipc";
import {
  type Candidate,
  chooseRoute,
  chooseRouteWithTrials,
  MIN_SAMPLES_TO_SWITCH,
  rankCandidates,
} from "./decision-engine";
import { errorSignature, parseTestSummary, replySignals } from "./error-signature";
import { cleanExperienceText, ExperienceMemory, ftsQuery } from "./experience-memory";
import { IntelligenceDb, type OutcomeRow } from "./intelligence-db";
import {
  emptyLogistic,
  learnLogistic,
  logisticQuality,
  MIN_UPDATES_FOR_USE,
  predictLogistic,
  restoreLogistic,
} from "./online-logistic";
import { labelOf, labelValue } from "./outcome-label";
import { analyzePlan } from "./plan-analyzer";
import {
  bottlenecks,
  errorPatterns,
  predictDuration,
  predictFailure,
  predictionAccuracy,
  predictOverload,
} from "./predictor";
import { ResourceMeter } from "./resource-meter";
import { betaPosterior, decayWeight, quantile, sampleBeta, seededRandom } from "./stats";
import { classifyTask } from "./task-classifier";
import { gradeVerification } from "./verification-grader";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const DAY = 86_400_000;
let seq = 0;

function outcome(fields: Partial<OutcomeRow> = {}): OutcomeRow {
  seq += 1;
  return {
    id: `out-${seq}`,
    workspaceId: "ws-a",
    botId: "dev",
    provider: "codex",
    model: null,
    category: "code",
    origin: "chat",
    sourceKey: `src-${seq}`,
    runId: null,
    taskId: null,
    deliveryId: null,
    startedAt: NOW - DAY,
    endedAt: NOW - DAY + 60_000,
    durationMs: 60_000,
    status: "succeeded",
    verification: "verified",
    verificationReasons: [],
    toolCalls: 2,
    toolErrors: 0,
    errorSignature: null,
    promptChars: 100,
    tokens: null,
    costUsd: null,
    predictedFailure: null,
    predictedDurationMs: null,
    predictionSource: null,
    features: null,
    feedback: null,
    feedbackNote: null,
    excluded: false,
    summary: "work",
    learned: false,
    ...fields,
  };
}

/** n outcomes for one coworker, `good` of them verified and the rest failed. */
function record(botId: string, good: number, bad: number, extra: Partial<OutcomeRow> = {}) {
  return [
    ...Array.from({ length: good }, (_, i) =>
      outcome({ botId, startedAt: NOW - (i + 1) * 3_600_000, ...extra }),
    ),
    ...Array.from({ length: bad }, (_, i) =>
      outcome({
        botId,
        status: "failed",
        verification: "failed",
        startedAt: NOW - (i + 1) * 3_700_000,
        ...extra,
      }),
    ),
  ];
}

function candidate(botId: string, fields: Partial<Candidate> = {}): Candidate {
  return {
    botId,
    botName: botId,
    provider: "codex",
    model: null,
    queued: 0,
    busy: false,
    available: true,
    ...fields,
  };
}

describe("stats", () => {
  it("shrinks small samples towards the prior and narrows with evidence", () => {
    const few = betaPosterior(2, 0, 0.5, 2);
    const many = betaPosterior(40, 0, 0.5, 2);
    expect(few.mean).toBeCloseTo(0.75, 5);
    expect(few.mean).toBeLessThan(many.mean);
    expect(many.upper - many.lower).toBeLessThan(few.upper - few.lower);
    expect(few.lower).toBeGreaterThanOrEqual(0);
    expect(many.upper).toBeLessThanOrEqual(1);
    expect(betaPosterior(Number.NaN, -3).evidence).toBe(0);
  });

  it("decays old evidence by half-life and computes quantiles", () => {
    expect(decayWeight(0, 10)).toBe(1);
    expect(decayWeight(10, 10)).toBeCloseTo(0.5, 10);
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([5, 1, 3], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.9)).toBeCloseTo(3.7, 5);
  });

  it("samples Beta values that are seeded, in range and centred right", () => {
    const random = seededRandom(42);
    const draws = Array.from({ length: 4000 }, () => sampleBeta(8, 2, random));
    expect(draws.every((value) => value >= 0 && value <= 1)).toBe(true);
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    expect(mean).toBeGreaterThan(0.77);
    expect(mean).toBeLessThan(0.83);
    const again = seededRandom(42);
    expect(sampleBeta(8, 2, again)).toBe(sampleBeta(8, 2, seededRandom(42)));
  });
});

describe("task classifier", () => {
  it("names the kind of work from its words", () => {
    expect(classifyTask("Fix the failing unit tests for the invoice export").category).toBe(
      "testing",
    );
    expect(
      classifyTask("Refactor the TypeScript function and fix the compile error").category,
    ).toBe("code");
    expect(classifyTask("Write a blog post and an email newsletter draft").category).toBe(
      "writing",
    );
    expect(
      classifyTask("Clean up the CSV and build a pivot table in the spreadsheet").category,
    ).toBe("data");
  });

  it("says 'general' rather than guess from one weak word", () => {
    const result = classifyTask("hello there");
    expect(result.category).toBe("general");
    expect(result.confidence).toBe(0);
  });

  it("uses the team-run role as strong evidence", () => {
    expect(classifyTask("Look at it", "qa").category).toBe("testing");
  });

  it("copes with huge and non-English text", () => {
    expect(() => classifyTask("x".repeat(200_000))).not.toThrow();
    expect(classifyTask("बिल ठीक करो").category).toBe("general");
  });
});

describe("error signatures", () => {
  it("gives the same signature to the same error with different numbers, paths and ids", () => {
    const a = errorSignature(
      "Error: ENOENT: no such file C:\\Users\\a\\proj\\src\\x.ts at line 42 (id 3f2a9b1c-1111-2222-3333-444455556666)\n    at foo (x.ts:1:2)",
    );
    const b = errorSignature(
      "Error: ENOENT: no such file /home/b/other/y.ts at line 7 (id 0a0b0c0d-aaaa-bbbb-cccc-ddddeeeeffff)\n    at bar (y.ts:9:9)",
    );
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(errorSignature("   ")).toBeNull();
    expect((errorSignature("e".repeat(5000)) ?? "").length).toBeLessThanOrEqual(160);
  });

  it("reads test summaries from common runners", () => {
    expect(parseTestSummary("Tests  2 failed | 24 passed (26)")).toMatchObject({
      passed: 24,
      failed: 2,
    });
    expect(parseTestSummary("===== 3 failed, 10 passed in 1.2s =====")).toMatchObject({
      passed: 10,
      failed: 3,
    });
    expect(parseTestSummary("Tests: 1 failed, 5 passed, 6 total")).toMatchObject({
      passed: 5,
      failed: 1,
    });
    expect(parseTestSummary("all good")).toBeNull();
  });

  it("notices admissions and errors in a reply", () => {
    const signals = replySignals("I could not finish it.\nTypeError: x is undefined");
    expect(signals.failurePhrases).toContain("could not");
    expect(signals.exceptions.length).toBeGreaterThan(0);
    expect(replySignals("All done, tests pass.").failurePhrases).toHaveLength(0);
  });
});

describe("outcome labels", () => {
  it("weights evidence: owner > outside checks > the coworker's word; excluded teaches nothing", () => {
    expect(labelOf(outcome({ feedback: "good", verification: "failed" }))?.successes).toBe(1.5);
    expect(labelOf(outcome({ feedback: "bad" }))?.failures).toBe(1.5);
    expect(labelValue(labelOf(outcome({ verification: "partial" })))).toBe(0.5);
    expect(labelOf(outcome({ verification: "inconclusive" }))).toMatchObject({
      successes: 0.5,
      failures: 0,
    });
    expect(labelOf(outcome({ excluded: true }))).toBeNull();
    expect(labelOf(outcome({ status: "interrupted", verification: null }))).toBeNull();
    expect(labelOf(outcome({ status: "running", verification: null }))).toBeNull();
    expect(labelOf(outcome({ status: "failed", verification: null }))?.failed).toBe(true);
  });
});

describe("online failure model", () => {
  it("scores each prediction before learning from it, and admits when it is no better", () => {
    // Pure coin flips: nothing to learn, so it must not claim to beat the plain rate.
    const random = seededRandom(7);
    let state = emptyLogistic();
    for (let i = 0; i < 400; i += 1) {
      state = learnLogistic(state, { noise: random() }, random() < 0.5);
    }
    const quality = logisticQuality(state);
    expect(quality.updates).toBe(400);
    expect(quality.useful).toBe(false);
  });

  it("becomes useful only with enough examples and a real signal", () => {
    const random = seededRandom(11);
    let state = emptyLogistic(0.2);
    for (let i = 0; i < MIN_UPDATES_FOR_USE - 1; i += 1) {
      const risky = random() < 0.5 ? 1 : 0;
      state = learnLogistic(state, { risky }, risky === 1 ? random() < 0.9 : random() < 0.1);
    }
    expect(logisticQuality(state).useful).toBe(false);
    for (let i = 0; i < 600; i += 1) {
      const risky = random() < 0.5 ? 1 : 0;
      state = learnLogistic(state, { risky }, risky === 1 ? random() < 0.9 : random() < 0.1);
    }
    const quality = logisticQuality(state);
    expect(quality.useful).toBe(true);
    expect(quality.brier ?? 1).toBeLessThan(quality.baselineBrier ?? 0);
    expect(predictLogistic(state, { risky: 1 })).toBeGreaterThan(0.6);
    expect(predictLogistic(state, { risky: 0 })).toBeLessThan(0.4);
  });

  it("refuses corrupt saved state", () => {
    expect(restoreLogistic({ version: 99, weights: "x" }).updates).toBe(0);
    expect(restoreLogistic(null).updates).toBe(0);
    const saved = learnLogistic(emptyLogistic(), { a: 1 }, true);
    expect(restoreLogistic(JSON.parse(JSON.stringify(saved))).updates).toBe(1);
  });
});

describe("decision engine", () => {
  it("keeps the usual coworker when the evidence is thin", () => {
    const history = [...record("dev", 2, 1), ...record("tara", 3, 0)];
    const ranking = rankCandidates(history, [candidate("dev"), candidate("tara")], "code", {
      now: NOW,
    });
    const choice = chooseRoute(ranking, "dev");
    expect(choice.chosenBotId).toBe("dev");
    expect(choice.switchFromDefault).toBe(false);
    expect(choice.explanation).toMatch(/not strong enough|keeps it/);
  });

  it("switches only with enough evidence and a clear margin, and explains with numbers", () => {
    const history = [...record("dev", 3, 9), ...record("tara", 14, 1)];
    const ranking = rankCandidates(history, [candidate("dev"), candidate("tara")], "code", {
      now: NOW,
    });
    const choice = chooseRoute(ranking, "dev");
    expect(choice.chosenBotId).toBe("tara");
    expect(choice.switchFromDefault).toBe(true);
    expect(ranking.best?.samples).toBeGreaterThanOrEqual(MIN_SAMPLES_TO_SWITCH);
    expect(choice.explanation).toMatch(/clearly better at code work/);
    expect(choice.explanation).toMatch(/%/);
  });

  it("never uses another workspace's or another kind of work's record as this one's", () => {
    const history = record("tara", 20, 0, { category: "writing" });
    const ranking = rankCandidates(history, [candidate("dev"), candidate("tara")], "code", {
      now: NOW,
    });
    const tara = ranking.candidates.find((item) => item.botId === "tara");
    expect(tara?.samples).toBe(0);
    expect(chooseRoute(ranking, "dev").chosenBotId).toBe("dev");
  });

  it("replaces an unavailable default and says why", () => {
    const ranking = rankCandidates(
      record("tara", 6, 0),
      [candidate("dev", { available: false, unavailableReason: "removed" }), candidate("tara")],
      "code",
      { now: NOW },
    );
    const choice = chooseRoute(ranking, "dev");
    expect(choice.chosenBotId).toBe("tara");
    expect(choice.explanation).toMatch(/cannot take work \(removed\)/);
  });

  it("answers a plain question honestly when nobody has a record", () => {
    const none = chooseRoute(
      rankCandidates([], [candidate("dev"), candidate("tara")], "code", { now: NOW }),
      null,
    );
    expect(none.confidence).toBe("none");
    expect(none.switchFromDefault).toBe(false);
    expect(none.explanation).toMatch(/^No coworker has a record on code work here yet/);
    const some = chooseRoute(
      rankCandidates(record("tara", 9, 1), [candidate("dev"), candidate("tara")], "code", {
        now: NOW,
      }),
      null,
    );
    expect(some.chosenBotId).toBe("tara");
    expect(some.explanation).toMatch(/^tara has the best record on code work here/);
  });

  it("returns no pick when nobody can work", () => {
    const ranking = rankCandidates([], [candidate("dev", { available: false })], "code", {
      now: NOW,
    });
    expect(chooseRoute(ranking, "dev").chosenBotId).toBeNull();
  });

  it("does not switch to a far better coworker that is buried in a long queue", () => {
    const history = [...record("dev", 3, 9), ...record("tara", 14, 1)];
    const ranking = rankCandidates(
      history,
      [candidate("dev"), candidate("tara", { queued: 30, busy: true })],
      "code",
      { now: NOW },
    );
    expect(chooseRoute(ranking, "dev").chosenBotId).toBe("dev");
  });
});

describe("trials for a weak usual coworker", () => {
  const all = () => [candidate("dev"), candidate("tara"), candidate("priya")];

  it("never disturbs a usual coworker with a good record", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const choice = chooseRouteWithTrials(record("dev", 9, 1), all(), "code", "dev", {
        now: NOW,
        random: seededRandom(seed),
      });
      expect(choice.chosenBotId).toBe("dev");
      expect(choice.trial).toBeFalsy();
    }
  });

  it("does not judge a usual coworker on too few tasks", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const choice = chooseRouteWithTrials(
        record("dev", 0, MIN_SAMPLES_TO_SWITCH - 1),
        all(),
        "code",
        "dev",
        {
          now: NOW,
          random: seededRandom(seed),
        },
      );
      expect(choice.chosenBotId).toBe("dev");
    }
  });

  it("shares a weak usual coworker's work with others, says it is a trial, and stays seeded", () => {
    const picks = new Map<string, number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const choice = chooseRouteWithTrials(record("dev", 2, 8), all(), "code", "dev", {
        now: NOW,
        random: seededRandom(seed),
      });
      picks.set(choice.chosenBotId ?? "none", (picks.get(choice.chosenBotId ?? "none") ?? 0) + 1);
      if (choice.trial) {
        expect(choice.explanation).toMatch(/^Trying /);
        expect(choice.confidence).toBe("low");
      }
    }
    expect((picks.get("tara") ?? 0) + (picks.get("priya") ?? 0)).toBeGreaterThan(100);
    const again = chooseRouteWithTrials(record("dev", 2, 8), all(), "code", "dev", {
      now: NOW,
      random: seededRandom(3),
    });
    const same = chooseRouteWithTrials(record("dev", 2, 8), all(), "code", "dev", {
      now: NOW,
      random: seededRandom(3),
    });
    expect(again.chosenBotId).toBe(same.chosenBotId);
  });

  it("needs a real gap to switch for good, not a lucky streak", () => {
    // 5 of 5 against 13 of 20 looks big but is not significant (p ~ 0.12): keep the usual one.
    const history = [...record("dev", 13, 7), ...record("tara", 5, 0)];
    const ranking = rankCandidates(history, all(), "code", { now: NOW });
    expect(chooseRoute(ranking, "dev").chosenBotId).toBe("dev");
  });
});

describe("predictor", () => {
  const context = {
    botId: "dev",
    provider: "codex",
    category: "code" as const,
    origin: "chat",
    promptChars: 100,
    queued: 0,
    memoryPressure: "ok" as const,
    now: NOW,
  };

  it("labels a rule-based number as an estimate and shows its parts", () => {
    const prediction = predictFailure([], { ...context, memoryPressure: "critical" }, null);
    expect(prediction.source).toBe("estimate");
    expect(prediction.basis).toMatch(/^Estimate/);
    expect(prediction.basis).toMatch(/memory critical/);
    expect(prediction.probability).toBeGreaterThan(0.2);
  });

  it("uses measured history once there is enough", () => {
    const prediction = predictFailure(record("dev", 1, 5), context, null);
    expect(prediction.source).toBe("history");
    expect(prediction.probability).toBeGreaterThan(0.5);
  });

  it("does not use a model that has not proved itself", () => {
    const untrained = learnLogistic(emptyLogistic(), { noHistory: 1 }, true);
    expect(predictFailure([], context, untrained).source).toBe("estimate");
  });

  it("predicts durations from history, else labelled estimates", () => {
    expect(predictDuration([], "dev", "code").source).toBe("estimate");
    const measured = predictDuration(
      [60_000, 120_000, 180_000].map((durationMs) => outcome({ durationMs })),
      "dev",
      "code",
    );
    expect(measured.source).toBe("history");
    expect(measured.medianMs).toBe(120_000);
  });

  it("flags overload, repeated errors and bottlenecks", () => {
    const history = [
      ...record("dev", 3, 0, { durationMs: 20 * 60_000 }),
      ...Array.from({ length: 3 }, () =>
        outcome({
          status: "failed",
          verification: "failed",
          errorSignature: "build failed: missing module <path>",
        }),
      ),
    ];
    const overload = predictOverload(history, [
      { botId: "dev", botName: "Dev", queued: 6, busy: true },
      { botId: "tara", botName: "Tara", queued: 0, busy: false },
    ]);
    expect(overload.find((row) => row.botId === "dev")?.overloaded).toBe(true);
    expect(overload.find((row) => row.botId === "tara")?.overloaded).toBe(false);
    const patterns = errorPatterns(history, NOW);
    expect(patterns[0]).toMatchObject({ count: 3, repeated: true });
    expect(Array.isArray(bottlenecks(history, NOW))).toBe(true);
  });

  it("scores past predictions against what really happened", () => {
    const history = [
      outcome({
        predictedFailure: 0.9,
        predictionSource: "estimate",
        status: "failed",
        verification: "failed",
      }),
      outcome({ predictedFailure: 0.1, predictionSource: "estimate" }),
      outcome({ predictedFailure: 0.2, predictionSource: "history", predictedDurationMs: 30_000 }),
    ];
    const accuracy = predictionAccuracy(history);
    expect(accuracy.scored).toBe(3);
    expect(accuracy.brier).not.toBeNull();
    expect(accuracy.bySource.map((row) => row.source).sort()).toEqual(["estimate", "history"]);
    expect(accuracy.durationScored).toBe(1);
  });
});

function task(id: string, fields: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id,
    runId: "run-1",
    title: id,
    description: "",
    role: "code",
    assignedBotId: "dev",
    assignedInstanceId: null,
    dependencies: [],
    inputs: {},
    deliverables: [],
    acceptanceCriteria: [],
    status: "pending",
    attemptCount: 0,
    maxAttempts: 3,
    error: null,
    evidence: [],
    createdAt: "",
    updatedAt: "",
    ...fields,
  };
}

const flat = () => ({
  durationMs: 60_000,
  durationSource: "estimate" as const,
  failureRisk: 0.1,
  riskSource: "estimate" as const,
});

describe("plan analyser", () => {
  it("finds layers and the critical path", () => {
    const run = {
      id: "run-1",
      instances: [],
      tasks: [
        task("a"),
        task("b", { dependencies: ["a"], assignedBotId: "tara" }),
        task("c", { dependencies: ["a"], assignedBotId: "priya" }),
        task("d", { dependencies: ["b", "c"] }),
      ],
    };
    const plan = analyzePlan(run, (item) =>
      item.id === "c" ? { ...flat(), durationMs: 300_000 } : flat(),
    );
    expect(plan.valid).toBe(true);
    expect(plan.layers).toEqual([["a"], ["b", "c"], ["d"]]);
    expect(plan.maxParallel).toBe(2);
    expect(plan.criticalPath).toEqual(["a", "c", "d"]);
    expect(plan.predictedRemainingMs).toBe(420_000);
    expect(plan.tasks.find((item) => item.id === "b")?.slackMs).toBe(240_000);
    expect(plan.successChance).toBeCloseTo(0.9 ** 4, 3);
  });

  it("reports cycles, missing steps, shared files, a busy coworker, blocked and risky tasks", () => {
    const run = {
      id: "run-2",
      instances: [],
      tasks: [
        task("loop1", { dependencies: ["loop2"] }),
        task("loop2", { dependencies: ["loop1"] }),
        task("ghost", { dependencies: ["nope"] }),
        task("w1", { deliverables: [{ name: "x", path: "src/App.tsx" }] }),
        task("w2", { deliverables: [{ name: "y", path: "SRC\\app.tsx" }] }),
        task("broken", { status: "failed", assignedBotId: "tara" }),
        task("after", { dependencies: ["broken"], assignedBotId: "priya" }),
      ],
    };
    const plan = analyzePlan(run, (item) =>
      item.id === "w1" ? { ...flat(), failureRisk: 0.7, riskSource: "history" } : flat(),
    );
    const kinds = new Set(plan.issues.map((issue) => issue.kind));
    expect(plan.valid).toBe(false);
    for (const kind of [
      "cycle",
      "missing-dependency",
      "same-file",
      "same-coworker-parallel",
      "blocked",
      "high-risk",
    ]) {
      expect(kinds.has(kind as never)).toBe(true);
    }
    expect(plan.issues.find((issue) => issue.kind === "cycle")?.taskIds.sort()).toEqual([
      "loop1",
      "loop2",
    ]);
  });

  it("counts finished work as done: no time, no risk", () => {
    const run = {
      id: "run-3",
      instances: [],
      tasks: [task("a", { status: "completed" }), task("b", { dependencies: ["a"] })],
    };
    const plan = analyzePlan(run, flat);
    expect(plan.predictedRemainingMs).toBe(60_000);
    expect(plan.successChance).toBeCloseTo(0.9, 5);
  });
});

describe("verification grading", () => {
  const evidence = (passed: boolean, type: "files" | "check" = "files", output?: string) => ({
    type,
    passed,
    verdict: passed ? ("passed" as const) : ("failed" as const),
    summary: passed ? "found" : "missing",
    output,
    timestamp: "",
  });

  it("never lets the coworker's own claims raise a grade", () => {
    const result = gradeVerification({
      status: "succeeded",
      reply: "Everything is verified and complete.\nTests  50 passed (50)",
      evidence: [],
      toolCalls: 0,
      toolErrors: 0,
    });
    expect(result.grade).toBe("inconclusive");
    expect(result.reasons.join("\n")).toMatch(/its claim, not checked/);
  });

  it("verifies on outside evidence and lowers to partial on warnings", () => {
    expect(
      gradeVerification({
        status: "succeeded",
        reply: "Wrote report.md",
        evidence: [evidence(true)],
        toolCalls: 2,
        toolErrors: 0,
      }).grade,
    ).toBe("verified");
    expect(
      gradeVerification({
        status: "succeeded",
        reply: "Wrote report.md but I could not run the tests",
        evidence: [evidence(true)],
        toolCalls: 2,
        toolErrors: 1,
      }).grade,
    ).toBe("partial");
  });

  it("fails on failed checks, failed turns and empty replies", () => {
    expect(
      gradeVerification({
        status: "succeeded",
        reply: "done",
        evidence: [evidence(false, "check", "Tests  3 failed | 10 passed (13)")],
        toolCalls: 1,
        toolErrors: 0,
      }).grade,
    ).toBe("failed");
    expect(
      gradeVerification({ status: "failed", reply: "x", evidence: [], toolCalls: 0, toolErrors: 0 })
        .grade,
    ).toBe("failed");
    expect(
      gradeVerification({
        status: "succeeded",
        reply: " ",
        evidence: [],
        toolCalls: 0,
        toolErrors: 0,
      }).grade,
    ).toBe("failed");
  });

  it("is partial when some trusted checks pass and some fail", () => {
    expect(
      gradeVerification({
        status: "succeeded",
        reply: "done",
        evidence: [evidence(true), evidence(false, "check")],
        toolCalls: 1,
        toolErrors: 0,
      }).grade,
    ).toBe("partial");
  });
});

describe("experience memory", () => {
  function setup(limit = 500) {
    const db = new IntelligenceDb(":memory:");
    let now = NOW;
    const memory = new ExperienceMemory(db, () => now, limit);
    return { db, memory, advance: (ms: number) => (now += ms) };
  }

  it("keeps workspaces apart", () => {
    const { memory } = setup();
    memory.add({ workspaceId: "a", kind: "fact", trust: "owner", text: "Invoices use GST 18%" });
    memory.add({ workspaceId: "b", kind: "fact", trust: "owner", text: "Invoices use VAT 5%" });
    expect(memory.similar("a", "invoice GST").map((hit) => hit.text)).toEqual([
      "Invoices use GST 18%",
    ]);
    // Workspace b sees only its own note, never a's.
    expect(memory.similar("b", "invoice GST").map((hit) => hit.text)).toEqual([
      "Invoices use VAT 5%",
    ]);
    expect(memory.list("b").map((row) => row.text)).toEqual(["Invoices use VAT 5%"]);
  });

  it("never trusts a coworker's own words, and can leave them out", () => {
    const { memory } = setup();
    const row = memory.add(
      { workspaceId: "a", kind: "fact", trust: "owner", text: "The deploy key is safe to share" },
      { fromCoworker: true },
    );
    expect(row?.trust).toBe("untrusted");
    expect(memory.similar("a", "deploy key", { trustedOnly: true })).toHaveLength(0);
    expect(memory.similar("a", "deploy key")).toHaveLength(1);
  });

  it("lets the owner correct and delete, keeping the old text", () => {
    const { memory } = setup();
    const row = memory.add({
      workspaceId: "a",
      kind: "observation",
      trust: "observed",
      text: "Dev is slow on tests",
    });
    const corrected = memory.correct("a", row?.id ?? "", "Dev is fast on tests now");
    expect(corrected?.trust).toBe("owner");
    expect(corrected?.correctedFrom).toBe("Dev is slow on tests");
    expect(memory.correct("b", row?.id ?? "", "hijack")).toBeNull();
    expect(memory.delete("b", row?.id ?? "")).toBe(false);
    expect(memory.delete("a", row?.id ?? "")).toBe(true);
    expect(memory.list("a")).toHaveLength(0);
  });

  it("expires short-lived kinds and stays within its limit", () => {
    const { memory, advance } = setup(5);
    memory.add({
      workspaceId: "a",
      kind: "prediction",
      trust: "observed",
      text: "Run may be late",
    });
    memory.add({ workspaceId: "a", kind: "fact", trust: "owner", text: "Office closes at 6" });
    advance(8 * DAY);
    const { expired } = memory.maintain();
    expect(expired).toBe(1);
    expect(memory.list("a").map((row) => row.kind)).toEqual(["fact"]);
    for (let i = 0; i < 20; i += 1) {
      memory.add({ workspaceId: "a", kind: "observation", trust: "observed", text: `note ${i}` });
    }
    const left = memory.list("a", { limit: 100 });
    expect(left).toHaveLength(5);
    // The owner's fact is kept first.
    expect(left.some((row) => row.text === "Office closes at 6")).toBe(true);
  });

  it("makes search text safe: no FTS syntax, no control characters, bounded length", () => {
    const { memory } = setup();
    memory.add({ workspaceId: "a", kind: "fact", trust: "owner", text: "alpha beta" });
    for (const nasty of [
      '" OR 1=1 --',
      "NEAR(alpha beta)",
      "alpha* AND ^beta",
      "{col}:alpha",
      ")(",
    ]) {
      expect(() => memory.similar("a", nasty)).not.toThrow();
    }
    // Quotes and operators never reach FTS5; words under three letters are dropped.
    expect(ftsQuery('alpha" OR "beta')).toBe('"alpha" OR "beta"');
    expect(cleanExperienceText("a\u0000b\u001bc\n\nd")).toBe("a b c d");
    expect(cleanExperienceText("x".repeat(1000)).length).toBeLessThanOrEqual(400);
    expect(
      memory.add({ workspaceId: "a", kind: "fact", trust: "owner", text: " \u0000 " }),
    ).toBeNull();
  });
});

describe("intelligence database", () => {
  it("stores outcomes once per source and filters by workspace", () => {
    const db = new IntelligenceDb(":memory:");
    const first = outcome({ sourceKey: "turn:dev:1", workspaceId: "a" });
    expect(db.insertOutcome(first)).toBe(true);
    expect(db.insertOutcome({ ...first, id: "other" })).toBe(false);
    db.insertOutcome(outcome({ workspaceId: "b" }));
    expect(db.outcomes("a")).toHaveLength(1);
    expect(db.outcomes("b")).toHaveLength(1);
    db.updateOutcome(first.id, { feedback: "good", verificationReasons: ["✓ files"] });
    expect(db.outcome(first.id)).toMatchObject({
      feedback: "good",
      verificationReasons: ["✓ files"],
    });
    expect(db.deleteOutcomes("a")).toBe(1);
    expect(db.countOutcomes()).toBe(1);
    db.close();
  });

  it("keeps a few model snapshots and deletes one model by exact name", () => {
    const db = new IntelligenceDb(":memory:");
    for (let i = 1; i <= 8; i += 1) db.snapshotPolicy("failure:a", { i }, i * 25, NOW + i);
    expect(db.policySnapshots("failure:a")).toHaveLength(5);
    db.savePolicy("failure:a", { x: 1 }, NOW);
    db.savePolicy("failure:a_b", { x: 2 }, NOW);
    db.deletePolicy("failure:a");
    expect(db.policy("failure:a")).toBeNull();
    // A workspace whose id starts the same way keeps its model.
    expect(db.policy("failure:a_b")).toEqual({ x: 2 });
    db.close();
  });
});

describe("resource meter", () => {
  it("measures time and CPU per operation", async () => {
    const meter = new ResourceMeter();
    meter.measure("sync", () => {
      let total = 0;
      for (let i = 0; i < 100_000; i += 1) total += i;
      return total;
    });
    await meter.measureAsync("async", async () => new Promise((resolve) => setTimeout(resolve, 5)));
    const snapshot = meter.snapshot();
    expect(snapshot.totalOperations).toBe(2);
    expect(snapshot.operations.map((op) => op.name).sort()).toEqual(["async", "sync"]);
    expect(snapshot.heapUsedMb).toBeGreaterThan(0);
  });
});
