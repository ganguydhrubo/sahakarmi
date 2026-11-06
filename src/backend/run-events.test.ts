// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_RUN_EVENTS, type NewRunEvent, RunEventStore } from "./run-events";

let root: string;
let store: RunEventStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-run-events-"));
  store = new RunEventStore(join(root, "run-events.sqlite"));
});

afterEach(async () => {
  store.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function event(patch: Partial<NewRunEvent> = {}): NewRunEvent {
  return {
    botId: "dev",
    botName: "Dev",
    provider: "codex",
    model: "gpt-5.5",
    origin: "owner",
    outcome: "completed",
    startedAt: new Date().toISOString(),
    durationMs: 30_000,
    toolCount: 4,
    inputTokens: 1200,
    outputTokens: 300,
    ...patch,
  };
}

describe("RunEventStore", () => {
  it("summarises turns by coworker and by model", () => {
    store.record(event());
    store.record(event({ durationMs: 90_000, toolCount: 0, outcome: "failed" }));
    store.record(event({ botId: "tara", botName: "Tara", model: "opencode-free" }));
    const summary = store.summary();
    expect(summary.totalTurns).toBe(3);
    expect(summary.byCoworker[0]).toMatchObject({
      key: "Dev",
      turns: 2,
      completed: 1,
      failed: 1,
      medianDurationMs: 60_000,
      averageTools: 2,
    });
    expect(summary.byModel.map((row) => row.key)).toEqual(["gpt-5.5", "opencode-free"]);
    expect(summary.recent[0]?.botName).toBe("Tara");
  });

  it("keeps only the newest turns", () => {
    for (let index = 0; index < MAX_RUN_EVENTS + 3; index += 1) {
      store.record(event({ toolCount: index }));
    }
    const summary = store.summary(1);
    expect(summary.totalTurns).toBe(MAX_RUN_EVENTS);
    expect(summary.recent[0]?.toolCount).toBe(MAX_RUN_EVENTS + 2);
  });
});
