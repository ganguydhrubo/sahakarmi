import { randomUUID } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  IntelligenceDecision,
  IntelligenceExperience,
  IntelligenceMode,
  IntelligenceOutcome,
  IntelligencePerformanceRow,
  IntelligencePlanAnalysis,
  IntelligencePredictions,
  IntelligenceRecommendation,
  IntelligenceRecommendInput,
  IntelligenceResources,
  IntelligenceRoutingImpact,
  IntelligenceStatus,
  OutcomeOrigin,
  VerificationGrade,
} from "../../shared/intelligence";
import type {
  AgentEvent,
  BotSummary,
  ConversationSnapshot,
  OrchestratorRun,
  OrchestratorTask,
  QueueDelivery,
  QueueSnapshot,
  ResourceUsageGroup,
} from "../../shared/ipc";
import { providerForModel } from "../../shared/ipc";
import { VerificationRepairEngine } from "../verification-repair-engine";
import {
  type Candidate,
  chooseRoute,
  chooseRouteWithTrials,
  type RouteChoice,
  rankCandidates,
} from "./decision-engine";
import { errorSignature } from "./error-signature";
import { ExperienceMemory } from "./experience-memory";
import { IntelligenceDb, type OutcomeRow } from "./intelligence-db";
import {
  emptyLogistic,
  type LogisticState,
  learnLogistic,
  logisticQuality,
  restoreLogistic,
} from "./online-logistic";
import { labelOf, labelValue } from "./outcome-label";
import { analyzePlan } from "./plan-analyzer";
import {
  bottlenecks,
  buildFeatures,
  errorPatterns,
  isCategory,
  predictDuration,
  predictFailure,
  predictionAccuracy,
  predictOverload,
} from "./predictor";
import { ResourceMeter } from "./resource-meter";
import { betaPosterior, quantile } from "./stats";
import { classifyTask, type TaskCategory } from "./task-classifier";
import { gradeVerification } from "./verification-grader";

/**
 * The Intelligence Core: one object the app talks to.
 *
 * It WATCHES (never drives) the coworkers: four kinds of events the app already sends
 * (turn started, turn completed, error, team-run task updated) go into a bounded queue and are
 * handled in small batches off the hot path. For each piece of work it records what was
 * predicted at the start and what the evidence said at the end, learns from it, and answers
 * questions (who should do this? how likely to fail? what is wrong with this plan?).
 *
 * In "adaptive" mode (a separate switch) it may also change who does a team-run task, and stop
 * a task that keeps failing the same way. Every such decision is written down with its reason.
 * It never sends messages, runs commands, pushes code or deletes anything by itself.
 */

export interface IntelligencePorts {
  listBots(): BotSummary[];
  activeWorkspaceId(): string | null;
  /** The mailbox delivery (queued message) a turn answers. */
  deliveryForTurn(turnId: string): QueueDelivery | null;
  queue(botId: string): QueueSnapshot;
  /** The chat, read once when a turn ends (for the reply and tool results). */
  readConversation(botId: string): Promise<ConversationSnapshot | null>;
  sharedRoot(): string | null;
  memory(): { freeMb: number; totalMb: number; pressure: "ok" | "low" | "critical" };
  getRun?(runId: string): Promise<OrchestratorRun | null>;
  /** Sahkarmi's process tree by program, measured (the AI runtimes separately). */
  runtimes?(): Promise<ResourceUsageGroup[] | null>;
}

export interface IntelligenceOptions {
  /** Folder for `intelligence.sqlite`; null keeps everything in memory (tests). */
  directory: string | null;
  ports: IntelligencePorts;
  enabled: () => boolean;
  adaptive: () => boolean;
  now?: () => number;
  log?: (level: "warn" | "error", line: string) => void;
  /** Files-only checks of a chat reply (no commands are ever run from here). */
  verifier?: VerificationRepairEngine;
  maxQueue?: number;
  /** Delay before a started turn is recorded (its queued message is matched by then). */
  beginDelayMs?: number;
}

export interface TeamTaskRoute {
  botId: string;
  applied: boolean;
  explanation: string;
  decisionId: string | null;
}

export interface Reassignment {
  botId: string;
  botName: string;
  explanation: string;
}

interface LiveTurn {
  key: string;
  botId: string;
  turnId: string;
  startedAt: number;
  /** False when the start was never seen: the duration is then unknown. */
  known: boolean;
  lastError: string | null;
  outcomeId: string | null;
  beginTimer: ReturnType<typeof setTimeout> | null;
}

type QueuedEvent =
  | { kind: "start"; botId: string; turnId: string; at: number }
  | { kind: "end"; botId: string; turnId: string; status: string; at: number }
  | { kind: "error"; botId: string; message: string }
  | { kind: "task"; runId: string; task: OrchestratorTask }
  | { kind: "begin"; key: string };

const DAY_MS = 86_400_000;
const MAX_LIVE = 300;
const MAX_HISTORY = 2_000;
const OUTCOMES_PER_WORKSPACE = 5_000;
const DECISIONS_PER_WORKSPACE = 2_000;
const SNAPSHOT_EVERY = 25;
/** A turn still "running" after this long was cut off (crash, restart): not a result. */
const STALE_RUNNING_MS = 6 * 60 * 60_000;
/** A team-run turn waits this long for its task's verdict before it is learnt as it stands. */
const TEAM_VERDICT_WAIT_MS = 2 * 60 * 60_000;
const SUMMARY_CHARS = 240;
const REPLY_CHARS = 20_000;

export class IntelligenceService {
  readonly #options: IntelligenceOptions;
  readonly #ports: IntelligencePorts;
  readonly #now: () => number;
  readonly #meter = new ResourceMeter();
  readonly #verifier: VerificationRepairEngine;
  readonly #maxQueue: number;
  readonly #beginDelayMs: number;
  #db: IntelligenceDb | null = null;
  #memory: ExperienceMemory | null = null;
  #openFailed: string | null = null;
  #lastError: string | null = null;
  readonly #queue: QueuedEvent[] = [];
  #maxSeen = 0;
  #dropped = 0;
  #draining: Promise<void> = Promise.resolve();
  #scheduled = false;
  #disposed = false;
  readonly #live = new Map<string, LiveTurn>();
  /** Latest reply per delivery, for grading a team-run task after its turn ended. */
  readonly #replies = new Map<string, string>();
  readonly #history = new Map<string, OutcomeRow[]>();
  readonly #models = new Map<string, LogisticState>();
  readonly #dirtyModels = new Set<string>();
  #processed = 0;

  constructor(options: IntelligenceOptions) {
    this.#options = options;
    this.#ports = options.ports;
    this.#now = options.now ?? Date.now;
    this.#verifier = options.verifier ?? new VerificationRepairEngine(null);
    this.#maxQueue = options.maxQueue ?? 2_000;
    this.#beginDelayMs = options.beginDelayMs ?? 1_500;
  }

