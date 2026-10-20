import { occurrencesBetween } from "../../shared/cadence";
import type { Routine, RoutineRun, ScheduledTask } from "../../shared/ipc";

export type CalendarMode = "day" | "week" | "month";

/** One thing on the calendar. Upcoming entries come from real cadences, past ones from history. */
export interface CalendarEntry {
  key: string;
  at: Date;
  title: string;
  botId: string | null;
  kind: "task" | "routine";
  /** upcoming = will run; ran = a scheduled task was queued (no result is tracked for those). */
  state: "upcoming" | "ran" | "running" | "done" | "failed";
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/** Visible range for a mode. Weeks start on Monday; months are padded to whole weeks. */
export function calendarRange(mode: CalendarMode, anchor: Date): { start: Date; end: Date } {
  const day = startOfDay(anchor);
  if (mode === "day") return { start: day, end: addDays(day, 1) };
  if (mode === "week") {
    const start = addDays(day, -((day.getDay() + 6) % 7));
    return { start, end: addDays(start, 7) };
  }
  const first = new Date(day.getFullYear(), day.getMonth(), 1);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const last = new Date(day.getFullYear(), day.getMonth() + 1, 1);
  const end = addDays(last, (7 - ((last.getDay() + 6) % 7)) % 7);
  return { start, end };
}

export function shiftAnchor(mode: CalendarMode, anchor: Date, direction: 1 | -1): Date {
  if (mode === "day") return addDays(anchor, direction);
  if (mode === "week") return addDays(anchor, 7 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

export function calendarDays(mode: CalendarMode, anchor: Date): Date[] {
  const { start, end } = calendarRange(mode, anchor);
  const days: Date[] = [];
  for (let day = start; day < end; day = addDays(day, 1)) days.push(day);
  return days;
}

export function calendarEntries(
  schedules: ScheduledTask[],
  routines: Routine[],
  runs: RoutineRun[],
  start: Date,
  end: Date,
  now: Date,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  const inRange = (at: Date) => at >= start && at < end;
  for (const task of schedules) {
    if (task.enabled) {
      for (const at of occurrencesBetween(task.cadence, task.nextRunAt, maxDate(start, now), end)) {
        entries.push({
          key: `task:${task.id}:${at.getTime()}`,
          at,
          title: task.text,
          botId: task.botId,
          kind: "task",
          state: "upcoming",
        });
      }
    }
    if (task.lastRunAt && inRange(new Date(task.lastRunAt))) {
      entries.push({
        key: `task-ran:${task.id}`,
        at: new Date(task.lastRunAt),
        title: task.text,
        botId: task.botId,
        kind: "task",
        state: "ran",
      });
    }
  }
  for (const routine of routines) {
    if (!routine.enabled || !routine.cadence) continue;
    for (const at of occurrencesBetween(
      routine.cadence,
      routine.nextRunAt,
      maxDate(start, now),
      end,
    )) {
      entries.push({
        key: `routine:${routine.id}:${at.getTime()}`,
        at,
        title: routine.name,
        botId: routine.steps[0]?.botId ?? null,
        kind: "routine",
        state: "upcoming",
      });
    }
  }
  for (const run of runs) {
    const at = new Date(run.startedAt);
    if (!inRange(at)) continue;
    entries.push({
      key: `run:${run.id}`,
      at,
      title: run.routineName,
      botId: run.steps[0]?.botId ?? null,
      kind: "routine",
      state: run.status,
    });
  }
  return entries.sort((left, right) => left.at.getTime() - right.at.getTime());
}

/** The next `limit` real runs across scheduled tasks and routines. */
export function upcomingRuns(
  schedules: ScheduledTask[],
  routines: Routine[],
  now: Date,
  limit = 10,
): CalendarEntry[] {
  const horizon = addDays(now, 60);
  return calendarEntries(schedules, routines, [], now, horizon, now)
    .filter((entry) => entry.state === "upcoming")
    .slice(0, limit);
}

export function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function maxDate(left: Date, right: Date): Date {
  return left > right ? left : right;
}
