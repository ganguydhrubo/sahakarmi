// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OrchestratorTask } from "../shared/ipc";
import { AdaptiveOrchestrator } from "./adaptive-orchestrator";
import { AgentCollaborationBus } from "./agent-collaboration-bus";
import { AgentExecutionFactory } from "./agent-execution-factory";
import { OrchestratorStore } from "./orchestrator-store";
import { VerificationRepairEngine } from "./verification-repair-engine";

const roots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sahkarmi-orchestrator-test-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(async (r) => {
      try {
        await rm(r, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Ignore transient Windows file handle release delay
      }
    }),
  );
});

describe("AdaptiveOrchestrator Complexity Evaluation", () => {
  it("routes simple and focused tasks to single-agent fast path", async () => {
    const dir = await makeTempDir();
    const store = new OrchestratorStore(dir);
    const orchestrator = new AdaptiveOrchestrator(store);

    expect(orchestrator.evaluateComplexity("Fix typo in submit button")).toBe("single-agent");
    expect(orchestrator.evaluateComplexity("Change header background color")).toBe("single-agent");
    expect(orchestrator.evaluateComplexity("Rename helper function")).toBe("single-agent");
  });

  it("routes complex, multi-domain or explicit requests to multi-agent DAG", async () => {
    const dir = await makeTempDir();
    const store = new OrchestratorStore(dir);
    const orchestrator = new AdaptiveOrchestrator(store);

    expect(
      orchestrator.evaluateComplexity(
        "Architect and implement a full-stack user authentication system",
      ),
    ).toBe("multi-agent");
    expect(
      orchestrator.evaluateComplexity(
        "Please perform a multi-agent audit and fix of all components and database schemas",
      ),
    ).toBe("multi-agent");
    expect(
      orchestrator.evaluateComplexity(
        "Build a comprehensive invoice generator with PDF exports, GST reconciliation, automated email reminders, and complete end-to-end integration tests across all payment gateways and customer accounts",
      ),
    ).toBe("multi-agent");
  });
});

describe("AgentExecutionFactory", () => {
  it("maps specialist roles to the starter coworkers", () => {
    const factory = new AgentExecutionFactory();
    const instCode = factory.createInstance("code", "/workspace");
    const instQA = factory.createInstance("qa", "/workspace");

    expect(instCode.role).toBe("code");
    expect(instCode.botName).toBe("Dev");
    expect(instQA.role).toBe("qa");
    expect(instQA.botName).toBe("Tara");
    // Permissions are decided per tool call by the permission rules, never by the plan.
    expect(instCode.toolPermissions).toBeUndefined();
  });
});

describe("AgentCollaborationBus Loop Prevention", () => {
  it("prevents infinite handoff ping-pong recursion", () => {
    const bus = new AgentCollaborationBus();
    const sender = {
      instanceId: "inst-1",
      botId: "bot-1",
      botName: "Dev",
      role: "code" as const,
      assignedTaskId: "task-1",
      status: "running" as const,
      workspacePath: "/w",
      toolPermissions: ["*"],
      turnCount: 1,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    // Send 10 valid handoffs
    for (let i = 0; i < 10; i++) {
      bus.sendMessage("run-1", sender, "bot-2", "qa", "task_handoff", `Handoff iteration ${i}`, {
        taskId: "task-1",
      });
    }

    // 11th handoff must throw to break infinite loop
    expect(() =>
      bus.sendMessage("run-1", sender, "bot-2", "qa", "task_handoff", "11th handoff", {
        taskId: "task-1",
      }),
    ).toThrow("Handoff depth limit");
  });
});

describe("VerificationRepairEngine Bounded Defect Repair", () => {
  it("transitions task to repairing on failure, and fails after max attempts", () => {
    const verifier = new VerificationRepairEngine();
    let task: OrchestratorTask = {
      id: "t-1",
      runId: "run-1",
      title: "Test Task",
      description: "Description",
      role: "code" as const,
      assignedBotId: "dev-code",
      assignedInstanceId: "exec-1",
      dependencies: [],
      inputs: {},
      deliverables: [],
      acceptanceCriteria: [],
      status: "running" as const,
      attemptCount: 0,
      maxAttempts: 2,
      error: null,
      evidence: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Cycle 1: fail -> enters repairing
    task = verifier.handleVerificationResult(task, false, [
      {
        type: "typecheck",
        passed: false,
        summary: "Type error",
        timestamp: new Date().toISOString(),
      },
    ]);
    expect(task.status).toBe("repairing");
    expect(task.attemptCount).toBe(1);

    // Cycle 2: fail -> reaches max attempts and fails
    task = verifier.handleVerificationResult(task, false, [
      {
        type: "typecheck",
        passed: false,
        summary: "Type error",
        timestamp: new Date().toISOString(),
      },
    ]);
    expect(task.status).toBe("failed");
    expect(task.attemptCount).toBe(2);
  });
});

describe("AdaptiveOrchestrator without coworkers to run on", () => {
  it("refuses to start a run instead of pretending to do the work", async () => {
    const dir = await makeTempDir();
    const store = new OrchestratorStore(dir);
    await store.initialize();
    const orchestrator = new AdaptiveOrchestrator(store);
    await expect(
      orchestrator.startRun({ objective: "Quick UI tweak", forcedStrategy: "single-agent" }, dir),
    ).rejects.toThrow("not available");
    expect(await orchestrator.getRuns()).toEqual([]);
  });
});