  mode(): IntelligenceMode {
    if (!this.#safe(this.#options.enabled, false)) return "off";
    return this.#safe(this.#options.adaptive, false) ? "adaptive" : "observe";
  }

  // ------------------------------------------------------------------ events (hot path)

  /**
   * Called for every app event. Cheap: filters and enqueues, nothing else. Never throws.
   */
  handleEvent(event: AgentEvent): void {
    if (this.#disposed) return;
    let queued: QueuedEvent | null = null;
    switch (event.type) {
      case "turn-started":
        queued = { kind: "start", botId: event.botId, turnId: event.turnId, at: this.#now() };
        break;
      case "turn-completed":
        queued = {
          kind: "end",
          botId: event.botId,
          turnId: event.turnId,
          status: event.status,
          at: this.#now(),
        };
        break;
      case "error":
        if (event.botId) queued = { kind: "error", botId: event.botId, message: event.message };
        break;
      case "orchestrator-task-updated":
        if (
          event.task.status === "completed" ||
          event.task.status === "failed" ||
          event.task.status === "repairing"
        ) {
          queued = { kind: "task", runId: event.runId, task: event.task };
        }
        break;
      default:
        return;
    }
    if (!queued || this.mode() === "off") return;
    if (this.#queue.length >= this.#maxQueue) {
      // Bounded: the oldest error notes go first; turn ends are what matter most.
      const index = this.#queue.findIndex((item) => item.kind === "error");
      this.#queue.splice(index >= 0 ? index : 0, 1);
      this.#dropped += 1;
    }
    this.#queue.push(queued);
    this.#maxSeen = Math.max(this.#maxSeen, this.#queue.length);
    this.#schedule();
  }

  #schedule(): void {
    if (this.#scheduled || this.#disposed) return;
    this.#scheduled = true;
    setImmediate(() => {
      this.#scheduled = false;
      this.#draining = this.#draining.then(() => this.#drain());
    });
  }

  /** Waits until every queued event is handled (tests, shutdown, before answering reads). */
  async settle(): Promise<void> {
    for (let round = 0; round < 50; round += 1) {
      await this.#draining;
      if (this.#queue.length === 0 && !this.#scheduled) return;
      if (!this.#scheduled) this.#draining = this.#draining.then(() => this.#drain());
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async #drain(): Promise<void> {
    let handled = 0;
    while (this.#queue.length && !this.#disposed && handled < 200) {
      const item = this.#queue.shift() as QueuedEvent;
      handled += 1;
      try {
        await this.#meter.measureAsync(`event:${item.kind}`, () => this.#handle(item));
      } catch (error) {
        this.#fail("event", error);
      }
    }
    this.#processed += handled;
    if (this.#processed >= 200) {
      this.#processed = 0;
      this.#maintain();
    }
    if (this.#queue.length) this.#schedule();
  }

  async #handle(item: QueuedEvent): Promise<void> {
    const db = this.#open();
    if (!db) return;
    switch (item.kind) {
      case "start": {
        const key = `${item.botId}:${item.turnId}`;
        if (this.#live.has(key)) return;
        const live: LiveTurn = {
          key,
          botId: item.botId,
          turnId: item.turnId,
          startedAt: item.at,
          known: true,
          lastError: null,
          outcomeId: null,
          beginTimer: null,
        };
        this.#live.set(key, live);
        this.#trimLive();
        // The queued message is linked to the turn a moment after the turn starts.
        live.beginTimer = setTimeout(() => {
          live.beginTimer = null;
          if (this.#disposed) return;
          this.#queue.push({ kind: "begin", key });
          this.#schedule();
        }, this.#beginDelayMs);
        live.beginTimer.unref?.();
        return;
      }
      case "begin": {
        const live = this.#live.get(item.key);
        if (live && !live.outcomeId) this.#begin(live);
        return;
      }
      case "error": {
        const live = [...this.#live.values()].reverse().find((turn) => turn.botId === item.botId);
        if (live) live.lastError = item.message.slice(0, 2_000);
        return;
      }
      case "end": {
        const key = `${item.botId}:${item.turnId}`;
        let live = this.#live.get(key);
        if (!live) {
          // Started before we were listening (or the start was dropped): duration unknown.
          live = {
            key,
            botId: item.botId,
            turnId: item.turnId,
            startedAt: item.at,
            known: false,
            lastError: null,
            outcomeId: null,
            beginTimer: null,
          };
        }
        if (live.beginTimer) clearTimeout(live.beginTimer);
        live.beginTimer = null;
        this.#live.delete(key);
        if (!live.outcomeId) this.#begin(live);
        await this.#finish(live, item.status, item.at);
        return;
      }
      case "task":
        await this.#applyTeamVerdict(item.runId, item.task);
        return;
    }
  }

  #trimLive(): void {
    while (this.#live.size > MAX_LIVE) {
      const oldest = this.#live.keys().next().value as string;
      const live = this.#live.get(oldest);
      if (live?.beginTimer) clearTimeout(live.beginTimer);
      this.#live.delete(oldest);
    }
  }

  // ------------------------------------------------------------------ recording

  /** Records the start of a turn with the predictions made BEFORE it ran. */
  #begin(live: LiveTurn): void {
    const db = this.#open();
    if (!db) return;
    const bot = this.#ports.listBots().find((candidate) => candidate.id === live.botId);
    if (!bot) return;
    const delivery = this.#ports.deliveryForTurn(live.turnId);
    const text = delivery?.text ?? "";
    const origin = originOf(delivery);
    const classification = classifyTask(text);
    const provider = safeProvider(bot.model);
    const queued = this.#queuedCount(bot.id);
    const memory = this.#memoryNow();
    const history = this.#historyFor(bot.workspaceId);
    const context = {
      botId: bot.id,
      provider,
      category: classification.category,
      origin,
      promptChars: text.length,
      queued,
      memoryPressure: memory.pressure,
      now: live.startedAt,
    };
    const model = this.#modelFor(bot.workspaceId);
    const failure = predictFailure(history, context, model);
    const duration = predictDuration(history, bot.id, classification.category);
    const row: OutcomeRow = {
      id: `out-${randomUUID()}`,
      workspaceId: bot.workspaceId,
      botId: bot.id,
      provider,
      model: bot.model,
      category: classification.category,
      origin,
      sourceKey: `turn:${bot.id}:${live.turnId}`,
      runId: null,
      taskId: null,
      deliveryId: delivery?.id ?? null,
      startedAt: live.startedAt,
      endedAt: null,
      durationMs: null,
      status: "running",
      verification: null,
      verificationReasons: [],
      toolCalls: 0,
      toolErrors: 0,
      errorSignature: null,
      promptChars: text.length,
      tokens: null,
      costUsd: null,
      predictedFailure: failure.probability,
      predictedDurationMs: duration.medianMs,
      predictionSource: failure.source,
      features: buildFeatures(history, context),
      feedback: null,
      feedbackNote: null,
      excluded: false,
      summary: summarise(text),
      learned: false,
    };
    const inserted = this.#meter.measure("db:insert-outcome", () => db.insertOutcome(row));
    live.outcomeId = inserted ? row.id : (db.outcomeBySource(row.sourceKey)?.id ?? null);
  }

  async #finish(live: LiveTurn, rawStatus: string, endedAt: number): Promise<void> {
    const db = this.#open();
    if (!db || !live.outcomeId) return;
    const outcome = db.outcome(live.outcomeId);
    if (outcome?.status !== "running") return;
    const status =
      rawStatus === "completed"
        ? "succeeded"
        : rawStatus === "interrupted"
          ? "interrupted"
          : "failed";
    const bot = this.#ports.listBots().find((candidate) => candidate.id === outcome.botId);
    const { reply, toolCalls, toolErrors, toolError } = await this.#readTurn(
      outcome.botId,
      live.turnId,
    );
    if (outcome.deliveryId && reply) {
      this.#replies.set(outcome.deliveryId, reply);
      while (this.#replies.size > 100)
        this.#replies.delete(this.#replies.keys().next().value as string);
    }
    // Outside evidence for a chat reply: the files it names, looked up in its own folder and
    // Shared. Never a command.
    let evidence: OrchestratorTask["evidence"] = [];
    if (status === "succeeded" && reply && bot) {
      try {
        const checked = await this.#meter.measureAsync("verify:files", () =>
          this.#verifier.verifyTask(syntheticTask(outcome), {
            workspacePath: bot.workspacePath,
            sharedRoot: this.#ports.sharedRoot(),
            reply,
            botId: bot.id,
          }),
        );
        evidence = checked.evidence.filter((item) => item.type === "files");
      } catch (error) {
        this.#fail("verify", error);
      }
    }
    const grade = gradeVerification({ status, reply, evidence, toolCalls, toolErrors });
    const errorText =
      status === "failed"
        ? (live.lastError ?? this.#ports.deliveryForTurn(live.turnId)?.error ?? null)
        : toolErrors > 0
          ? toolError
          : null;
    const durationMs = live.known ? Math.max(0, endedAt - outcome.startedAt) : null;
    db.updateOutcome(outcome.id, {
      endedAt,
      durationMs,
      status,
      verification: grade.grade,
      verificationReasons: grade.reasons,
      toolCalls,
      toolErrors,
      errorSignature: errorSignature(errorText),
    });
    const finished = db.outcome(outcome.id);
    this.#touchHistory(finished);
    if (!finished) return;
    // A team-run task's verdict (files, the owner's check, a reviewer) is stronger evidence and
    // usually arrives a moment later: learn then.
    if (finished.origin !== "team-run") this.#learn(finished);
  }

  async #readTurn(
    botId: string,
    turnId: string,
  ): Promise<{
    reply: string | null;
    toolCalls: number;
    toolErrors: number;
    toolError: string | null;
  }> {
    let snapshot: ConversationSnapshot | null = null;
    try {
      snapshot = await this.#meter.measureAsync("read:conversation", () =>
        this.#ports.readConversation(botId),
      );
    } catch (error) {
      this.#fail("read conversation", error);
    }
    const messages = snapshot?.messages.filter((message) => message.turnId === turnId) ?? [];
    const tools = messages.filter((message) => message.itemType === "toolCall" || message.tool);
    const failedTools = tools.filter(
      (message) => message.tool?.status === "failed" || message.status === "failed",
    );
    const reply = messages
      .filter(
        (message) =>
          message.author === "assistant" &&
          message.itemType !== "commentary" &&
          message.itemType !== "toolCall" &&
          !message.tool &&
          !message.exchange &&
          message.text.trim(),
      )
      .map((message) => message.text.trim())
      .join("\n\n")
      .slice(0, REPLY_CHARS);
    return {
      reply: reply || null,
      toolCalls: tools.length,
      toolErrors: failedTools.length,
      toolError: failedTools[0]?.tool?.output?.slice(0, 500) ?? null,
    };
  }

  /** A team-run task finished an attempt: its evidence replaces the chat-level grade. */
  async #applyTeamVerdict(runId: string, task: OrchestratorTask): Promise<void> {
    const db = this.#open();
    if (!db) return;
    const sent = task.inputs?.attemptDeliveries as Record<string, string> | undefined;
    const deliveryId = sent?.[String(task.attemptCount)];
    if (!deliveryId) return;
    const outcome = db.outcomeByDelivery(deliveryId);
    if (!outcome || outcome.status === "running" || outcome.taskId === task.id) return;
    const since = outcome.startedAt - 1_000;
    const evidence = task.evidence.filter((item) => {
      const at = Date.parse(item.timestamp);
      return Number.isFinite(at) ? at >= since : true;
    });
    const grade = gradeVerification({
      status:
        outcome.status === "succeeded"
          ? "succeeded"
          : outcome.status === "failed"
            ? "failed"
            : "interrupted",
      reply:
        this.#replies.get(deliveryId) ??
        (typeof task.inputs.result === "string" ? task.inputs.result : null),
      evidence,
      toolCalls: outcome.toolCalls,
      toolErrors: outcome.toolErrors,
      acceptanceCriteria: task.acceptanceCriteria,
    });
    const failedEvidence = evidence.find((item) => !item.passed);
    db.updateOutcome(outcome.id, {
      runId,
      taskId: task.id,
      category: classifyTask(`${task.title}\n${task.description}`, task.role).category,
      verification: grade.grade,
      verificationReasons: [`Team run "${task.title}"`, ...grade.reasons],
      errorSignature: outcome.errorSignature ?? errorSignature(failedEvidence?.summary ?? null),
    });
    const updated = db.outcome(outcome.id);
    this.#touchHistory(updated);
    if (!updated) return;
    this.#settleDecisions(db, updated, `${runId}:${task.id}`);
    if (!updated.learned) this.#learn(updated);
  }

  #settleDecisions(db: IntelligenceDb, outcome: OutcomeRow, subject: string): void {
    const label = labelValue(labelOf(outcome));
    for (const decision of db.decisions(outcome.workspaceId, 200)) {
      if (decision.subject !== subject || decision.outcomeId) continue;
      if (decision.chosenBotId && decision.chosenBotId !== outcome.botId) continue;
      db.settleDecision(decision.id, outcome.id, label);
    }
  }

  /** Learn from one finished outcome: the failure model and the experience notes. */
  #learn(outcome: OutcomeRow): void {
    const db = this.#open();
    if (!db) return;
    this.#meter.measure("learn", () => {
      const label = labelOf(outcome);
      if (label && outcome.features) {
        const name = modelName(outcome.workspaceId);
        const next = learnLogistic(
          this.#modelFor(outcome.workspaceId),
          outcome.features,
          label.failed,
        );
        this.#models.set(outcome.workspaceId, next);
        db.savePolicy(name, next, this.#now());
        if (next.updates % SNAPSHOT_EVERY === 0) {
          db.snapshotPolicy(name, next, next.updates, this.#now());
        }
      }
      db.updateOutcome(outcome.id, { learned: true });
      this.#noteExperience(outcome);
    });
  }

