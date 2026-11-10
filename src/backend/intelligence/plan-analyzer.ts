import type { OrchestratorRun, OrchestratorTask } from "../../shared/ipc";
import type { PredictionSource } from "./intelligence-db";

/**
 * Reads a team run's task list as a graph (tasks and what each waits for) and works out what
 * the plan really looks like: the order tasks can run in, how many at once, the longest chain
 * (critical path) with predicted durations, and problems a coworker would only hit later:
 * loops, missing dependencies, two tasks writing the same file at the same time, one coworker
 * holding up parallel work, tasks blocked behind a failure, risky steps.
 *
 * Pure: it takes the run and an estimator and touches nothing.
 */

export interface TaskEstimate {
  durationMs: number;
  durationSource: PredictionSource;
  failureRisk: number;
  riskSource: PredictionSource;
}

export interface PlanIssue {
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

export interface PlanTaskView {
  id: string;
  title: string;
  status: OrchestratorTask["status"];
  botId: string;
  /** Step number in the run order (tasks with the same number may run together). */
  layer: number | null;
  earliestStartMs: number;
  durationMs: number;
  durationSource: PredictionSource;
  failureRisk: number;
  riskSource: PredictionSource;
  /** Time it can slip without delaying the run. 0 = on the critical path. */
  slackMs: number;
  critical: boolean;
}

export interface PlanAnalysis {
  runId: string;
  valid: boolean;
  layers: string[][];
  maxParallel: number;
  criticalPath: string[];
  /** Predicted time for the unfinished work, along the critical path. */
  predictedRemainingMs: number;
  /** Chance that every unfinished task succeeds (assuming independence). */
  successChance: number;
  tasks: PlanTaskView[];
  issues: PlanIssue[];
  /** The step most likely to slow the run down. */
  bottleneck: { taskId: string; detail: string } | null;
}

const HIGH_RISK = 0.5;

export function analyzePlan(
  run: Pick<OrchestratorRun, "id" | "tasks" | "instances">,
  estimate: (task: OrchestratorTask, botId: string) => TaskEstimate,
): PlanAnalysis {
  const tasks = run.tasks;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const issues: PlanIssue[] = [];
  const botOf = (task: OrchestratorTask) =>
    run.instances.find((instance) => instance.instanceId === task.assignedInstanceId)?.botId ??
    task.assignedBotId;

  // Missing dependencies.
  const deps = new Map<string, string[]>();
  for (const task of tasks) {
    const known = task.dependencies.filter((id) => byId.has(id));
    const missing = task.dependencies.filter((id) => !byId.has(id));
    if (missing.length) {
      issues.push({
        kind: "missing-dependency",
        taskIds: [task.id],
        detail: `"${task.title}" waits for a task that is not in the plan (${missing.join(", ")}).`,
      });
    }
    deps.set(task.id, known);
  }

  // Kahn's algorithm: layers; whatever is left over sits in a cycle.
  const indegree = new Map(tasks.map((task) => [task.id, deps.get(task.id)?.length ?? 0]));
  const dependents = new Map<string, string[]>();
  for (const [id, list] of deps) {
    for (const dep of list) dependents.set(dep, [...(dependents.get(dep) ?? []), id]);
  }
  const layers: string[][] = [];
  let frontier = tasks.filter((task) => (indegree.get(task.id) ?? 0) === 0).map((task) => task.id);
  const placed = new Set<string>();
  while (frontier.length) {
    layers.push(frontier);
    for (const id of frontier) placed.add(id);
    const next: string[] = [];
    for (const id of frontier) {
      for (const child of dependents.get(id) ?? []) {
        const left = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, left);
        if (left === 0) next.push(child);
      }
    }
    frontier = next;
  }
  const cyclic = tasks.filter((task) => !placed.has(task.id)).map((task) => task.id);
  if (cyclic.length) {
    issues.push({
      kind: "cycle",
      taskIds: cyclic,
      detail: `${cyclic.length} task(s) wait for each other in a loop and can never start: ${cyclic
        .map((id) => `"${byId.get(id)?.title ?? id}"`)
        .join(", ")}.`,
    });
  }
  const layerOf = new Map<string, number>();
  layers.forEach((layer, index) => {
    for (const id of layer) layerOf.set(id, index + 1);
  });

  // Estimates; finished tasks take no more time and carry no more risk.
  const estimates = new Map<string, TaskEstimate>();
  for (const task of tasks) {
    const finished = task.status === "completed";
    const raw = estimate(task, botOf(task));
    estimates.set(task.id, finished ? { ...raw, durationMs: 0, failureRisk: 0 } : raw);
  }

