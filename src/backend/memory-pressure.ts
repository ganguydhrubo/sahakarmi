import { freemem, totalmem } from "node:os";

/**
 * How much physical memory the PC has free right now, and whether it is running short.
 *
 * On an 8 GB laptop the things Sahkarmi starts are what fill memory: each Claude coworker that
 * works is its own ~450 MB process, and each awake coworker browser page is ~100-200 MB. Past
 * the free RAM, Windows pages to disk and everything (the owner's other apps too) freezes.
 * Sahkarmi asks this before it starts more: a new heavy process waits while memory is short,
 * and idle browser pages are put to sleep sooner. os.freemem() is Windows' "available" memory
 * (free plus standby that can be reused at once), the same number Task Manager shows.
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

const MB = 1024 * 1024;
const systemProbe: MemoryProbe = { free: freemem, total: totalmem };
let probe: MemoryProbe = systemProbe;

/** Tests (and the Performance view's simulation) can stand in another reading. */
export function setMemoryProbe(next: MemoryProbe | null): void {
  probe = next ?? systemProbe;
}

/**
 * "low" below 15% of RAM or 1.2 GB free (whichever is more), "critical" below 8% or 600 MB.
 * On 8 GB that is about 1.2 GB and 650 MB; on 16 GB about 2.4 GB and 1.3 GB.
 */
export function readMemory(): MemoryReading {
  const freeMb = Math.round(probe.free() / MB);
  const totalMb = Math.round(probe.total() / MB);
  const low = Math.max(1_200, totalMb * 0.15);
  const critical = Math.max(600, totalMb * 0.08);
  return {
    freeMb,
    totalMb,
    pressure: freeMb < critical ? "critical" : freeMb < low ? "low" : "ok",
  };
}

/** What starting one more Claude process (the heaviest thing a turn can start) needs free. */
export const HEAVY_RUNTIME_MB = 500;

/** True when a new process of about `costMb` fits without pushing the PC into "low". */
export function hasRoomFor(costMb: number): boolean {
  const reading = readMemory();
  const low = Math.max(1_200, reading.totalMb * 0.15);
  return reading.freeMb - costMb >= low;
}
