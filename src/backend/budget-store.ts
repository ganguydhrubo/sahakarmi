import { join } from "node:path";
import type { BudgetSettings, SetBudgetInput } from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

/**
 * Work limits ("budget-stop" in Settings > Features): the most replies a coworker may start in
 * one day and the most steps one team run may send. No limit is set until the owner sets one,
 * so a fresh install behaves exactly as before. Kept in its own file (budgets.json); nothing
 * else the app stores is touched.
 */
interface BudgetFileState {
  version: 1;
  /** Bot id → replies a day. */
  coworkers: Record<string, number>;
  teamRunSteps: number | null;
  /** Replies started on `date` (the PC's local day), per bot id. */
  usage: { date: string; turns: Record<string, number> };
}

export const BUDGET_LIMITS = { min: 1, max: 10_000 } as const;

export class BudgetStore {
  readonly #file: JsonFile<BudgetFileState>;
  readonly #now: () => Date;
  #state: BudgetFileState;

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    this.#file = new JsonFile(join(userDataPath, "budgets.json"), { recoverCorrupt: true });
    this.#now = now;
    this.#state = emptyState(this.#today());
  }

  async initialize(): Promise<void> {
    const stored = await this.#file
      .read(() => emptyState(this.#today()), isBudgetState)
      .catch(() => emptyState(this.#today()));
    this.#state = {
      version: 1,
      coworkers: Object.fromEntries(
        Object.entries(stored.coworkers).filter(([, limit]) => validLimit(limit) !== null),
      ),
      teamRunSteps: validLimit(stored.teamRunSteps),
      usage: {
        date: stored.usage.date,
        turns: Object.fromEntries(
          Object.entries(stored.usage.turns).filter(
            ([, count]) => typeof count === "number" && Number.isFinite(count) && count >= 0,
          ),
        ) as Record<string, number>,
      },
    };
  }

  get(): BudgetSettings {
    this.#rollDay();
    return {
      coworkers: { ...this.#state.coworkers },
      teamRunSteps: this.#state.teamRunSteps,
      usedToday: { ...this.#state.usage.turns },
    };
  }

  /** `null` removes a limit. Only the fields given change. */
  async set(input: SetBudgetInput): Promise<BudgetSettings> {
    if (input.coworkers) {
      for (const [botId, limit] of Object.entries(input.coworkers)) {
        if (!botId) continue;
        const valid = validLimit(limit);
        if (limit !== null && valid === null) {
          throw new Error(`A limit must be a whole number from 1 to ${BUDGET_LIMITS.max}.`);
        }
        if (valid === null) delete this.#state.coworkers[botId];
        else this.#state.coworkers[botId] = valid;
      }
    }
    if (input.teamRunSteps !== undefined) {
      const valid = validLimit(input.teamRunSteps);
      if (input.teamRunSteps !== null && valid === null) {
        throw new Error(`A limit must be a whole number from 1 to ${BUDGET_LIMITS.max}.`);
      }
      this.#state.teamRunSteps = valid;
    }
    await this.#persist();
    return this.get();
  }

  /** The limit this coworker reached today, or null while it may start another reply. */
  coworkerLimitReached(botId: string): { limit: number; used: number } | null {
    const limit = this.#state.coworkers[botId];
    if (limit === undefined) return null;
    this.#rollDay();
    const used = this.#state.usage.turns[botId] ?? 0;
    return used >= limit ? { limit, used } : null;
  }

  /** A reply is starting. Counted only for coworkers with a limit, so nothing is written otherwise. */
  recordTurn(botId: string): void {
    if (this.#state.coworkers[botId] === undefined) return;
    this.#rollDay();
    this.#state.usage.turns[botId] = (this.#state.usage.turns[botId] ?? 0) + 1;
    void this.#persist().catch(() => undefined);
  }

  teamRunSteps(): number | null {
    return this.#state.teamRunSteps;
  }

  async deleteBotData(botId: string): Promise<void> {
    if (this.#state.coworkers[botId] === undefined && !(botId in this.#state.usage.turns)) return;
    delete this.#state.coworkers[botId];
    delete this.#state.usage.turns[botId];
    await this.#persist();
  }

  #today(): string {
    const now = this.#now();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${now.getFullYear()}-${month}-${day}`;
  }

  #rollDay(): void {
    const today = this.#today();
    if (this.#state.usage.date !== today) this.#state.usage = { date: today, turns: {} };
  }

  async #persist(): Promise<void> {
    await this.#file.write(this.#state);
  }
}

function validLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= BUDGET_LIMITS.min && value <= BUDGET_LIMITS.max ? value : null;
}

function emptyState(date: string): BudgetFileState {
  return { version: 1, coworkers: {}, teamRunSteps: null, usage: { date, turns: {} } };
}

function isBudgetState(value: unknown): value is BudgetFileState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRecord(value.coworkers) &&
    (value.teamRunSteps === null || typeof value.teamRunSteps === "number") &&
    isRecord(value.usage) &&
    typeof value.usage.date === "string" &&
    isRecord(value.usage.turns)
  );
}
