/**
 * How long each startup step took, written once to the app log (and so to Export diagnostics).
 * A slow start then names its slowest step instead of being a guess.
 */
export interface StartupSummary {
  totalMs: number;
  steps: Array<{ step: string; ms: number }>;
  slowest: string | null;
  slow: boolean;
}

/** Above this the summary is logged as a warning. */
export const SLOW_STARTUP_MS = 8_000;

export class StartupTimings {
  readonly #now: () => number;
  readonly #started: number;
  #last: number;
  readonly #steps: Array<{ step: string; ms: number }> = [];

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
    this.#started = now();
    this.#last = this.#started;
  }

  mark(step: string): void {
    const now = this.#now();
    this.#steps.push({ step, ms: Math.round(now - this.#last) });
    this.#last = now;
  }

  summary(): StartupSummary {
    const totalMs = Math.round(this.#last - this.#started);
    const slowest = this.#steps.reduce<{ step: string; ms: number } | null>(
      (worst, entry) => (!worst || entry.ms > worst.ms ? entry : worst),
      null,
    );
    return {
      totalMs,
      steps: [...this.#steps],
      slowest: slowest?.step ?? null,
      slow: totalMs > SLOW_STARTUP_MS,
    };
  }
}
