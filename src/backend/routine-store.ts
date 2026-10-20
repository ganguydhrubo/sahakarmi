import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  isFrequentCadence,
  MAX_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  nextRunAfter,
} from "../shared/cadence";
import type {
  Routine,
  RoutineCadence,
  RoutineRun,
  RoutineRunStep,
  RoutinesState,
  SaveRoutineInput,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";
import { parseCadence } from "./schedule-store";

interface RoutineFileState {
  version: 1;
  routines: Routine[];
  runs: RoutineRun[];
}

interface RoutineStoreEvents {
  changed: [state: RoutinesState];
}

/** How a routine reaches coworkers: the same mailbox, queue, permissions and approvals as a person. */
export interface RoutineExecutor {
  /** Queues the text for the coworker and returns the delivery id. */
  send(botId: string, text: string): Promise<string>;
  /** Resolves when that delivery has finished, with the coworker's final reply. */
  waitFor(
    botId: string,
    deliveryId: string,
  ): Promise<{ ok: boolean; reply: string | null; error: string | null }>;
}

const TICK_MS = 30_000;
const MAX_RUNS = 200;
const MAX_STEPS = 20;
const RESULT_EXCERPT = 500;
const CONTEXT_LIMIT = 6_000;

/**
 * Named multi-step routines. Steps run one after another; each step's final reply is passed to
 * the next step as context. A failed step stops the run. Runs are kept in routines.json.
 */
export class RoutineStore extends EventEmitter<RoutineStoreEvents> {
  readonly #file: JsonFile<RoutineFileState>;
  readonly #now: () => Date;
  #state: RoutineFileState = { version: 1, routines: [], runs: [] };
  #executor: RoutineExecutor | null = null;
  #timer: NodeJS.Timeout | null = null;
  #ticking = false;
  readonly #active = new Map<string, Promise<void>>();

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    super();
    this.#file = new JsonFile(join(userDataPath, "routines.json"));
    this.#now = now;
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(
      () => ({ version: 1, routines: [], runs: [] }),
      isRoutineFileState,
    );
    // A run cannot survive an app restart: close it honestly instead of leaving it "running".
    let changed = false;
    for (const run of this.#state.runs) {
      if (run.status !== "running") continue;
      changed = true;
      run.status = "failed";
      run.finishedAt = this.#now().toISOString();
      for (const step of run.steps) {
        if (step.status === "running") {
          step.status = "failed";
          step.result = "Sahkarmi was closed during this step.";
        } else if (step.status === "queued") {
          step.status = "skipped";
        }
      }
    }
    if (changed) await this.#persist();
  }

  start(executor: RoutineExecutor): void {
    this.#executor = executor;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#executor = null;
  }

  state(): RoutinesState {
    return structuredClone({ routines: this.#state.routines, runs: this.#state.runs });
  }

  async save(input: SaveRoutineInput): Promise<RoutinesState> {
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
    if (!name) throw new Error("Give the routine a name.");
    if (!Array.isArray(input.steps) || input.steps.length === 0) {
      throw new Error("Add at least one step.");
    }
    if (input.steps.length > MAX_STEPS)
      throw new Error(`A routine can have up to ${MAX_STEPS} steps.`);
    const existing = input.id ? this.#require(input.id) : null;
    const steps = input.steps.map((step) => {
      const instruction = typeof step.instruction === "string" ? step.instruction.trim() : "";
      if (typeof step.botId !== "string" || !step.botId)
        throw new Error("Pick a coworker for every step.");
      if (!instruction) throw new Error("Every step needs an instruction.");
      return {
        id: typeof step.id === "string" && step.id ? step.id : randomUUID(),
        botId: step.botId,
        instruction: instruction.slice(0, 20_000),
      };
    });
    const cadence = input.cadence === null ? null : parseRoutineCadence(input.cadence);
    if (cadence && isFrequentCadence(cadence) && input.confirmFrequent !== true) {
      throw new Error("Running more often than every 5 minutes needs confirmation.");
    }
    const now = this.#now();
    const nextRunAt =
      cadence && input.enabled ? (nextRunAfter(cadence, now)?.toISOString() ?? null) : null;
    if (cadence?.kind === "once" && input.enabled && !nextRunAt) {
      throw new Error("That time is already in the past.");
    }
    if (existing) {
      existing.name = name;
      existing.steps = steps;
      existing.cadence = cadence;
      existing.enabled = input.enabled === true;
      existing.nextRunAt = nextRunAt;
    } else {
      this.#state.routines.push({
        id: randomUUID(),
        name,
        steps,
        cadence,
        enabled: input.enabled === true,
        createdAt: now.toISOString(),
        lastRunAt: null,
        nextRunAt,
      });
    }
    await this.#persist();
    return this.state();
  }

  async delete(routineId: string): Promise<RoutinesState> {
    this.#require(routineId);
    this.#state.routines = this.#state.routines.filter((routine) => routine.id !== routineId);
    await this.#persist();
    return this.state();
  }

  async setEnabled(routineId: string, enabled: boolean): Promise<RoutinesState> {
    const routine = this.#require(routineId);
    routine.enabled = enabled;
    routine.nextRunAt =
      enabled && routine.cadence
        ? (nextRunAfter(routine.cadence, this.#now())?.toISOString() ?? null)
        : null;
    await this.#persist();
    return this.state();
  }

  /** Steps that use a deleted coworker are removed; a routine left with no steps is removed. */
  async deleteBotData(botId: string): Promise<void> {
    for (const routine of this.#state.routines) {
      routine.steps = routine.steps.filter((step) => step.botId !== botId);
    }
    this.#state.routines = this.#state.routines.filter((routine) => routine.steps.length > 0);
    await this.#persist();
  }

  /** Starts a run without waiting for it. */
  async runNow(routineId: string): Promise<RoutinesState> {
    this.#require(routineId);
    if (this.#active.has(routineId)) throw new Error("This routine is already running.");
    this.#launch(routineId, "manual");
    return this.state();
  }

  /** Resolves when every running routine has finished. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.#active.size > 0) await Promise.allSettled([...this.#active.values()]);
  }

  /** Starts every enabled routine whose next run time has passed. */
  async tick(): Promise<void> {
    if (this.#ticking || !this.#executor) return;
    this.#ticking = true;
    try {
      const now = this.#now();
      for (const routine of this.#state.routines) {
        if (!routine.enabled || !routine.cadence || !routine.nextRunAt) continue;
        if (Date.parse(routine.nextRunAt) > now.getTime() || this.#active.has(routine.id)) continue;
        routine.lastRunAt = now.toISOString();
        routine.nextRunAt =
          routine.cadence.kind === "once"
            ? null
            : (nextRunAfter(routine.cadence, now)?.toISOString() ?? null);
        if (routine.cadence.kind === "once") routine.enabled = false;
        await this.#persist();
        this.#launch(routine.id, "schedule");
      }
    } finally {
      this.#ticking = false;
    }
  }

  #launch(routineId: string, trigger: RoutineRun["trigger"]): void {
    const task = this.#run(routineId, trigger)
      .catch((error) => console.error("Routine run failed:", error))
      .finally(() => this.#active.delete(routineId));
    this.#active.set(routineId, task);
  }

  async #run(routineId: string, trigger: RoutineRun["trigger"]): Promise<void> {
    const routine = this.#require(routineId);
    const executor = this.#executor;
    const startedAt = this.#now().toISOString();
    if (trigger === "manual") routine.lastRunAt = startedAt;
    const run: RoutineRun = {
      id: randomUUID(),
      routineId,
      routineName: routine.name,
      trigger,
      status: "running",
      startedAt,
      finishedAt: null,
      steps: routine.steps.map(
        (step): RoutineRunStep => ({
          stepId: step.id,
          botId: step.botId,
          instruction: step.instruction,
          status: "queued",
          deliveryId: null,
          result: null,
          startedAt: null,
          finishedAt: null,
        }),
      ),
    };
    this.#state.runs.unshift(run);
    this.#state.runs = this.#state.runs.slice(0, MAX_RUNS);
    await this.#persist();

    let previous: string | null = null;
    for (const [index, step] of run.steps.entries()) {
      step.status = "running";
      step.startedAt = this.#now().toISOString();
      await this.#persist();
      let outcome: { ok: boolean; reply: string | null; error: string | null };
      try {
        if (!executor) throw new Error("Coworkers are not ready yet.");
        step.deliveryId = await executor.send(
          step.botId,
          stepText(routine.name, index, run.steps.length, step.instruction, previous),
        );
        await this.#persist();
        outcome = await executor.waitFor(step.botId, step.deliveryId);
      } catch (error) {
        outcome = {
          ok: false,
          reply: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      step.finishedAt = this.#now().toISOString();
      if (!outcome.ok) {
        step.status = "failed";
        step.result = excerpt(outcome.error ?? "The step did not finish.");
        for (const rest of run.steps.slice(index + 1)) rest.status = "skipped";
        run.status = "failed";
        run.finishedAt = this.#now().toISOString();
        await this.#persist();
        return;
      }
      step.status = "done";
      step.result = outcome.reply ? excerpt(outcome.reply) : null;
      previous = outcome.reply;
      await this.#persist();
    }
    run.status = "done";
    run.finishedAt = this.#now().toISOString();
    await this.#persist();
  }

  #require(routineId: string): Routine {
    const routine = this.#state.routines.find((candidate) => candidate.id === routineId);
    if (!routine) throw new Error("This routine no longer exists.");
    return routine;
  }

  async #persist(): Promise<void> {
    await this.#file.write(this.#state);
    this.emit("changed", this.state());
  }
}

export function parseRoutineCadence(value: unknown): RoutineCadence {
  if (isRecord(value) && value.kind === "interval") {
    const minutes = value.minutes;
    if (
      typeof minutes !== "number" ||
      !Number.isInteger(minutes) ||
      minutes < MIN_INTERVAL_MINUTES ||
      minutes > MAX_INTERVAL_MINUTES
    ) {
      throw new Error("Repeat every 1 minute to 7 days.");
    }
    return { kind: "interval", minutes };
  }
  return parseCadence(value);
}

function stepText(
  name: string,
  index: number,
  total: number,
  instruction: string,
  previous: string | null,
): string {
  const header = `[Routine "${name}" · step ${index + 1}/${total}] ${instruction}`;
  if (!previous) return header;
  const context =
    previous.length > CONTEXT_LIMIT ? `${previous.slice(0, CONTEXT_LIMIT)}\n…` : previous;
  return `${header}\n\nResult of step ${index} (use as input):\n${context}`;
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > RESULT_EXCERPT ? `${clean.slice(0, RESULT_EXCERPT)}…` : clean;
}

function isRoutineFileState(value: unknown): value is RoutineFileState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.routines) &&
    Array.isArray(value.runs) &&
    value.routines.every(
      (routine) =>
        isRecord(routine) &&
        typeof routine.id === "string" &&
        typeof routine.name === "string" &&
        Array.isArray(routine.steps) &&
        typeof routine.enabled === "boolean",
    )
  );
}
