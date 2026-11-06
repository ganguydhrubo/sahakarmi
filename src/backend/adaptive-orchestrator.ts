import { randomUUID } from "node:crypto";
import type {
  AgentCollaborationMessage,
  AgentEvent,
  BotSummary,
  OrchestratorRun,
  OrchestratorSpecialistRole,
  OrchestratorTask,
  StartOrchestratorRunInput,
  TaskExecutionStrategy,
} from "../shared/ipc";
import { AgentCollaborationBus } from "./agent-collaboration-bus";
import { AgentExecutionFactory } from "./agent-execution-factory";
import type { OrchestratorStore } from "./orchestrator-store";
import type { TeamRunAgentPort, TeamRunEngine } from "./team-run-engine";
import { VerificationRepairEngine } from "./verification-repair-engine";

export type OrchestratorEventListener = (event: AgentEvent) => void;

/** Hooks for the durable engine: the real coworkers it hands tasks to. */
export interface OrchestratorEngineOptions {
  port: TeamRunAgentPort;
  /** How long a failed task message is watched for a re-send (tests shorten it). */
  retryGraceMs?: number;
  /** Where checkpoints live; read when the engine first loads. Default: SQLite. */
  checkpoints?: () => "sqlite" | "json";
}

export interface OrchestratorDependencies {
  factory?: AgentExecutionFactory;
  bus?: AgentCollaborationBus;
  verifier?: VerificationRepairEngine;
}

/**
 * Plans team runs and hands them to the durable TeamRunEngine (LangGraph), which sends each task
 * to a real coworker. There is no other execution path: without a port nothing can run.
 */
export class AdaptiveOrchestrator {
  readonly #store: OrchestratorStore;
  readonly #factory: AgentExecutionFactory;
  readonly #bus: AgentCollaborationBus;
  readonly #verifier: VerificationRepairEngine;
  readonly #eventListeners = new Set<OrchestratorEventListener>();
  readonly #engineOptions: OrchestratorEngineOptions | null;
  #engine: Promise<TeamRunEngine> | null = null;