  // Critical path method over the acyclic part: earliest start/finish forward, latest backward.
  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();
  const order = layers.flat();
  for (const id of order) {
    const start = Math.max(0, ...(deps.get(id) ?? []).map((dep) => earliestFinish.get(dep) ?? 0));
    earliestStart.set(id, start);
    earliestFinish.set(id, start + (estimates.get(id)?.durationMs ?? 0));
  }
  const makespan = Math.max(0, ...order.map((id) => earliestFinish.get(id) ?? 0));
  const latestFinish = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const children = dependents.get(id) ?? [];
    const finish = children.length
      ? Math.min(
          ...children.map(
            (child) =>
              (latestFinish.get(child) ?? makespan) - (estimates.get(child)?.durationMs ?? 0),
          ),
        )
      : makespan;
    latestFinish.set(id, finish);
  }
  const slack = (id: string) =>
    Math.max(0, (latestFinish.get(id) ?? makespan) - (earliestFinish.get(id) ?? 0));
  // Walk the zero-slack chain from the start.
  const criticalPath: string[] = [];
  let current = order.find(
    (id) =>
      (deps.get(id)?.length ?? 0) === 0 &&
      slack(id) === 0 &&
      (estimates.get(id)?.durationMs ?? 0) > 0,
  );
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    guard.add(current);
    criticalPath.push(current);
    const finish = earliestFinish.get(current) ?? 0;
    current = (dependents.get(current) ?? []).find(
      (child) => slack(child) === 0 && (earliestStart.get(child) ?? -1) === finish,
    );
  }
  const critical = new Set(criticalPath);

  // Two tasks that may run at the same time and name the same file.
  for (const layer of layers) {
    const owners = new Map<string, string[]>();
    for (const id of layer) {
      for (const deliverable of byId.get(id)?.deliverables ?? []) {
        if (!deliverable.path) continue;
        const key = deliverable.path.replace(/\\/g, "/").toLowerCase();
        owners.set(key, [...(owners.get(key) ?? []), id]);
      }
    }
    for (const [path, ids] of owners) {
      if (ids.length > 1) {
        issues.push({
          kind: "same-file",
          taskIds: ids,
          detail: `${ids.length} tasks that may run at the same time all write ${path}; one would overwrite the other.`,
        });
      }
    }
    // One coworker given several tasks that could run in parallel: they will queue instead.
    const byBot = new Map<string, string[]>();
    for (const id of layer) {
      const task = byId.get(id);
      if (!task || task.status === "completed") continue;
      const bot = botOf(task);
      byBot.set(bot, [...(byBot.get(bot) ?? []), id]);
    }
    for (const [bot, ids] of byBot) {
      if (ids.length > 1) {
        issues.push({
          kind: "same-coworker-parallel",
          taskIds: ids,
          detail: `${ids.length} tasks could run together but all go to the same coworker (${bot}), so they will wait for each other.`,
        });
      }
    }
  }

  // Tasks stuck behind a failed task.
  const failed = new Set(tasks.filter((task) => task.status === "failed").map((task) => task.id));
  const blockedBy = (id: string, seen = new Set<string>()): string | null => {
    for (const dep of deps.get(id) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (failed.has(dep)) return dep;
      const deeper = blockedBy(dep, seen);
      if (deeper) return deeper;
    }
    return null;
  };
  for (const task of tasks) {
    if (task.status === "completed" || task.status === "failed") continue;
    const cause = blockedBy(task.id);
    if (cause) {
      issues.push({
        kind: "blocked",
        taskIds: [task.id, cause],
        detail: `"${task.title}" cannot start: "${byId.get(cause)?.title ?? cause}" failed.`,
      });
    }
  }

  // Risky steps and tasks already near their attempt limit.
  for (const task of tasks) {
    if (task.status === "completed" || task.status === "failed") continue;
    const estimateFor = estimates.get(task.id);
    if (estimateFor && estimateFor.failureRisk >= HIGH_RISK) {
      issues.push({
        kind: "high-risk",
        taskIds: [task.id],
        detail: `"${task.title}" has a ${Math.round(estimateFor.failureRisk * 100)}% predicted chance of failing (${estimateFor.riskSource}).`,
      });
    }
    if (
      task.attemptCount > 0 &&
      task.attemptCount >= task.maxAttempts - 1 &&
      task.status !== "pending"
    ) {
      issues.push({
        kind: "retry-loop",
        taskIds: [task.id],
        detail: `"${task.title}" has used ${task.attemptCount} of ${task.maxAttempts} attempts.`,
      });
    }
  }

  const views: PlanTaskView[] = tasks.map((task) => {
    const value = estimates.get(task.id) ?? {
      durationMs: 0,
      durationSource: "estimate" as const,
      failureRisk: 0,
      riskSource: "estimate" as const,
    };
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      botId: botOf(task),
      layer: layerOf.get(task.id) ?? null,
      earliestStartMs: earliestStart.get(task.id) ?? 0,
      durationMs: value.durationMs,
      durationSource: value.durationSource,
      failureRisk: value.failureRisk,
      riskSource: value.riskSource,
      slackMs: placed.has(task.id) ? slack(task.id) : 0,
      critical: critical.has(task.id),
    };
  });

  const unfinished = views.filter((view) => view.status !== "completed");
  const successChance = unfinished.reduce((chance, view) => chance * (1 - view.failureRisk), 1);
  const slowest = views
    .filter((view) => view.critical)
    .sort((a, b) => b.durationMs - a.durationMs)[0];
  return {
    runId: run.id,
    valid: cyclic.length === 0 && !issues.some((issue) => issue.kind === "missing-dependency"),
    layers,
    maxParallel: Math.max(0, ...layers.map((layer) => layer.length)),
    criticalPath,
    predictedRemainingMs: makespan,
    successChance: Math.round(successChance * 1000) / 1000,
    tasks: views,
    issues,
    bottleneck: slowest
      ? {
          taskId: slowest.id,
          detail: `"${slowest.title}" is the longest step on the critical path (${Math.round(slowest.durationMs / 60_000)} min, ${slowest.durationSource}).`,
        }
      : null,
  };
}