  #noteExperience(outcome: OutcomeRow): void {
    const memory = this.#memory;
    const db = this.#db;
    if (!memory || !db) return;
    const botName =
      this.#ports.listBots().find((bot) => bot.id === outcome.botId)?.name ?? outcome.botId;
    if (
      outcome.summary &&
      (outcome.verification === "verified" || outcome.verification === "failed")
    ) {
      memory.add({
        workspaceId: outcome.workspaceId,
        kind: "observation",
        // Only Sahkarmi's own checks decide "verified"; a failure is what Sahkarmi observed.
        trust: outcome.verification === "verified" ? "verified" : "observed",
        category: outcome.category,
        botId: outcome.botId,
        outcomeId: outcome.id,
        text: `${botName} ${outcome.verification === "verified" ? "completed (verified)" : "failed"} ${outcome.category} task: ${outcome.summary}`,
      });
    }
    if (outcome.errorSignature) {
      const repeats = db
        .outcomes(outcome.workspaceId, {
          botId: outcome.botId,
          since: this.#now() - 14 * DAY_MS,
          limit: 200,
        })
        .filter((row) => row.errorSignature === outcome.errorSignature).length;
      if (repeats >= 2) {
        memory.add({
          workspaceId: outcome.workspaceId,
          kind: "lesson",
          trust: "observed",
          category: outcome.category,
          botId: outcome.botId,
          outcomeId: outcome.id,
          text: `${botName} hit the same error ${repeats} times in 14 days: ${outcome.errorSignature}`,
        });
      }
    }
  }

  // ------------------------------------------------------------------ team runs (engine hooks)

  /**
   * Who should do a team-run task. In observe mode this is advice only (written down, not
   * used); in adaptive mode a clearly better coworker on the evidence gets the task.
   */
  routeTeamTask(input: {
    runId: string;
    workspaceId: string | null;
    task: Pick<OrchestratorTask, "id" | "title" | "description" | "role">;
    defaultBotId: string;
  }): TeamTaskRoute | null {
    if (this.mode() === "off") return null;
    const db = this.#open();
    if (!db) return null;
    try {
      return this.#meter.measure("route", () => {
        const workspaceId = this.#workspace(input.workspaceId);
        const category = classifyTask(
          `${input.task.title}\n${input.task.description}`,
          input.task.role,
        ).category;
        const adaptive = this.mode() === "adaptive";
        const choice = this.#choose(workspaceId, category, input.defaultBotId, adaptive);
        const apply =
          adaptive &&
          choice.switchFromDefault &&
          choice.chosenBotId !== null &&
          choice.chosenBotId !== input.defaultBotId;
        const decisionId = `dec-${randomUUID()}`;
        db.insertDecision({
          id: decisionId,
          workspaceId,
          at: this.#now(),
          kind: "route",
          subject: `${input.runId}:${input.task.id}`,
          category,
          chosenBotId: apply ? choice.chosenBotId : input.defaultBotId,
          defaultBotId: input.defaultBotId,
          applied: apply,
          explanation: apply ? choice.explanation : `Advice only: ${choice.explanation}`,
          candidates: compactCandidates(choice),
          outcomeId: null,
          outcomeLabel: null,
        });
        return {
          botId: apply ? (choice.chosenBotId as string) : input.defaultBotId,
          applied: apply,
          explanation: choice.explanation,
          decisionId,
        };
      });
    } catch (error) {
      this.#fail("route", error);
      return null;
    }
  }

  /**
   * Adaptive mode only: another coworker for a task whose coworker is gone, or that failed the
   * same way twice. Null means "no better choice on the evidence".
   */
  reassign(input: {
    run: Pick<OrchestratorRun, "id" | "workspaceId">;
    task: Pick<OrchestratorTask, "id" | "title" | "description" | "role">;
    fromBotId: string;
    reason: "unavailable" | "repeated-failure";
    detail: string;
  }): Reassignment | null {
    if (this.mode() !== "adaptive") return null;
    const db = this.#open();
    if (!db) return null;
    try {
      return this.#meter.measure("reassign", () => {
        const workspaceId = this.#workspace(input.run.workspaceId);
        const category = classifyTask(
          `${input.task.title}\n${input.task.description}`,
          input.task.role,
        ).category;
        const ranking = this.#ranking(workspaceId, category, input.fromBotId);
        const from = ranking.candidates.find((item) => item.botId === input.fromBotId);
        const best = ranking.candidates.find(
          (item) => item.available && item.botId !== input.fromBotId,
        );
        if (!best) return null;
        if (
          input.reason === "repeated-failure" &&
          (best.samples === 0 || (from && best.successRate <= from.successRate))
        ) {
          return null;
        }
        const explanation =
          input.reason === "unavailable"
            ? `${from?.botName ?? input.fromBotId} cannot take the task (${input.detail}); ${best.botName} takes it (${best.reasons.join("; ")}).`
            : `${from?.botName ?? input.fromBotId} failed twice the same way (${input.detail}); ${best.botName} has a better record on ${category} work (${Math.round(best.successRate * 100)}% vs ${Math.round((from?.successRate ?? 0) * 100)}%).`;
        db.insertDecision({
          id: `dec-${randomUUID()}`,
          workspaceId,
          at: this.#now(),
          kind: "reassign",
          subject: `${input.run.id}:${input.task.id}`,
          category,
          chosenBotId: best.botId,
          defaultBotId: input.fromBotId,
          applied: true,
          explanation,
          candidates: ranking.candidates.slice(0, 6).map((item) => ({
            botId: item.botId,
            successRate: item.successRate,
            samples: item.samples,
          })),
          outcomeId: null,
          outcomeLabel: null,
        });
        return { botId: best.botId, botName: best.botName, explanation };
      });
    } catch (error) {
      this.#fail("reassign", error);
      return null;
    }
  }

  /** Adaptive mode only: writes down that a repeating failure stopped the retries. */
  noteStoppedRetry(input: {
    run: Pick<OrchestratorRun, "id" | "workspaceId">;
    task: Pick<OrchestratorTask, "id" | "title">;
    botId: string;
    signature: string;
  }): void {
    const db = this.#open();
    if (!db) return;
    db.insertDecision({
      id: `dec-${randomUUID()}`,
      workspaceId: this.#workspace(input.run.workspaceId),
      at: this.#now(),
      kind: "stop-retry",
      subject: `${input.run.id}:${input.task.id}`,
      category: null,
      chosenBotId: input.botId,
      defaultBotId: input.botId,
      applied: true,
      explanation: `"${input.task.title}" failed twice with the same error (${input.signature}); another attempt would repeat it, so the retries stopped.`,
      candidates: [],
      outcomeId: null,
      outcomeLabel: null,
    });
  }

  // ------------------------------------------------------------------ questions (IPC)

  recommend(input: IntelligenceRecommendInput): IntelligenceRecommendation {
    return this.#meter.measure("recommend", () => {
      const workspaceId = this.#workspace(input.workspaceId ?? null);
      const classification = classifyTask(input.text ?? "", validRole(input.role));
      const category = classification.category;
      const db = this.#open();
      const choice = this.#choose(workspaceId, category, input.defaultBotId ?? null);
      const chosen = choice.chosenBotId;
      const history = this.#historyFor(workspaceId);
      const failure = chosen
        ? predictFailure(
            history,
            {
              botId: chosen,
              provider:
                choice.ranking.candidates.find((item) => item.botId === chosen)?.provider ?? null,
              category,
              origin: "chat",
              promptChars: (input.text ?? "").length,
              queued: this.#queuedCount(chosen),
              memoryPressure: this.#memoryNow().pressure,
              now: this.#now(),
            },
            this.#modelFor(workspaceId),
          )
        : null;
      const similar =
        db && this.#memory
          ? this.#memory.similar(workspaceId, input.text ?? "", { limit: 5 }).map((item) => ({
              id: item.id,
              kind: item.kind,
              trust: item.trust,
              text: item.text,
              botId: item.botId,
              relevance: item.relevance,
            }))
          : [];
      return {
        category,
        classification: { confidence: classification.confidence, matched: classification.matched },
        candidates: choice.ranking.candidates,
        chosenBotId: chosen,
        defaultBotId: choice.defaultBotId,
        switchFromDefault: choice.switchFromDefault,
        confidence: choice.confidence,
        explanation: choice.explanation,
        failure,
        duration: chosen ? predictDuration(history, chosen, category) : null,
        similar,
        wouldApply: this.mode() === "adaptive" && choice.switchFromDefault,
      };
    });
  }

  async analyzeRun(runId: string): Promise<IntelligencePlanAnalysis | null> {
    const run = await this.#ports.getRun?.(runId);
    if (!run) return null;
    return this.#meter.measure("analyze-run", () => {
      const workspaceId = this.#workspace(run.workspaceId);
      const history = this.#historyFor(workspaceId);
      const model = this.#modelFor(workspaceId);
      const memory = this.#memoryNow();
      const categoryOf = (task: OrchestratorTask): TaskCategory =>
        classifyTask(`${task.title}\n${task.description}`, task.role).category;
      const analysis = analyzePlan(run, (task, botId) => {
        const category = categoryOf(task);
        const duration = predictDuration(history, botId, category);
        const failure = predictFailure(
          history,
          {
            botId,
            provider: safeProvider(this.#ports.listBots().find((bot) => bot.id === botId)?.model),
            category,
            origin: "team-run",
            promptChars: task.description.length,
            queued: this.#queuedCount(botId),
            memoryPressure: memory.pressure,
            now: this.#now(),
          },
          model,
        );
        return {
          durationMs: duration.medianMs,
          durationSource: duration.source,
          failureRisk: failure.probability,
          riskSource: failure.source,
        };
      });
      const suggestions: IntelligencePlanAnalysis["suggestions"] = [];
      for (const view of analysis.tasks) {
        if (view.status === "completed" || view.status === "failed" || view.failureRisk < 0.4)
          continue;
        const task = run.tasks.find((item) => item.id === view.id);
        if (!task) continue;
        const choice = this.#choose(workspaceId, categoryOf(task), view.botId);
        if (choice.switchFromDefault && choice.chosenBotId && choice.chosenBotId !== view.botId) {
          suggestions.push({
            taskId: view.id,
            fromBotId: view.botId,
            toBotId: choice.chosenBotId,
            explanation: choice.explanation,
          });
        }
      }
      return {
        ...analysis,
        objective: run.objective,
        status: run.status,
        suggestions,
      };
    });
  }

  predictions(workspaceIdInput?: string | null): IntelligencePredictions {
    return this.#meter.measure("predictions", () => {
      const workspaceId = this.#workspace(workspaceIdInput ?? null);
      const history = this.#historyFor(workspaceId);
      const bots = this.#ports.listBots().filter((bot) => bot.workspaceId === workspaceId);
      const queues = bots.map((bot) => {
        const snapshot = this.#safe(() => this.#ports.queue(bot.id), null);
        const deliveries = snapshot?.deliveries ?? [];
        return {
          botId: bot.id,
          botName: bot.name,
          queued: deliveries.filter((item) => item.status === "queued").length,
          busy: deliveries.some((item) => item.status === "running" || item.status === "starting"),
        };
      });
      const memory = this.#memoryNow();
      return {
        overload: predictOverload(history, queues),
        errorPatterns: errorPatterns(history, this.#now()),
        bottlenecks: bottlenecks(history, this.#now()).map((item) =>
          item.kind === "busy-coworker"
            ? {
                ...item,
                subject: bots.find((bot) => bot.id === item.subject)?.name ?? item.subject,
              }
            : item,
        ),
        memoryPressure: memory.pressure,
        memory: { freeMb: memory.freeMb, totalMb: memory.totalMb, heavyTurnMb: 450 },
      };
    });
  }

  status(workspaceIdInput?: string | null): IntelligenceStatus {
    const workspaceId = this.#workspace(workspaceIdInput ?? null);
    const db = this.#open();
    const empty = { verified: 0, partial: 0, failed: 0, inconclusive: 0 } as Record<
      VerificationGrade,
      number
    >;
    if (!db) {
      return {
        mode: this.mode(),
        workspaceId,
        storage: { path: "", bytes: null, outcomes: 0, experiences: 0 },
        outcomes: {
          total: 0,
          finished: 0,
          running: 0,
          labelled: 0,
          byGrade: empty,
          withFeedback: 0,
          excluded: 0,
        },
        model: logisticQuality(emptyLogistic()),
        modelSnapshots: [],
        accuracy: predictionAccuracy([]),
        routing: {
          switched: 0,
          switchedSuccess: null,
          kept: 0,
          keptSuccess: null,
          verdict: "Not started.",
        },
        queue: { pending: this.#queue.length, max: this.#maxSeen, dropped: this.#dropped },
        lastError: this.#openFailed ?? this.#lastError,
      };
    }
    return this.#meter.measure("status", () => {
      const rows = db.outcomes(workspaceId, { limit: OUTCOMES_PER_WORKSPACE });
      const byGrade = { ...empty };
      let running = 0;
      let labelled = 0;
      let withFeedback = 0;
      let excluded = 0;
      for (const row of rows) {
        if (row.status === "running") running += 1;
        if (row.verification) byGrade[row.verification] += 1;
        if (labelOf(row)) labelled += 1;
        if (row.feedback) withFeedback += 1;
        if (row.excluded) excluded += 1;
      }
      return {
        mode: this.mode(),
        workspaceId,
        storage: {
          path: db.path,
          bytes: fileBytes(db.path),
          outcomes: db.countOutcomes(),
          experiences: db.countExperiences(),
        },
        outcomes: {
          total: rows.length,
          finished: rows.length - running,
          running,
          labelled,
          byGrade,
          withFeedback,
          excluded,
        },
        model: logisticQuality(this.#modelFor(workspaceId)),
        modelSnapshots: db.policySnapshots(modelName(workspaceId)),
        accuracy: predictionAccuracy(rows),
        routing: this.#routingImpact(db, workspaceId),
        queue: { pending: this.#queue.length, max: this.#maxSeen, dropped: this.#dropped },
        lastError: this.#lastError,
      };
    });
  }

  performance(workspaceIdInput?: string | null): IntelligencePerformanceRow[] {
    return this.#meter.measure("performance", () => {
      const workspaceId = this.#workspace(workspaceIdInput ?? null);
      const names = new Map(this.#ports.listBots().map((bot) => [bot.id, bot.name]));
      const groups = new Map<string, OutcomeRow[]>();
      for (const row of this.#historyFor(workspaceId)) {
        if (!labelOf(row)) continue;
        const key = `${row.botId}\u0000${row.category}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const result: IntelligencePerformanceRow[] = [];
      for (const [key, rows] of groups) {
        const [botId = "", category = "general"] = key.split("\u0000");
        let s = 0;
        let f = 0;
        const counts = { verified: 0, partial: 0, failed: 0, inconclusive: 0 };
        const durations: number[] = [];
        for (const row of rows) {
          const label = labelOf(row);
          if (!label) continue;
          s += label.successes;
          f += label.failures;
          if (label.failed) counts.failed += 1;
          else if (row.verification === "verified" || row.feedback === "good") counts.verified += 1;
          else if (row.verification === "partial") counts.partial += 1;
          else counts.inconclusive += 1;
          if (!label.failed && row.durationMs !== null) durations.push(row.durationMs);
        }
        const posterior = betaPosterior(s, f, 0.5, 2);
        result.push({
          botId,
          botName: names.get(botId) ?? botId,
          category,
          samples: rows.length,
          ...counts,
          successRate: round(posterior.mean),
          lower: round(posterior.lower),
          upper: round(posterior.upper),
          medianMs: durations.length ? Math.round(quantile(durations, 0.5) ?? 0) : null,
        });
      }
      return result.sort((a, b) => a.botName.localeCompare(b.botName) || b.samples - a.samples);
    });
  }

  outcomes(input: { workspaceId?: string | null; limit?: number } = {}): IntelligenceOutcome[] {
    const db = this.#open();
    if (!db) return [];
    const workspaceId = this.#workspace(input.workspaceId ?? null);
    const names = new Map(this.#ports.listBots().map((bot) => [bot.id, bot.name]));
    return db
      .outcomes(workspaceId, { limit: Math.min(200, input.limit ?? 50) })
      .map((row) => toView(row, names.get(row.botId) ?? row.botId));
  }

  decisions(workspaceIdInput?: string | null): IntelligenceDecision[] {
    const db = this.#open();
    if (!db) return [];
    return db.decisions(this.#workspace(workspaceIdInput ?? null), 50).map((row) => ({
      id: row.id,
      at: row.at,
      kind: row.kind,
      subject: row.subject,
      category: row.category,
      chosenBotId: row.chosenBotId,
      defaultBotId: row.defaultBotId,
      applied: row.applied,
      explanation: row.explanation,
      outcomeLabel: row.outcomeLabel,
    }));
  }

  experiences(workspaceIdInput?: string | null): IntelligenceExperience[] {
    const memory = this.#open() ? this.#memory : null;
    if (!memory) return [];
    return memory
      .list(this.#workspace(workspaceIdInput ?? null), { limit: 100 })
      .map(experienceView);
  }

  /** The owner's own fact or preference (trust "owner"). */
  addExperience(input: {
    workspaceId?: string | null;
    kind: "fact" | "preference";
    text: string;
  }): IntelligenceExperience | null {
    const memory = this.#open() ? this.#memory : null;
    if (!memory || (input.kind !== "fact" && input.kind !== "preference")) return null;
    const row = memory.add({
      workspaceId: this.#workspace(input.workspaceId ?? null),
      kind: input.kind,
      trust: "owner",
      text: input.text,
    });
    return row ? experienceView(row) : null;
  }

  correctExperience(input: {
    workspaceId?: string | null;
    id: string;
    text: string;
  }): IntelligenceExperience | null {
    const memory = this.#open() ? this.#memory : null;
    const row = memory?.correct(this.#workspace(input.workspaceId ?? null), input.id, input.text);
    return row ? experienceView(row) : null;
  }

  deleteExperience(input: { workspaceId?: string | null; id: string }): boolean {
    const memory = this.#open() ? this.#memory : null;
    return memory?.delete(this.#workspace(input.workspaceId ?? null), input.id) ?? false;
  }

  /** The owner's 👍 / 👎 on a recorded outcome; the strongest evidence there is. */
  setFeedback(input: {
    outcomeId: string;
    feedback: "good" | "bad" | null;
    note?: string | null;
  }): IntelligenceOutcome | null {
    const db = this.#open();
    if (!db) return null;
    const outcome = db.outcome(input.outcomeId);
    if (!outcome) return null;
    db.updateOutcome(outcome.id, {
      feedback: input.feedback,
      feedbackNote: input.note?.trim().slice(0, 500) || null,
    });
    if (input.note?.trim() && this.#memory) {
      this.#memory.add({
        workspaceId: outcome.workspaceId,
        kind: "preference",
        trust: "owner",
        category: outcome.category,
        botId: outcome.botId,
        outcomeId: outcome.id,
        text: input.note,
      });
    }
    this.#afterRelabel(outcome.workspaceId, outcome.id);
    const updated = db.outcome(outcome.id);
    const name =
      this.#ports.listBots().find((bot) => bot.id === outcome.botId)?.name ?? outcome.botId;
    return updated ? toView(updated, name) : null;
  }

  /** Leave an outcome out of all learning (or bring it back). Reversible. */
  setExcluded(input: { outcomeId: string; excluded: boolean }): IntelligenceOutcome | null {
    const db = this.#open();
    if (!db) return null;
    const outcome = db.outcome(input.outcomeId);
    if (!outcome) return null;
    db.updateOutcome(outcome.id, { excluded: input.excluded });
    this.#afterRelabel(outcome.workspaceId, outcome.id);
    const updated = db.outcome(outcome.id);
    const name =
      this.#ports.listBots().find((bot) => bot.id === outcome.botId)?.name ?? outcome.botId;
    return updated ? toView(updated, name) : null;
  }

  /** The failure model as it was at an earlier snapshot. */
  rollbackModel(input: { workspaceId?: string | null; snapshotId: number }): IntelligenceStatus {
    const db = this.#open();
    const workspaceId = this.#workspace(input.workspaceId ?? null);
    if (db) {
      const state = db.policySnapshot(modelName(workspaceId), input.snapshotId);
      if (state) {
        const restored = restoreLogistic(state);
        this.#models.set(workspaceId, restored);
        this.#dirtyModels.delete(workspaceId);
        db.savePolicy(modelName(workspaceId), restored, this.#now());
      }
    }
    return this.status(workspaceId);
  }

  /** Forget everything learnt in one workspace (records, notes, decisions, model). */
  resetLearning(workspaceIdInput?: string | null): IntelligenceStatus {
    const db = this.#open();
    const workspaceId = this.#workspace(workspaceIdInput ?? null);
    if (db) {
      db.transaction(() => {
        db.deleteOutcomes(workspaceId);
        db.deleteExperiences(workspaceId);
        db.deleteDecisions(workspaceId);
        db.deletePolicy(modelName(workspaceId));
      });
      this.#models.delete(workspaceId);
      this.#history.delete(workspaceId);
    }
    return this.status(workspaceId);
  }

  async resources(): Promise<IntelligenceResources> {
    const snapshot = this.#meter.snapshot();
    let runtimes: IntelligenceResources["runtimes"] = null;
    try {
      runtimes = (await this.#ports.runtimes?.()) ?? null;
    } catch {
      runtimes = null;
    }
    return { ...snapshot, dbBytes: this.#db ? fileBytes(this.#db.path) : null, runtimes };
  }

  async dispose(): Promise<void> {
    await this.settle().catch(() => undefined);
    this.#disposed = true;
    for (const live of this.#live.values()) if (live.beginTimer) clearTimeout(live.beginTimer);
    this.#live.clear();
    this.#db?.close();
    this.#db = null;
  }

  // ------------------------------------------------------------------ internals

  #open(): IntelligenceDb | null {
    if (this.#db) return this.#db;
    if (this.#openFailed || this.#disposed) return null;
    try {
      const directory = this.#options.directory;
      let path = ":memory:";
      if (directory) {
        mkdirSync(directory, { recursive: true });
        path = join(directory, "intelligence.sqlite");
      }
      this.#db = new IntelligenceDb(path);
      this.#memory = new ExperienceMemory(this.#db, this.#now);
      this.#maintain();
      return this.#db;
    } catch (error) {
      this.#openFailed = `The Intelligence Core could not open its database: ${error instanceof Error ? error.message : String(error)}`;
      this.#options.log?.("error", this.#openFailed);
      return null;
    }
  }

  /** Housekeeping, run when the database opens and every 200 events: never on a timer. */
  #maintain(): void {
    const db = this.#db;
    if (!db) return;
    this.#meter.measure("maintain", () => {
      const now = this.#now();
      // Cut off by a crash or restart: not a result either way.
      for (const row of db.staleRunning(now - STALE_RUNNING_MS)) {
        db.updateOutcome(row.id, {
          status: "interrupted",
          endedAt: now,
          verificationReasons: ["Cut off: no end was ever recorded (app closed or crashed)."],
        });
      }
      // Team-run turns whose task verdict never came: learn from what they have.
      for (const workspaceId of db.workspaces()) {
        for (const row of db.outcomes(workspaceId, { limit: 500, finishedOnly: true })) {
          if (
            !row.learned &&
            row.origin === "team-run" &&
            row.status !== "running" &&
            (row.endedAt ?? row.startedAt) < now - TEAM_VERDICT_WAIT_MS
          ) {
            this.#learn(row);
          }
        }
        db.pruneOutcomes(workspaceId, OUTCOMES_PER_WORKSPACE);
        db.pruneDecisions(workspaceId, DECISIONS_PER_WORKSPACE);
      }
      this.#memory?.maintain();
    });
  }

  #afterRelabel(workspaceId: string, outcomeId: string): void {
    this.#touchHistory(this.#db?.outcome(outcomeId) ?? null);
    this.#dirtyModels.add(workspaceId);
  }

  /**
   * Keeps a cached history in step with one changed row, instead of reading up to 2,000 rows
   * again after every finished turn (that read takes tens of milliseconds on the main process).
   */
  #touchHistory(row: OutcomeRow | null): void {
    if (!row) return;
    const cached = this.#history.get(row.workspaceId);
    if (!cached) return;
    const index = cached.findIndex((item) => item.id === row.id);
    if (index >= 0) cached.splice(index, 1);
    if (row.status === "running") return;
    const at = cached.findIndex((item) => item.startedAt < row.startedAt);
    cached.splice(at < 0 ? cached.length : at, 0, row);
    if (cached.length > MAX_HISTORY) cached.length = MAX_HISTORY;
  }

  #historyFor(workspaceId: string): OutcomeRow[] {
    const cached = this.#history.get(workspaceId);
    if (cached) return cached;
    const db = this.#open();
    if (!db) return [];
    const rows = this.#meter.measure("db:history", () =>
      db.outcomes(workspaceId, { limit: MAX_HISTORY, finishedOnly: true }),
    );
    this.#history.set(workspaceId, rows);
    while (this.#history.size > 4)
      this.#history.delete(this.#history.keys().next().value as string);
    return rows;
  }

  #modelFor(workspaceId: string): LogisticState {
    if (this.#dirtyModels.has(workspaceId)) {
      this.#dirtyModels.delete(workspaceId);
      return this.#rebuildModel(workspaceId);
    }
    const cached = this.#models.get(workspaceId);
    if (cached) return cached;
    const db = this.#open();
    const restored = restoreLogistic(db?.policy(modelName(workspaceId)) ?? null);
    this.#models.set(workspaceId, restored);
    return restored;
  }

  /**
   * Feedback or an exclusion changed what past work teaches: replay every labelled outcome in
   * time order (test-then-train, so the quality numbers stay honest). A few milliseconds for
   * thousands of outcomes.
   */
  #rebuildModel(workspaceId: string): LogisticState {
    const db = this.#open();
    if (!db) return emptyLogistic();
    return this.#meter.measure("model:rebuild", () => {
      const rows = db
        .outcomes(workspaceId, { limit: OUTCOMES_PER_WORKSPACE, finishedOnly: true })
        .reverse();
      let state = emptyLogistic();
      for (const row of rows) {
        const label = labelOf(row);
        if (!label || !row.features) continue;
        state = learnLogistic(state, row.features, label.failed);
      }
      this.#models.set(workspaceId, state);
      db.savePolicy(modelName(workspaceId), state, this.#now());
      db.snapshotPolicy(modelName(workspaceId), state, state.updates, this.#now());
      return state;
    });
  }

  #candidates(workspaceId: string): Candidate[] {
    return this.#ports
      .listBots()
      .filter((bot) => bot.workspaceId === workspaceId)
      .map((bot) => {
        const snapshot = this.#safe(() => this.#ports.queue(bot.id), null);
        const deliveries = snapshot?.deliveries ?? [];
        return {
          botId: bot.id,
          botName: bot.name,
          provider: safeProvider(bot.model),
          model: bot.model,
          queued: deliveries.filter((item) => item.status === "queued").length,
          busy: deliveries.some((item) => item.status === "running" || item.status === "starting"),
          available: !snapshot?.paused,
          unavailableReason: snapshot?.paused ? "its queue is paused" : undefined,
        };
      });
  }

  #candidatesWith(workspaceId: string, includeBotId?: string | null): Candidate[] {
    const candidates = this.#candidates(workspaceId);
    if (includeBotId && !candidates.some((item) => item.botId === includeBotId)) {
      candidates.push({
        botId: includeBotId,
        botName: includeBotId,
        provider: null,
        model: null,
        queued: 0,
        busy: false,
        available: false,
        unavailableReason: "not a coworker in this workspace",
      });
    }
    return candidates;
  }

  #ranking(workspaceId: string, category: TaskCategory, includeBotId?: string | null) {
    return rankCandidates(
      this.#historyFor(workspaceId),
      this.#candidatesWith(workspaceId, includeBotId),
      category,
      { now: this.#now() },
    );
  }

  /** `trials`: a weak usual coworker's work may go to others on trial (adaptive team runs). */
  #choose(
    workspaceId: string,
    category: TaskCategory,
    defaultBotId: string | null,
    trials = false,
  ): RouteChoice {
    if (!trials) {
      return chooseRoute(this.#ranking(workspaceId, category, defaultBotId), defaultBotId);
    }
    return chooseRouteWithTrials(
      this.#historyFor(workspaceId),
      this.#candidatesWith(workspaceId, defaultBotId),
      category,
      defaultBotId,
      { now: this.#now() },
    );
  }

  #routingImpact(db: IntelligenceDb, workspaceId: string): IntelligenceRoutingImpact {
    const settled = db
      .decisions(workspaceId, 500)
      .filter((row) => row.kind === "route" && row.outcomeLabel !== null);
    const switched = settled.filter((row) => row.applied && row.chosenBotId !== row.defaultBotId);
    const kept = settled.filter((row) => !row.applied || row.chosenBotId === row.defaultBotId);
    const mean = (rows: typeof settled) =>
      rows.length
        ? round(rows.reduce((sum, row) => sum + (row.outcomeLabel ?? 0), 0) / rows.length)
        : null;
    const switchedSuccess = mean(switched);
    const keptSuccess = mean(kept);
    let verdict: string;
    if (switched.length < 5 || kept.length < 5) {
      verdict = `Not enough settled team-run decisions to compare yet (switched ${switched.length}, kept ${kept.length}; 5 of each needed).`;
    } else if ((switchedSuccess ?? 0) > (keptSuccess ?? 0)) {
      verdict = `Tasks the Intelligence Core reassigned succeeded ${Math.round((switchedSuccess ?? 0) * 100)}% of the time, against ${Math.round((keptSuccess ?? 0) * 100)}% for tasks left with the usual coworker.`;
    } else {
      verdict = `Reassigned tasks did not do better (${Math.round((switchedSuccess ?? 0) * 100)}% vs ${Math.round((keptSuccess ?? 0) * 100)}%). Consider turning adaptive routing off.`;
    }
    return { switched: switched.length, switchedSuccess, kept: kept.length, keptSuccess, verdict };
  }

  #workspace(input: string | null): string {
    if (input && input !== "default") return input;
    return this.#safe(() => this.#ports.activeWorkspaceId(), null) ?? input ?? "default";
  }

  #queuedCount(botId: string): number {
    const snapshot = this.#safe(() => this.#ports.queue(botId), null);
    return snapshot?.deliveries.filter((item) => item.status === "queued").length ?? 0;
  }

  #memoryNow(): { freeMb: number; totalMb: number; pressure: "ok" | "low" | "critical" } {
    return this.#safe(() => this.#ports.memory(), {
      freeMb: 0,
      totalMb: 0,
      pressure: "ok" as const,
    });
  }

  #safe<T>(read: () => T, fallback: T): T {
    try {
      return read();
    } catch {
      return fallback;
    }
  }

  #fail(where: string, error: unknown): void {
    this.#lastError = `${where}: ${error instanceof Error ? error.message : String(error)}`;
    this.#options.log?.("warn", `Intelligence ${this.#lastError}`);
  }
}

function modelName(workspaceId: string): string {
  return `failure:${workspaceId}`;
}

function originOf(delivery: QueueDelivery | null): OutcomeOrigin {
  if (!delivery) return "other";
  if (delivery.sender.kind === "bot") return "other";
  switch (delivery.origin) {
    case "team-run":
      return "team-run";
    case "schedule":
      return "schedule";
    case "routine":
      return "routine";
    case "system":
      return "other";
    default:
      return "chat";
  }
}

function safeProvider(model: string | undefined | null): string | null {
  if (!model) return null;
  try {
    return providerForModel(model as BotSummary["model"]);
  } catch {
    return null;
  }
}

function summarise(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS - 1)}…` : flat;
}

function syntheticTask(outcome: OutcomeRow): OrchestratorTask {
  const now = new Date().toISOString();
  return {
    id: outcome.id,
    runId: "",
    title: outcome.summary.slice(0, 80),
    description: outcome.summary,
    role: "code",
    assignedBotId: outcome.botId,
    assignedInstanceId: null,
    dependencies: [],
    inputs: {},
    deliverables: [],
    acceptanceCriteria: [],
    status: "running",
    attemptCount: 0,
    maxAttempts: 1,
    error: null,
    evidence: [],
    createdAt: now,
    updatedAt: now,
  };
}

function compactCandidates(choice: RouteChoice): unknown {
  return choice.ranking.candidates.slice(0, 6).map((item) => ({
    botId: item.botId,
    successRate: item.successRate,
    lower: item.lower,
    samples: item.samples,
    score: item.score,
  }));
}

function validRole(role: string | null | undefined): OrchestratorTask["role"] | null {
  const roles: OrchestratorTask["role"][] = [
    "orchestrator",
    "architect",
    "frontend",
    "backend",
    "code",
    "qa",
    "security",
    "research",
    "finance",
    "ops",
  ];
  return roles.includes(role as OrchestratorTask["role"])
    ? (role as OrchestratorTask["role"])
    : null;
}

function toView(row: OutcomeRow, botName: string): IntelligenceOutcome {
  return {
    id: row.id,
    botId: row.botId,
    botName,
    provider: row.provider,
    model: row.model,
    category: isCategory(row.category) ? row.category : "general",
    origin: row.origin,
    runId: row.runId,
    taskId: row.taskId,
    startedAt: row.startedAt,
    durationMs: row.durationMs,
    status: row.status,
    verification: row.verification,
    verificationReasons: row.verificationReasons,
    toolCalls: row.toolCalls,
    toolErrors: row.toolErrors,
    errorSignature: row.errorSignature,
    predictedFailure: row.predictedFailure,
    predictedDurationMs: row.predictedDurationMs,
    predictionSource: row.predictionSource,
    feedback: row.feedback,
    feedbackNote: row.feedbackNote,
    excluded: row.excluded,
    summary: row.summary,
    labelBasis: labelOf(row)?.basis ?? null,
  };
}

function experienceView(row: {
  id: string;
  kind: IntelligenceExperience["kind"];
  trust: IntelligenceExperience["trust"];
  category: string | null;
  botId: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  uses: number;
  correctedFrom: string | null;
}): IntelligenceExperience {
  return {
    id: row.id,
    kind: row.kind,
    trust: row.trust,
    category: row.category,
    botId: row.botId,
    text: row.text,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    uses: row.uses,
    correctedFrom: row.correctedFrom,
  };
}

function fileBytes(path: string): number | null {
  if (!path || path === ":memory:") return null;
  try {
    let bytes = statSync(path).size;
    for (const suffix of ["-wal", "-shm"]) {
      try {
        bytes += statSync(`${path}${suffix}`).size;
      } catch {
        // No such side file.
      }
    }
    return bytes;
  } catch {
    return null;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
