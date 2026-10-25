import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RoutineCadence, SaveRoutineInput } from "../shared/ipc";
import { isRecord } from "./protocol";

/** One active imported routine, as read from its local database. */
export interface ImportedRoutine {
  name: string;
  agentName: string;
  instruction: string;
  schedule: unknown;
}

export interface RoutineImportReport {
  importedAt: string;
  imported: Array<{ name: string; coworker: string }>;
  skipped: Array<{ name: string; reason: string }>;
}

const MARKER_FILE = "routine-import.json";

/**
 * Reads the source app's active routines (read-only; the source app's own data is never changed). Uses
 * Node's built-in SQLite, loaded only when the source database is actually present.
 */
export async function readDesktopRoutines(databasePath: string): Promise<ImportedRoutine[]> {
  const { DatabaseSync } = await loadSqlite();
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const names = new Map<string, string>();
    for (const row of db.prepare("SELECT agent_id, agent_json FROM projection_agents").all()) {
      try {
        const agent: unknown = JSON.parse(String(row.agent_json));
        if (isRecord(agent) && typeof agent.name === "string") {
          names.set(String(row.agent_id), agent.name);
        }
      } catch {
        // A damaged agent row: its routines are reported as having no coworker.
      }
    }
    const rows = db
      .prepare(
        `SELECT r.agent_id, r.name, r.instruction, t.schedule_json
         FROM projection_agent_routines r
         LEFT JOIN projection_routine_triggers t ON t.routine_id = r.routine_id
         WHERE r.active = 1`,
      )
      .all();
    return rows.map((row) => {
      let schedule: unknown = null;
      try {
        schedule = row.schedule_json ? JSON.parse(String(row.schedule_json)) : null;
      } catch {
        schedule = null;
      }
      return {
        name: String(row.name ?? ""),
        agentName: names.get(String(row.agent_id)) ?? "",
        instruction: String(row.instruction ?? ""),
        schedule,
      };
    });
  } finally {
    db.close();
  }
}

/**
 * Node's built-in SQLite. The name is kept out of the bundler's sight: some Vite versions do not
 * yet list node:sqlite as a built-in and refuse to bundle it.
 */
export function loadSqlite(): Promise<typeof import("node:sqlite")> {
  const name = "node:sqlite";
  return import(/* @vite-ignore */ name);
}

/** the source app's schedule JSON in Sahkarmi's terms; null when it cannot be expressed. */
export function cadenceFromImport(schedule: unknown): RoutineCadence | null {
  if (!isRecord(schedule)) return null;
  const time = typeof schedule.time === "string" && /^\d{2}:\d{2}$/.test(schedule.time);
  switch (schedule.kind) {
    case "daily":
      return time ? { kind: "daily", time: schedule.time as string } : null;
    case "weekdays":
      return time ? { kind: "weekdays", time: schedule.time as string } : null;
    case "hourly":
      return { kind: "hourly" };
    case "interval": {
      const amount = Number(schedule.amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const minutes = schedule.unit === "hours" ? amount * 60 : amount;
      return { kind: "interval", minutes };
    }
    default:
      return null;
  }
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/linkedin/g, "linkdin")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !["the", "and", "content", "agent"].includes(word)),
  );

/**
 * The Sahkarmi coworker an source agent became: the same name, otherwise the one sharing the
 * most distinctive words ("Dhrubo Linkdin Content" → "my linkdin"). No match → null, never a guess
 * between two equally good coworkers.
 */
export function matchCoworker<T extends { id: string; name: string }>(
  agentName: string,
  coworkers: T[],
): T | null {
  const target = agentName.trim().toLowerCase();
  const exact = coworkers.find((bot) => bot.name.trim().toLowerCase() === target);
  if (exact) return exact;
  const wanted = words(agentName);
  const squashed = target.replace(/[^a-z0-9]/g, "");
  let best: T | null = null;
  let bestScore = 0;
  let tie = false;
  for (const bot of coworkers) {
    const theirs = words(bot.name);
    let score = [...wanted].filter((word) => theirs.has(word)).length;
    const botSquashed = bot.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (botSquashed.length > 3 && squashed.includes(botSquashed)) score += 1;
    if (score > bestScore) {
      best = bot;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) {
      tie = true;
    }
  }
  return bestScore > 0 && !tie ? best : null;
}

/** Routine inputs for the matched routines, always paused: the old app may still be running them. */
export function planRoutineImport<T extends { id: string; name: string }>(
  routines: ImportedRoutine[],
  coworkers: T[],
  now: Date,
): { inputs: SaveRoutineInput[]; report: RoutineImportReport } {
  const report: RoutineImportReport = { importedAt: now.toISOString(), imported: [], skipped: [] };
  const inputs: SaveRoutineInput[] = [];
  for (const routine of routines) {
    const name = routine.name.trim().slice(0, 80);
    if (!name || !routine.instruction.trim()) {
      report.skipped.push({ name: name || "(no name)", reason: "it has no instruction" });
      continue;
    }
    const coworker = matchCoworker(routine.agentName, coworkers);
    if (!coworker) {
      report.skipped.push({
        name,
        reason: `no Sahkarmi coworker matches the source app's "${routine.agentName || "unknown"}"`,
      });
      continue;
    }
    const cadence = cadenceFromImport(routine.schedule);
    inputs.push({
      name,
      steps: [{ botId: coworker.id, instruction: routine.instruction.trim() }],
      cadence,
      enabled: false,
      confirmFrequent: true,
    });
    report.imported.push({ name, coworker: coworker.name });
  }
  return { inputs, report };
}

/**
 * First start with no routines: bring the owner's active imported routines over, paused, once.
 * A marker file keeps it from running again after the owner deletes what was imported.
 */
export async function importDesktopRoutinesOnce(options: {
  userDataPath: string;
  sourceDatabase: string;
  routineCount: number;
  coworkers: Array<{ id: string; name: string }>;
  save: (input: SaveRoutineInput) => Promise<unknown>;
  now?: Date;
}): Promise<RoutineImportReport | null> {
  const marker = join(options.userDataPath, MARKER_FILE);
  if (options.routineCount > 0) return null;
  if (await exists(marker)) return null;
  if (!(await exists(options.sourceDatabase))) return null;
  const routines = await readDesktopRoutines(options.sourceDatabase);
  const { inputs, report } = planRoutineImport(
    routines,
    options.coworkers,
    options.now ?? new Date(),
  );
  const planned = report.imported;
  report.imported = [];
  for (const [index, input] of inputs.entries()) {
    try {
      await options.save(input);
      report.imported.push(planned[index]);
    } catch (error) {
      report.skipped.push({
        name: input.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await writeFile(marker, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export async function readRoutineImportReport(
  userDataPath: string,
): Promise<RoutineImportReport | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(userDataPath, MARKER_FILE), "utf8"));
    return isRecord(parsed) && Array.isArray(parsed.imported)
      ? (parsed as unknown as RoutineImportReport)
      : null;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
