import type { OutcomeRow, PredictionSource } from "./intelligence-db";
import {
  type Features,
  type LogisticState,
  logisticQuality,
  predictLogistic,
} from "./online-logistic";
import { labelOf } from "./outcome-label";
import { betaPosterior, brier, clamp, decayWeight, quantile } from "./stats";
import { TASK_CATEGORIES, type TaskCategory } from "./task-classifier";

/**
 * Lightweight predictions from the workspace's own history. Each prediction says where it came
 * from: "model" (the failure model, only once it measurably beats the plain rate), "history"
 * (this coworker's record on this kind of work) or "estimate" (transparent rules, used when
 * there is too little history; always shown as an estimate).
 */

export interface FailurePrediction {
  probability: number;
  source: PredictionSource;
  /** How the number was reached, in a sentence. */
  basis: string;
}

export interface DurationPrediction {
  medianMs: number;
  p90Ms: number;
  source: PredictionSource;
  samples: number;
  basis: string;
}

export interface PredictionContext {
  botId: string;
  provider: string | null;
  category: TaskCategory;
  origin: string;
  promptChars: number;
  /** Messages waiting for this coworker when the work starts. */
  queued: number;
  memoryPressure: "ok" | "low" | "critical";
  now: number;
}

const DAY_MS = 86_400_000;
const HALF_LIFE_MS = 30 * DAY_MS;
/** Labelled outcomes on this coworker and kind of work before its own rate is used. */
const MIN_HISTORY = 3;

/**
 * Rule-based durations used only without history, per kind of work. Shown as estimates; they
 * are deliberately round numbers, not measurements.
 */
const ESTIMATED_MINUTES: Record<TaskCategory, [number, number]> = {
  code: [6, 20],
  testing: [5, 15],
  research: [4, 12],
  writing: [2, 6],
  data: [4, 12],
  browser: [5, 15],
  design: [5, 15],
  ops: [2, 8],
  security: [6, 20],
  general: [2, 8],
};

/** Features for the failure model, all known when the work starts (no peeking at the end). */
export function buildFeatures(
  history: readonly OutcomeRow[],
  context: PredictionContext,
): Features {
  const features: Features = {
    [`category:${context.category}`]: 1,
    [`provider:${context.provider ?? "unknown"}`]: 1,
    [`origin:${context.origin}`]: 1,
    promptLength: Math.log1p(context.promptChars) / 10,
    queued: Math.min(10, context.queued) / 10,
    memoryLow: context.memoryPressure === "low" ? 1 : 0,
    memoryCritical: context.memoryPressure === "critical" ? 1 : 0,
  };
  const own = recentFor(history, context.botId, context.category, context.now);
  features.botFailureRate = own.posteriorFailure;
  features.recentFailures = Math.min(3, own.streak) / 3;
  features.noHistory = own.samples === 0 ? 1 : 0;
  return features;
}

interface RecentRecord {
  samples: number;
  posteriorFailure: number;
  /** Failures in a row, newest first. */
  streak: number;
}

function recentFor(
  history: readonly OutcomeRow[],
  botId: string,
  category: string,
  now: number,
): RecentRecord {
  let s = 0;
  let f = 0;
  let samples = 0;
  let streak = 0;
  let streakOpen = true;
  // History is newest first.
  for (const outcome of history) {
    if (outcome.botId !== botId || outcome.category !== category) continue;
    const label = labelOf(outcome);
    if (!label) continue;
    const weight = decayWeight(now - outcome.startedAt, HALF_LIFE_MS);
    s += label.successes * weight;
    f += label.failures * weight;
    samples += 1;
    if (streakOpen) {
      if (label.failed) streak += 1;
      else streakOpen = false;
    }
  }
  const posterior = betaPosterior(s, f, 0.5, 2);
  return { samples, posteriorFailure: 1 - posterior.mean, streak };
}

export function predictFailure(
  history: readonly OutcomeRow[],
  context: PredictionContext,
  model: LogisticState | null,
): FailurePrediction {
  if (model) {
    const quality = logisticQuality(model);
    if (quality.useful) {
      const probability = predictLogistic(model, buildFeatures(history, context));
      return {
        probability: round(probability),
        source: "model",
        basis: `Failure model trained on ${quality.updates} finished tasks; its Brier score ${quality.brier} beats the plain rate's ${quality.baselineBrier}.`,
      };
    }
  }
  const own = recentFor(history, context.botId, context.category, context.now);
  if (own.samples >= MIN_HISTORY) {
    return {
      probability: round(own.posteriorFailure),
      source: "history",
      basis: `This coworker's record on ${context.category} work: ${own.samples} finished tasks${own.streak ? `, the last ${own.streak} failed` : ""}.`,
    };
  }
  // Transparent rules, labelled as an estimate.
  let probability = 0.2;
  const parts = ["base 20%"];
  if (context.promptChars > 4_000) {
    probability += 0.05;
    parts.push("long request +5%");
  }
  if (context.queued >= 3) {
    probability += 0.05;
    parts.push("busy queue +5%");
  }
  if (context.memoryPressure === "critical") {
    probability += 0.15;
    parts.push("memory critical +15%");
  } else if (context.memoryPressure === "low") {
    probability += 0.05;
    parts.push("memory low +5%");
  }
  if (own.streak > 0) {
    const bump = Math.min(0.3, own.streak * 0.1);
    probability += bump;
    parts.push(
      `${own.streak} recent failure${own.streak === 1 ? "" : "s"} +${Math.round(bump * 100)}%`,
    );
  }
  if (context.category === "browser" || context.category === "security") {
    probability += 0.05;
    parts.push(`${context.category} work +5%`);
  }
  return {
    probability: round(clamp(probability, 0.05, 0.9)),
    source: "estimate",
    basis: `Estimate (too little history, ${own.samples} finished task${own.samples === 1 ? "" : "s"}): ${parts.join(", ")}.`,
  };
}

