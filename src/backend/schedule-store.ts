import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { CreateScheduleInput, ScheduleCadence, ScheduledTask } from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

interface ScheduleState {
  version: 1;
  schedules: ScheduledTask[];
}

interface ScheduleStoreEvents {
  changed: [schedules: ScheduledTask[]];
}

export type ScheduleRunner = (task: ScheduledTask) => Promise<void>;

const TICK_MS = 30_000;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Recurring and one-off tasks ("Run on schedule"). Times are wall-clock in the machine's local
 * time zone, which for most users is IST. Missed runs while the app was closed fire once on launch.
 */
export class ScheduleStore extends EventEmitter<ScheduleStoreEvents> {
  readonly #file: JsonFile<ScheduleState>;
  readonly #now: () => Date;
  #state: ScheduleState = { version: 1, schedules: [] };
  #timer: NodeJS.Timeout | null = null;
  #runner: ScheduleRunner | null = null;
  #ticking = false;

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    super();
    this.#file = new JsonFile(join(userDataPath, "schedules.json"));
    this.#now = now;
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(() => ({ version: 1, schedules: [] }), isScheduleState);
  }

  start(runner: ScheduleRunner): void {
    this.#runner = runner;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#runner = null;
  }

  list(): ScheduledTask[] {
    return this.#state.schedules.map((task) => structuredClone(task));
  }

  async create(input: CreateScheduleInput): Promise<ScheduledTask> {
    const text = input.text.trim();
    if (!text) throw new Error("A scheduled task needs instructions.");
    const cadence = parseCadence(input.cadence);
    const task: ScheduledTask = {
      id: randomUUID(),
      botId: input.botId,
      text: text.slice(0, 20_000),
      cadence,
      enabled: true,
      createdAt: this.#now().toISOString(),
      lastRunAt: null,
      nextRunAt: nextRunAfter(cadence, this.#now())?.toISOString() ?? null,
    };
    if (!task.nextRunAt) throw new Error("That time is already in the past.");
    this.#state.schedules.push(task);
    await this.#persist();
    return structuredClone(task);
  }

  async setEnabled(scheduleId: string, enabled: boolean): Promise<ScheduledTask> {
    const task = this.#require(scheduleId);
    task.enabled = enabled;
    if (enabled) task.nextRunAt = nextRunAfter(task.cadence, this.#now())?.toISOString() ?? null;
    await this.#persist();
    return structuredClone(task);
  }

  async delete(scheduleId: string): Promise<void> {
    this.#require(scheduleId);
    this.#state.schedules = this.#state.schedules.filter((task) => task.id !== scheduleId);
    await this.#persist();
  }

  async deleteBotData(botId: string): Promise<void> {
    this.#state.schedules = this.#state.schedules.filter((task) => task.botId !== botId);
    await this.#persist();
  }

  async runNow(scheduleId: string): Promise<void> {
    const task = this.#require(scheduleId);
    await this.#run(task);
  }

  /** Runs every enabled task whose next run time has passed. Exposed for tests. */
  async tick(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      const now = this.#now();
      for (const task of this.#state.schedules) {
        if (!task.enabled || !task.nextRunAt || Date.parse(task.nextRunAt) > now.getTime())
          continue;
        await this.#run(task);
      }
    } finally {
      this.#ticking = false;
    }
  }

  async #run(task: ScheduledTask): Promise<void> {
    const now = this.#now();
    task.lastRunAt = now.toISOString();
    const next = task.cadence.kind === "once" ? null : nextRunAfter(task.cadence, now);
    task.nextRunAt = next?.toISOString() ?? null;
    if (task.cadence.kind === "once") task.enabled = false;
    await this.#persist();
    try {
      await this.#runner?.(structuredClone(task));
    } catch (error) {
      console.error("Scheduled task failed to queue:", error);
    }
  }

  #require(scheduleId: string): ScheduledTask {
    const task = this.#state.schedules.find((candidate) => candidate.id === scheduleId);
    if (!task) throw new Error("This scheduled task no longer exists.");
    return task;
  }

  async #persist(): Promise<void> {
    await this.#file.write(this.#state);
    this.emit("changed", this.list());
  }
}

export function parseCadence(value: unknown): ScheduleCadence {
  if (!isRecord(value)) throw new Error("Invalid schedule.");
  switch (value.kind) {
    case "once": {
      if (typeof value.at !== "string" || Number.isNaN(Date.parse(value.at))) {
        throw new Error("Pick a date and time for the task.");
      }
      return { kind: "once", at: new Date(value.at).toISOString() };
    }
    case "hourly":
      return { kind: "hourly" };
    case "daily":
    case "weekdays":
      return { kind: value.kind, time: parseTime(value.time) };
    case "weekly": {
      const day = value.day;
      if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
        throw new Error("Pick a day of the week.");
      }
      return { kind: "weekly", day: day as 0 | 1 | 2 | 3 | 4 | 5 | 6, time: parseTime(value.time) };
    }
    default:
      throw new Error("Unknown schedule type.");
  }
}

function parseTime(value: unknown): string {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) {
    throw new Error("Use a 24-hour time such as 09:30.");
  }
  return value;
}

/** Next local-time occurrence strictly after `from`, or null when a one-off time has passed. */
export function nextRunAfter(cadence: ScheduleCadence, from: Date): Date | null {
  if (cadence.kind === "once") {
    const at = new Date(cadence.at);
    return at.getTime() > from.getTime() ? at : null;
  }
  if (cadence.kind === "hourly") {
    const next = new Date(from);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return next;
  }
  const [hours, minutes] = cadence.time.split(":").map(Number) as [number, number];
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= from.getTime()) continue;
    const day = candidate.getDay();
    if (cadence.kind === "weekdays" && (day === 0 || day === 6)) continue;
    if (cadence.kind === "weekly" && day !== cadence.day) continue;
    return candidate;
  }
  return null;
}

function isScheduleState(value: unknown): value is ScheduleState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.schedules) &&
    value.schedules.every(
      (task) =>
        isRecord(task) &&
        typeof task.id === "string" &&
        typeof task.botId === "string" &&
        typeof task.text === "string" &&
        typeof task.enabled === "boolean" &&
        isRecord(task.cadence),
    )
  );
}
