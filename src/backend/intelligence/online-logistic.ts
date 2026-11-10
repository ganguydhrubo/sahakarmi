import { brier, clamp, finite, logLoss, sigmoid } from "./stats";

/**
 * A logistic regression trained one example at a time (stochastic gradient descent with L2),
 * used to predict the chance that a task fails. Tiny: a few dozen weights, microseconds per
 * update, a few hundred bytes on disk.
 *
 * Honesty is built in: every example is first PREDICTED and scored, and only then learnt from
 * (prequential, "test-then-train" evaluation). The same is done for a baseline that always
 * predicts the failure rate seen so far. The model is only called useful when it has seen
 * enough examples AND its Brier score beats the baseline's; otherwise callers must fall back
 * to the historical rate or a labelled rule-based estimate.
 */

export interface LogisticState {
  version: 1;
  weights: Record<string, number>;
  /** Examples learnt from. */
  updates: number;
  /** Prequential sums, model vs baseline. */
  brierSum: number;
  baselineBrierSum: number;
  logLossSum: number;
  baselineLogLossSum: number;
  /** Failures seen (the baseline predicts failures / updates). */
  positives: number;
  learningRate: number;
  l2: number;
}

export interface LogisticQuality {
  updates: number;
  /** Mean Brier score of the model's predictions made before each example was learnt. */
  brier: number | null;
  baselineBrier: number | null;
  logLoss: number | null;
  baselineLogLoss: number | null;
  /** Share by which the model beats the baseline (positive is better), null before data. */
  skill: number | null;
  /** True only with enough examples and a real improvement over the baseline. */
  useful: boolean;
}

export type Features = Record<string, number>;

/** Examples needed before the model may be called useful. */
export const MIN_UPDATES_FOR_USE = 30;
/** Smallest relative Brier improvement over the baseline that counts. */
export const MIN_SKILL = 0.02;
const MAX_WEIGHT = 20;

export function emptyLogistic(learningRate = 0.05, l2 = 1e-3): LogisticState {
  return {
    version: 1,
    weights: {},
    updates: 0,
    brierSum: 0,
    baselineBrierSum: 0,
    logLossSum: 0,
    baselineLogLossSum: 0,
    positives: 0,
    learningRate,
    l2,
  };
}

/** Accepts only a well-formed saved state; anything else starts afresh. */
export function restoreLogistic(value: unknown): LogisticState {
  if (!value || typeof value !== "object") return emptyLogistic();
  const state = value as Partial<LogisticState>;
  if (state.version !== 1 || !state.weights || typeof state.weights !== "object") {
    return emptyLogistic();
  }
  const weights: Record<string, number> = {};
  for (const [key, weight] of Object.entries(state.weights)) {
    if (Number.isFinite(weight)) weights[key] = clamp(weight as number, -MAX_WEIGHT, MAX_WEIGHT);
  }
  return {
    version: 1,
    weights,
    updates: Math.max(0, Math.floor(finite(state.updates))),
    brierSum: Math.max(0, finite(state.brierSum)),
    baselineBrierSum: Math.max(0, finite(state.baselineBrierSum)),
    logLossSum: Math.max(0, finite(state.logLossSum)),
    baselineLogLossSum: Math.max(0, finite(state.baselineLogLossSum)),
    positives: Math.max(0, Math.floor(finite(state.positives))),
    learningRate: clamp(finite(state.learningRate, 0.05), 1e-4, 1),
    l2: clamp(finite(state.l2, 1e-3), 0, 1),
  };
}

export function predictLogistic(state: LogisticState, features: Features): number {
  let z = state.weights.bias ?? 0;
  for (const [name, value] of Object.entries(features)) {
    if (!Number.isFinite(value) || value === 0) continue;
    z += (state.weights[name] ?? 0) * value;
  }
  return sigmoid(z);
}

/** The baseline's current prediction: the failure rate seen so far (Laplace-smoothed). */
export function baselineProbability(state: LogisticState): number {
  return (state.positives + 1) / (state.updates + 2);
}

/**
 * Scores the prediction for this example (model and baseline), then learns from it.
 * Returns a new state; the input is not changed.
 */
export function learnLogistic(
  state: LogisticState,
  features: Features,
  failed: boolean,
): LogisticState {
  const outcome: 0 | 1 = failed ? 1 : 0;
  const predicted = predictLogistic(state, features);
  const baseline = baselineProbability(state);
  const weights = { ...state.weights };
  const error = predicted - outcome;
  const rate = state.learningRate / Math.sqrt(1 + state.updates / 50);
  const step = (name: string, value: number) => {
    const current = weights[name] ?? 0;
    const gradient = error * value + (name === "bias" ? 0 : state.l2 * current);
    weights[name] = clamp(current - rate * gradient, -MAX_WEIGHT, MAX_WEIGHT);
  };
  step("bias", 1);
  for (const [name, value] of Object.entries(features)) {
    if (!Number.isFinite(value) || value === 0 || name === "bias") continue;
    step(name, value);
  }
  return {
    ...state,
    weights,
    updates: state.updates + 1,
    positives: state.positives + outcome,
    brierSum: state.brierSum + brier(predicted, outcome),
    baselineBrierSum: state.baselineBrierSum + brier(baseline, outcome),
    logLossSum: state.logLossSum + logLoss(predicted, outcome),
    baselineLogLossSum: state.baselineLogLossSum + logLoss(baseline, outcome),
  };
}

export function logisticQuality(state: LogisticState): LogisticQuality {
  if (state.updates === 0) {
    return {
      updates: 0,
      brier: null,
      baselineBrier: null,
      logLoss: null,
      baselineLogLoss: null,
      skill: null,
      useful: false,
    };
  }
  const n = state.updates;
  const modelBrier = state.brierSum / n;
  const baseBrier = state.baselineBrierSum / n;
  const skill = baseBrier > 0 ? 1 - modelBrier / baseBrier : null;
  return {
    updates: n,
    brier: round(modelBrier),
    baselineBrier: round(baseBrier),
    logLoss: round(state.logLossSum / n),
    baselineLogLoss: round(state.baselineLogLossSum / n),
    skill: skill === null ? null : round(skill),
    useful: n >= MIN_UPDATES_FOR_USE && skill !== null && skill >= MIN_SKILL,
  };
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
