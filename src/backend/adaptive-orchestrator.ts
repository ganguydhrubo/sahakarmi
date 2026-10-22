import { randomUUID } from "node:crypto";
import type {
  AgentCollaborationMessage,
  AgentEvent,
  BotSummary,
  OrchestratorDeliverable,
  OrchestratorRun,
  OrchestratorSpecialistRole,
  OrchestratorTask,
  StartOrchestratorRunInput,
  TaskExecutionStrategy,
} from "../shared/ipc";
import { AgentCollaborationBus } from "./agent-collaboration-bus";
import { AgentExecutionFactory } from "./agent-execution-factory";
import type { OrchestratorStore } from "./orchestrator-store";
import { ToolRegistry } from "./tool-registry";
import { VerificationRepairEngine } from "./verification-repair-engine";

export type OrchestratorEventListener = (event: AgentEvent) => void;

export class AdaptiveOrchestrator {
  readonly #store: OrchestratorStore;
  readonly #factory: AgentExecutionFactory;
  readonly #bus: AgentCollaborationBus;
  readonly #tools: ToolRegistry;
  readonly #verifier: VerificationRepairEngine;
  readonly #eventListeners = new Set<OrchestratorEventListener>();
  readonly #activeRuns = new Map<string, { paused: boolean; cancelled: boolean }>();

