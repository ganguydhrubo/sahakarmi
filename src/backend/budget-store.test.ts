// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BudgetStore } from "./budget-store";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-budget-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("BudgetStore", () => {
  it("has no limits until the owner sets one, and writes nothing for unlimited coworkers", async () => {
    const store = new BudgetStore(root);
    await store.initialize();
    expect(store.get()).toMatchObject({ coworkers: {}, teamRunSteps: null });
    store.recordTurn("bot-1");
    expect(store.coworkerLimitReached("bot-1")).toBeNull();
    await expect(readFile(join(root, "budgets.json"), "utf8")).rejects.toThrow();
  });

  it("stops at the daily limit and starts again the next day", async () => {
    let now = new Date(2026, 10, 8, 10, 0);
    const store = new BudgetStore(root, () => now);
    await store.initialize();
    await store.set({ coworkers: { "bot-1": 3 } });
    for (let turn = 0; turn < 3; turn += 1) {
      expect(store.coworkerLimitReached("bot-1")).toBeNull();
      store.recordTurn("bot-1");
    }
    expect(store.coworkerLimitReached("bot-1")).toEqual({ limit: 3, used: 3 });
    now = new Date(2026, 10, 9, 0, 5);
    expect(store.coworkerLimitReached("bot-1")).toBeNull();
  });

  it("validates limits, clears with null and survives a restart", async () => {
    const store = new BudgetStore(root);
    await store.initialize();
    await expect(store.set({ coworkers: { "bot-1": 0 } })).rejects.toThrow(/whole number/);
    await expect(store.set({ teamRunSteps: 2.5 })).rejects.toThrow(/whole number/);
    await store.set({ coworkers: { "bot-1": 5, "bot-2": 7 }, teamRunSteps: 12 });
    await store.set({ coworkers: { "bot-2": null } });
    const reopened = new BudgetStore(root);
    await reopened.initialize();
    expect(reopened.get()).toMatchObject({ coworkers: { "bot-1": 5 }, teamRunSteps: 12 });
    expect(reopened.teamRunSteps()).toBe(12);
  });

  it("a damaged file means no limits, never a failure", async () => {
    await writeFile(join(root, "budgets.json"), "{not json");
    const store = new BudgetStore(root);
    await store.initialize();
    expect(store.get().coworkers).toEqual({});
  });
});
