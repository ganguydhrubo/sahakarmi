// @vitest-environment node

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScheduledTask } from "../shared/ipc";
import { nextRunAfter, parseCadence, ScheduleStore } from "./schedule-store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Monday 20 October 2026, 10:15 local time.
const monday = new Date(2026, 9, 19 + 1, 10, 15, 0, 0);

describe("nextRunAfter", () => {
  it("runs daily tasks later today or tomorrow", () => {
    expect(nextRunAfter({ kind: "daily", time: "18:00" }, monday)).toEqual(
      new Date(2026, 9, 20, 18, 0),
    );
    expect(nextRunAfter({ kind: "daily", time: "09:00" }, monday)).toEqual(
      new Date(2026, 9, 21, 9, 0),
    );
  });

  it("skips weekends for weekday tasks", () => {
    const friday = new Date(2026, 9, 23, 19, 0);
    expect(nextRunAfter({ kind: "weekdays", time: "09:30" }, friday)).toEqual(
      new Date(2026, 9, 26, 9, 30),
    );
  });

  it("finds the next matching weekday for weekly tasks", () => {
    expect(nextRunAfter({ kind: "weekly", day: 6, time: "11:00" }, monday)).toEqual(
      new Date(2026, 9, 24, 11, 0),
    );
  });

  it("runs hourly at the top of the next hour and refuses past one-offs", () => {
    expect(nextRunAfter({ kind: "hourly" }, monday)).toEqual(new Date(2026, 9, 20, 11, 0));
    expect(nextRunAfter({ kind: "once", at: new Date(2026, 9, 1).toISOString() }, monday)).toBe(
      null,
    );
  });
});

describe("parseCadence", () => {
  it("rejects malformed schedules", () => {
    expect(() => parseCadence({ kind: "daily", time: "25:00" })).toThrow("24-hour");
    expect(() => parseCadence({ kind: "weekly", day: 9, time: "10:00" })).toThrow("day");
    expect(() => parseCadence({ kind: "fortnightly" })).toThrow("Unknown");
  });
});

describe("ScheduleStore", () => {
  it("runs due tasks once, advances them, and persists across restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-schedules-"));
    roots.push(root);
    let now = monday;
    const store = new ScheduleStore(root, () => now);
    await store.initialize();
    const ran: ScheduledTask[] = [];
    store.start(async (task) => {
      ran.push(task);
    });

    const task = await store.create({
      botId: "asha-accounts",
      text: "Send me the day's collections summary",
      cadence: { kind: "daily", time: "18:00" },
    });
    expect(task.nextRunAt).toBe(new Date(2026, 9, 20, 18, 0).toISOString());

    now = new Date(2026, 9, 20, 18, 0, 30);
    await store.tick();
    await store.tick();
    expect(ran).toHaveLength(1);
    expect(store.list()[0]?.nextRunAt).toBe(new Date(2026, 9, 21, 18, 0).toISOString());

    await store.setEnabled(task.id, false);
    now = new Date(2026, 9, 22, 18, 0, 30);
    await store.tick();
    expect(ran).toHaveLength(1);
    store.stop();

    const restored = new ScheduleStore(root, () => now);
    await restored.initialize();
    expect(restored.list()).toMatchObject([{ id: task.id, enabled: false }]);
  });

  it("disables one-off tasks after they run", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-schedules-"));
    roots.push(root);
    let now = monday;
    const store = new ScheduleStore(root, () => now);
    await store.initialize();
    const ran: string[] = [];
    store.start(async (task) => {
      ran.push(task.id);
    });
    const task = await store.create({
      botId: "kavya-content",
      text: "Post the Diwali offer",
      cadence: { kind: "once", at: new Date(2026, 9, 20, 12, 0).toISOString() },
    });
    now = new Date(2026, 9, 20, 12, 1);
    await store.tick();
    await store.tick();
    expect(ran).toEqual([task.id]);
    expect(store.list()[0]).toMatchObject({ enabled: false, nextRunAt: null });
    store.stop();
  });
});
