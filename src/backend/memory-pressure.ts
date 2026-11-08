import { freemem, totalmem } from "node:os";

/**
 * How much physical memory the PC has free right now, and whether it is running short.
 *
 * On an 8 GB laptop the things Sahkarmi starts are what fill memory: each Claude coworker that
 * works is its own ~300-450 MB process, and each awake coworker browser page is ~100-200 MB.
 * Past the free RAM, Windows pages to disk and everything (the owner's other apps too) freezes.
 * Sahkarmi asks this before it starts more: a new heavy process waits while memory is short,
 * and idle browser pages are put to sleep sooner. os.freemem() is Windows' "available" memory
 * (free plus standby that can be reused at once), the same number Task Manager shows.
 *
 * The owner may also set a memory limit for Sahkarmi itself (Settings > Features). Then the
 * reading is the worse of the two: the PC's free memory and Sahkarmi's own use against the limit.
 */
export type MemoryPressure = "ok" | "low" | "critical";

export interface MemoryReading {
  freeMb: number;
  totalMb: number;
  pressure: MemoryPressure;
}

export interface MemoryProbe {
  free(): number;
  total(): number;
}

/** Sahkarmi's own use against the owner's limit; usedMb is null until it was measured. */
export interface MemoryBudget {
  limitMb: number;
  warnPercent: number;
  usedMb: number | null;
}

const MB = 1024 * 1024;
const systemProbe: MemoryProbe = { free: freemem, total: totalmem };
let probe: MemoryProbe = systemProbe;
let budget: () => MemoryBudget | null = () => null;

/** Tests (and the Performance view's simulation) can stand in another reading. */
export function setMemoryProbe(next: MemoryProbe | null): void {
  probe = next ?? systemProbe;
}

/** The owner's memory limit for Sahkarmi (null: Automatic, only the PC's free memory counts). */
export function setMemoryBudget(next: (() => MemoryBudget | null) | null): void {
  budget = next ?? (() => null);
}

/**
 * "low" below 10% of RAM or 1 GB free (whichever is more), "critical" below 5% or 500 MB.
 * On 8 GB that is about 1 GB and 500 MB; on 16 GB about 1.6 GB and 800 MB. Windows keeps
 * working smoothly well into these numbers, so a 16 GB PC with 3 GB available is "ok".
 */
function systemThresholds(totalMb: number): { low: number; critical: number } {
  return { low: Math.max(1_000, totalMb * 0.1), critical: Math.max(500, totalMb * 0.05) };
}

/** Sahkarmi's own pressure against the owner's limit: "low" from the warning share on. */
export function budgetPressure(current = budget()): MemoryPressure {
  if (!current || current.limitMb <= 0 || current.usedMb === null) return "ok";
  if (current.usedMb >= current.limitMb) return "critical";
  if (current.usedMb >= (current.limitMb * current.warnPercent) / 100) return "low";
  return "ok";
}

const RANK: Record<MemoryPressure, number> = { ok: 0, low: 1, critical: 2 };

export function readMemory(): MemoryReading {
  const freeMb = Math.round(probe.free() / MB);
  const totalMb = Math.round(probe.total() / MB);
  const { low, critical } = systemThresholds(totalMb);
  const system: MemoryPressure = freeMb < critical ? "critical" : freeMb < low ? "low" : "ok";
  const own = budgetPressure();
  return { freeMb, totalMb, pressure: RANK[own] > RANK[system] ? own : system };
}

/** What starting one more Claude process (the heaviest thing a turn can start) needs free. */
export const HEAVY_RUNTIME_MB = 450;

/**
 * True when a new process of about `costMb` fits: the PC keeps more than its "critical" free
 * memory afterwards, and Sahkarmi stays within the owner's limit (when one is set).
 */
export function hasRoomFor(costMb: number): boolean {
  const reading = readMemory();
  const { critical } = systemThresholds(reading.totalMb);
  if (reading.freeMb - costMb < critical) return false;
  const current = budget();
  if (current && current.limitMb > 0 && current.usedMb !== null) {
    return current.usedMb + costMb <= current.limitMb;
  }
  return true;
}
