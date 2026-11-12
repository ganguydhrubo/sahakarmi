/**
 * Shapes the Intelligence Core shares between the main process and the window
 * (Settings > Intelligence). Plain data only.
 */

export type IntelligenceMode = "off" | "observe" | "adaptive";
export type OutcomeStatus = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";
export type VerificationGrade = "verified" | "partial" | "failed" | "inconclusive";
export type OutcomeOrigin = "chat" | "team-run" | "schedule" | "routine" | "telegram" | "other";
/** model: the failure model (only once it beats the plain rate); history: measured; estimate: rules. */
export type PredictionSource = "model" | "history" | "estimate";
export type ExperienceKind = "fact" | "observation" | "preference" | "prediction" | "lesson";
/** owner: the owner said it. verified: outside evidence. observed: Sahkarmi saw it. untrusted: a coworker's word. */
export type ExperienceTrust = "owner" | "verified" | "observed" | "untrusted";

export interface IntelligenceModelQuality {
  updates: number;
  brier: number | null;
  baselineBrier: number | null;
  logLoss: number | null;
  baselineLogLoss: number | null;
  /** Share by which the model beats the plain rate (positive is better). */
  skill: number | null;
  useful: boolean;
}

export interface IntelligencePredictionAccuracy {
  scored: number;
  brier: number | null;
  baselineBrier: number | null;
  bySource: Array<{ source: PredictionSource; scored: number; brier: number }>;
  durationError: number | null;
  durationScored: number;
}

export interface IntelligenceRoutingImpact {
  /** Finished team-run tasks the Intelligence Core assigned against the usual choice. */
  switched: number;
  switchedSuccess: number | null;
  /** Finished team-run tasks that kept the usual coworker, same kinds of work. */
  kept: number;
  keptSuccess: number | null;
  /** Plain-language verdict, or why there is not enough data yet. */
  verdict: string;
}

export interface IntelligenceStatus {
  mode: IntelligenceMode;
  workspaceId: string;
  storage: { path: string; bytes: number | null; outcomes: number; experiences: number };
  outcomes: {
    total: number;
    finished: number;
    running: number;
    labelled: number;
    byGrade: Record<VerificationGrade, number>;
    withFeedback: number;
    excluded: number;
  };
  model: IntelligenceModelQuality;
  modelSnapshots: Array<{ id: number; updates: number; createdAt: number }>;
  accuracy: IntelligencePredictionAccuracy;
  routing: IntelligenceRoutingImpact;
  /** Events waiting to be processed and the most ever waiting (bounded). */
  queue: { pending: number; max: number; dropped: number };
  lastError: string | null;
}

export interface IntelligenceCandidate {
  botId: string;
  botName: string;
  provider: string | null;
  model: string | null;
  available: boolean;
  unavailableReason: string | null;
  successRate: number;
  lower: number;
  upper: number;
  /** Uncertainty of the success rate (posterior standard deviation). */
  sd: number;
  evidence: number;
  samples: number;
  verified: number;
  failed: number;
  medianMs: number | null;
  p90Ms: number | null;
  waitMs: number;
  score: number;
  reasons: string[];
}

export interface IntelligenceFailurePrediction {
  probability: number;
  source: PredictionSource;
  basis: string;
}

export interface IntelligenceDurationPrediction {
  medianMs: number;
  p90Ms: number;
  source: PredictionSource;
  samples: number;
  basis: string;
}

export interface IntelligenceSimilar {
  id: string;
  kind: ExperienceKind;
  trust: ExperienceTrust;
  text: string;
  botId: string | null;
  relevance: number;
}

export interface IntelligenceRecommendation {
  category: string;
  classification: { confidence: number; matched: string[] };
  candidates: IntelligenceCandidate[];
  chosenBotId: string | null;
  defaultBotId: string | null;
  switchFromDefault: boolean;
  confidence: "high" | "medium" | "low" | "none";
  explanation: string;
  /** For the chosen coworker. */
  failure: IntelligenceFailurePrediction | null;
  duration: IntelligenceDurationPrediction | null;
  similar: IntelligenceSimilar[];
  /** True when adaptive mode would act on this (team runs only); false = advice. */
  wouldApply: boolean;
}

export interface IntelligencePerformanceRow {
  botId: string;
  botName: string;
  category: string;
  samples: number;
  verified: number;
  partial: number;
  failed: number;
  inconclusive: number;
  successRate: number;
  lower: number;
  upper: number;
  medianMs: number | null;
}

export interface IntelligenceOutcome {
  id: string;
  botId: string;
  botName: string;
  provider: string | null;
  model: string | null;
  category: string;
  origin: OutcomeOrigin;
  runId: string | null;
  taskId: string | null;
  startedAt: number;
  durationMs: number | null;
  status: OutcomeStatus;
  verification: VerificationGrade | null;
  verificationReasons: string[];
  toolCalls: number;
  toolErrors: number;
  errorSignature: string | null;
  predictedFailure: number | null;
  predictedDurationMs: number | null;
  predictionSource: PredictionSource | null;
  feedback: "good" | "bad" | null;
  feedbackNote: string | null;
  excluded: boolean;
  summary: string;
  /** What this outcome teaches, in a few words (null = nothing). */
  labelBasis: string | null;
}

