// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  { id: "antigravity", state: "available", version: "1", message: null },
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

  it("counts a resumed Claude session once, across app restarts", async () => {
    // Real totals from Claude Code 2.1.312: a resumed session reports its saved total plus the new turn.
    const report = (
      usage: UsageService,
      tokens: number,
      costUsd: number,
      turnTokens: number,
      resumed = false,
    ) =>
      usage.record({
        kind: "cumulative",
        provider: "claude",
        botId: "meera",
        counterKey: "thread:claude:s1",
        persistent: true,
        tokens,
        costUsd,
        turnTokens,
        resumed,
      });
    const first = new UsageService(root, clock);
    await first.initialize();
    report(first, 22_712, 0.000922, 22_712);
    report(first, 47_454, 0.002251, 24_742);
    await first.flush();

    const second = new UsageService(root, clock);
    await second.initialize();
    report(second, 72_645, 0.002973, 25_191, true);
    report(second, 99_748, 0.003691, 27_103);
    const claude = second.overview(PROVIDERS).providers.find((p) => p.provider === "claude");
    expect(claude?.tokensToday).toBe(99_748);
    expect(claude?.costUsd30d).toBeCloseTo(0.003691, 6);
    expect(second.overview(PROVIDERS).bots).toEqual([
      expect.objectContaining({ botId: "meera", tokens30d: 99_748, turns30d: 4 }),
    ]);
  });

  it("counts only the new turn when a resumed total has nothing saved to subtract", async () => {
    const usage = new UsageService(root, clock);
    await usage.initialize();
    usage.record({
      kind: "cumulative",
      provider: "claude",
      botId: "meera",
      counterKey: "thread:claude:s2",
      persistent: true,
      tokens: 148_965_964,
      costUsd: 120,
      turnTokens: 2_000_000,
      resumed: true,
    });
    const claude = usage.overview(PROVIDERS).providers.find((p) => p.provider === "claude");
    expect(claude?.tokensToday).toBe(2_000_000);
    expect(claude?.costUsd30d).toBeCloseTo(120 * (2_000_000 / 148_965_964), 6);

    // The next turn in the same run is measured against the resumed total, not counted again.
    usage.record({
      kind: "cumulative",
      provider: "claude",
      botId: "meera",
      counterKey: "thread:claude:s2",
      persistent: true,
      tokens: 150_965_964,
      costUsd: 121,
      turnTokens: 2_000_000,
    });
    expect(
      usage.overview(PROVIDERS).providers.find((p) => p.provider === "claude")?.tokensToday,
    ).toBe(4_000_000);
  });

  it("drops Claude totals written by version 1, which counted resumed sessions twice", async () => {
    const bucket = {
      tokens: 1_366_341_625,
      costUsd: 1001.55,
      turns: 41,
      lastAt: now.toISOString(),
    };
    await writeFile(
      join(root, "usage.json"),
      JSON.stringify({
        version: 1,
        days: {
          "2026-10-20|claude|meera": bucket,
          "2026-10-20|codex|asha": {
            tokens: 5_000,
            costUsd: null,
            turns: 2,
            lastAt: bucket.lastAt,
          },
        },
        counters: { "thread:codex:t1": { tokens: 5_000, costUsd: 0 } },
        limits: {},
        context: {},
      }),
    );
    const usage = new UsageService(root, clock);
    await usage.initialize();
    const providers = usage.overview(PROVIDERS).providers;
    expect(providers.find((p) => p.provider === "claude")).toMatchObject({
      tokensToday: 0,
      costUsd30d: null,
    });
    expect(providers.find((p) => p.provider === "codex")?.tokensToday).toBe(5_000);
    expect(usage.overview(PROVIDERS).alerts).toContainEqual(
      expect.objectContaining({
        id: "claude:recounted",
        level: "info",
        message: expect.stringContaining("start again from 20 Oct 2026"),
      }),
    );
    await usage.flush();
    const saved = JSON.parse(await readFile(join(root, "usage.json"), "utf8"));
    expect(saved.version).toBe(2);
    expect(Object.keys(saved.days)).toEqual(["2026-10-20|codex|asha"]);

    // Read again later: nothing more is removed, and the notice goes after a week.
    now = new Date("2026-10-28T10:00:00Z");
    const later = new UsageService(root, clock);
    await later.initialize();
    expect(later.overview(PROVIDERS).alerts.map((alert) => alert.id)).not.toContain(
      "claude:recounted",
    );
  });

  it("never invents numbers for providers that report nothing", async () => {
    const usage = new UsageService(root, clock);
    await usage.initialize();
    const antigravity = usage
      .overview(PROVIDERS)
      .providers.find((p) => p.provider === "antigravity");
    expect(antigravity).toMatchObject({
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
