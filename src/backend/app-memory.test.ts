// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import {
  AppMemoryMonitor,
  groupTree,
  type ProcessRow,
  parseProcessRows,
  presets,
  recommend,
} from "./app-memory";
import { hasRoomFor, readMemory, setMemoryBudget, setMemoryProbe } from "./memory-pressure";

const MB = 1024 * 1024;
const GB = 1024 * MB;

afterEach(() => {
  setMemoryProbe(null);
  setMemoryBudget(null);
});

// The real tree measured on the owner's PC on 2026-11-08, trimmed.
const ROWS: ProcessRow[] = [
  { pid: 10, ppid: 1, name: "Sahkarmi.exe", bytes: 230 * MB },
  { pid: 11, ppid: 10, name: "Sahkarmi.exe", bytes: 394 * MB },
  { pid: 12, ppid: 10, name: "agy_acp_server.exe", bytes: 113 * MB },
  { pid: 13, ppid: 12, name: "localharness_external.exe", bytes: 191 * MB },
  { pid: 14, ppid: 12, name: "conhost.exe", bytes: 8 * MB },
  { pid: 15, ppid: 10, name: "claude.exe", bytes: 266 * MB },
  { pid: 16, ppid: 15, name: "powershell.exe", bytes: 76 * MB },
  { pid: 17, ppid: 10, name: "codex.exe", bytes: 54 * MB },
  { pid: 99, ppid: 1, name: "chrome.exe", bytes: 900 * MB },
];

describe("app memory", () => {
  it("reads the CIM lines and skips junk", () => {
    expect(
      parseProcessRows("10|1|Sahkarmi.exe|1048576\r\nbad line\n11|10|x.exe|2097152\n"),
    ).toEqual([
      { pid: 10, ppid: 1, name: "Sahkarmi.exe", bytes: MB },
      { pid: 11, ppid: 10, name: "x.exe", bytes: 2 * MB },
    ]);
  });

  it("counts only Sahkarmi's own tree, grouped by the program behind it", () => {
    const groups = groupTree(ROWS, 10);
    const by = Object.fromEntries(groups.map((group) => [group.kind, group]));
    expect(by.app?.mb).toBe(624);
    expect(by.antigravity?.mb).toBe(312);
    // A shell a Claude coworker started belongs to Claude.
    expect(by.claude?.mb).toBe(342);
    expect(by.codex?.mb).toBe(54);
    expect(groups.reduce((sum, group) => sum + group.mb, 0)).toBe(1332);
    expect(groups.some((group) => group.label.includes("chrome"))).toBe(false);
  });

  it("suggests half the RAM (at most 8 GB) and how many Claude coworkers fit", () => {
    expect(recommend(16_045, null).limitMb).toBe(7_680);
    expect(recommend(8_192, 3_000).limitMb).toBe(4_096);
    expect(recommend(8_192, null).claudeCoworkers).toBeGreaterThanOrEqual(1);
    expect(presets(16_045)).toEqual([2048, 3072, 4096, 6144, 8192, 12288]);
  });

  it("forecasts when growth will reach the limit, and warns before it does", async () => {
    let now = 0;
    let used = 3_000;
    const levels: string[] = [];
    const monitor = new AppMemoryMonitor({
      rootPid: 10,
      now: () => now,
      lister: async () => [{ pid: 10, ppid: 1, name: "Sahkarmi.exe", bytes: used * MB }],
    });
    monitor.configure(() => ({ limitMb: 0, warnPercent: 80 }));
    monitor.onLevelChanged((level) => levels.push(level));
    for (let minute = 0; minute < 4; minute += 1) {
      now = minute * 60_000;
      used = 3_000 + minute * 200;
      await monitor.sample();
    }
    expect(monitor.trendMbPerMin()).toBe(200);
    expect(monitor.minutesToLimit()).toBeNull();
    monitor.configure(() => ({ limitMb: 4_000, warnPercent: 90 }));
    expect(monitor.minutesToLimit()).toBe(2);
    now = 4 * 60_000;
    used = 3_700;
    await monitor.sample();
    expect(levels).toContain("warn");
    used = 4_100;
    now = 5 * 60_000;
    await monitor.sample();
    expect(monitor.level).toBe("over");
    monitor.stop();
  });

  it("respects the owner's limit on top of the PC's free memory", () => {
    setMemoryProbe({ free: () => 10 * GB, total: () => 16 * GB });
    expect(readMemory().pressure).toBe("ok");
    expect(hasRoomFor(450)).toBe(true);
    setMemoryBudget(() => ({ limitMb: 4_096, warnPercent: 80, usedMb: 3_400 }));
    expect(readMemory().pressure).toBe("low");
    expect(hasRoomFor(450)).toBe(true);
    expect(hasRoomFor(800)).toBe(false);
    setMemoryBudget(() => ({ limitMb: 4_096, warnPercent: 80, usedMb: 4_200 }));
    expect(readMemory().pressure).toBe("critical");
    // Automatic: only the PC counts; 3 GB free of 16 GB is fine.
    setMemoryBudget(null);
    setMemoryProbe({ free: () => 3 * GB, total: () => 16 * GB });
    expect(readMemory().pressure).toBe("ok");
    expect(hasRoomFor(450)).toBe(true);
  });
});
