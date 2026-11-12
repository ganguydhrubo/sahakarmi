import type { OutcomeRow } from "./intelligence-db";
import { labelOf } from "./outcome-label";
import { betaPosterior, decayWeight, quantile, sampleBeta, seededRandom } from "./stats";
import type { TaskCategory } from "./task-classifier";

/**
 * Picks the coworker for a kind of work from what actually happened before.
 *
 * For every candidate it builds a Beta posterior of its success rate on this kind of task:
 * evidence is weighted by how strong it was (see outcome-label) and by age (a half-life), and
 * thin data is pulled toward a prior made of the workspace's rate for this kind of work and
 * the coworker's rate on all work (empirical Bayes). Speed and queue length are small
 * penalties on top.
 *
 * It never assumes a capability: a coworker with no record is "no evidence", never "good", and
 * the default coworker is only replaced when another one is clearly better on the evidence
 * (its pessimistic estimate beats the default's average) or the default cannot work.
 */

export interface Candidate {
  botId: string;
  botName: string;
  provider: string | null;
  model: string | null;
  /** Messages waiting in its queue (not counting the one running). */
  queued: number;
  /** Is it working right now? */
  busy: boolean;
  /** False when it cannot take work (removed, its AI not set up, another workspace). */
  available: boolean;
  unavailableReason?: string;
}

export interface RankedCandidate {
  botId: string;
  botName: string;
  provider: string | null;
  model: string | null;
  available: boolean;
  unavailableReason: string | null;
  /** Posterior success rate on this kind of work, with a 90% interval. */
  successRate: number;
  lower: number;
  upper: number;
  /** Posterior standard deviation of the success rate (its uncertainty). */
  sd: number;
  /** Weighted evidence on this kind of work (strong evidence counts 1, weak 0.5). */
  evidence: number;
  /** Raw counts on this kind of work in the window. */
  samples: number;
  verified: number;
  failed: number;
  /** Typical and slow durations on this kind of work. */
  medianMs: number | null;
  p90Ms: number | null;
  /** Expected wait before it could start (queue × its typical duration). */
  waitMs: number;
  /** The number used to rank (higher is better). */
  score: number;
  reasons: string[];
}

export interface Ranking {
  category: TaskCategory;
  candidates: RankedCandidate[];
  /** Best available candidate by the ranking, or null when none can work. */
  best: RankedCandidate | null;
  /** The prior used: workspace rate on this kind of work. */
  prior: { mean: number; evidence: number };
}

export interface RouteChoice {
  ranking: Ranking;
  chosenBotId: string | null;
  defaultBotId: string | null;
  /** True when the evidence says another coworker should do it instead of the default. */
  switchFromDefault: boolean;
  confidence: "high" | "medium" | "low" | "none";
  explanation: string;
  /** True when this is a trial: the usual coworker is weak here and another one gets a turn. */
  trial?: boolean;
}

export interface RankOptions {
  now?: number;
  /** Older evidence counts half after this long. */
  halfLifeDays?: number;
  /** Only outcomes newer than this are read. */
  windowDays?: number;
  /** "conservative" ranks by the pessimistic estimate (default); "thompson" samples. */
  strategy?: "conservative" | "mean" | "thompson";
  random?: () => number;
  /** Penalty weights (0..1) for slowness relative to the slowest candidate and for waiting. */
  latencyWeight?: number;
  waitWeight?: number;
}

/** Evidence a coworker needs on a kind of work before it may replace the default. */
export const MIN_SAMPLES_TO_SWITCH = 5;
/**
 * A usual coworker whose record on a kind of work is below this (over at least
 * MIN_SAMPLES_TO_SWITCH tasks) is weak there: other coworkers may get trial tasks.
 */
export const WEAK_DEFAULT = 0.6;
/** Smallest success-rate lead (10 points) worth moving work for. */
export const MIN_GAP_TO_SWITCH = 0.1;
/** z for a one-sided 95% test. */
const Z95 = 1.6448536269514722;

function posteriorSd(alpha: number, beta: number): number {
  const total = alpha + beta;
  return total > 0 ? Math.sqrt((alpha * beta) / (total * total * (total + 1))) : 0.5;
}
const DAY_MS = 86_400_000;
const WAIT_SCALE_MS = 30 * 60_000;

