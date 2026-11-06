import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MessageOrigin, PerformanceRow, PerformanceSummary, RunEvent } from "../shared/ipc";

/** Finished turns kept on this PC; older ones are dropped. */
export const MAX_RUN_EVENTS = 5_000;

export type NewRunEvent = Omit<RunEvent, "id">;

interface Row {
  id: number;
  bot_id: string;
  bot_name: string | null;
  provider: string | null;
  model: string | null;
  origin: string;
  outcome: string;
  started_at: string;
  duration_ms: number;
  tool_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
}

function toEvent(row: Row): RunEvent {
  return {
    id: row.id,
    botId: row.bot_id,
    botName: row.bot_name,
    provider: row.provider,
    model: row.model,
    origin: row.origin as MessageOrigin,
    outcome: row.outcome as RunEvent["outcome"],
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    toolCount: row.tool_count,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function rows(events: RunEvent[], keyOf: (event: RunEvent) => string): PerformanceRow[] {
  const groups = new Map<string, RunEvent[]>();
  for (const event of events) {
    const key = keyOf(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.entries()]
    .map(([key, items]) => ({
      key,
      turns: items.length,
      completed: items.filter((item) => item.outcome === "completed").length,
      failed: items.filter((item) => item.outcome === "failed").length,
      medianDurationMs: Math.round(median(items.map((item) => item.durationMs))),
      averageTools:
        Math.round((items.reduce((sum, item) => sum + item.toolCount, 0) / items.length) * 10) / 10,
    }))
    .sort((a, b) => b.turns - a.turns);
}

/**
 * A local record of finished coworker turns (time, tools, outcome, provider, model, tokens when
 * the runtime reports them), in <userData>/run-events.sqlite through node:sqlite. It never
 * leaves the PC: there is no upload, no telemetry endpoint, nothing but this file.
 */
export class RunEventStore {
  readonly #db: DatabaseSync;
  #closed = false;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = NORMAL");
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_id TEXT NOT NULL, bot_name TEXT, provider TEXT, model TEXT,
        origin TEXT NOT NULL, outcome TEXT NOT NULL, started_at TEXT NOT NULL,
        duration_ms INTEGER NOT NULL, tool_count INTEGER NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS run_events_started ON run_events (started_at);
    `);
  }

  record(event: NewRunEvent): void {
    if (this.#closed) return;
    this.#db
      .prepare(
        "INSERT INTO run_events (bot_id, bot_name, provider, model, origin, outcome, started_at, duration_ms, tool_count, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        event.botId,
        event.botName,
        event.provider,
        event.model,
        event.origin,
        event.outcome,
        event.startedAt,
        Math.max(0, Math.round(event.durationMs)),
        Math.max(0, Math.round(event.toolCount)),
        event.inputTokens,
        event.outputTokens,
      );
    this.#db
      .prepare(
        "DELETE FROM run_events WHERE id <= (SELECT id FROM run_events ORDER BY id DESC LIMIT 1 OFFSET ?)",
      )
      .run(MAX_RUN_EVENTS);
  }

  summary(recentLimit = 25): PerformanceSummary {
    if (this.#closed) {
      return { since: null, totalTurns: 0, byCoworker: [], byModel: [], recent: [] };
    }
    const events = (
      this.#db.prepare("SELECT * FROM run_events ORDER BY id DESC").all() as unknown as Row[]
    ).map(toEvent);
    return {
      since: events.at(-1)?.startedAt ?? null,
      totalTurns: events.length,
      byCoworker: rows(events, (event) => event.botName ?? event.botId),
      byModel: rows(events, (event) => event.model ?? event.provider ?? "unknown"),
      recent: events.slice(0, recentLimit),
    };
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}