  constructor(
    store: OrchestratorStore,
    factory: AgentExecutionFactory = new AgentExecutionFactory(),
    bus: AgentCollaborationBus = new AgentCollaborationBus(),
    tools: ToolRegistry = new ToolRegistry(),
    verifier: VerificationRepairEngine = new VerificationRepairEngine(),
  ) {
    this.#store = store;
    this.#factory = factory;
    this.#bus = bus;
    this.#tools = tools;
    this.#verifier = verifier;

    this.#bus.subscribe((msg: AgentCollaborationMessage) => {
      this.#emit({ type: "orchestrator-handoff", message: msg });
    });
  }

  onEvent(listener: OrchestratorEventListener): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  get tools(): ToolRegistry {
    return this.#tools;
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

    run.status = "running";
    await this.#store.saveRun(run);
    this.#activeRuns.set(runId, { paused: false, cancelled: false });
    this.#emit({ type: "orchestrator-run-updated", run });

    // Execute run asynchronously without blocking the caller
    void this.#executeRun(runId, workspacePath);

    return run;
  }

  async pauseRun(runId: string): Promise<OrchestratorRun | null> {
    const ctrl = this.#activeRuns.get(runId);
    if (ctrl) ctrl.paused = true;
    const run = await this.#store.getRun(runId);
    if (!run) return null;
    run.status = "paused";
    const saved = await this.#store.saveRun(run);
    this.#emit({ type: "orchestrator-run-updated", run: saved });
    return saved;
  }

  async resumeRun(runId: string, workspacePath = "."): Promise<OrchestratorRun | null> {
    const ctrl = this.#activeRuns.get(runId);
    if (ctrl) {
      ctrl.paused = false;
    } else {
      this.#activeRuns.set(runId, { paused: false, cancelled: false });
    }
    const run = await this.#store.getRun(runId);
    if (!run) return null;
    run.status = "running";
    const saved = await this.#store.saveRun(run);
    this.#emit({ type: "orchestrator-run-updated", run: saved });

    void this.#executeRun(runId, workspacePath);
    return saved;
  }

  async cancelRun(runId: string): Promise<OrchestratorRun | null> {
    const ctrl = this.#activeRuns.get(runId);
    if (ctrl) {
      ctrl.cancelled = true;
      ctrl.paused = false;
    }
    const run = await this.#store.getRun(runId);
    if (!run) return null;
    run.status = "failed";
    run.error = "Run cancelled by user.";
    run.completedAt = new Date().toISOString();
    const saved = await this.#store.saveRun(run);
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

  async #executeRun(runId: string, workspacePath: string): Promise<void> {
    while (true) {
      const ctrl = this.#activeRuns.get(runId);
      if (!ctrl || ctrl.cancelled) return;
      if (ctrl.paused) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      const run = await this.#store.getRun(runId);
      if (!run || run.status === "completed" || run.status === "failed") return;

      // Find tasks that are ready to run (dependencies completed and task is pending or repairing)
      const completedTaskIds = new Set(
        run.tasks.filter((t) => t.status === "completed").map((t) => t.id),
      );

      const readyTasks = run.tasks.filter((t) => {
        if (t.status !== "pending" && t.status !== "repairing") return false;
        return t.dependencies.every((depId) => completedTaskIds.has(depId));
      });

      if (readyTasks.length === 0) {
        // Check if all tasks are completed
        const allCompleted = run.tasks.every((t) => t.status === "completed");
        const anyFailed = run.tasks.some((t) => t.status === "failed");

        if (allCompleted) {
          run.status = "completed";
          run.completedAt = new Date().toISOString();
          const deliverables: OrchestratorDeliverable[] = run.tasks.flatMap((t) => t.deliverables);
          run.deliverables = deliverables;
          await this.#store.saveRun(run);
          this.#emit({ type: "orchestrator-run-updated", run });
          this.#activeRuns.delete(runId);
          return;
        }

        if (anyFailed) {
          run.status = "failed";
          run.completedAt = new Date().toISOString();
          const failedTask = run.tasks.find((t) => t.status === "failed");
          run.error = failedTask?.error ?? "One or more tasks failed verification.";
          await this.#store.saveRun(run);
          this.#emit({ type: "orchestrator-run-updated", run });
          this.#activeRuns.delete(runId);
          return;
        }

        // Wait briefly for currently running tasks to finish
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }

      // Execute ready tasks concurrently
      await Promise.all(readyTasks.map((task) => this.#executeTask(run, task, workspacePath)));
    }
  }

  async #executeTask(
    run: OrchestratorRun,
    task: OrchestratorTask,
    workspacePath: string,
  ): Promise<void> {
    task.status = "running";
    task.updatedAt = new Date().toISOString();
    await this.#store.updateTask(run.id, task);
    this.#emit({ type: "orchestrator-task-updated", runId: run.id, task });

    const instance = run.instances.find((i) => i.instanceId === task.assignedInstanceId);
    if (instance) {
      instance.status = "running";
      instance.turnCount += 1;
      await this.#store.updateInstance(run.id, instance);
    }

    // Inter-agent handoff notification
    if (instance && task.dependencies.length > 0) {
      const priorTask = run.tasks.find((t) => t.id === task.dependencies[0]);
      if (priorTask?.assignedInstanceId) {
        const priorInstance = run.instances.find(
          (i) => i.instanceId === priorTask.assignedInstanceId,
        );
        if (priorInstance) {
          const handoffMsg = this.#bus.sendMessage(
            run.id,
            priorInstance,
            instance.botId,
            instance.role,
            "task_handoff",
            `Handing off deliverables of ${priorTask.title} to ${instance.botName}`,
            { taskId: task.id, priorTaskId: priorTask.id },
            instance.instanceId,
          );
          await this.#store.addMessage(handoffMsg);
        }
      }
    }

    // Execute verification checks
    const verification = await this.#verifier.verifyTask(task, {
      workspacePath,
      types: task.role === "qa" || task.role === "code",
    });

    const updatedTask = this.#verifier.handleVerificationResult(
      task,
      verification.passed,
      verification.evidence,
    );

    if (instance) {
      instance.status = updatedTask.status === "running" ? "running" : "completed";
      if (updatedTask.status === "completed" || updatedTask.status === "failed") {
        instance.completedAt = new Date().toISOString();
      }
      await this.#store.updateInstance(run.id, instance);
    }

    await this.#store.updateTask(run.id, updatedTask);
    this.#emit({ type: "orchestrator-task-updated", runId: run.id, task: updatedTask });
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
