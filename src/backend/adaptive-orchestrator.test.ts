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
import { ToolRegistry } from "./tool-registry";
import { VerificationRepairEngine } from "./verification-repair-engine";

const roots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sahkarmi-orchestrator-test-"));
  roots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
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
  it("creates execution instances mapped to specialist roles with default permissions", () => {
    const factory = new AgentExecutionFactory();
    const instCode = factory.createInstance("code", "/workspace");
    const instQA = factory.createInstance("qa", "/workspace");

    expect(instCode.role).toBe("code");
    expect(instCode.botName).toBe("Dev");
    expect(instCode.toolPermissions).toContain("write_file");
    expect(instCode.toolPermissions).toContain("run_tests");

    expect(instQA.role).toBe("qa");
    expect(instQA.botName).toBe("Tara");
    expect(instQA.toolPermissions).toContain("run_tests");
    expect(instQA.toolPermissions).toContain("check_types");
  });
});

describe("ToolRegistry Action-Observation Loop", () => {
  it("enforces permission boundaries and rejects unauthorized tools", async () => {
    const dir = await makeTempDir();
    const tools = new ToolRegistry();

    const result = await tools.execute(
      "write_file",
      { path: "test.txt", content: "hello" },
      {
        instanceId: "inst-1",
        botId: "bot-1",
        role: "research",
        workspacePath: dir,
        toolPermissions: ["read_file"], // write_file NOT permitted
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Permission denied");
  });

  it("prevents directory traversal outside workspace boundary", async () => {
    const dir = await makeTempDir();
    const tools = new ToolRegistry();

    const result = await tools.execute(
      "read_file",
      { path: "../../windows/system32/cmd.exe" },
      {
        instanceId: "inst-1",
        botId: "bot-1",
        role: "code",
        workspacePath: dir,
        toolPermissions: ["*"],
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Access outside workspace boundary rejected");
  });

  it("redacts sensitive API tokens and credentials from observations", async () => {
    const dir = await makeTempDir();
    const tools = new ToolRegistry();

    // write a file containing mock secret
    await tools.execute(
      "write_file",
      {
        path: "secret.txt",
        content:
          "Key: AIzaSyD4j5k6L7m8N9o0P1q2R3s4T5u6V7w8X9y and sk-ant-api03-1234567890abcdef1234567890abcdef",
      },
      {
        instanceId: "inst-1",
        botId: "bot-1",
        role: "code",
        workspacePath: dir,
        toolPermissions: ["*"],
      },
    );

    const readResult = await tools.execute(
      "read_file",
      { path: "secret.txt" },
      {
        instanceId: "inst-1",
        botId: "bot-1",
        role: "code",
        workspacePath: dir,
        toolPermissions: ["*"],
      },
    );

    expect(readResult.success).toBe(true);
    expect(readResult.output).not.toContain("AIzaSyD4j5k6L7m8N9o0P1q2R3s4T5u6V7w8X9y");
    expect(readResult.output).toContain("AIza[REDACTED_API_KEY]");
    expect(readResult.output).toContain("[REDACTED_ANTHROPIC_KEY]");
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

describe("AdaptiveOrchestrator Execution Lifecycle", () => {
  it("executes single-agent fast path with automated verification", async () => {
    const dir = await makeTempDir();
    const store = new OrchestratorStore(dir);
    await store.initialize();
    const orchestrator = new AdaptiveOrchestrator(store);

    const run = await orchestrator.startRun(
      { objective: "Quick UI tweak", forcedStrategy: "single-agent" },
      dir,
    );

    expect(run.strategy).toBe("single-agent");
    expect(run.tasks.length).toBe(1);
    expect(run.instances.length).toBe(1);

    // Poll until completed (runs in memory)
    for (let i = 0; i < 20; i++) {
      const current = await orchestrator.getRun(run.id);
      if (current && current.status === "completed") {
        expect(current.tasks[0].status).toBe("completed");
        expect(current.tasks[0].evidence.length).toBeGreaterThan(0);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it("schedules multi-agent DAG with dependencies and handoffs", async () => {
    const dir = await makeTempDir();
    const store = new OrchestratorStore(dir);
    await store.initialize();
    const orchestrator = new AdaptiveOrchestrator(store);

    const run = await orchestrator.startRun(
      { objective: "Build authentication with security audit", forcedStrategy: "multi-agent" },
      dir,
    );

    expect(run.strategy).toBe("multi-agent");
    expect(run.tasks.length).toBe(3); // Architect -> Code -> QA
    expect(run.instances.length).toBe(3);

    // Verify dependency chain
    expect(run.tasks[0].dependencies).toEqual([]);
    expect(run.tasks[1].dependencies).toEqual([run.tasks[0].id]);
    expect(run.tasks[2].dependencies).toEqual([run.tasks[1].id]);

    // Poll until completed
    for (let i = 0; i < 30; i++) {
      const current = await orchestrator.getRun(run.id);
      if (current && current.status === "completed") {
        expect(current.tasks.every((t) => t.status === "completed")).toBe(true);
        expect(current.messages.length).toBeGreaterThan(0); // Inter-agent handoffs occurred
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  it("supports pausing, resuming, and cancelling a run", async () => {
    const dir = await makeTempDir();
    const store = new OrchestratorStore(dir);
    await store.initialize();
    const orchestrator = new AdaptiveOrchestrator(store);

    const run = await orchestrator.startRun(
      { objective: "Long running multi-agent workflow", forcedStrategy: "multi-agent" },
      dir,
    );

    const paused = await orchestrator.pauseRun(run.id);
    expect(paused?.status).toBe("paused");

    const resumed = await orchestrator.resumeRun(run.id, dir);
    expect(resumed?.status).toBe("running");

    const cancelled = await orchestrator.cancelRun(run.id);
    expect(cancelled?.status).toBe("failed");
    expect(cancelled?.error).toContain("cancelled");
  });
});