export function predictDuration(
  history: readonly OutcomeRow[],
  botId: string,
  category: TaskCategory,
): DurationPrediction {
  const own: number[] = [];
  const all: number[] = [];
  for (const outcome of history) {
    if (outcome.category !== category || outcome.durationMs === null) continue;
    const label = labelOf(outcome);
    if (!label || label.failed) continue;
    if (all.length < 400) all.push(outcome.durationMs);
    if (outcome.botId === botId && own.length < 200) own.push(outcome.durationMs);
  }
  if (own.length >= MIN_HISTORY) {
    return {
      medianMs: Math.round(quantile(own, 0.5) ?? 0),
      p90Ms: Math.round(quantile(own, 0.9) ?? 0),
      source: "history",
      samples: own.length,
      basis: `${own.length} earlier ${category} tasks by this coworker.`,
    };
  }
  if (all.length >= MIN_HISTORY) {
    return {
      medianMs: Math.round(quantile(all, 0.5) ?? 0),
      p90Ms: Math.round(quantile(all, 0.9) ?? 0),
      source: "history",
      samples: all.length,
      basis: `${all.length} earlier ${category} tasks by any coworker in this workspace.`,
    };
  }
  const [median, slow] = ESTIMATED_MINUTES[category];
  return {
    medianMs: median * 60_000,
    p90Ms: slow * 60_000,
    source: "estimate",
    samples: own.length,
    basis: `Estimate: typical ${category} work, no measured history yet.`,
  };
}

export interface OverloadRow {
  botId: string;
  botName: string;
  queued: number;
  busy: boolean;
  /** Expected time to clear the queue. */
  expectedWaitMs: number;
  source: PredictionSource;
  overloaded: boolean;
  reason: string | null;
}

/** Queue length × typical duration per coworker; overloaded at 30 min of waiting or 5 queued. */
export function predictOverload(
  history: readonly OutcomeRow[],
  queues: ReadonlyArray<{ botId: string; botName: string; queued: number; busy: boolean }>,
): OverloadRow[] {
  return queues
    .map((queue) => {
      const durations: number[] = [];
      for (const outcome of history) {
        if (outcome.botId !== queue.botId || outcome.durationMs === null) continue;
        if (outcome.status !== "succeeded" && outcome.status !== "failed") continue;
        durations.push(outcome.durationMs);
        if (durations.length >= 100) break;
      }
      const typical =
        durations.length >= MIN_HISTORY ? (quantile(durations, 0.5) ?? 0) : 5 * 60_000;
      const source: PredictionSource = durations.length >= MIN_HISTORY ? "history" : "estimate";
      const expectedWaitMs = Math.round((queue.queued + (queue.busy ? 0.5 : 0)) * typical);
      const overloaded = queue.queued >= 5 || expectedWaitMs >= 30 * 60_000;
      return {
        ...queue,
        expectedWaitMs,
        source,
        overloaded,
        reason: overloaded
          ? queue.queued >= 5
            ? `${queue.queued} messages waiting`
            : `about ${Math.round(expectedWaitMs / 60_000)} min of queued work`
          : null,
      };
    })
    .sort((a, b) => b.expectedWaitMs - a.expectedWaitMs);
}

export interface ErrorPattern {
  signature: string;
  count: number;
  botIds: string[];
  categories: string[];
  lastSeen: number;
  /** Seen at least twice in the window. */
  repeated: boolean;
}

