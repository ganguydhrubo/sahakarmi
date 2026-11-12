// @vitest-environment node

/**
 * SIMULATION AND PERFORMANCE CHECKS. Nothing here is real coworker data.
 *
 * The routing simulation gives made-up coworkers hidden success rates per kind of work and
 * compares fixed routing (always the usual coworker) with the decision engine learning from
 * the outcomes it sees. The performance checks time the Intelligence Core's own work on this
 * machine with thousands of synthetic records. Set SAHKARMI_BENCH_OUT to a file path to save
 * the measured numbers as JSON.
 */

import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Candidate,
  chooseRoute,
  chooseRouteWithTrials,
  rankCandidates,
} from "./decision-engine";
import { errorSignature } from "./error-signature";
import { ExperienceMemory } from "./experience-memory";
import { IntelligenceDb, type OutcomeRow } from "./intelligence-db";
import { IntelligenceService } from "./intelligence-service";
import { emptyLogistic, learnLogistic } from "./online-logistic";
import { seededRandom } from "./stats";
import { classifyTask, type TaskCategory } from "./task-classifier";
import { gradeVerification } from "./verification-grader";

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const results: Record<string, unknown> = {};

function save(name: string, value: unknown): void {
  results[name] = value;
  const out = process.env.SAHKARMI_BENCH_OUT;
  if (out) writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`[simulation] ${name}: ${JSON.stringify(value)}`);
}

function row(
  id: number,
  botId: string,
  category: string,
  ok: boolean,
  at: number,
  durationMs = 120_000,
): OutcomeRow {
  return {
    id: `sim-${id}`,
    workspaceId: "sim",
    botId,
    provider: "sim",
    model: null,
    category,
    origin: "team-run",
    sourceKey: `sim:${id}`,
    runId: null,
    taskId: null,
    deliveryId: null,
    startedAt: at,
    endedAt: at + durationMs,
    durationMs,
    status: ok ? "succeeded" : "failed",
    verification: ok ? "verified" : "failed",
    verificationReasons: [],
    toolCalls: 1,
    toolErrors: ok ? 0 : 1,
    errorSignature: ok ? null : "simulated failure",
    promptChars: 200,
    tokens: null,
    costUsd: null,
    predictedFailure: null,
    predictedDurationMs: null,
    predictionSource: null,
    features: { bias: 1, [`category:${category}`]: 1, [`bot:${botId}`]: 1 },
    feedback: null,
    feedbackNote: null,
    excluded: false,
    summary: "simulated",
    learned: true,
  };
}

const BOTS = ["dev", "tara", "priya", "arjun"];
const CATEGORIES: TaskCategory[] = ["code", "testing", "writing", "data"];
const candidates: Candidate[] = BOTS.map((botId) => ({
  botId,
  botName: botId,
  provider: "sim",
  model: null,
  queued: 0,
  busy: false,
  available: true,
}));

/** Runs `tasks` simulated tasks; returns success counts for fixed and learned routing. */
function simulate(
  hidden: Record<string, Record<string, number>>,
  defaults: Record<string, string>,
  tasks: number,
  seed: number,
) {
  const random = seededRandom(seed);
  const history: OutcomeRow[] = [];
  let staticWins = 0;
  let learnedWins = 0;
  let switches = 0;
  let trials = 0;
  const window: number[] = [];
  let decisionMs = 0;
  for (let i = 0; i < tasks; i += 1) {
    const category = CATEGORIES[Math.floor(random() * CATEGORIES.length)] as TaskCategory;
    const at = NOW + i * 10 * 60_000;
    const usual = defaults[category] as string;
    // Fixed routing: the usual coworker, always.
    const staticOk = random() < (hidden[usual]?.[category] ?? 0);
    if (staticOk) staticWins += 1;
    // Learned routing: same rule the app uses (switch only on clear evidence).
    const started = performance.now();
    const choice = chooseRouteWithTrials(history, candidates, category, usual, {
      now: at,
      random,
    });
    if (choice.trial) trials += 1;
    decisionMs += performance.now() - started;
    const chosen = choice.chosenBotId ?? usual;
    if (chosen !== usual) switches += 1;
    const learnedOk = random() < (hidden[chosen]?.[category] ?? 0);
    if (learnedOk) learnedWins += 1;
    window.push(learnedOk ? 1 : 0);
    history.unshift(row(i, chosen, category, learnedOk, at));
    if (history.length > 2_000) history.pop();
  }
  const last = window.slice(-Math.floor(tasks / 3));
  return {
    tasks,
    staticSuccess: round(staticWins / tasks),
    learnedSuccess: round(learnedWins / tasks),
    learnedLastThird: round(last.reduce((a, b) => a + b, 0) / last.length),
    switchRate: round(switches / tasks),
    trialRate: round(trials / tasks),
    avgDecisionMs: round(decisionMs / tasks, 3),
  };
}

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

