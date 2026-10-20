import type { RoutineCadence } from "./ipc";

/** Below this many minutes a repeating cadence needs explicit confirmation. */
export const FREQUENT_INTERVAL_MINUTES = 5;
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;

/**
 * Next local-time occurrence strictly after `from`, or null when a one-off time has passed.
 * Interval cadences repeat every N minutes from `from` (the last run, or now).
 */
export function nextRunAfter(cadence: RoutineCadence, from: Date): Date | null {
  if (cadence.kind === "once") {
    const at = new Date(cadence.at);
    return at.getTime() > from.getTime() ? at : null;
  }
  if (cadence.kind === "interval") {
    return new Date(from.getTime() + cadence.minutes * 60_000);
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

/**
 * Real upcoming occurrences inside [start, end), starting from the item's stored next run time.
 * Capped so a very frequent cadence cannot flood the calendar.
 */
export function occurrencesBetween(
  cadence: RoutineCadence,
  nextRunAt: string | null,
  start: Date,
  end: Date,
  limit = 500,
): Date[] {
  if (!nextRunAt) return [];
  const result: Date[] = [];
  let current: Date | null = new Date(nextRunAt);
  while (current && current.getTime() < end.getTime() && result.length < limit) {
    if (current.getTime() >= start.getTime()) result.push(current);
    if (cadence.kind === "once") break;
    current = nextRunAfter(cadence, current);
  }
  return result;
}

/** True when the cadence repeats faster than every FREQUENT_INTERVAL_MINUTES minutes. */
export function isFrequentCadence(cadence: RoutineCadence): boolean {
  return cadence.kind === "interval" && cadence.minutes < FREQUENT_INTERVAL_MINUTES;
}
