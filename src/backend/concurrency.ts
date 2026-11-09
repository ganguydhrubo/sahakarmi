/**
 * How many coworkers may work at once in "Auto" mode, and in which order waiting coworkers get
 * a free slot when fair turns are on. Pure functions: AgentService feeds them the live reading.
 */

/** Free memory Auto mode always leaves for Windows, the app window and the owner's other apps. */
export const AUTO_RESERVE_MB = 1_536;
/** A coworker with its own heavy process (a new one is ~450 MB). */
export const AUTO_HEAVY_COST_MB = 450;
/** A coworker on a shared engine process: its tools and helpers. */
export const AUTO_SHARED_COST_MB = 150;
/** Each awake browser page the coworker holds is its own renderer process. */
export const AUTO_PAGE_COST_MB = 150;
export const AUTO_MIN_TURNS = 1;
export const AUTO_MAX_TURNS = 64;

export interface AutoLimitInput {
  /** The PC's free (available) memory right now, in MB. */
  freeMb: number;
  /** "heavy": a coworker with its own process; "shared": one on a shared engine process. */
  kind: "heavy" | "shared";
  /** Awake browser pages this coworker holds. */
  awakePages: number;
}

/** What one more coworker of this kind costs, in MB. */
export function autoTurnCost(input: Pick<AutoLimitInput, "kind" | "awakePages">): number {
  const base = input.kind === "heavy" ? AUTO_HEAVY_COST_MB : AUTO_SHARED_COST_MB;
  const pages = Number.isFinite(input.awakePages) ? Math.max(0, Math.floor(input.awakePages)) : 0;
  return base + pages * AUTO_PAGE_COST_MB;
}

/**
 * limit = clamp(1..64, floor((free MB - 1536) / cost)). One turn can always run, so work never
 * stops completely. A 16 GB PC with 3 GB free: (3072 - 1536) / 450 = 3 heavy coworkers, or
 * 1536 / 150 = 10 on a shared engine.
 */
export function autoTurnLimit(input: AutoLimitInput): number {
  const cost = autoTurnCost(input);
  const free = Number.isFinite(input.freeMb) ? input.freeMb : 0;
  const fits = Math.floor((free - AUTO_RESERVE_MB) / cost);
  if (!Number.isFinite(fits)) return AUTO_MIN_TURNS;
  return Math.min(AUTO_MAX_TURNS, Math.max(AUTO_MIN_TURNS, fits));
}

export interface WaitingCoworker {
  botId: string;
  /** Its next queued message was typed by the owner: it keeps going first. */
  fromOwner: boolean;
  /** When it last finished (or started) a turn, ms; undefined when never served. */
  lastServedAt: number | undefined;
}

/**
 * Round-robin across coworkers: owner-typed messages first (in arrival order), then the
 * coworker served least recently. A coworker never served goes before any that was. Ties keep
 * arrival order, so with fair turns off and no history the order is the same as before.
 */
export function fairOrder(waiting: WaitingCoworker[]): string[] {
  return waiting
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      if (left.entry.fromOwner !== right.entry.fromOwner) return left.entry.fromOwner ? -1 : 1;
      const a = left.entry.lastServedAt ?? Number.NEGATIVE_INFINITY;
      const b = right.entry.lastServedAt ?? Number.NEGATIVE_INFINITY;
      if (a !== b) return a < b ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ entry }) => entry.botId);
}