interface Tally {
  s: number;
  f: number;
  samples: number;
  verified: number;
  failed: number;
  durations: number[];
}

function emptyTally(): Tally {
  return { s: 0, f: 0, samples: 0, verified: 0, failed: 0, durations: [] };
}

/** Outcomes must already be from one workspace (the caller's query guarantees it). */
export function rankCandidates(
  outcomes: readonly OutcomeRow[],
  candidates: readonly Candidate[],
  category: TaskCategory,
  options: RankOptions = {},
): Ranking {
  const now = options.now ?? Date.now();
  const halfLife = (options.halfLifeDays ?? 30) * DAY_MS;
  const since = now - (options.windowDays ?? 180) * DAY_MS;
  const strategy = options.strategy ?? "conservative";
  const random = options.random ?? seededRandom(now);
  const latencyWeight = options.latencyWeight ?? 0.1;
  const waitWeight = options.waitWeight ?? 0.15;

  const inCategory = new Map<string, Tally>();
  const overall = new Map<string, Tally>();
  const categoryAll = emptyTally();
  for (const outcome of outcomes) {
    if (outcome.startedAt < since) continue;
    const label = labelOf(outcome);
    if (!label) continue;
    const weight = decayWeight(now - outcome.startedAt, halfLife);
    const add = (tally: Tally) => {
      tally.s += label.successes * weight;
      tally.f += label.failures * weight;
      tally.samples += 1;
      if (outcome.verification === "verified" || outcome.feedback === "good") tally.verified += 1;
      if (label.failed) tally.failed += 1;
      if (!label.failed && outcome.durationMs !== null && tally.durations.length < 200) {
        tally.durations.push(outcome.durationMs);
      }
    };
    const all = overall.get(outcome.botId) ?? emptyTally();
    add(all);
    overall.set(outcome.botId, all);
    if (outcome.category !== category) continue;
    add(categoryAll);
    const own = inCategory.get(outcome.botId) ?? emptyTally();
    add(own);
    inCategory.set(outcome.botId, own);
  }

  const categoryEvidence = categoryAll.s + categoryAll.f;
  const priorMean = categoryEvidence > 0 ? (categoryAll.s + 1) / (categoryEvidence + 2) : 0.5;

  const posteriors = new Map<string, { alpha: number; beta: number }>();
  const ranked: RankedCandidate[] = candidates.map((candidate) => {
    const own = inCategory.get(candidate.botId) ?? emptyTally();
    const all = overall.get(candidate.botId) ?? emptyTally();
    // Its record on OTHER kinds of work shifts its prior a little; its record on this kind is
    // the evidence itself and must not be counted twice.
    const otherS = Math.max(0, all.s - own.s);
    const otherF = Math.max(0, all.f - own.f);
    const otherEvidence = otherS + otherF;
    const botMean = otherEvidence > 0 ? (otherS + 1) / (otherEvidence + 2) : priorMean;
    const botWeight = Math.min(4, otherEvidence);
    const blendedPrior = (2 * priorMean + botWeight * botMean) / (2 + botWeight);
    const posterior = betaPosterior(own.s, own.f, blendedPrior, 3);
    posteriors.set(candidate.botId, { alpha: posterior.alpha, beta: posterior.beta });
    const medianMs = quantile(own.durations, 0.5);
    const p90Ms = quantile(own.durations, 0.9);
    const typical = medianMs ?? quantile(categoryAll.durations, 0.5) ?? 0;
    const waitMs = Math.round((candidate.queued + (candidate.busy ? 0.5 : 0)) * typical);
    const reasons: string[] = [];
    if (own.samples === 0) {
      reasons.push(`no record on ${category} work yet`);
    } else {
      reasons.push(
        `${own.samples} ${category} task${own.samples === 1 ? "" : "s"}: ${own.verified} verified, ${own.failed} failed`,
      );
    }
    if (medianMs !== null) reasons.push(`usually takes ${formatDuration(medianMs)}`);
    if (candidate.queued > 0) reasons.push(`${candidate.queued} waiting in its queue`);
    if (!candidate.available) reasons.push(candidate.unavailableReason ?? "cannot take work now");
    return {
      botId: candidate.botId,
      botName: candidate.botName,
      provider: candidate.provider,
      model: candidate.model,
      available: candidate.available,
      unavailableReason: candidate.available
        ? null
        : (candidate.unavailableReason ?? "unavailable"),
      successRate: round(posterior.mean),
      lower: round(posterior.lower),
      upper: round(posterior.upper),
      sd: round(posteriorSd(posterior.alpha, posterior.beta)),
      evidence: round(posterior.evidence),
      samples: own.samples,
      verified: own.verified,
      failed: own.failed,
      medianMs: medianMs === null ? null : Math.round(medianMs),
      p90Ms: p90Ms === null ? null : Math.round(p90Ms),
      waitMs,
      score: 0,
      reasons,
    };
  });

  const slowest = Math.max(0, ...ranked.map((item) => item.medianMs ?? 0));
  for (const item of ranked) {
    const posterior = posteriors.get(item.botId) ?? { alpha: 1, beta: 1 };
    const base =
      strategy === "thompson"
        ? sampleBeta(posterior.alpha, posterior.beta, random)
        : strategy === "mean"
          ? item.successRate
          : item.lower;
    const latency = slowest > 0 && item.medianMs !== null ? item.medianMs / slowest : 0;
    const wait = Math.min(1, item.waitMs / WAIT_SCALE_MS);
    item.score = round(base - latencyWeight * latency - waitWeight * wait);
  }
  ranked.sort(
    (a, b) =>
      Number(b.available) - Number(a.available) ||
      b.score - a.score ||
      b.evidence - a.evidence ||
      a.botName.localeCompare(b.botName),
  );
  return {
    category,
    candidates: ranked,
    best: ranked.find((item) => item.available) ?? null,
    prior: { mean: round(priorMean), evidence: round(categoryEvidence) },
  };
}

