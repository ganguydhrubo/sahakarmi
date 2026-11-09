import { execFile } from "node:child_process";
import { availableParallelism } from "node:os";
import type {
  ResourceLevel,
  ResourceRecommendation,
  ResourceStatus,
  ResourceUsageGroup,
} from "../shared/ipc";
import { MIN_MEMORY_LIMIT_MB } from "../shared/ipc";
import { budgetPressure, HEAVY_RUNTIME_MB, readMemory } from "./memory-pressure";

/** One running process: its id, its parent, its name and its working set in bytes. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  name: string;
  bytes: number;
  /** Processor time used so far (kernel + user, in 100 ns units); from the detail query only. */
  cpuTicks?: number;
}

export type ProcessLister = () => Promise<ProcessRow[]>;

const MB = 1024 * 1024;

/**
 * Every process on the PC, from one CIM query (wmic is gone from Windows 11). About 0.5-0.8 s
 * of PowerShell, so it runs at most every SAMPLE_MS and only while someone needs the number.
 */
export const windowsProcessLister: ProcessLister = () =>
  new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.WorkingSetSize)" }',
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 4 * MB },
      (error, stdout) => {
        if (error) return resolve([]);
        resolve(parseProcessRows(stdout));
      },
    );
  });

/**
 * The same query with each process's processor time too (for the detail meter). Used only while
 * the "live-meter-detail" feature is on; the plain query above stays as it was.
 */
export const windowsProcessDetailLister: ProcessLister = () =>
  new Promise((resolve) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize,KernelModeTime,UserModeTime | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)|$($_.WorkingSetSize)|$($_.KernelModeTime)|$($_.UserModeTime)" }',
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 4 * MB },
      (error, stdout) => {
        if (error) return resolve([]);
        resolve(parseProcessRows(stdout));
      },
    );
  });

export function parseProcessRows(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [pid, ppid, name, bytes, kernel, user] = line.trim().split("|");
    const row: ProcessRow = {
      pid: Number(pid),
      ppid: Number(ppid),
      name: name ?? "",
      bytes: Number(bytes),
    };
    if (Number.isFinite(row.pid) && Number.isFinite(row.ppid) && Number.isFinite(row.bytes)) {
      if (kernel && user) {
        const ticks = Number(kernel) + Number(user);
        if (Number.isFinite(ticks)) row.cpuTicks = ticks;
      }
      if (row.name) rows.push(row);
    }
  }
  return rows;
}

/** Processor time of Sahkarmi's whole tree (rooted at `rootPid`); null without CPU columns. */
export function treeCpuTicks(rows: ProcessRow[], rootPid: number): number | null {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    if (row.pid === row.ppid) continue;
    const list = children.get(row.ppid);
    if (list) list.push(row);
    else children.set(row.ppid, [row]);
  }
  const root = rows.find((row) => row.pid === rootPid);
  if (!root || root.cpuTicks === undefined) return null;
  let total = 0;
  const seen = new Set<number>();
  const stack = [root];
  while (stack.length > 0) {
    const row = stack.pop();
    if (!row || seen.has(row.pid)) continue;
    seen.add(row.pid);
    total += row.cpuTicks ?? 0;
    stack.push(...(children.get(row.pid) ?? []));
  }
  return total;
}

/**
 * Share of the whole PC's processor (all cores) used between two readings, 0-100. Processes that
 * ended in between take their time with them, so a drop reads as 0, never below.
 */
export function cpuPercentBetween(
  previous: { at: number; ticks: number },
  next: { at: number; ticks: number },
  cores: number,
): number | null {
  const wallMs = next.at - previous.at;
  if (!(wallMs > 0) || !(cores > 0)) return null;
  const used = Math.max(0, next.ticks - previous.ticks) / 10_000; // 100 ns ticks -> ms
  return Math.min(100, Math.max(0, Math.round((used / (wallMs * cores)) * 100)));
}

const GROUP_LABELS: Record<ResourceUsageGroup["kind"], string> = {
  app: "Sahkarmi window and browser",
  claude: "Claude coworkers",
  codex: "Codex coworkers",
  antigravity: "Antigravity coworkers",
  opencode: "OpenCode coworkers",
  gemini: "Gemini coworkers",
  tools: "Tools coworkers started (MCP servers, scripts)",
};

