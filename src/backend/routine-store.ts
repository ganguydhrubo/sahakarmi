import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
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
  RoutineTrigger,
  SaveRoutineInput,
} from "../shared/ipc";
import { createFolderWatcher, type StopWatching, type WatchFolder } from "./folder-watch";
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
  /** Approval steps: one owner card; resolves with the owner's decision. */
  askApproval?(input: {
    botId: string;
    routineName: string;
    question: string;
    details: string;
  }): Promise<"approved" | "rejected" | "timed-out">;
  /** Output steps that post to Telegram. */
  sendTelegram?(text: string): Promise<void>;
}

const TICK_MS = 30_000;
const MAX_RUNS = 200;
const MAX_STEPS = 20;
const RESULT_EXCERPT = 500;
const CONTEXT_LIMIT = 6_000;
/** Files added while a folder routine is busy or paused wait for its next run, up to this many. */
const MAX_PENDING_FILES = 50;

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
  readonly #watchFolder: WatchFolder;
  readonly #watchers = new Map<string, { folder: string; stop: StopWatching }>();
  readonly #pendingFiles = new Map<string, string[]>();
  #paused = false;

  constructor(
    userDataPath: string,
    now: () => Date = () => new Date(),
    watchFolder: WatchFolder = createFolderWatcher(),
  ) {
    super();
    this.#file = new JsonFile(join(userDataPath, "routines.json"), { recoverCorrupt: true });
    this.#now = now;
    this.#watchFolder = watchFolder;
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
        if (step.status === "running" || step.status === "waiting") {
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
    this.#syncWatchers();
    void this.tick();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#executor = null;
    for (const watcher of this.#watchers.values()) watcher.stop();
    this.#watchers.clear();
  }

  /**
   * "Pause all coworkers": no routine starts while paused. Due scheduled runs start once on
   * resume (as after a restart); files added meanwhile are handed to the next folder run.
   */
  setPaused(paused: boolean): void {
    if (this.#paused === paused) return;
    this.#paused = paused;
    if (paused) return;
    void this.tick();
    for (const routineId of [...this.#pendingFiles.keys()]) this.#launchPendingFiles(routineId);
  }

  get paused(): boolean {
    return this.#paused;
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
    const steps = await parseRoutineSteps(input.steps);
    const trigger = input.trigger ? await parseRoutineTrigger(input.trigger) : null;
    const cadence = trigger || input.cadence === null ? null : parseRoutineCadence(input.cadence);
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
      existing.trigger = trigger;
      existing.enabled = input.enabled === true;
      existing.nextRunAt = nextRunAt;
    } else {
      this.#state.routines.push({
        id: randomUUID(),
        name,
        steps,
        cadence,
        trigger,
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

  /**
   * Steps that use a deleted coworker are removed; a routine left with no coworker step is
   * removed. A "no" that jumped to a removed step now stops the run instead.
   */
  async deleteBotData(botId: string): Promise<void> {
    for (const routine of this.#state.routines) {
      routine.steps = routine.steps.filter((step) => !usesCoworker(step) || step.botId !== botId);
      const ids = new Set(routine.steps.map((step) => step.id));
      for (const step of routine.steps) {
        if (step.onNo?.action === "jump" && !ids.has(step.onNo.stepId)) {
          step.onNo = { action: "stop" };
        }
      }
    }
    this.#state.routines = this.#state.routines.filter((routine) =>
      routine.steps.some(usesCoworker),
    );
    await this.#persist();
  }

  /** Starts a run without waiting for it. */
  async runNow(routineId: string): Promise<RoutinesState> {
    this.#require(routineId);
    if (this.#active.has(routineId)) throw new Error("This routine is already running.");
    this.#launch(routineId, "manual");
    return this.state();
  }

  /**
   * Runs the routine again from one step of an earlier run. The steps before it are not run
   * again: their results (and approvals) are reused from that run, so a fixed step does not
   * redo, re-ask or re-send everything before it.
   */
  async rerunFrom(runId: string, stepId: string): Promise<RoutinesState> {
    const earlier = this.#state.runs.find((run) => run.id === runId);
    if (!earlier) throw new Error("That run is no longer in the history.");
    const routine = this.#require(earlier.routineId);
    if (this.#active.has(routine.id)) throw new Error("This routine is already running.");
    if (earlier.status === "running") throw new Error("Wait for that run to finish first.");
    const from = routine.steps.findIndex((step) => step.id === stepId);
    if (from < 0) throw new Error("That step is no longer in the routine.");
    let previous: string | null = null;
    const reused: RoutineRunStep[] = [];
    for (const step of routine.steps.slice(0, from)) {
      const before = earlier.steps.find((candidate) => candidate.stepId === step.id);
      if (!before) {
        throw new Error("A step before this one was added after that run. Run the whole routine.");
      }
      if (before.status === "done") {
        if (before.carry === undefined) {
          throw new Error("That run is too old to restart from a step. Run the whole routine.");
        }
        previous = before.carry;
      } else if (before.status !== "skipped") {
        throw new Error("An earlier step did not finish in that run. Rerun from that step.");
      }
      reused.push({ ...structuredClone(before), reused: true });
    }
    this.#launch(routine.id, "rerun", from === 0 ? (earlier.files ?? []) : [], {
      from,
      previous,
      reused,
      rerunOf: earlier.id,
    });
    return this.state();
  }

  /** Resolves when every running routine has finished. For tests and shutdown. */
  async idle(): Promise<void> {
    while (this.#active.size > 0) await Promise.allSettled([...this.#active.values()]);
  }

  /** Starts every enabled routine whose next run time has passed. */
  async tick(): Promise<void> {
    if (this.#ticking || !this.#executor || this.#paused) return;
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

  #launch(
    routineId: string,
    trigger: RoutineRun["trigger"],
    files: string[] = [],
    resume?: Resume,
  ): void {
    const task = this.#run(routineId, trigger, files, resume)
      .catch((error) => console.error("Routine run failed:", error))
      .finally(() => {
        this.#active.delete(routineId);
        this.#launchPendingFiles(routineId);
      });
    this.#active.set(routineId, task);
  }

  /** Keeps one watcher per enabled folder routine, matching the saved routines. */
  #syncWatchers(): void {
    const wanted = new Map<string, string>();
    if (this.#executor) {
      for (const routine of this.#state.routines) {
        const folder = folderOf(routine.trigger);
        if (routine.enabled && folder) wanted.set(routine.id, folder);
      }
    }
    for (const [routineId, watcher] of this.#watchers) {
      if (wanted.get(routineId) === watcher.folder) continue;
      watcher.stop();
      this.#watchers.delete(routineId);
      this.#pendingFiles.delete(routineId);
    }
    for (const [routineId, folder] of wanted) {
      if (this.#watchers.has(routineId)) continue;
      const stop = this.#watchFolder(folder, (files) => this.#filesAdded(routineId, files));
      this.#watchers.set(routineId, { folder, stop });
    }
  }

  #filesAdded(routineId: string, files: string[]): void {
    const routine = this.#state.routines.find((candidate) => candidate.id === routineId);
    if (!routine?.enabled || !folderOf(routine.trigger)) return;
    const pending = [...(this.#pendingFiles.get(routineId) ?? []), ...files];
    this.#pendingFiles.set(routineId, [...new Set(pending)].slice(0, MAX_PENDING_FILES));
    this.#launchPendingFiles(routineId);
  }

  #launchPendingFiles(routineId: string): void {
    const files = this.#pendingFiles.get(routineId);
    if (!files?.length) return;
    if (this.#paused || !this.#executor || this.#active.has(routineId)) return;
    this.#pendingFiles.delete(routineId);
    if (!this.#state.routines.some((routine) => routine.id === routineId && routine.enabled)) {
      return;
    }
    this.#launch(routineId, "folder", files);
  }

  async #run(
    routineId: string,
    trigger: RoutineRun["trigger"],
    files: string[] = [],
    resume?: Resume,
  ): Promise<void> {
    const routine = this.#require(routineId);
    const executor = this.#executor;
    const startedAt = this.#now().toISOString();
    if (trigger !== "schedule") routine.lastRunAt = startedAt;
    const run: RoutineRun = {
      id: randomUUID(),
      routineId,
      routineName: routine.name,
      trigger,
      ...(files.length > 0 ? { files } : {}),
      ...(resume ? { rerunOf: resume.rerunOf } : {}),
      status: "running",
      startedAt,
      finishedAt: null,
      steps: routine.steps.map(
        (step, position): RoutineRunStep =>
          resume?.reused[position] ?? {
            stepId: step.id,
            ...(step.kind && step.kind !== "agent" ? { kind: step.kind } : {}),
            botId: step.botId,
            instruction: step.instruction,
            status: "queued",
            deliveryId: null,
            result: null,
            startedAt: null,
            finishedAt: null,
          },
      ),
    };
    // The run follows the steps as they were when it started, even if the routine is edited.
    const plan = structuredClone(routine.steps);
    this.#state.runs.unshift(run);
    this.#state.runs = this.#state.runs.slice(0, MAX_RUNS);
    this.#dropOldCarries(routineId);
    await this.#persist();

    const finish = async (status: RoutineRun["status"], from: number) => {
      for (const rest of run.steps.slice(from)) {
        if (rest.status === "queued") rest.status = "skipped";
      }
      run.status = status;
      run.finishedAt = this.#now().toISOString();
      await this.#persist();
    };

    let previous: string | null = resume?.previous ?? null;
    let index = resume?.from ?? 0;
    while (index < run.steps.length) {
      const step = run.steps[index] as RoutineRunStep;
      const definition = plan[index] as Routine["steps"][number];
      const kind = definition.kind ?? "agent";
      step.status = "running";
      step.startedAt = this.#now().toISOString();
      await this.#persist();
      let outcome: StepOutcome;
      try {
        if (!executor) throw new Error("Coworkers are not ready yet.");
        if (kind === "approval") {
          step.status = "waiting";
          await this.#persist();
          outcome = await this.#approve(executor, routine.name, plan, index, previous);
        } else if (kind === "output") {
          outcome = await this.#output(executor, routine.name, definition, previous);
        } else {
          const text =
            kind === "condition"
              ? conditionText(routine.name, index, run.steps.length, step.instruction, previous)
              : stepText(
                  routine.name,
                  index,
                  run.steps.length,
                  step.instruction,
                  previous,
                  index === 0 ? files : [],
                );
          step.deliveryId = await executor.send(step.botId, text);
          await this.#persist();
          const reply = await executor.waitFor(step.botId, step.deliveryId);
          outcome = !reply.ok
            ? { ok: false, error: reply.error ?? "The step did not finish." }
            : kind === "condition"
              ? conditionOutcome(reply.reply)
              : { ok: true, result: reply.reply, next: reply.reply };
        }
      } catch (error) {
        outcome = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      step.finishedAt = this.#now().toISOString();
      if (!outcome.ok) {
        step.status = "failed";
        step.result = excerpt(outcome.error);
        await finish("failed", index + 1);
        return;
      }
      step.status = "done";
      step.result = outcome.result ? excerpt(outcome.result) : null;
      if (outcome.next !== undefined) previous = outcome.next;
      step.carry =
        previous && previous.length > CARRY_LIMIT ? previous.slice(0, CARRY_LIMIT) : previous;
      if (outcome.stop) {
        await finish("done", index + 1);
        return;
      }
      if (outcome.no && definition.onNo?.action === "jump") {
        const target = definition.onNo.stepId;
        const to = plan.findIndex(
          (candidate, position) => position > index && candidate.id === target,
        );
        if (to > index) {
          for (const skipped of run.steps.slice(index + 1, to)) skipped.status = "skipped";
          await this.#persist();
          index = to;
          continue;
        }
      }
      if (outcome.no) {
        await finish("done", index + 1);
        return;
      }
      await this.#persist();
      index += 1;
    }
    await finish("done", run.steps.length);
  }

  /** One owner card. Yes continues; no stops the run (as the owner asked); silence fails it. */
  async #approve(
    executor: RoutineExecutor,
    routineName: string,
    plan: Routine["steps"],
    index: number,
    previous: string | null,
  ): Promise<StepOutcome> {
    if (!executor.askApproval) return { ok: false, error: "Approvals are unavailable." };
    const step = plan[index] as Routine["steps"][number];
    // The card belongs to the coworker whose work is being approved (or the first one).
    const owner =
      plan.slice(0, index).reverse().find(usesCoworker) ?? plan.find(usesCoworker) ?? null;
    if (!owner) return { ok: false, error: "This routine has no coworker to ask for." };
    const shown = previous
      ? previous.length > APPROVAL_PREVIEW
        ? `${previous.slice(0, APPROVAL_PREVIEW)}\n…`
        : previous
      : null;
    const decision = await executor.askApproval({
      botId: owner.botId,
      routineName,
      question: step.instruction,
      details: shown
        ? `Routine "${routineName}" is waiting for you. The result so far:\n\n${shown}`
        : `Routine "${routineName}" is waiting for you before it goes on.`,
    });
    if (decision === "approved") return { ok: true, result: "Approved." };
    if (decision === "rejected") {
      return { ok: true, result: "Not approved, so the routine stopped here.", stop: true };
    }
    return { ok: false, error: "No answer within 24 hours, so the routine stopped." };
  }

  async #output(
    executor: RoutineExecutor,
    routineName: string,
    step: Routine["steps"][number],
    previous: string | null,
  ): Promise<StepOutcome> {
    const text = previous?.trim();
    if (!text) return { ok: false, error: "There is no result to send yet." };
    const output = step.output;
    if (output?.kind === "telegram") {
      if (!executor.sendTelegram) return { ok: false, error: "Telegram is not set up." };
      await executor.sendTelegram(`${routineName}\n\n${text}`);
      return { ok: true, result: "Sent to Telegram." };
    }
    if (output?.kind === "file") {
      const path = await writeOutputFile(output.folder, routineName, text, this.#now());
      return { ok: true, result: `Saved to ${path}` };
    }
    return { ok: false, error: "This output step has no destination." };
  }

  /** Only the latest few runs of a routine keep the text needed to restart from a step. */
  #dropOldCarries(routineId: string): void {
    let seen = 0;
    for (const run of this.#state.runs) {
      if (run.routineId !== routineId) continue;
      seen += 1;
      if (seen <= RERUNNABLE_RUNS) continue;
      for (const step of run.steps) delete step.carry;
    }
  }

  #require(routineId: string): Routine {
    const routine = this.#state.routines.find((candidate) => candidate.id === routineId);
    if (!routine) throw new Error("This routine no longer exists.");
    return routine;
  }

  async #persist(): Promise<void> {
    await this.#file.write(this.#state);
    this.#syncWatchers();
    this.emit("changed", this.state());
  }
}

function folderOf(trigger: RoutineTrigger | null | undefined): string | null {
  return isRecord(trigger) && trigger.kind === "folder" && typeof trigger.folder === "string"
    ? trigger.folder
    : null;
}

/** Validates a trigger from the window: the folder must exist now. */
export async function parseRoutineTrigger(value: unknown): Promise<RoutineTrigger> {
  if (!isRecord(value) || value.kind !== "folder" || typeof value.folder !== "string") {
    throw new Error("Unknown routine trigger.");
  }
  const folder = value.folder.trim();
  if (!folder || !isAbsolute(folder)) throw new Error("Choose a folder to watch.");
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error("That folder does not exist.");
  return { kind: "folder", folder: resolve(folder) };
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
  files: string[] = [],
): string {
  const header = `[Routine "${name}" · step ${index + 1}/${total}] ${instruction}`;
  if (files.length > 0) {
    const list = files.map((file) => `- ${file}`).join("\n");
    return `${header}\n\nNew file${files.length === 1 ? "" : "s"} added (use as input):\n${list}`;
  }
  if (!previous) return header;
  const context =
    previous.length > CONTEXT_LIMIT ? `${previous.slice(0, CONTEXT_LIMIT)}\n…` : previous;
  return `${header}\n\nResult of step ${index} (use as input):\n${context}`;
}

/** Where a rerun starts, and what it reuses from the earlier run. */
interface Resume {
  from: number;
  previous: string | null;
  reused: RoutineRunStep[];
  rerunOf: string;
}

/** How much of each step's result a run keeps for restarting from a later step. */
const CARRY_LIMIT = 20_000;
/** How many of a routine's latest runs keep those results. */
const RERUNNABLE_RUNS = 5;

type StepOutcome =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Shown on the step. */
      result: string | null;
      /** What the next step receives; absent = the previous result passes through. */
      next?: string | null;
      /** A condition answered no. */
      no?: boolean;
      /** End the run here as done (the owner said no). */
      stop?: boolean;
    };

/** How much of the result so far an approval card shows. */
const APPROVAL_PREVIEW = 1_500;

type StepDefinition = Routine["steps"][number];

/** Agent and condition steps are done by a coworker; approval and output steps are not. */
function usesCoworker(step: StepDefinition): boolean {
  return step.kind === undefined || step.kind === "agent" || step.kind === "condition";
}

function conditionText(
  name: string,
  index: number,
  total: number,
  question: string,
  previous: string | null,
): string {
  const header = `[Routine "${name}" · step ${index + 1}/${total} · yes/no check] ${question}`;
  const rule =
    "Do not do any task. Only decide. Answer YES or NO as the first word, then one short reason.";
  if (!previous) return `${header}\n\n${rule}`;
  const context =
    previous.length > CONTEXT_LIMIT ? `${previous.slice(0, CONTEXT_LIMIT)}\n…` : previous;
  return `${header}\n\n${rule}\n\nResult of step ${index} (decide from this):\n${context}`;
}

/** The first word decides: yes/no in English, Hindi (haan/nahi) and Bengali (hyan/na). */
export function parseYesNo(reply: string | null): boolean | null {
  const word = reply
    ?.trim()
    .replace(/^[^\p{L}]+/u, "")
    .match(/^[\p{L}\p{M}]+/u)?.[0]
    ?.toLowerCase();
  if (!word) return null;
  if (["yes", "y", "haan", "han", "ha", "hyan", "हाँ", "हां", "হ্যাঁ"].includes(word)) return true;
  if (["no", "n", "nahi", "nahin", "na", "नहीं", "না"].includes(word)) return false;
  return null;
}

function conditionOutcome(reply: string | null): StepOutcome {
  const answer = parseYesNo(reply);
  if (answer === null) {
    return { ok: false, error: "The coworker did not answer yes or no." };
  }
  const reason = reply?.trim() ?? "";
  return { ok: true, result: reason || (answer ? "Yes" : "No"), no: !answer };
}

/** Writes the result as "<routine> <date time>.md" in the folder; never overwrites a file. */
async function writeOutputFile(
  folder: string,
  routineName: string,
  text: string,
  now: Date,
): Promise<string> {
  const info = await stat(folder).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`The folder ${folder} no longer exists.`);
  const safe = routineName
    .replace(/[<>:"/\\|?*\p{Cc}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
  const base = `${(safe || "Routine").slice(0, 80)} ${stamp}`;
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const path = join(folder, attempt === 1 ? `${base}.md` : `${base} (${attempt}).md`);
    try {
      await writeFile(path, `${text}\n`, { encoding: "utf8", flag: "wx" });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not find a free file name in that folder.");
}

/** Validates the steps from the window. Ids are kept, so a condition can name a later step. */
export async function parseRoutineSteps(raw: SaveRoutineInput["steps"]): Promise<StepDefinition[]> {
  const steps: StepDefinition[] = [];
  for (const step of raw) {
    const kind = step.kind ?? "agent";
    if (!["agent", "condition", "approval", "output"].includes(kind)) {
      throw new Error("Unknown step type.");
    }
    const id = typeof step.id === "string" && step.id ? step.id.slice(0, 80) : randomUUID();
    const instruction = typeof step.instruction === "string" ? step.instruction.trim() : "";
    const parsed: StepDefinition = { id, botId: "", instruction: instruction.slice(0, 20_000) };
    if (kind !== "agent") parsed.kind = kind;
    if (kind === "agent" || kind === "condition") {
      if (typeof step.botId !== "string" || !step.botId) {
        throw new Error("Pick a coworker for every step.");
      }
      parsed.botId = step.botId;
    }
    if (kind === "agent" && !instruction) throw new Error("Every step needs an instruction.");
    if (kind === "condition" && !instruction) throw new Error("Write the yes/no question.");
    if (kind === "approval" && !instruction) throw new Error("Write what you want to approve.");
    if (kind === "condition") {
      const onNo = step.onNo;
      parsed.onNo =
        isRecord(onNo) && onNo.action === "jump" && typeof onNo.stepId === "string"
          ? { action: "jump", stepId: onNo.stepId }
          : { action: "stop" };
    }
    if (kind === "output") {
      const output = step.output;
      if (isRecord(output) && output.kind === "telegram") {
        parsed.output = { kind: "telegram" };
      } else if (isRecord(output) && output.kind === "file" && typeof output.folder === "string") {
        const folder = output.folder.trim();
        if (!folder || !isAbsolute(folder)) throw new Error("Choose a folder for the output.");
        const info = await stat(folder).catch(() => null);
        if (!info?.isDirectory()) throw new Error("The output folder does not exist.");
        parsed.output = { kind: "file", folder: resolve(folder) };
      } else {
        throw new Error("Choose where the output goes.");
      }
    }
    steps.push(parsed);
  }
  if (!steps.some(usesCoworker)) throw new Error("Add at least one coworker step.");
  if ((steps[0]?.kind ?? "agent") === "output") {
    throw new Error("An output step needs a step before it.");
  }
  const ids = steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) throw new Error("Two steps have the same id.");
  for (const [index, step] of steps.entries()) {
    if (step.onNo?.action !== "jump") continue;
    const target = step.onNo.stepId;
    if (ids.indexOf(target) <= index) throw new Error("A “no” can only jump to a later step.");
  }
  return steps;
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
