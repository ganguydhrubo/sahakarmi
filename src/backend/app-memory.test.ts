// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import {
  AppMemoryMonitor,
  cpuPercentBetween,
  groupTree,
  type ProcessRow,
  parseProcessRows,
  presets,
  recommend,
  treeCpuTicks,
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

  it("reads processor time from the detail query, and the plain query stays as it was", () => {
    expect(parseProcessRows("10|1|Sahkarmi.exe|1048576|200|300\n")).toEqual([
      { pid: 10, ppid: 1, name: "Sahkarmi.exe", bytes: MB, cpuTicks: 500 },
    ]);
    expect(parseProcessRows("10|1|Sahkarmi.exe|1048576\n")[0]).not.toHaveProperty("cpuTicks");
    const rows = ROWS.map((row) => ({ ...row, cpuTicks: 1_000 }));
    // Eight processes in Sahkarmi's tree; chrome.exe is not counted.
    expect(treeCpuTicks(rows, 10)).toBe(8_000);
    expect(treeCpuTicks(ROWS, 10)).toBeNull();
  });

  it("turns processor time into a share of the whole PC", () => {
    // 1 s of processor time in 1 s of wall time on 4 cores = 25 %.
    expect(cpuPercentBetween({ at: 0, ticks: 0 }, { at: 1_000, ticks: 10_000_000 }, 4)).toBe(25);
    expect(cpuPercentBetween({ at: 0, ticks: 500 }, { at: 1_000, ticks: 100 }, 4)).toBe(0);
    expect(cpuPercentBetween({ at: 0, ticks: 0 }, { at: 0, ticks: 100 }, 4)).toBeNull();
    expect(cpuPercentBetween({ at: 0, ticks: 0 }, { at: 1, ticks: 1e12 }, 1)).toBe(100);
  });

  it("adds processor and awake pages to the meter only while the detail switch is on", async () => {
    setMemoryProbe({ free: () => 8 * GB, total: () => 16 * GB });
    let now = 0;
    let ticks = 0;
    const plain: number[] = [];
    const detailed: number[] = [];
    const monitor = new AppMemoryMonitor({
      rootPid: 10,
      now: () => now,
      cores: 2,
      lister: async () => {
        plain.push(now);
        return [{ pid: 10, ppid: 1, name: "Sahkarmi.exe", bytes: 1_000 * MB }];
      },
      detailLister: async () => {
        detailed.push(now);
        return [{ pid: 10, ppid: 1, name: "Sahkarmi.exe", bytes: 1_000 * MB, cpuTicks: ticks }];
      },
    });
    monitor.configure(() => ({ limitMb: 0, warnPercent: 80 }));
    let detail = false;
    monitor.configureDetail(
      () => detail,
      () => 4,
    );
    try {
      await monitor.sample();
      const off = await monitor.status();
      expect(off).not.toHaveProperty("cpuPercent");
      expect(off).not.toHaveProperty("awakePages");
      expect(detailed).toHaveLength(0);
      expect(plain.length).toBeGreaterThan(0);
      detail = true;
      now = 60_000;
      await monitor.sample();
      now = 90_000;
      ticks = 30 * 10_000_000; // 30 s of processor in 30 s on 2 cores = 50 %
      const on = await monitor.status();
      expect(on.cpuPercent).toBe(50);
      expect(on.awakePages).toBe(4);
      expect(detailed.length).toBeGreaterThanOrEqual(2);
    } finally {
      monitor.dispose();
    }
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