function kindOf(name: string, parentKind: ResourceUsageGroup["kind"] | null) {
  const lower = name.toLowerCase();
  if (lower.startsWith("sahkarmi")) return "app";
  if (lower.startsWith("claude")) return "claude";
  if (lower.startsWith("codex")) return "codex";
  if (lower.startsWith("agy_") || lower.startsWith("localharness")) return "antigravity";
  if (lower.startsWith("opencode")) return "opencode";
  if (lower.startsWith("gemini")) return "gemini";
  // conhost and friends belong to whoever started them; anything else is a tool.
  if (lower === "conhost.exe" && parentKind) return parentKind;
  return parentKind && parentKind !== "app" ? parentKind : "tools";
}

/** Sahkarmi's process tree (rooted at `rootPid`), grouped by the program that uses the memory. */
export function groupTree(rows: ProcessRow[], rootPid: number): ResourceUsageGroup[] {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    if (row.pid === row.ppid) continue;
    const list = children.get(row.ppid);
    if (list) list.push(row);
    else children.set(row.ppid, [row]);
  }
  const root = rows.find((row) => row.pid === rootPid);
  const totals = new Map<ResourceUsageGroup["kind"], { mb: number; processes: number }>();
  const seen = new Set<number>();
  const walk = (row: ProcessRow, parentKind: ResourceUsageGroup["kind"] | null) => {
    if (seen.has(row.pid)) return;
    seen.add(row.pid);
    const kind = parentKind === null ? "app" : kindOf(row.name, parentKind);
    const total = totals.get(kind) ?? { mb: 0, processes: 0 };
    total.mb += row.bytes / MB;
    total.processes += 1;
    totals.set(kind, total);
    for (const child of children.get(row.pid) ?? []) walk(child, kind);
  };
  if (root) walk(root, null);
  return [...totals.entries()]
    .map(([kind, total]) => ({
      kind,
      label: GROUP_LABELS[kind],
      mb: Math.round(total.mb),
      processes: total.processes,
    }))
    .sort((left, right) => right.mb - left.mb);
}

function safeCores(): number {
  try {
    return Math.max(1, availableParallelism());
  } catch {
    return 1;
  }
}

/** Measured base of the app with no coworker working (window, renderer, GPU, helpers). */
export const APP_BASE_MB = 1_200;

/**
 * The limit Sahkarmi suggests: enough for the app and a few Claude coworkers, and never more
 * than half of the PC's RAM, so the owner's other apps keep room.
 */
