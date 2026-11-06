// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFolderWatcher, isIgnoredFileName, type WatchFolder } from "./folder-watch";
import { type RoutineExecutor, RoutineStore } from "./routine-store";
import { ScheduleStore } from "./schedule-store";

let root: string;
let watched: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-triggers-"));
  watched = join(root, "Invoices");
  await mkdir(watched);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function recordingExecutor(): RoutineExecutor & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    async send(_botId, text) {
      sent.push(text);
      return `d-${sent.length}`;
    },
    async waitFor() {
      return { ok: true, reply: "done", error: null };
    },
  };
}

/** A watcher the test fires by hand. */
function fakeWatcher(): WatchFolder & {
  fire: (files: string[]) => void;
  active: () => string[];
} {
  const listeners = new Map<string, (files: string[]) => void>();
  const watch: WatchFolder = (folder, onFiles) => {
    listeners.set(folder, onFiles);
    return () => listeners.delete(folder);
  };
  return Object.assign(watch, {
    fire: (files: string[]) => {
      for (const listener of listeners.values()) listener(files);
    },
    active: () => [...listeners.keys()],
  });
}

const STEP = [{ botId: "asha-accounts", instruction: "File this invoice" }];

describe("routine folder triggers", () => {
  it("runs the routine with the added files and watches only while enabled", async () => {
    const watcher = fakeWatcher();
    const store = new RoutineStore(root, undefined, watcher);
    await store.initialize();
    const executor = recordingExecutor();
    store.start(executor);
    const state = await store.save({
      name: "New invoices",
      steps: STEP,
      cadence: null,
      trigger: { kind: "folder", folder: watched },
      enabled: true,
    });
    const routine = state.routines[0];
    expect(routine?.trigger).toEqual({ kind: "folder", folder: watched });
    expect(routine?.cadence).toBeNull();
    expect(watcher.active()).toEqual([watched]);

    watcher.fire([join(watched, "inv-1.pdf")]);
    await store.idle();
    expect(executor.sent[0]).toContain("New file added (use as input):");
    expect(executor.sent[0]).toContain(join(watched, "inv-1.pdf"));
    expect(store.state().runs[0]).toMatchObject({
      trigger: "folder",
      status: "done",
      files: [join(watched, "inv-1.pdf")],
    });

    await store.setEnabled(routine?.id ?? "", false);
    expect(watcher.active()).toEqual([]);
    store.stop();
  });

  it("holds files while paused and runs once on resume", async () => {
    const watcher = fakeWatcher();
    const store = new RoutineStore(root, undefined, watcher);
    await store.initialize();
    const executor = recordingExecutor();
    store.start(executor);
    await store.save({
      name: "New invoices",
      steps: STEP,
      cadence: null,
      trigger: { kind: "folder", folder: watched },
      enabled: true,
    });
    store.setPaused(true);
    watcher.fire([join(watched, "a.pdf")]);
    watcher.fire([join(watched, "b.pdf")]);
    await store.idle();
    expect(executor.sent).toHaveLength(0);
    store.setPaused(false);
    await store.idle();
    expect(executor.sent).toHaveLength(1);
    expect(executor.sent[0]).toContain("a.pdf");
    expect(executor.sent[0]).toContain("b.pdf");
    store.stop();
  });

  it("refuses a folder that does not exist", async () => {
    const store = new RoutineStore(root, undefined, fakeWatcher());
    await store.initialize();
    await expect(
      store.save({
        name: "Bad",
        steps: STEP,
        cadence: null,
        trigger: { kind: "folder", folder: join(root, "missing") },
        enabled: true,
      }),
    ).rejects.toThrow("That folder does not exist.");
  });

  it("paused schedules wait and run once when resumed", async () => {
    const now = new Date("2026-11-06T09:00:00");
    const schedules = new ScheduleStore(root, () => now);
    await schedules.initialize();
    const ran: string[] = [];
    await schedules.create({
      botId: "asha-accounts",
      text: "Morning report",
      cadence: { kind: "daily", time: "09:30" },
    });
    schedules.setPaused(true);
    schedules.start(async (task) => {
      ran.push(task.text);
    });
    now.setHours(10);
    await schedules.tick();
    expect(ran).toEqual([]);
    schedules.setPaused(false);
    await waitFor(() => ran.length > 0, 5_000);
    expect(ran).toEqual(["Morning report"]);
    schedules.stop();
  });
});

describe("folder watcher (real file system)", () => {
  it("ignores temp and partial files", () => {
    for (const name of [
      "~$report.docx",
      "file.tmp",
      "movie.mp4.crdownload",
      "x.part",
      ".hidden",
      "desktop.ini",
      "Thumbs.db",
      "draft.txt~",
    ]) {
      expect(isIgnoredFileName(name), name).toBe(true);
    }
    expect(isIgnoredFileName("invoice-12.pdf")).toBe(false);
  });

  it("reports a new file once after it settles, including in subfolders", async () => {
    const batches: string[][] = [];
    const stop = createFolderWatcher({ settleMs: 150 })(watched, (files) => batches.push(files));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(join(watched, "inv-1.pdf"), "pdf bytes");
    await writeFile(join(watched, "~$lock.docx"), "lock");
    await mkdir(join(watched, "2026"));
    await writeFile(join(watched, "2026", "inv-2.pdf"), "more");
    await waitFor(() => batches.flat().length >= 2, 5_000);
    // Give duplicate events a chance to show up; none should.
    await new Promise((resolve) => setTimeout(resolve, 600));
    stop();
    const files = batches.flat().sort();
    expect(files).toEqual([join(watched, "2026", "inv-2.pdf"), join(watched, "inv-1.pdf")].sort());
  });
});

async function waitFor(check: () => boolean, timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > until) throw new Error("Timed out waiting for the watcher.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
