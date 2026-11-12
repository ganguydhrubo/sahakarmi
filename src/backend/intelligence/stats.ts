/**
 * Small, dependency-free statistics for the Intelligence Core. Everything here is a pure
 * function over numbers, so it is cheap (microseconds), deterministic and easy to test.
 *
 * - Beta–Bernoulli posteriors for "how often does this coworker succeed at this kind of task",
 *   with an empirical-Bayes prior (the workspace-wide rate) so thin data is pulled toward the
 *   average instead of swinging between 0% and 100%.
 * - Exponential forgetting (a half-life), so a coworker that got better or worse is noticed.
 * - Quantiles for durations, and Brier / log-loss scores for honest prediction quality.
 * - A seeded random source and Beta sampling for Thompson sampling, used only when the owner
 *   turns exploration on.
 */

export interface BetaPosterior {
  /** Posterior parameters (prior pseudo-counts plus weighted observations). */
  alpha: number;
  beta: number;
  /** Posterior mean of the success rate. */
  mean: number;
  /** Approximate 90% credible interval (normal approximation, clamped to [0, 1]). */
  lower: number;
  upper: number;
  /** Weighted observations behind it (not counting the prior). */
  evidence: number;
}

/** z for a two-sided 90% interval. */
const Z90 = 1.6448536269514722;

/**
 * Posterior of a success rate from weighted successes and failures and a prior with mean
 * `priorMean` worth `priorStrength` observations.
 */
export function betaPosterior(
  successes: number,
  failures: number,
  priorMean = 0.5,
  priorStrength = 2,
): BetaPosterior {
  const s = Math.max(0, finite(successes));
  const f = Math.max(0, finite(failures));
  const m = clamp(finite(priorMean, 0.5), 0.01, 0.99);
  const k = Math.max(0.5, finite(priorStrength, 2));
  const alpha = m * k + s;
  const beta = (1 - m) * k + f;
  const total = alpha + beta;
  const mean = alpha / total;
  const variance = (alpha * beta) / (total * total * (total + 1));
  const sd = Math.sqrt(variance);
  return {
    alpha,
    beta,
    mean,
    lower: clamp(mean - Z90 * sd, 0, 1),
    upper: clamp(mean + Z90 * sd, 0, 1),
    evidence: s + f,
  };
}

/** Weight of an observation `ageMs` old under a half-life (1 when fresh, 0.5 after one half-life). */
export function decayWeight(ageMs: number, halfLifeMs: number): number {
  if (!(halfLifeMs > 0)) return 1;
  const age = Math.max(0, finite(ageMs));
  return 0.5 ** (age / halfLifeMs);
}

/** The q-quantile (0..1) of a list, by linear interpolation. Null for an empty list. */
export function quantile(values: readonly number[], q: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = clamp(q, 0, 1) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (position - low);
}

/** Brier score of one probabilistic prediction for a 0/1 outcome (lower is better). */
export function brier(probability: number, outcome: 0 | 1): number {
  const p = clamp(probability, 0, 1);
  return (p - outcome) ** 2;
}

/** Log loss of one prediction, with p clipped away from 0 and 1 (lower is better). */
export function logLoss(probability: number, outcome: 0 | 1): number {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return outcome === 1 ? -Math.log(p) : -Math.log(1 - p);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/**
 * mulberry32: a tiny seeded generator. Tests pass a seed so Thompson sampling is repeatable;
 * the app seeds it from the clock.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(random: () => number): number {
  // Box–Muller; 1 - u keeps log() away from 0.
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, 1) by Marsaglia and Tsang (2000); shape < 1 uses the boost trick. */
export function sampleGamma(shape: number, random: () => number): number {
  if (shape < 1) {
    const boosted = sampleGamma(shape + 1, random);
    return boosted * random() ** (1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let guard = 0; guard < 1_000; guard += 1) {
    let x = 0;
    let v = 0;
    do {
      x = standardNormal(random);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return shape; // Unreachable in practice; the mean is a safe answer.
}

/** One draw from Beta(alpha, beta). */
export function sampleBeta(alpha: number, beta: number, random: () => number): number {
  const x = sampleGamma(Math.max(1e-3, alpha), random);
  const y = sampleGamma(Math.max(1e-3, beta), random);
  return x + y === 0 ? 0.5 : x / (x + y);
}

/** A running mean that can also be serialised. */
export interface RunningMean {
  n: number;
  mean: number;
}

export function updateMean(state: RunningMean, value: number): RunningMean {
  const n = state.n + 1;
  return { n, mean: state.mean + (value - state.mean) / n };
}