/**
 * The routing decision: keep the default coworker unless the evidence clearly favours another
 * one, or the default cannot work. Always says why.
 */
export function chooseRoute(ranking: Ranking, defaultBotId: string | null): RouteChoice {
  const byId = new Map(ranking.candidates.map((item) => [item.botId, item]));
  const fallback = defaultBotId ? (byId.get(defaultBotId) ?? null) : null;
  const best = ranking.best;
  if (!best) {
    return {
      ranking,
      chosenBotId: null,
      defaultBotId,
      switchFromDefault: false,
      confidence: "none",
      explanation: "No coworker in this workspace can take the work now.",
    };
  }
  if (!defaultBotId) {
    // A plain question ("who should do this?"): rank on the record, and say when there is none.
    const anyRecord = ranking.candidates.some((item) => item.samples > 0);
    const confidence =
      best.samples >= 15
        ? "high"
        : best.samples >= MIN_SAMPLES_TO_SWITCH
          ? "medium"
          : anyRecord
            ? "low"
            : "none";
    const explanation = !anyRecord
      ? `No coworker has a record on ${ranking.category} work here yet, so there is no evidence-based pick: ${best.botName} is listed first only by order. Finished work will show who is good at it.`
      : best.samples === 0
        ? `${best.botName} has no record on ${ranking.category} work yet but ranks first because the others' records are weaker.`
        : `${best.botName} has the best record on ${ranking.category} work here: ${best.reasons.join("; ")}.`;
    return {
      ranking,
      chosenBotId: best.botId,
      defaultBotId: null,
      switchFromDefault: false,
      confidence,
      explanation,
    };
  }
  if (!fallback?.available) {
    const why = fallback
      ? `${fallback.botName} cannot take work (${fallback.unavailableReason ?? "unavailable"})`
      : "the usual coworker for this work does not exist here";
    return {
      ranking,
      chosenBotId: best.botId,
      defaultBotId,
      switchFromDefault: fallback !== null || defaultBotId !== null,
      confidence: best.samples >= MIN_SAMPLES_TO_SWITCH ? "medium" : "low",
      explanation: `${capitalise(why)}, so ${best.botName} takes it (${best.reasons.join("; ")}).`,
    };
  }
  // Both records are uncertain: the gap must be large and unlikely to be luck, measured
  // against the uncertainty of both (one-sided 95% test), not just the newcomer's.
  const gap = best.successRate - fallback.successRate;
  const spread = Math.sqrt(best.sd ** 2 + fallback.sd ** 2);
  const clearlyBetter =
    best.botId !== fallback.botId &&
    best.samples >= MIN_SAMPLES_TO_SWITCH &&
    gap >= MIN_GAP_TO_SWITCH &&
    spread > 0 &&
    gap / spread >= Z95 &&
    best.waitMs <= fallback.waitMs + WAIT_SCALE_MS;
  if (clearlyBetter) {
    return {
      ranking,
      chosenBotId: best.botId,
      defaultBotId,
      switchFromDefault: true,
      confidence: best.samples >= 15 && fallback.samples >= 15 ? "high" : "medium",
      explanation: `${best.botName} is clearly better at ${ranking.category} work here: likely ${percent(best.successRate)} success against ${percent(fallback.successRate)} for ${fallback.botName}, a gap of ${Math.round(gap * 100)} points that is unlikely to be luck on this evidence (95% test). ${best.botName}: ${best.reasons.join("; ")}. ${fallback.botName}: ${fallback.reasons.join("; ")}.`,
    };
  }
  const confidence =
    fallback.samples >= 15 ? "high" : fallback.samples >= MIN_SAMPLES_TO_SWITCH ? "medium" : "low";
  const note =
    best.botId !== fallback.botId
      ? ` ${best.botName} ranks higher (${percent(best.successRate)}) but the evidence is not strong enough to switch (${best.samples} task${best.samples === 1 ? "" : "s"}, need ${MIN_SAMPLES_TO_SWITCH} and a clear margin).`
      : "";
  return {
    ranking,
    chosenBotId: fallback.botId,
    defaultBotId,
    switchFromDefault: false,
    confidence,
    explanation: `${fallback.botName} keeps it: ${fallback.reasons.join("; ")}.${note}`,
  };
}