describe("SIMULATION: routing that learns from verified outcomes", () => {
  it("beats fixed routing when one coworker is clearly better at a kind of work", () => {
    const hidden = {
      dev: { code: 0.55, testing: 0.5, writing: 0.4, data: 0.5 },
      tara: { code: 0.6, testing: 0.55, writing: 0.5, data: 0.88 },
      priya: { code: 0.45, testing: 0.9, writing: 0.85, data: 0.5 },
      arjun: { code: 0.9, testing: 0.6, writing: 0.55, data: 0.45 },
    };
    const defaults = { code: "dev", testing: "dev", writing: "dev", data: "dev" };
    const runs = [11, 22, 33].map((seed) => simulate(hidden, defaults, 600, seed));
    save("routing-clear-winner", runs);
    for (const run of runs) {
      expect(run.learnedSuccess).toBeGreaterThan(run.staticSuccess + 0.1);
      expect(run.learnedLastThird).toBeGreaterThan(0.75);
    }
  });

  it("costs nothing in success when every coworker is equally good", () => {
    const flat = Object.fromEntries(
      BOTS.map((bot) => [bot, { code: 0.7, testing: 0.7, writing: 0.7, data: 0.7 }]),
    );
    const defaults = { code: "dev", testing: "tara", writing: "priya", data: "arjun" };
    const runs = [5, 6, 7].map((seed) => simulate(flat, defaults, 600, seed));
    save("routing-no-signal", runs);
    // Known behaviour, reported, not hidden: an unlucky streak can make a usual coworker look
    // weak, start trials and move its work. With equal coworkers that must not cost success.
    const meanGap =
      runs.reduce((sum, run) => sum + (run.learnedSuccess - run.staticSuccess), 0) / runs.length;
    expect(meanGap).toBeGreaterThan(-0.05);
    for (const run of runs) expect(run.switchRate).toBeLessThan(0.5);
  });

  it("keeps the usual coworker when it is already the best", () => {
    const hidden = {
      dev: { code: 0.9, testing: 0.9, writing: 0.9, data: 0.9 },
      tara: { code: 0.6, testing: 0.6, writing: 0.6, data: 0.6 },
      priya: { code: 0.6, testing: 0.6, writing: 0.6, data: 0.6 },
      arjun: { code: 0.6, testing: 0.6, writing: 0.6, data: 0.6 },
    };
    const defaults = { code: "dev", testing: "dev", writing: "dev", data: "dev" };
    const run = simulate(hidden, defaults, 400, 9);
    save("routing-default-best", run);
    expect(run.switchRate).toBe(0);
  });
});

