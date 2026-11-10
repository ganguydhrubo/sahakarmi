import { freemem, totalmem } from "node:os";

/**
 * Measures what the Intelligence Core itself costs: how many operations it ran, the wall time
 * and the CPU time of the process while they ran. Measured with process.hrtime / cpuUsage
 * around each operation; nothing runs in the background to collect it.
 *
 * Note: process.cpuUsage() is for the whole main process, so an operation's CPU time can include
 * other work that happened during it. That makes these numbers an upper bound, never an
 * under-count.
 */

export interface OperationStats {
  name: string;
  count: number;
  totalMs: number;
  maxMs: number;
  /** Main-process CPU time during these operations (an upper bound, see above). */
  cpuMs: number;
}

export interface MeterSnapshot {
  operations: OperationStats[];
  totalOperations: number;
  totalMs: number;
  totalCpuMs: number;
  /** Main process now. */
  heapUsedMb: number;
  rssMb: number;
  /** Main process CPU since the meter started, as a share of one core. */
  processCpuPercent: number | null;
  systemFreeMb: number;
  systemTotalMb: number;
  since: number;
}

const MB = 1024 * 1024;

export class ResourceMeter {
  readonly #ops = new Map<string, OperationStats>();
  readonly #startedAt = Date.now();
  readonly #startCpu = process.cpuUsage();
  readonly #startHr = process.hrtime.bigint();

  measure<T>(name: string, work: () => T): T {
    const cpu = process.cpuUsage();
    const start = process.hrtime.bigint();
    try {
      return work();
    } finally {
      this.#note(name, start, cpu);
    }
  }

  async measureAsync<T>(name: string, work: () => Promise<T>): Promise<T> {
    const cpu = process.cpuUsage();
    const start = process.hrtime.bigint();
    try {
      return await work();
    } finally {
      this.#note(name, start, cpu);
    }
  }

  #note(name: string, start: bigint, cpu: NodeJS.CpuUsage): void {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    const used = process.cpuUsage(cpu);
    const cpuMs = (used.user + used.system) / 1000;
    const stats = this.#ops.get(name) ?? { name, count: 0, totalMs: 0, maxMs: 0, cpuMs: 0 };
    stats.count += 1;
    stats.totalMs += elapsedMs;
    stats.maxMs = Math.max(stats.maxMs, elapsedMs);
    stats.cpuMs += cpuMs;
    this.#ops.set(name, stats);
  }

  snapshot(): MeterSnapshot {
    const operations = [...this.#ops.values()]
      .map((item) => ({
        ...item,
        totalMs: round(item.totalMs),
        maxMs: round(item.maxMs),
        cpuMs: round(item.cpuMs),
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
    const memory = process.memoryUsage();
    const wallMs = Number(process.hrtime.bigint() - this.#startHr) / 1e6;
    const cpu = process.cpuUsage(this.#startCpu);
    return {
      operations,
      totalOperations: operations.reduce((sum, item) => sum + item.count, 0),
      totalMs: round(operations.reduce((sum, item) => sum + item.totalMs, 0)),
      totalCpuMs: round(operations.reduce((sum, item) => sum + item.cpuMs, 0)),
      heapUsedMb: round(memory.heapUsed / MB),
      rssMb: round(memory.rss / MB),
      processCpuPercent: wallMs > 0 ? round(((cpu.user + cpu.system) / 1000 / wallMs) * 100) : null,
      systemFreeMb: Math.round(freemem() / MB),
      systemTotalMb: Math.round(totalmem() / MB),
      since: this.#startedAt,
    };
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
