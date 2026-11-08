// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_SETTINGS } from "../shared/ipc";
import { EngineSettingsStore, normaliseEngineSettings } from "./engine-settings";

const MEMORY_DEFAULTS = {
  memoryLimitMb: DEFAULT_ENGINE_SETTINGS.memoryLimitMb,
  memoryWarnPercent: DEFAULT_ENGINE_SETTINGS.memoryWarnPercent,
  maxStepsPerTurn: DEFAULT_ENGINE_SETTINGS.maxStepsPerTurn,
};

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("engine settings", () => {
  it.each([
    [{}, { maxConcurrentTurns: 3, watchdogMinutes: 45 }],
    [
      { maxConcurrentTurns: 99, watchdogMinutes: 1 },
      { maxConcurrentTurns: 64, watchdogMinutes: 5 },
    ],
    [
      { maxConcurrentTurns: 0, watchdogMinutes: 9_999 },
      { maxConcurrentTurns: 1, watchdogMinutes: 240 },
    ],
    [
      { maxConcurrentTurns: "4", watchdogMinutes: Number.NaN },
      { maxConcurrentTurns: 3, watchdogMinutes: 45 },
    ],
  ])("keeps %j within limits", (input, expected) => {
    expect(normaliseEngineSettings(input)).toEqual({ ...expected, ...MEMORY_DEFAULTS });
  });

  it("saves a change and reads it back after a restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-engine-settings-"));
    roots.push(root);
    const first = new EngineSettingsStore(root);
    await first.initialize();
    await first.update({ maxConcurrentTurns: 2 });
    const again = new EngineSettingsStore(root);
    await again.initialize();
    expect(again.get()).toEqual({ maxConcurrentTurns: 2, watchdogMinutes: 45, ...MEMORY_DEFAULTS });
  });

  it("keeps the memory limit at Automatic (0) or between 1 GB and the PC's RAM", () => {
    expect(normaliseEngineSettings({ memoryLimitMb: -5 }).memoryLimitMb).toBe(0);
    expect(normaliseEngineSettings({ memoryLimitMb: 100 }).memoryLimitMb).toBe(1024);
    expect(normaliseEngineSettings({ memoryLimitMb: 10_000_000 }).memoryLimitMb).toBeLessThan(
      10_000_000,
    );
    expect(normaliseEngineSettings({ memoryWarnPercent: 10 }).memoryWarnPercent).toBe(50);
    expect(normaliseEngineSettings({ maxStepsPerTurn: 5 }).maxStepsPerTurn).toBe(50);
  });
});