describe("PERFORMANCE on this machine (synthetic records)", () => {
  it("ranks, searches, grades and learns within small time and memory budgets", () => {
    const heapBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const wallBefore = performance.now();

    const db = new IntelligenceDb(":memory:");
    const random = seededRandom(1);
    const insertStart = performance.now();
    db.transaction(() => {
      for (let i = 0; i < 5_000; i += 1) {
        const bot = BOTS[i % BOTS.length] as string;
        const category = CATEGORIES[Math.floor(random() * 4)] as string;
        db.insertOutcome(row(i, bot, category, random() < 0.7, NOW - i * 60_000));
      }
    });
    const insertMs = performance.now() - insertStart;

    const readStart = performance.now();
    const history = db.outcomes("sim", { limit: 2_000, finishedOnly: true });
    const readMs = performance.now() - readStart;

    const rankRuns = 200;
    const rankStart = performance.now();
    for (let i = 0; i < rankRuns; i += 1) {
      chooseRoute(
        rankCandidates(history, candidates, CATEGORIES[i % 4] as TaskCategory, { now: NOW }),
        "dev",
      );
    }
    const rankMs = (performance.now() - rankStart) / rankRuns;

    const rebuildStart = performance.now();
    let model = emptyLogistic();
    for (const item of db.outcomes("sim", { limit: 5_000, finishedOnly: true }).reverse()) {
      model = learnLogistic(model, item.features ?? {}, item.status === "failed");
    }
    const rebuildMs = performance.now() - rebuildStart;

    let clock = NOW;
    const memory = new ExperienceMemory(db, () => clock, 500);
    for (let i = 0; i < 600; i += 1) {
      clock += 1_000;
      memory.add({
        workspaceId: "sim",
        kind: "observation",
        trust: "observed",
        text: `Coworker ${BOTS[i % 4]} finished ${CATEGORIES[i % 4]} task number ${i} about invoices and GST reports`,
      });
    }
    const searchRuns = 200;
    const searchStart = performance.now();
    for (let i = 0; i < searchRuns; i += 1) memory.similar("sim", "invoice GST report for March");
    const searchMs = (performance.now() - searchStart) / searchRuns;

    const reply = `${"I changed src/app.ts and ran the tests. ".repeat(500)}\nTests  40 passed (40)`;
    const gradeRuns = 500;
    const gradeStart = performance.now();
    for (let i = 0; i < gradeRuns; i += 1) {
      gradeVerification({ status: "succeeded", reply, evidence: [], toolCalls: 4, toolErrors: 0 });
      errorSignature(`Error: ENOENT at C:\\work\\${i}\\file.ts line ${i}`);
      classifyTask(reply);
    }
    const gradeMs = (performance.now() - gradeStart) / gradeRuns;

    const cpu = process.cpuUsage(cpuBefore);
    const wallMs = performance.now() - wallBefore;
    const heapAfter = process.memoryUsage().heapUsed;
    const measured = {
      insert5000OutcomesMs: round(insertMs, 1),
      read2000OutcomesMs: round(readMs, 2),
      rankAndChoosePerTaskMs: round(rankMs, 3),
      rebuildModelFrom5000Ms: round(rebuildMs, 1),
      experiencesKept: memory.list("sim", { limit: 1_000 }).length,
      similarSearchMs: round(searchMs, 3),
      gradeClassifySignaturePer20kReplyMs: round(gradeMs, 3),
      totalWallMs: round(wallMs, 0),
      totalCpuMs: round((cpu.user + cpu.system) / 1000, 0),
      heapGrowthMb: round((heapAfter - heapBefore) / 1024 / 1024, 1),
      rssMb: round(process.memoryUsage().rss / 1024 / 1024, 0),
    };
    save("performance", measured);
    db.close();

    // Generous ceilings: a regression shows up as a jump of many times, not a few ms.
    expect(rankMs).toBeLessThan(50);
    expect(searchMs).toBeLessThan(20);
    expect(gradeMs).toBeLessThan(20);
    expect(rebuildMs).toBeLessThan(2_000);
    expect(measured.experiencesKept).toBeLessThanOrEqual(500);
  });
});

