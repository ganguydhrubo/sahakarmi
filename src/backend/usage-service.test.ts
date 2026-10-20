// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentProviderStatus, UsageLimitWindow } from "../shared/ipc";
import { UsageService } from "./usage-service";

let root: string;
let now = new Date("2026-10-20T10:00:00Z");
const clock = () => now;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-usage-"));
  now = new Date("2026-10-20T10:00:00Z");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const PROVIDERS: AgentProviderStatus[] = [
  { id: "codex", state: "available", version: "1", message: null },
  { id: "claude", state: "sign-in-required", version: "1", message: null },
  { id: "gemini", state: "available", version: "1", message: null },
  { id: "opencode", state: "available", version: "1", message: null },
];

function window(overrides: Partial<UsageLimitWindow> = {}): UsageLimitWindow {
  return {
    id: "codex:primary",
    label: "5-hour window",
    usedPercent: 42,
    resetsAt: "2026-10-20T13:00:00Z",
    status: "ok",
    source: "test",
    observedAt: now.toISOString(),
    dataLabel: "verified",
    ...overrides,
  };
}

describe("UsageService", () => {
  it("adds only the growth of cumulative counters and survives restarts for thread totals", async () => {
    const usage = new UsageService(root, clock);
    await usage.initialize();
    const observe = (tokens: number) =>
      usage.record({
        kind: "cumulative",
        provider: "codex",
        botId: "asha",
        counterKey: "thread:codex:t1",
        persistent: true,
        tokens,
        costUsd: null,
      });
    observe(1_000);
    observe(1_500);
    observe(1_500);
    await usage.flush();

    const reopened = new UsageService(root, clock);
    await reopened.initialize();
    reopened.record({
      kind: "cumulative",
      provider: "codex",
      botId: "asha",
      counterKey: "thread:codex:t1",
      persistent: true,
      tokens: 1_800,
      costUsd: null,
    });
    const codex = reopened.overview(PROVIDERS).providers.find((p) => p.provider === "codex");
    expect(codex).toMatchObject({
      tokensToday: 1_800,
      tokensLabel: "verified",
      costLabel: "unavailable",
    });
    expect(reopened.overview(PROVIDERS).bots).toEqual([
      expect.objectContaining({ botId: "asha", tokens30d: 1_800, turns30d: 3 }),
    ]);
  });

  it("treats a smaller session total as a reset and labels SDK cost as an estimate", async () => {
    const usage = new UsageService(root, clock);
    await usage.initialize();
    const observe = (tokens: number, costUsd: number) =>
      usage.record({
        kind: "cumulative",
        provider: "claude",
        botId: "meera",
        counterKey: "run1:t9",
        persistent: false,
        tokens,
        costUsd,
      });
    observe(500, 0.01);
    observe(900, 0.02);
    observe(200, 0.005); // /clear or a resumed session
    const claude = usage.overview(PROVIDERS).providers.find((p) => p.provider === "claude");
    expect(claude?.tokensToday).toBe(1_100);
    expect(claude?.costUsd30d).toBeCloseTo(0.025, 6);
    expect(claude?.costLabel).toBe("estimated");
  });

  it("never invents numbers for providers that report nothing", async () => {
    const usage = new UsageService(root, clock);
    await usage.initialize();
    const gemini = usage.overview(PROVIDERS).providers.find((p) => p.provider === "gemini");
    expect(gemini).toMatchObject({
      tokensToday: null,
      tokens30d: null,
      tokensLabel: "unavailable",
      costUsd30d: null,
      costLabel: "unavailable",
      limits: [],
      limitsLabel: "unavailable",
    });
  });

  it("marks old or already-reset limit windows as stale and alerts only on fresh ones", async () => {
    const usage = new UsageService(root, clock);
    await usage.initialize();
    usage.record({
      kind: "limits",
      provider: "codex",
      replace: true,
      windows: [window({ usedPercent: 91 }), window({ id: "codex:secondary", usedPercent: 99 })],
    });
    let overview = usage.overview(PROVIDERS);
    expect(overview.providers[0]?.limitsLabel).toBe("verified");
    expect(overview.alerts.map((alert) => alert.level)).toEqual(["warning", "critical", "info"]);

    now = new Date("2026-10-20T10:45:00Z");
    overview = usage.overview(PROVIDERS);
    expect(overview.providers[0]?.limits.every((w) => w.dataLabel === "stale")).toBe(true);
    expect(overview.providers[0]?.limitsLabel).toBe("stale");
    expect(overview.alerts.filter((alert) => alert.provider === "codex")).toEqual([]);
  });

  it("stores counts only, keeps 90 days, and can be cleared", async () => {
    const usage = new UsageService(root, clock);
    await usage.initialize();
    usage.record({
      kind: "cumulative",
      provider: "codex",
      botId: "arjun",
      counterKey: "thread:codex:old",
      persistent: true,
      tokens: 10,
      costUsd: null,
    });
    await usage.flush();
    const file = await readFile(join(root, "usage.json"), "utf8");
    expect(Object.keys(JSON.parse(file))).toEqual([
      "version",
      "days",
      "counters",
      "limits",
      "context",
    ]);

    now = new Date("2027-02-01T10:00:00Z");
    expect(usage.overview(PROVIDERS).days).toEqual([]);
    expect(usage.overview(PROVIDERS).ledgerSince).toBeNull();
    await usage.clear();
    expect(JSON.parse(await readFile(join(root, "usage.json"), "utf8")).counters).toEqual({});
  });
});
