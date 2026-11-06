// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorTask } from "../shared/ipc";
import { claimedFiles, VerificationRepairEngine } from "./verification-repair-engine";

let root: string;
let own: string;
let other: string;
let shared: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-verify-"));
  own = join(root, "bots", "dev");
  other = join(root, "bots", "tara");
  shared = join(root, "Shared");
  await Promise.all([own, other, shared].map((dir) => mkdir(dir, { recursive: true })));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

function task(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: "t-1",
    runId: "run-1",
    title: "Write the report",
    description: "",
    role: "research",
    assignedBotId: "dev",
    assignedInstanceId: null,
    dependencies: [],
    inputs: {},
    deliverables: [{ name: "Reply" }],
    acceptanceCriteria: [],
    status: "running",
    attemptCount: 0,
    maxAttempts: 3,
    error: null,
    evidence: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("claimedFiles", () => {
  it("finds the files a reply names, but not web addresses", () => {
    expect(
      claimedFiles(
        "Done. Saved `Shared/diwali-plan.docx` and report.pdf; sources at https://example.com/a.pdf. See C:\\Users\\me\\Shared\\sheet.xlsx.",
      ),
    ).toEqual(["Shared/diwali-plan.docx", "report.pdf", "C:\\Users\\me\\Shared\\sheet.xlsx"]);
    expect(claimedFiles("I wrote three ideas for the post.")).toEqual([]);
    expect(claimedFiles(null)).toEqual([]);
  });
});

describe("VerificationRepairEngine", () => {
  it("is honest when there is nothing to check: unverified, never passed", async () => {
    const verifier = new VerificationRepairEngine();
    const result = await verifier.verifyTask(task(), {
      workspacePath: own,
      sharedRoot: shared,
      reply: "I thought about it and the answer is 42.",
    });
    expect(result.verdict).toBe("unverified");
    expect(result.passed).toBe(true);
    expect(result.evidence[0]?.summary).toContain("Not verified");
    const finished = verifier.handleVerificationResult(task(), result.passed, result.evidence);
    expect(finished.status).toBe("completed");
    expect(finished.verification).toBe("unverified");
  });

  it("fails a task whose named file is missing or empty", async () => {
    await writeFile(join(shared, "empty.csv"), "");
    const verifier = new VerificationRepairEngine();
    const result = await verifier.verifyTask(task(), {
      workspacePath: own,
      sharedRoot: shared,
      reply: "Saved Shared/missing.pdf and Shared/empty.csv.",
    });
    expect(result.verdict).toBe("failed");
    expect(result.evidence[0]?.summary).toContain("missing: Shared/missing.pdf");
    expect(result.evidence[0]?.summary).toContain("empty: Shared/empty.csv");
  });

  it("checks the coworker's own folder, not a colleague's", async () => {
    await writeFile(join(other, "plan.md"), "Tara's plan");
    const verifier = new VerificationRepairEngine();
    const missing = await verifier.verifyTask(task(), {
      workspacePath: own,
      sharedRoot: shared,
      reply: "Wrote plan.md.",
    });
    expect(missing.verdict).toBe("failed");
    await writeFile(join(own, "plan.md"), "Dev's plan");
    const found = await verifier.verifyTask(task(), {
      workspacePath: own,
      sharedRoot: shared,
      reply: "Wrote plan.md.",
    });
    expect(found.verdict).toBe("passed");
    const finished = verifier.handleVerificationResult(task(), found.passed, found.evidence);
    expect(finished.verification).toBe("verified");
  });

  it("never runs a code check by itself (no bun x tsc)", async () => {
    const authorize = vi.fn();
    const verifier = new VerificationRepairEngine(authorize);
    await writeFile(join(own, "package.json"), "{}");
    const result = await verifier.verifyTask(task({ role: "code" }), {
      workspacePath: own,
      sharedRoot: shared,
      reply: "Implemented it.",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(result.evidence.every((item) => item.type !== "typecheck")).toBe(true);
  });

  it("runs the owner's check only through the permission gate", async () => {
    const refused = new VerificationRepairEngine(async () => ({
      allowed: false,
      reason: "The owner declined this action.",
    }));
    const notRun = await refused.verifyTask(task(), {
      workspacePath: own,
      reply: "Done.",
      checkCommand: "exit 0",
      checkCwd: own,
    });
    expect(notRun.verdict).toBe("unverified");
    expect(notRun.evidence[0]?.summary).toContain("declined");

    const allowed = new VerificationRepairEngine(async () => ({ allowed: true, reason: "ok" }));
    const pass = await allowed.verifyTask(task(), {
      workspacePath: own,
      reply: "Done.",
      checkCommand: "exit 0",
      checkCwd: own,
    });
    expect(pass.verdict).toBe("passed");
    const fail = await allowed.verifyTask(task(), {
      workspacePath: own,
      reply: "Done.",
      checkCommand: "exit 3",
      checkCwd: own,
    });
    expect(fail.verdict).toBe("failed");
    expect(fail.evidence[0]?.type).toBe("check");
  });
});