export function recommend(totalMb: number, usedMb: number | null): ResourceRecommendation {
  const half = Math.floor(totalMb / 2 / 512) * 512;
  const limitMb = Math.max(MIN_MEMORY_LIMIT_MB * 2, Math.min(half, 8_192));
  const claudeCoworkers = Math.max(1, Math.floor((limitMb - APP_BASE_MB) / HEAVY_RUNTIME_MB));
  const gb = (mb: number) => `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
  const now = usedMb === null ? "" : ` Sahkarmi uses ${gb(usedMb)} right now.`;
  return {
    limitMb,
    claudeCoworkers,
    reason: `This PC has ${gb(totalMb)}. ${gb(limitMb)} keeps half for your other apps and lets about ${claudeCoworkers} Claude coworkers work side by side.${now}`,
  };
}

/** Ready-made limits that fit this PC: 2, 3, 4, 6, 8, 12, 16, 24, 32 GB up to RAM minus 1 GB. */
export function presets(totalMb: number): number[] {
  return [2, 3, 4, 6, 8, 12, 16, 24, 32]
    .map((gb) => gb * 1024)
    .filter((mb) => mb <= totalMb - 1024);
}

export interface AppMemoryOptions {
  rootPid: number;
  lister?: ProcessLister;
  /** The query with processor time, used while the detail meter is on. */
  detailLister?: ProcessLister;
  now?: () => number;
  cores?: number;
}

/**
 * Measures what Sahkarmi and every program it started really use, keeps the last readings and
 * forecasts when the owner's limit would be reached. It samples only while needed (a limit is
 * set, or the Settings view asked in the last minute), so with Automatic it costs nothing.
 */
export class AppMemoryMonitor {
  static SAMPLE_MS = 20_000;
  static HISTORY = 15;
  /** The Settings view keeps sampling on for this long after it last asked. */
  static VIEW_KEEPALIVE_MS = 60_000;

  readonly #rootPid: number;
  readonly #lister: ProcessLister;
  readonly #detailLister: ProcessLister;
  readonly #now: () => number;
  readonly #cores: number;
  /** Detail meter (processor and awake pages): off keeps the plain memory meter. */
  #detail: () => boolean = () => false;
  #awakePages: () => number | null = () => null;
  #cpuReading: { at: number; ticks: number } | null = null;
  #cpuPercent: number | null = null;
  /** While the detail meter is on: a cheap free-memory look that starts sampling under pressure. */
  #pressureWatch: ReturnType<typeof setInterval> | null = null;
  #history: { at: number; mb: number }[] = [];
  #groups: ResourceUsageGroup[] = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #sampling: Promise<void> | null = null;
  #viewedAt = 0;
  #limit: () => { limitMb: number; warnPercent: number } = () => ({
    limitMb: 0,
    warnPercent: 80,
  });
  #listeners: ((level: ResourceLevel, previous: ResourceLevel) => void)[] = [];
  #level: ResourceLevel = "ok";

  constructor(options: AppMemoryOptions) {
    this.#rootPid = options.rootPid;
    this.#lister = options.lister ?? windowsProcessLister;
    this.#detailLister = options.detailLister ?? options.lister ?? windowsProcessDetailLister;
    this.#now = options.now ?? Date.now;
    this.#cores = options.cores ?? safeCores();
  }

  /**
   * The detail meter: processor use and awake browser pages next to the memory reading. While on,
   * it also samples when the PC runs short of memory (a free-memory look every SAMPLE_MS; the
   * process list itself still runs only while needed).
   */
  configureDetail(enabled: () => boolean, awakePages: () => number | null): void {
    this.#detail = enabled;
    this.#awakePages = awakePages;
    if (this.#pressureWatch) clearInterval(this.#pressureWatch);
    this.#pressureWatch = setInterval(() => {
      try {
        if (this.#detail()) this.#retime();
      } catch {
        // The plain meter keeps working.
      }
    }, AppMemoryMonitor.SAMPLE_MS);
    this.#pressureWatch.unref?.();
  }

  /** Latest processor use (% of the PC), or null before two detail readings. */
  get cpuPercent(): number | null {
    return this.#cpuPercent;
  }

  configure(limit: () => { limitMb: number; warnPercent: number }): void {
    this.#limit = limit;
    this.#retime();
  }

  /** Called when the level changes (ok, warn, over), e.g. to free memory or tell the owner. */
  onLevelChanged(listener: (level: ResourceLevel, previous: ResourceLevel) => void): void {
    this.#listeners.push(listener);
  }

  /** The latest measured use in MB, or null before the first reading. */
  get usedMb(): number | null {
    return this.#history.at(-1)?.mb ?? null;
  }

  get level(): ResourceLevel {
    return this.#level;
  }

  /** One fresh measurement now (shared when one is already running). */
  sample(): Promise<void> {
    const detail = this.#detailOn();
    this.#sampling ??= (detail ? this.#detailLister : this.#lister)()
      .then((rows) => {
        if (rows.length === 0) return;
        if (detail) this.#noteCpu(rows);
        this.#groups = groupTree(rows, this.#rootPid);
        const mb = this.#groups.reduce((sum, group) => sum + group.mb, 0);
        this.#history.push({ at: this.#now(), mb });
        if (this.#history.length > AppMemoryMonitor.HISTORY) this.#history.shift();
        this.#updateLevel();
      })
      .catch(() => undefined)
      .finally(() => {
        this.#sampling = null;
      });
    return this.#sampling;
  }

  /** Growth in MB per minute over the kept readings (least squares), null with fewer than 3. */
  trendMbPerMin(): number | null {
    const points = this.#history;
    if (points.length < 3) return null;
    const t0 = points[0]?.at ?? 0;
    const xs = points.map((point) => (point.at - t0) / 60_000);
    const ys = points.map((point) => point.mb);
    const n = xs.length;
    const meanX = xs.reduce((a, b) => a + b, 0) / n;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      num += ((xs[i] ?? 0) - meanX) * ((ys[i] ?? 0) - meanY);
      den += ((xs[i] ?? 0) - meanX) ** 2;
    }
    return den === 0 ? null : Math.round((num / den) * 10) / 10;
  }

  /** At the present growth, minutes until the limit; null without a limit or growth. */
  minutesToLimit(): number | null {
    const { limitMb } = this.#limit();
    const used = this.usedMb;
    const trend = this.trendMbPerMin();
    if (limitMb <= 0 || used === null || trend === null || trend <= 5) return null;
    if (used >= limitMb) return 0;
    return Math.round((limitMb - used) / trend);
  }

  async status(): Promise<ResourceStatus> {
    this.#viewedAt = this.#now();
    this.#retime();
    const stale = (this.#history.at(-1)?.at ?? 0) < this.#now() - AppMemoryMonitor.SAMPLE_MS / 2;
    if (stale) await this.sample();
    // The limit may have just changed: the level follows it now, not at the next reading.
    this.#updateLevel();
    const reading = readMemory();
    const { limitMb, warnPercent } = this.#limit();
    const used = this.usedMb;
    const sampledAt = this.#history.at(-1)?.at;
    const system: ResourceStatus["systemPressure"] =
      reading.freeMb < Math.max(500, reading.totalMb * 0.05)
        ? "critical"
        : reading.freeMb < Math.max(1_000, reading.totalMb * 0.1)
          ? "low"
          : "ok";
    return {
      totalMb: reading.totalMb,
      freeMb: reading.freeMb,
      systemPressure: system,
      appUsedMb: used,
      groups: this.#groups,
      limitMb,
      warnPercent,
      level: this.#level,
      trendMbPerMin: this.trendMbPerMin(),
      minutesToLimit: this.minutesToLimit(),
      recommendation: recommend(reading.totalMb, used),
      presetsMb: presets(reading.totalMb),
      sampledAt: sampledAt ? new Date(sampledAt).toISOString() : null,
      ...(this.#detailOn() ? { cpuPercent: this.#cpuPercent, awakePages: this.#pagesAwake() } : {}),
    };
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** Stops every timer, the free-memory look too (app quit, tests). */
  dispose(): void {
    this.stop();
    if (this.#pressureWatch) clearInterval(this.#pressureWatch);
    this.#pressureWatch = null;
  }

  #detailOn(): boolean {
    try {
      return this.#detail();
    } catch {
      return false;
    }
  }

  #pagesAwake(): number | null {
    try {
      const count = this.#awakePages();
      return typeof count === "number" && Number.isFinite(count) ? count : null;
    } catch {
      return null;
    }
  }

  #noteCpu(rows: ProcessRow[]): void {
    const ticks = treeCpuTicks(rows, this.#rootPid);
    if (ticks === null) return;
    const next = { at: this.#now(), ticks };
    if (this.#cpuReading) {
      const percent = cpuPercentBetween(this.#cpuReading, next, this.#cores);
      if (percent !== null) this.#cpuPercent = percent;
    }
    this.#cpuReading = next;
  }

  /** Sampling is needed: a limit is set, Settings looked lately, or (detail) memory is short. */
  #needed(): boolean {
    if (this.#limit().limitMb > 0) return true;
    if (this.#now() - this.#viewedAt < AppMemoryMonitor.VIEW_KEEPALIVE_MS) return true;
    if (!this.#detailOn()) return false;
    try {
      return readMemory().pressure !== "ok";
    } catch {
      return false;
    }
  }

  #updateLevel(): void {
    const { limitMb, warnPercent } = this.#limit();
    const pressure = budgetPressure({ limitMb, warnPercent, usedMb: this.usedMb });
    // Forecast: growing into the limit within 3 minutes counts as "warn" already.
    const soon = this.minutesToLimit();
    const level: ResourceLevel =
      pressure === "critical"
        ? "over"
        : pressure === "low" || (soon !== null && soon <= 3)
          ? "warn"
          : "ok";
    if (level === this.#level) return;
    const previous = this.#level;
    this.#level = level;
    for (const listener of this.#listeners) listener(level, previous);
  }

  /** Samples on a timer only while a limit is set or the Settings view is open. */
  #retime(): void {
    const needed = this.#needed();
    if (needed && !this.#timer) {
      void this.sample();
      this.#timer = setInterval(() => {
        const stillNeeded = this.#needed();
        if (!stillNeeded) {
          this.stop();
          this.#history = [];
          this.#level = "ok";
          this.#cpuReading = null;
          return;
        }
        void this.sample();
      }, AppMemoryMonitor.SAMPLE_MS);
      this.#timer.unref?.();
    } else if (!needed) {
      this.stop();
    }
  }
}