export interface IntelligenceExperience {
  id: string;
  kind: ExperienceKind;
  trust: ExperienceTrust;
  category: string | null;
  botId: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  uses: number;
  correctedFrom: string | null;
}

export interface IntelligenceDecision {
  id: string;
  at: number;
  kind: "route" | "reassign" | "stop-retry" | "plan";
  subject: string | null;
  category: string | null;
  chosenBotId: string | null;
  defaultBotId: string | null;
  applied: boolean;
  explanation: string;
  outcomeLabel: number | null;
}

export interface IntelligencePlanIssue {
  kind:
    | "cycle"
    | "missing-dependency"
    | "same-file"
    | "same-coworker-parallel"
    | "blocked"
    | "high-risk"
    | "retry-loop";
  taskIds: string[];
  detail: string;
}

export interface IntelligencePlanTask {
  id: string;
  title: string;
  status: string;
  botId: string;
  layer: number | null;
  earliestStartMs: number;
  durationMs: number;
  durationSource: PredictionSource;
  failureRisk: number;
  riskSource: PredictionSource;
  slackMs: number;
  critical: boolean;
}

export interface IntelligencePlanAnalysis {
  runId: string;
  objective: string;
  status: string;
  valid: boolean;
  layers: string[][];
  maxParallel: number;
  criticalPath: string[];
  predictedRemainingMs: number;
  successChance: number;
  tasks: IntelligencePlanTask[];
  issues: IntelligencePlanIssue[];
  bottleneck: { taskId: string; detail: string } | null;
  /** Reassignments that would lower the risk, from the evidence. */
  suggestions: Array<{ taskId: string; fromBotId: string; toBotId: string; explanation: string }>;
}

export interface IntelligenceOverload {
  botId: string;
  botName: string;
  queued: number;
  busy: boolean;
  expectedWaitMs: number;
  source: PredictionSource;
  overloaded: boolean;
  reason: string | null;
}

export interface IntelligenceErrorPattern {
  signature: string;
  count: number;
  botIds: string[];
  categories: string[];
  lastSeen: number;
  repeated: boolean;
}

export interface IntelligenceBottleneck {
  kind: "slow-category" | "busy-coworker" | "failing-category";
  subject: string;
  detail: string;
  value: number;
}

export interface IntelligencePredictions {
  overload: IntelligenceOverload[];
  errorPatterns: IntelligenceErrorPattern[];
  bottlenecks: IntelligenceBottleneck[];
  memoryPressure: "ok" | "low" | "critical";
  /** Free memory now and what a heavy coworker turn needs. */
  memory: { freeMb: number; totalMb: number; heavyTurnMb: number };
}

export interface IntelligenceOperationStats {
  name: string;
  count: number;
  totalMs: number;
  maxMs: number;
  cpuMs: number;
}

export interface IntelligenceResources {
  operations: IntelligenceOperationStats[];
  totalOperations: number;
  totalMs: number;
  totalCpuMs: number;
  heapUsedMb: number;
  rssMb: number;
  processCpuPercent: number | null;
  systemFreeMb: number;
  systemTotalMb: number;
  since: number;
  dbBytes: number | null;
  /** Sahkarmi's whole process tree by program (the AI runtimes measured separately). */
  runtimes: Array<{ kind: string; label: string; mb: number; processes: number }> | null;
}

export interface IntelligenceRecommendInput {
  workspaceId?: string | null;
  text: string;
  role?: string | null;
  defaultBotId?: string | null;
}

export interface IntelligenceFeedbackInput {
  outcomeId: string;
  feedback: "good" | "bad" | null;
  note?: string | null;
}

export interface IntelligenceDesktopApi {
  status: (workspaceId?: string | null) => Promise<IntelligenceStatus>;
  performance: (workspaceId?: string | null) => Promise<IntelligencePerformanceRow[]>;
  outcomes: (input?: {
    workspaceId?: string | null;
    limit?: number;
  }) => Promise<IntelligenceOutcome[]>;
  recommend: (input: IntelligenceRecommendInput) => Promise<IntelligenceRecommendation>;
  predictions: (workspaceId?: string | null) => Promise<IntelligencePredictions>;
  analyzeRun: (runId: string) => Promise<IntelligencePlanAnalysis | null>;
  decisions: (workspaceId?: string | null) => Promise<IntelligenceDecision[]>;
  experiences: (workspaceId?: string | null) => Promise<IntelligenceExperience[]>;
  addExperience: (input: {
    workspaceId?: string | null;
    kind: "fact" | "preference";
    text: string;
  }) => Promise<IntelligenceExperience | null>;
  correctExperience: (input: {
    workspaceId?: string | null;
    id: string;
    text: string;
  }) => Promise<IntelligenceExperience | null>;
  deleteExperience: (input: { workspaceId?: string | null; id: string }) => Promise<boolean>;
  setFeedback: (input: IntelligenceFeedbackInput) => Promise<IntelligenceOutcome | null>;
  setExcluded: (input: {
    outcomeId: string;
    excluded: boolean;
  }) => Promise<IntelligenceOutcome | null>;
  resources: () => Promise<IntelligenceResources>;
  rollbackModel: (input: {
    workspaceId?: string | null;
    snapshotId: number;
  }) => Promise<IntelligenceStatus>;
  resetLearning: (workspaceId?: string | null) => Promise<IntelligenceStatus>;
}