describe("PERFORMANCE: the whole service, 1,000 coworker turns (synthetic)", () => {
  it("records, grades and learns each turn in a few milliseconds", async () => {
    let clock = NOW;
    const bots = BOTS.map((id) => ({
      id,
      workspaceId: "default",
      name: id,
      role: "Specialist",
      description: "",
      notifications: false,
      model: "codex:gpt-5",
      reasoningEffort: "medium" as const,
      threadId: null,
      workspacePath: "",
      preview: "",
      updatedAt: null,
      avatarShape: "blob" as const,
      avatarColor: "orange" as const,
    }));
    const texts = [
      "Fix the TypeScript compile error in the invoice module",
      "Write the weekly newsletter for customers",
      "Clean the CSV export and build a pivot table",
      "Run the unit tests and fix what fails",
    ];
    const deliveries = new Map<string, { id: string; text: string }>();
    const replies = new Map<
      string,
      Array<{
        id: string;
        turnId: string;
        author: "assistant";
        text: string;
        createdAt: string;
        status: "completed";
      }>
    >();
    const service = new IntelligenceService({
      directory: null,
      enabled: () => true,
      adaptive: () => true,
      now: () => clock,
      beginDelayMs: 0,
      ports: {
        listBots: () => bots as never,
        activeWorkspaceId: () => "default",
        deliveryForTurn: (turnId) =>
          ({
            ...deliveries.get(turnId),
            messageId: "m",
            recipientBotId: "dev",
            sender: { kind: "user" },
            origin: "owner",
            attachments: [],
            replyToMessageId: null,
            status: "running",
            position: 0,
            turnId,
            error: null,
            createdAt: "",
          }) as never,
        queue: (botId) => ({ botId, paused: false, deliveries: [] }),
        readConversation: async (botId) =>
          ({
            botId,
            threadId: null,
            activeTurnId: null,
            revision: 1,
            messages: replies.get(botId) ?? [],
          }) as never,
        sharedRoot: () => null,
        memory: () => ({ freeMb: 8_000, totalMb: 16_000, pressure: "ok" as const }),
      },
    });
    const random = seededRandom(3);
    const heapBefore = process.memoryUsage().heapUsed;
    const cpuBefore = process.cpuUsage();
    const started = performance.now();
    const turns = 1_000;
    for (let i = 0; i < turns; i += 1) {
      const botId = BOTS[i % BOTS.length] as string;
      const turnId = `t-${i}`;
      deliveries.set(turnId, { id: `d-${i}`, text: texts[i % texts.length] as string });
      service.handleEvent({ type: "turn-started", botId, threadId: "x", turnId });
      clock += 60_000;
      const list = replies.get(botId) ?? [];
      list.push({
        id: `r-${i}`,
        turnId,
        author: "assistant",
        text: "Done. Tests  12 passed (12)",
        createdAt: "",
        status: "completed",
      });
      if (list.length > 50) list.shift();
      replies.set(botId, list);
      const failed = random() < 0.3;
      if (failed)
        service.handleEvent({
          type: "error",
          botId,
          code: "x",
          message: `Build failed at line ${i}`,
        });
      service.handleEvent({
        type: "turn-completed",
        botId,
        threadId: "x",
        turnId,
        status: failed ? "failed" : "completed",
      });
      if (i % 50 === 49) await service.settle();
    }
    await service.settle();
    const wallMs = performance.now() - started;
    const cpu = process.cpuUsage(cpuBefore);
    const status = service.status();
    const resources = await service.resources();
    const measured = {
      turns,
      recorded: status.outcomes.total,
      modelUpdates: status.model.updates,
      wallMsPerTurn: round(wallMs / turns, 3),
      cpuMsPerTurn: round((cpu.user + cpu.system) / 1000 / turns, 3),
      meterTotalMs: resources.totalMs,
      slowestOperations: resources.operations
        .slice(0, 5)
        .map((op) => ({ name: op.name, count: op.count, maxMs: op.maxMs })),
      heapGrowthMb: round((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024, 1),
      queueDropped: status.queue.dropped,
    };
    save("service-1000-turns", measured);
    await service.dispose();
    expect(status.outcomes.total).toBe(turns);
    expect(measured.wallMsPerTurn).toBeLessThan(50);
  });
});