  constructor(
    store: OrchestratorStore,
    engine: OrchestratorEngineOptions | null = null,
    dependencies: OrchestratorDependencies = {},
  ) {
    this.#store = store;
    this.#factory = dependencies.factory ?? new AgentExecutionFactory();
    this.#bus = dependencies.bus ?? new AgentCollaborationBus();
    this.#verifier = dependencies.verifier ?? new VerificationRepairEngine();
    this.#engineOptions = engine;

    this.#bus.subscribe((msg: AgentCollaborationMessage) => {
      this.#emit({ type: "orchestrator-handoff", message: msg });
    });
  }

  /**
   * The graph engine and its library load on the first team run, never at startup, so the app
   * opens exactly as fast as before and a user who never starts a team run pays nothing.
   */
  #loadEngine(): Promise<TeamRunEngine> | null {
    const options = this.#engineOptions;
    if (!options) return null;
    if (!this.#engine) {
      this.#engine = import("./team-run-engine").then(
        ({ TeamRunEngine }) =>
          new TeamRunEngine({
            store: this.#store,
            port: options.port,
            bus: this.#bus,
            verifier: this.#verifier,
            checkpointDir: this.#store.checkpointDir,
            emit: (event) => this.#emit(event),
            retryGraceMs: options.retryGraceMs,
            checkpoints: options.checkpoints?.() ?? "sqlite",
          }),
      );
      this.#engine.catch(() => {
        this.#engine = null;
      });
    }
    return this.#engine;
  }

  /** Older runs made by the removed in-memory loop cannot be driven: they are only shown. */
  async #engineFor(run: OrchestratorRun): Promise<TeamRunEngine | null> {
    if (run.engine !== "graph") return null;
    return (await this.#loadEngine()) ?? null;
  }

  /**
   * After a restart: a run paused on an approval listens for the owner's decision again. The
   * engine loads only when such a run exists, so start-up stays as fast as before.
   */
  async restoreWaitingRuns(): Promise<void> {
    const runs = await this.#store.getRuns();
    if (!runs.some((run) => run.engine === "graph" && run.waitingOn)) return;
    const engine = await this.#loadEngine();
    await engine?.restore();
  }

  /** Stops listening and lets running graphs settle. For tests and shutdown. */
  async dispose(): Promise<void> {
    const engine = await this.#engine?.catch(() => null);
    engine?.dispose();
  }

  onEvent(listener: OrchestratorEventListener): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  evaluateComplexity(objective: string): TaskExecutionStrategy {
    const trimmed = objective.trim().toLowerCase();

    // Check for explicit multi-agent indicators
    const multiAgentTriggers = [
      "multi-agent",
      "multi agent",
      "full stack",
      "full-stack",
      "architecture",
      "architect and implement",
      "audit and fix",
      "cross-domain",
      "frontend and backend",
      "build system",
      "refactor and test",
      "security and qa",
      "end-to-end",
      "integration",
      "database",
      "authentication",
      "comprehensive",
    ];

    if (multiAgentTriggers.some((trigger) => trimmed.includes(trigger))) {
      return "multi-agent";
    }

    // Single-agent indicators (small, focused, quick tasks)
    const singleAgentTriggers = [
      "fix typo",
      "tweak button",
      "change color",
      "update title",
      "quick fix",
      "one line",
      "rename",
      "simple bug",
    ];

    if (singleAgentTriggers.some((trigger) => trimmed.includes(trigger))) {
      return "single-agent";
    }

    // Word count / length heuristic: prompts over 20 words imply multi-step work
    const words = trimmed.split(/\s+/).length;
    return words > 20 ? "multi-agent" : "single-agent";
  }

  async getRuns(): Promise<OrchestratorRun[]> {
    return this.#store.getRuns();
  }

  async getRun(runId: string): Promise<OrchestratorRun | null> {
    return this.#store.getRun(runId);
  }

  async startRun(
    input: StartOrchestratorRunInput,
    workspacePath: string,
    existingBots: BotSummary[] = [],
  ): Promise<OrchestratorRun> {
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const strategy = input.forcedStrategy ?? this.evaluateComplexity(input.objective);

    const run: OrchestratorRun = {
      id: runId,
      workspaceId: input.workspaceId ?? "default",
      objective: input.objective,
      strategy,
      status: "planning",
      tasks: [],
      instances: [],
      messages: [],
      deliverables: [],
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    };

    if (strategy === "single-agent") {
      this.#setupSingleAgentPlan(run, workspacePath, existingBots);
    } else {
      this.#setupMultiAgentPlan(run, workspacePath, existingBots);
    }

    const enginePromise = this.#loadEngine();
    if (!enginePromise) throw new Error("Team runs are not available right now.");
    run.engine = "graph";
    run.waitingOn = null;
    run.checkCommand = input.checkCommand?.trim() || null;
    run.plannedBy = "template";
    this.#assignRealCoworkers(run, input.workspaceId ?? null);
    run.status = "running";
    await this.#store.saveRun(run);
    this.#emit({ type: "orchestrator-run-updated", run });
    enginePromise.then(
      (engine) => engine.start(run, workspacePath),
      async (error: unknown) => {
        const failed = await this.#store.getRun(runId);
        if (!failed) return;
        failed.status = "failed";
        failed.error = `The team-run engine could not start: ${error instanceof Error ? error.message : String(error)}`;
        failed.completedAt = new Date().toISOString();
        await this.#store.saveRun(failed);
        this.#emit({ type: "orchestrator-run-updated", run: failed });
      },
    );
    return run;
  }

  /**
   * The role map names the starter coworkers (Dev, Tara, ...). When the owner renamed or removed
   * them, each task goes to a coworker that exists, preferring the run's workspace. A run with no
   * coworker at all cannot start.
   */
  #assignRealCoworkers(run: OrchestratorRun, workspaceId: string | null): void {
    const bots = this.#engineOptions?.port.listBots() ?? [];
    const known = new Set(bots.map((bot) => bot.id));
    const fallback =
      bots.find((bot) => workspaceId !== null && bot.workspaceId === workspaceId) ?? bots[0];
    if (!fallback) throw new Error("Add a coworker before starting a team run.");
    for (const instance of run.instances) {
      if (known.has(instance.botId)) continue;
      instance.botId = fallback.id;
      instance.botName = fallback.name;
    }
    for (const task of run.tasks) {
      const instance = run.instances.find((i) => i.instanceId === task.assignedInstanceId);
      if (instance) task.assignedBotId = instance.botId;
    }
  }

  async pauseRun(runId: string): Promise<OrchestratorRun | null> {
    const run = await this.#store.getRun(runId);
    if (!run) return null;
    if (run.status === "completed" || run.status === "failed") return run;
    const engine = await this.#engineFor(run);
    await engine?.pause(runId);
    // Read again: pausing took the coworkers' task messages back and noted that on the tasks.
    const latest = (await this.#store.getRun(runId)) ?? run;
    latest.status = "paused";
    const saved = await this.#store.saveRun(latest);
    this.#emit({ type: "orchestrator-run-updated", run: saved });
    return saved;
  }

  async resumeRun(runId: string, workspacePath = "."): Promise<OrchestratorRun | null> {
    const run = await this.#store.getRun(runId);
    if (!run) return null;
    if (run.status === "completed" || run.status === "failed") return run;
    const engine = await this.#engineFor(run);
    if (!engine) return run;
    if (engine.isActive(runId)) return run;
    run.status = "running";
    const saved = await this.#store.saveRun(run);
    this.#emit({ type: "orchestrator-run-updated", run: saved });
    await engine.resume(saved, workspacePath);
    return (await this.#store.getRun(runId)) ?? saved;
  }

  async cancelRun(runId: string): Promise<OrchestratorRun | null> {
    const run = await this.#store.getRun(runId);
    if (!run) return null;
    const engine = await this.#engineFor(run);
    await engine?.cancel(runId);
    this.#bus.resetRun(runId);
    const latest = (await this.#store.getRun(runId)) ?? run;
    latest.status = "failed";
    latest.error = "Run cancelled by user.";
    latest.completedAt = new Date().toISOString();
    latest.waitingOn = null;
    const saved = await this.#store.saveRun(latest);
    this.#emit({ type: "orchestrator-run-updated", run: saved });
    return saved;
  }

  #setupSingleAgentPlan(
    run: OrchestratorRun,
    workspacePath: string,
    existingBots: BotSummary[],
  ): void {
    const role: OrchestratorSpecialistRole = "code";
    const instance = this.#factory.createInstance(role, workspacePath, existingBots);
    const taskId = `task-${randomUUID().slice(0, 8)}`;

    const task: OrchestratorTask = {
      id: taskId,
      runId: run.id,
      title: "Direct Implementation",
      description: run.objective,
      role,
      assignedBotId: instance.botId,
      assignedInstanceId: instance.instanceId,
      dependencies: [],
      inputs: { objective: run.objective },
      deliverables: [{ name: "Target changes", summary: run.objective }],
      acceptanceCriteria: [
        "Code changes accurately satisfy user objective",
        "Verification checks pass cleanly",
      ],
      status: "pending",
      attemptCount: 0,
      maxAttempts: 3,
      error: null,
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    instance.assignedTaskId = taskId;
    run.tasks = [task];
    run.instances = [instance];
  }

  #setupMultiAgentPlan(
    run: OrchestratorRun,
    workspacePath: string,
    existingBots: BotSummary[],
  ): void {
    // Specialist roles: Architect, Implementation (Code/Frontend), QA
    const archInstance = this.#factory.createInstance("architect", workspacePath, existingBots);
    const codeInstance = this.#factory.createInstance("code", workspacePath, existingBots);
    const qaInstance = this.#factory.createInstance("qa", workspacePath, existingBots);

    const t1Id = `task-arch-${randomUUID().slice(0, 6)}`;
    const t2Id = `task-impl-${randomUUID().slice(0, 6)}`;
    const t3Id = `task-qa-${randomUUID().slice(0, 6)}`;

    const task1: OrchestratorTask = {
      id: t1Id,
      runId: run.id,
      title: "Architecture Analysis & Workstream Planning",
      description: `Analyze requirements and specify interfaces for: ${run.objective}`,
      role: "architect",
      assignedBotId: archInstance.botId,
      assignedInstanceId: archInstance.instanceId,
      dependencies: [],
      inputs: { objective: run.objective },
      deliverables: [{ name: "Execution Plan", summary: "Structured implementation plan" }],
      acceptanceCriteria: [
        "Identifies modified interfaces and files",
        "Specifies dependency requirements",
      ],
      status: "pending",
      attemptCount: 0,
      maxAttempts: 3,
      error: null,
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const task2: OrchestratorTask = {
      id: t2Id,
      runId: run.id,
      title: "Core Implementation",
      description: `Implement functionality according to architecture specification`,
      role: "code",
      assignedBotId: codeInstance.botId,
      assignedInstanceId: codeInstance.instanceId,
      dependencies: [t1Id],
      inputs: { objective: run.objective, specTaskId: t1Id },
      deliverables: [{ name: "Code Modifications", summary: "Production code changes" }],
      acceptanceCriteria: [
        "All required components implemented",
        "No syntax or contract violations",
      ],
      status: "pending",
      attemptCount: 0,
      maxAttempts: 3,
      error: null,
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const task3: OrchestratorTask = {
      id: t3Id,
      runId: run.id,
      title: "Quality Assurance & Verification Gates",
      description: `Run verification suite and review deliverables for: ${run.objective}`,
      role: "qa",
      assignedBotId: qaInstance.botId,
      assignedInstanceId: qaInstance.instanceId,
      dependencies: [t2Id],
      inputs: { targetTaskId: t2Id },
      deliverables: [
        { name: "Verification Report", summary: "Evidence-backed validation summary" },
      ],
      acceptanceCriteria: [
        "Automated checks (lint, types, tests) verified",
        "No regressions detected",
      ],
      status: "pending",
      attemptCount: 0,
      maxAttempts: 3,
      error: null,
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    archInstance.assignedTaskId = t1Id;
    codeInstance.assignedTaskId = t2Id;
    qaInstance.assignedTaskId = t3Id;

    run.tasks = [task1, task2, task3];
    run.instances = [archInstance, codeInstance, qaInstance];
  }

  #emit(event: AgentEvent): void {
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in orchestrator event listener:", err);
      }
    }
  }
}