export function errorPatterns(
  history: readonly OutcomeRow[],
  now: number,
  windowDays = 14,
): ErrorPattern[] {
  const since = now - windowDays * DAY_MS;
  const groups = new Map<string, ErrorPattern>();
  for (const outcome of history) {
    if (!outcome.errorSignature || outcome.startedAt < since || outcome.excluded) continue;
    const group = groups.get(outcome.errorSignature) ?? {
      signature: outcome.errorSignature,
      count: 0,
      botIds: [],
      categories: [],
      lastSeen: 0,
      repeated: false,
    };
    group.count += 1;
    if (!group.botIds.includes(outcome.botId)) group.botIds.push(outcome.botId);
    if (!group.categories.includes(outcome.category)) group.categories.push(outcome.category);
    group.lastSeen = Math.max(group.lastSeen, outcome.endedAt ?? outcome.startedAt);
    group.repeated = group.count >= 2;
    groups.set(outcome.errorSignature, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen);
}

export interface Bottleneck {
  kind: "slow-category" | "busy-coworker" | "failing-category";
  subject: string;
  detail: string;
  value: number;
}

/** Where time and failures concentrate in the last `windowDays`. */
export function bottlenecks(
  history: readonly OutcomeRow[],
  now: number,
  windowDays = 30,
): Bottleneck[] {
  const since = now - windowDays * DAY_MS;
  const byCategory = new Map<string, { time: number; n: number; failed: number }>();
  const byBot = new Map<string, number>();
  let total = 0;
  for (const outcome of history) {
    if (outcome.startedAt < since || outcome.durationMs === null) continue;
    const label = labelOf(outcome);
    const entry = byCategory.get(outcome.category) ?? { time: 0, n: 0, failed: 0 };
    entry.time += outcome.durationMs;
    entry.n += 1;
    if (label?.failed) entry.failed += 1;
    byCategory.set(outcome.category, entry);
    byBot.set(outcome.botId, (byBot.get(outcome.botId) ?? 0) + outcome.durationMs);
    total += outcome.durationMs;
  }
  const result: Bottleneck[] = [];
  if (total > 0) {
    for (const [category, entry] of byCategory) {
      const share = entry.time / total;
      if (share >= 0.4 && entry.n >= 3) {
        result.push({
          kind: "slow-category",
          subject: category,
          detail: `${Math.round(share * 100)}% of all working time went to ${category} work (${entry.n} tasks).`,
          value: round(share),
        });
      }
      if (entry.n >= 4 && entry.failed / entry.n >= 0.4) {
        result.push({
          kind: "failing-category",
          subject: category,
          detail: `${entry.failed} of ${entry.n} ${category} tasks failed.`,
          value: round(entry.failed / entry.n),
        });
      }
    }
    for (const [botId, time] of byBot) {
      const share = time / total;
      if (share >= 0.5 && byBot.size > 1) {
        result.push({
          kind: "busy-coworker",
          subject: botId,
          detail: `${Math.round(share * 100)}% of all working time was one coworker's.`,
          value: round(share),
        });
      }
    }
  }
  return result.sort((a, b) => b.value - a.value);
}

export interface PredictionAccuracy {
  /** Labelled outcomes that had a failure prediction stored at their start. */
  scored: number;
  brier: number | null;
  /** Brier of always predicting the overall failure rate, over the same outcomes. */
  baselineBrier: number | null;
  bySource: Array<{ source: PredictionSource; scored: number; brier: number }>;
  /** Median absolute error of duration predictions, as a share of the real duration. */
  durationError: number | null;
  durationScored: number;
}

/** How good the stored predictions turned out to be (measured, never assumed). */
export function predictionAccuracy(history: readonly OutcomeRow[]): PredictionAccuracy {
  const scored: Array<{ p: number; y: 0 | 1; source: PredictionSource }> = [];
  const durationErrors: number[] = [];
  for (const outcome of history) {
    const label = labelOf(outcome);
    if (!label) continue;
    if (outcome.predictedFailure !== null && outcome.predictionSource) {
      scored.push({
        p: outcome.predictedFailure,
        y: label.failed ? 1 : 0,
        source: outcome.predictionSource,
      });
    }
    if (outcome.predictedDurationMs && outcome.durationMs && !label.failed) {
      durationErrors.push(
        Math.abs(outcome.predictedDurationMs - outcome.durationMs) / outcome.durationMs,
      );
    }
  }
  if (scored.length === 0) {
    return {
      scored: 0,
      brier: null,
      baselineBrier: null,
      bySource: [],
      durationError: durationErrors.length ? round(quantile(durationErrors, 0.5) ?? 0) : null,
      durationScored: durationErrors.length,
    };
  }
  const rate = scored.reduce((sum, item) => sum + item.y, 0) / scored.length;
  const model = scored.reduce((sum, item) => sum + brier(item.p, item.y), 0) / scored.length;
  const baseline = scored.reduce((sum, item) => sum + brier(rate, item.y), 0) / scored.length;
  const bySource = (["model", "history", "estimate"] as const)
    .map((source) => {
      const items = scored.filter((item) => item.source === source);
      return {
        source,
        scored: items.length,
        brier: items.length
          ? round(items.reduce((sum, item) => sum + brier(item.p, item.y), 0) / items.length)
          : 0,
      };
    })
    .filter((item) => item.scored > 0);
  return {
    scored: scored.length,
    brier: round(model),
    baselineBrier: round(baseline),
    bySource,
    durationError: durationErrors.length ? round(quantile(durationErrors, 0.5) ?? 0) : null,
    durationScored: durationErrors.length,
  };
}

export function isCategory(value: string): value is TaskCategory {
  return (TASK_CATEGORIES as readonly string[]).includes(value);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