/**
 * chooseRoute, plus trials. Without trials a weak usual coworker keeps every task and no one
 * else ever builds the record that would show they are better (the routing simulation shows
 * exactly that). So when the usual coworker has a weak record on this kind of work
 * (below WEAK_DEFAULT over at least MIN_SAMPLES_TO_SWITCH tasks), the pick is drawn by
 * Thompson sampling: coworkers with little or good evidence get a share, clearly worse ones
 * rarely do, and it settles on the best as evidence grows. A usual coworker that does well is
 * never disturbed. Used for team runs in adaptive mode only.
 */
export function chooseRouteWithTrials(
  outcomes: readonly OutcomeRow[],
  candidates: readonly Candidate[],
  category: TaskCategory,
  defaultBotId: string | null,
  options: RankOptions = {},
): RouteChoice {
  const ranking = rankCandidates(outcomes, candidates, category, {
    ...options,
    strategy: "conservative",
  });
  const choice = chooseRoute(ranking, defaultBotId);
  if (choice.switchFromDefault || !defaultBotId) return choice;
  const usual = ranking.candidates.find((item) => item.botId === defaultBotId);
  if (
    !usual?.available ||
    usual.samples < MIN_SAMPLES_TO_SWITCH ||
    usual.successRate >= WEAK_DEFAULT
  ) {
    return choice;
  }
  const sampled = rankCandidates(outcomes, candidates, category, {
    ...options,
    strategy: "thompson",
  });
  const pick = sampled.best;
  if (!pick || pick.botId === defaultBotId) return choice;
  return {
    ranking,
    chosenBotId: pick.botId,
    defaultBotId,
    switchFromDefault: true,
    confidence: "low",
    trial: true,
    explanation: `Trying ${pick.botName}: ${usual.botName} succeeds only about ${percent(usual.successRate)} on ${category} work here (${usual.samples} tasks), so other coworkers get a share of this work until one proves better. ${pick.botName}: ${pick.reasons.join("; ")}.`,
  };
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
