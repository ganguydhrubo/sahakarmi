import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/**
 * The Intelligence Core's own SQLite file (`intelligence/intelligence.sqlite` under userData),
 * through the same built-in `node:sqlite` engine as team memory and Knowledge Bases. It is a new
 * file: no existing table or file is changed.
 *
 * - `outcomes`: one row per piece of work a coworker did (a chat turn or a team-run task attempt),
 *   with what was predicted at the start and what the evidence said at the end.
 * - `experiences` + `experiences_fts`: short lessons and observations with provenance and a trust
 *   level, searchable with FTS5 (bm25), scoped to one workspace, with expiry.
 * - `decisions`: every routing / replanning decision, the alternatives and the reason (audit).
 * - `policy` + `policy_snapshots`: learnt parameters (the failure model) with earlier versions,
 *   so learning can be rolled back.
 *
 * Every query names a workspace: nothing here crosses from one workspace to another.
 */

const SCHEMA_VERSION = 1;

import type {
  ExperienceKind,
  ExperienceTrust,
  OutcomeOrigin,
  OutcomeStatus,
  PredictionSource,
  VerificationGrade,
} from "../../shared/intelligence";

export type {
  ExperienceKind,
  ExperienceTrust,
  OutcomeOrigin,
  OutcomeStatus,
  PredictionSource,
  VerificationGrade,
};

export interface OutcomeRow {
  id: string;
  workspaceId: string;
  botId: string;
  provider: string | null;
  model: string | null;
  category: string;
  origin: OutcomeOrigin;
  sourceKey: string;
  runId: string | null;
  taskId: string | null;
  /** The mailbox delivery (one queued message) this work answered. */
  deliveryId: string | null;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  status: OutcomeStatus;
  verification: VerificationGrade | null;
  verificationReasons: string[];
  toolCalls: number;
  toolErrors: number;
  errorSignature: string | null;
  promptChars: number;
  tokens: number | null;
  costUsd: number | null;
  predictedFailure: number | null;
  predictedDurationMs: number | null;
  predictionSource: PredictionSource | null;
  features: Record<string, number> | null;
  feedback: "good" | "bad" | null;
  feedbackNote: string | null;
  excluded: boolean;
  summary: string;
  learned: boolean;
}

export interface ExperienceRow {
  id: string;
  workspaceId: string;
  kind: ExperienceKind;
  trust: ExperienceTrust;
  category: string | null;
  botId: string | null;
  outcomeId: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  uses: number;
  lastUsedAt: number | null;
  correctedFrom: string | null;
}

export interface ExperienceHit extends ExperienceRow {
  /** bm25 rank from FTS5: lower is better. */
  rank: number;
}

export interface DecisionRow {
  id: string;
  workspaceId: string;
  at: number;
  kind: "route" | "reassign" | "stop-retry" | "plan";
  subject: string | null;
  category: string | null;
  chosenBotId: string | null;
  defaultBotId: string | null;
  applied: boolean;
  explanation: string;
  candidates: unknown;
  outcomeId: string | null;
  outcomeLabel: number | null;
}

type Row = Record<string, SQLInputValue>;

export class IntelligenceDb {
  readonly #db: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.#db = new DatabaseSync(path);
    if (path !== ":memory:") {
      this.#db.exec("PRAGMA journal_mode = WAL");
      this.#db.exec("PRAGMA synchronous = NORMAL");
    }
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#migrate();
  }

  close(): void {
    try {
      this.#db.close();
    } catch {
      // Already closed.
    }
  }

  #migrate(): void {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        category TEXT NOT NULL,
        origin TEXT NOT NULL,
        source_key TEXT NOT NULL UNIQUE,
        run_id TEXT,
        task_id TEXT,
        delivery_id TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        duration_ms INTEGER,
        status TEXT NOT NULL,
        verification TEXT,
        verification_reasons TEXT NOT NULL DEFAULT '[]',
        tool_calls INTEGER NOT NULL DEFAULT 0,
        tool_errors INTEGER NOT NULL DEFAULT 0,
        error_signature TEXT,
        prompt_chars INTEGER NOT NULL DEFAULT 0,
        tokens INTEGER,
        cost_usd REAL,
        predicted_failure REAL,
        predicted_duration_ms INTEGER,
        prediction_source TEXT,
        features TEXT,
        feedback TEXT,
        feedback_note TEXT,
        excluded INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        learned INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS outcomes_ws_cat ON outcomes(workspace_id, category, started_at);
      CREATE INDEX IF NOT EXISTS outcomes_ws_bot ON outcomes(workspace_id, bot_id, started_at);
      CREATE INDEX IF NOT EXISTS outcomes_ws_time ON outcomes(workspace_id, started_at);
      CREATE INDEX IF NOT EXISTS outcomes_delivery ON outcomes(delivery_id);
      CREATE TABLE IF NOT EXISTS experiences (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        trust TEXT NOT NULL,
        category TEXT,
        bot_id TEXT,
        outcome_id TEXT,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        uses INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER,
        corrected_from TEXT
      );
      CREATE INDEX IF NOT EXISTS experiences_ws ON experiences(workspace_id, created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS experiences_fts USING fts5(
        text, content='experiences', content_rowid='seq', tokenize='porter unicode61'
      );
      CREATE TRIGGER IF NOT EXISTS experiences_ai AFTER INSERT ON experiences BEGIN
        INSERT INTO experiences_fts(rowid, text) VALUES (new.seq, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS experiences_ad AFTER DELETE ON experiences BEGIN
        INSERT INTO experiences_fts(experiences_fts, rowid, text) VALUES ('delete', old.seq, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS experiences_au AFTER UPDATE OF text ON experiences BEGIN
        INSERT INTO experiences_fts(experiences_fts, rowid, text) VALUES ('delete', old.seq, old.text);
        INSERT INTO experiences_fts(rowid, text) VALUES (new.seq, new.text);
      END;
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        subject TEXT,
        category TEXT,
        chosen_bot_id TEXT,
        default_bot_id TEXT,
        applied INTEGER NOT NULL DEFAULT 0,
        explanation TEXT NOT NULL,
        candidates TEXT NOT NULL DEFAULT '[]',
        outcome_id TEXT,
        outcome_label REAL
      );
      CREATE INDEX IF NOT EXISTS decisions_ws ON decisions(workspace_id, at);
      CREATE TABLE IF NOT EXISTS policy (
        name TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS policy_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        state TEXT NOT NULL,
        updates INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this.#db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)")
      .run(String(SCHEMA_VERSION));
  }

  transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  // ---------------------------------------------------------------- outcomes

  insertOutcome(row: OutcomeRow): boolean {
    const result = this.#db
      .prepare(
        `INSERT OR IGNORE INTO outcomes (
          id, workspace_id, bot_id, provider, model, category, origin, source_key, run_id, task_id,
          delivery_id, started_at, ended_at, duration_ms, status, verification, verification_reasons,
          tool_calls, tool_errors, error_signature, prompt_chars, tokens, cost_usd,
          predicted_failure, predicted_duration_ms, prediction_source, features,
          feedback, feedback_note, excluded, summary, learned
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.workspaceId,
        row.botId,
        row.provider,
        row.model,
        row.category,
        row.origin,
        row.sourceKey,
        row.runId,
        row.taskId,
        row.deliveryId,
        row.startedAt,
        row.endedAt,
        row.durationMs,
        row.status,
        row.verification,
        JSON.stringify(row.verificationReasons),
        row.toolCalls,
        row.toolErrors,
        row.errorSignature,
        row.promptChars,
        row.tokens,
        row.costUsd,
        row.predictedFailure,
        row.predictedDurationMs,
        row.predictionSource,
        row.features ? JSON.stringify(row.features) : null,
        row.feedback,
        row.feedbackNote,
        row.excluded ? 1 : 0,
        row.summary,
        row.learned ? 1 : 0,
      );
    return Number(result.changes) > 0;
  }

  /** Changes the given fields of one outcome. Unknown field names are ignored. */
  updateOutcome(id: string, fields: Partial<OutcomeRow>): void {
    const columns: Array<[string, SQLInputValue]> = [];
    const set = (column: string, value: SQLInputValue) => columns.push([column, value]);
    if (fields.endedAt !== undefined) set("ended_at", fields.endedAt);
    if (fields.durationMs !== undefined) set("duration_ms", fields.durationMs);
    if (fields.status !== undefined) set("status", fields.status);
    if (fields.verification !== undefined) set("verification", fields.verification);
    if (fields.verificationReasons !== undefined) {
      set("verification_reasons", JSON.stringify(fields.verificationReasons));
    }
    if (fields.toolCalls !== undefined) set("tool_calls", fields.toolCalls);
    if (fields.toolErrors !== undefined) set("tool_errors", fields.toolErrors);
    if (fields.errorSignature !== undefined) set("error_signature", fields.errorSignature);
    if (fields.tokens !== undefined) set("tokens", fields.tokens);
    if (fields.costUsd !== undefined) set("cost_usd", fields.costUsd);
    if (fields.feedback !== undefined) set("feedback", fields.feedback);
    if (fields.feedbackNote !== undefined) set("feedback_note", fields.feedbackNote);
    if (fields.excluded !== undefined) set("excluded", fields.excluded ? 1 : 0);
    if (fields.learned !== undefined) set("learned", fields.learned ? 1 : 0);
    if (fields.provider !== undefined) set("provider", fields.provider);
    if (fields.model !== undefined) set("model", fields.model);
    if (fields.category !== undefined) set("category", fields.category);
    if (fields.runId !== undefined) set("run_id", fields.runId);
    if (fields.taskId !== undefined) set("task_id", fields.taskId);
    if (fields.predictedFailure !== undefined) set("predicted_failure", fields.predictedFailure);
    if (fields.predictedDurationMs !== undefined) {
      set("predicted_duration_ms", fields.predictedDurationMs);
    }
    if (fields.predictionSource !== undefined) set("prediction_source", fields.predictionSource);
    if (fields.features !== undefined) {
      set("features", fields.features ? JSON.stringify(fields.features) : null);
    }
    if (columns.length === 0) return;
    this.#db
      .prepare(
        `UPDATE outcomes SET ${columns.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ?`,
      )
      .run(...columns.map(([, value]) => value), id);
  }

  outcome(id: string): OutcomeRow | null {
    const row = this.#db.prepare("SELECT * FROM outcomes WHERE id = ?").get(id) as Row | undefined;
    return row ? toOutcome(row) : null;
  }

  outcomeBySource(sourceKey: string): OutcomeRow | null {
    const row = this.#db.prepare("SELECT * FROM outcomes WHERE source_key = ?").get(sourceKey) as
      | Row
      | undefined;
    return row ? toOutcome(row) : null;
  }

  outcomeByDelivery(deliveryId: string): OutcomeRow | null {
    const row = this.#db
      .prepare("SELECT * FROM outcomes WHERE delivery_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(deliveryId) as Row | undefined;
    return row ? toOutcome(row) : null;
  }

  /** Newest first, one workspace, optional filters. */
  outcomes(
    workspaceId: string,
    options: {
      category?: string;
      botId?: string;
      since?: number;
      limit?: number;
      finishedOnly?: boolean;
      offset?: number;
    } = {},
  ): OutcomeRow[] {
    const where = ["workspace_id = ?"];
    const params: SQLInputValue[] = [workspaceId];
    if (options.category) {
      where.push("category = ?");
      params.push(options.category);
    }
    if (options.botId) {
      where.push("bot_id = ?");
      params.push(options.botId);
    }
    if (options.since !== undefined) {
      where.push("started_at >= ?");
      params.push(options.since);
    }
    if (options.finishedOnly) where.push("status != 'running'");
    const limit = Math.max(1, Math.min(10_000, Math.floor(options.limit ?? 500)));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const rows = this.#db
      .prepare(
        `SELECT * FROM outcomes WHERE ${where.join(" AND ")} ORDER BY started_at DESC, rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Row[];
    return rows.map(toOutcome);
  }

  /** Outcomes still "running" that began before `before` (left over from a crash or restart). */
  staleRunning(before: number): OutcomeRow[] {
    const rows = this.#db
      .prepare("SELECT * FROM outcomes WHERE status = 'running' AND started_at < ? LIMIT 500")
      .all(before) as Row[];
    return rows.map(toOutcome);
  }

  countOutcomes(workspaceId?: string): number {
    const row = (
      workspaceId
        ? this.#db
            .prepare("SELECT COUNT(*) AS n FROM outcomes WHERE workspace_id = ?")
            .get(workspaceId)
        : this.#db.prepare("SELECT COUNT(*) AS n FROM outcomes").get()
    ) as Row;
    return Number(row.n ?? 0);
  }

  deleteOutcomes(workspaceId: string): number {
    const result = this.#db.prepare("DELETE FROM outcomes WHERE workspace_id = ?").run(workspaceId);
    return Number(result.changes);
  }

  /** Keeps the newest `keep` outcomes of a workspace; returns how many were removed. */
  pruneOutcomes(workspaceId: string, keep: number): number {
    const result = this.#db
      .prepare(
        `DELETE FROM outcomes WHERE workspace_id = ? AND id NOT IN (
           SELECT id FROM outcomes WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ?
         )`,
      )
      .run(workspaceId, workspaceId, Math.max(0, keep));
    return Number(result.changes);
  }

  workspaces(): string[] {
    const rows = this.#db
      .prepare(
        `SELECT workspace_id FROM outcomes GROUP BY workspace_id
         UNION SELECT workspace_id FROM experiences GROUP BY workspace_id`,
      )
      .all() as Row[];
    return rows.map((row) => String(row.workspace_id));
  }

  // ---------------------------------------------------------------- experiences

  insertExperience(row: ExperienceRow): void {
    this.#db
      .prepare(
        `INSERT INTO experiences (id, workspace_id, kind, trust, category, bot_id, outcome_id, text,
          created_at, updated_at, expires_at, uses, last_used_at, corrected_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.workspaceId,
        row.kind,
        row.trust,
        row.category,
        row.botId,
        row.outcomeId,
        row.text,
        row.createdAt,
        row.updatedAt,
        row.expiresAt,
        row.uses,
        row.lastUsedAt,
        row.correctedFrom,
      );
  }

  experience(id: string, workspaceId: string): ExperienceRow | null {
    const row = this.#db
      .prepare("SELECT * FROM experiences WHERE id = ? AND workspace_id = ?")
      .get(id, workspaceId) as Row | undefined;
    return row ? toExperience(row) : null;
  }

  /** An experience with the same text in the same workspace, if any (no duplicates). */
  experienceByText(workspaceId: string, text: string): ExperienceRow | null {
    const row = this.#db
      .prepare("SELECT * FROM experiences WHERE workspace_id = ? AND text = ? LIMIT 1")
      .get(workspaceId, text) as Row | undefined;
    return row ? toExperience(row) : null;
  }

  updateExperience(
    id: string,
    workspaceId: string,
    fields: Partial<
      Pick<
        ExperienceRow,
        | "text"
        | "trust"
        | "kind"
        | "expiresAt"
        | "updatedAt"
        | "uses"
        | "lastUsedAt"
        | "correctedFrom"
      >
    >,
  ): boolean {
    const columns: Array<[string, SQLInputValue]> = [];
    if (fields.text !== undefined) columns.push(["text", fields.text]);
    if (fields.trust !== undefined) columns.push(["trust", fields.trust]);
    if (fields.kind !== undefined) columns.push(["kind", fields.kind]);
    if (fields.expiresAt !== undefined) columns.push(["expires_at", fields.expiresAt]);
    if (fields.updatedAt !== undefined) columns.push(["updated_at", fields.updatedAt]);
    if (fields.uses !== undefined) columns.push(["uses", fields.uses]);
    if (fields.lastUsedAt !== undefined) columns.push(["last_used_at", fields.lastUsedAt]);
    if (fields.correctedFrom !== undefined) columns.push(["corrected_from", fields.correctedFrom]);
    if (columns.length === 0) return false;
    const result = this.#db
      .prepare(
        `UPDATE experiences SET ${columns.map(([column]) => `${column} = ?`).join(", ")} WHERE id = ? AND workspace_id = ?`,
      )
      .run(...columns.map(([, value]) => value), id, workspaceId);
    return Number(result.changes) > 0;
  }

  deleteExperience(id: string, workspaceId: string): boolean {
    const result = this.#db
      .prepare("DELETE FROM experiences WHERE id = ? AND workspace_id = ?")
      .run(id, workspaceId);
    return Number(result.changes) > 0;
  }

  experiences(
    workspaceId: string,
    options: { kind?: string; limit?: number; offset?: number; now?: number } = {},
  ): ExperienceRow[] {
    const where = ["workspace_id = ?", "(expires_at IS NULL OR expires_at > ?)"];
    const params: SQLInputValue[] = [workspaceId, options.now ?? Date.now()];
    if (options.kind) {
      where.push("kind = ?");
      params.push(options.kind);
    }
    const rows = this.#db
      .prepare(
        `SELECT * FROM experiences WHERE ${where.join(" AND ")} ORDER BY created_at DESC, seq DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...params,
        Math.max(1, Math.min(500, options.limit ?? 50)),
        Math.max(0, options.offset ?? 0),
      ) as Row[];
    return rows.map(toExperience);
  }

  countExperiences(workspaceId?: string): number {
    const row = (
      workspaceId
        ? this.#db
            .prepare("SELECT COUNT(*) AS n FROM experiences WHERE workspace_id = ?")
            .get(workspaceId)
        : this.#db.prepare("SELECT COUNT(*) AS n FROM experiences").get()
    ) as Row;
    return Number(row.n ?? 0);
  }

  /** bm25 search within one workspace, live (not expired) entries only. */
  searchExperiences(
    workspaceId: string,
    query: string,
    limit: number,
    now = Date.now(),
  ): ExperienceHit[] {
    if (!query.trim()) return [];
    const rows = this.#db
      .prepare(
        `SELECT e.*, bm25(experiences_fts) AS rank FROM experiences_fts
         JOIN experiences e ON e.seq = experiences_fts.rowid
         WHERE experiences_fts MATCH ? AND e.workspace_id = ? AND (e.expires_at IS NULL OR e.expires_at > ?)
         ORDER BY rank LIMIT ?`,
      )
      .all(query, workspaceId, now, Math.max(1, Math.min(100, limit))) as Row[];
    return rows.map((row) => ({ ...toExperience(row), rank: Number(row.rank ?? 0) }));
  }

  deleteExpiredExperiences(now: number): number {
    const result = this.#db
      .prepare("DELETE FROM experiences WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(now);
    return Number(result.changes);
  }

  /**
   * Keeps at most `keep` experiences in a workspace. Owner-given ones go last; among the rest,
   * the least used and oldest go first.
   */
  pruneExperiences(workspaceId: string, keep: number): number {
    const result = this.#db
      .prepare(
        `DELETE FROM experiences WHERE workspace_id = ? AND id NOT IN (
           SELECT id FROM experiences WHERE workspace_id = ?
           ORDER BY (trust = 'owner') DESC, uses DESC, COALESCE(last_used_at, created_at) DESC
           LIMIT ?
         )`,
      )
      .run(workspaceId, workspaceId, Math.max(0, keep));
    return Number(result.changes);
  }

  deleteExperiences(workspaceId: string): number {
    return Number(
      this.#db.prepare("DELETE FROM experiences WHERE workspace_id = ?").run(workspaceId).changes,
    );
  }

  // ---------------------------------------------------------------- decisions

  insertDecision(row: DecisionRow): void {
    this.#db
      .prepare(
        `INSERT INTO decisions (id, workspace_id, at, kind, subject, category, chosen_bot_id,
          default_bot_id, applied, explanation, candidates, outcome_id, outcome_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.workspaceId,
        row.at,
        row.kind,
        row.subject,
        row.category,
        row.chosenBotId,
        row.defaultBotId,
        row.applied ? 1 : 0,
        row.explanation,
        JSON.stringify(row.candidates ?? []),
        row.outcomeId,
        row.outcomeLabel,
      );
  }

  settleDecision(id: string, outcomeId: string, label: number | null): void {
    this.#db
      .prepare("UPDATE decisions SET outcome_id = ?, outcome_label = ? WHERE id = ?")
      .run(outcomeId, label, id);
  }

  decisions(workspaceId: string, limit = 50): DecisionRow[] {
    const rows = this.#db
      .prepare(
        "SELECT * FROM decisions WHERE workspace_id = ? ORDER BY at DESC, rowid DESC LIMIT ?",
      )
      .all(workspaceId, Math.max(1, Math.min(500, limit))) as Row[];
    return rows.map(toDecision);
  }

  pruneDecisions(workspaceId: string, keep: number): number {
    const result = this.#db
      .prepare(
        `DELETE FROM decisions WHERE workspace_id = ? AND id NOT IN (
           SELECT id FROM decisions WHERE workspace_id = ? ORDER BY at DESC LIMIT ?
         )`,
      )
      .run(workspaceId, workspaceId, Math.max(0, keep));
    return Number(result.changes);
  }

  deleteDecisions(workspaceId: string): number {
    return Number(
      this.#db.prepare("DELETE FROM decisions WHERE workspace_id = ?").run(workspaceId).changes,
    );
  }

  // ---------------------------------------------------------------- policy

  policy(name: string): unknown {
    const row = this.#db.prepare("SELECT state FROM policy WHERE name = ?").get(name) as
      | Row
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(String(row.state));
    } catch {
      return null;
    }
  }

  savePolicy(name: string, state: unknown, now: number): void {
    this.#db
      .prepare(
        `INSERT INTO policy (name, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(name, JSON.stringify(state), now);
  }

  snapshotPolicy(name: string, state: unknown, updates: number, now: number, keep = 5): void {
    this.#db
      .prepare(
        "INSERT INTO policy_snapshots (name, state, updates, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(name, JSON.stringify(state), updates, now);
    this.#db
      .prepare(
        `DELETE FROM policy_snapshots WHERE name = ? AND id NOT IN (
           SELECT id FROM policy_snapshots WHERE name = ? ORDER BY id DESC LIMIT ?
         )`,
      )
      .run(name, name, keep);
  }

  policySnapshots(name: string): Array<{ id: number; updates: number; createdAt: number }> {
    const rows = this.#db
      .prepare(
        "SELECT id, updates, created_at FROM policy_snapshots WHERE name = ? ORDER BY id DESC",
      )
      .all(name) as Row[];
    return rows.map((row) => ({
      id: Number(row.id),
      updates: Number(row.updates),
      createdAt: Number(row.created_at),
    }));
  }

  policySnapshot(name: string, id: number): unknown {
    const row = this.#db
      .prepare("SELECT state FROM policy_snapshots WHERE name = ? AND id = ?")
      .get(name, id) as Row | undefined;
    if (!row) return null;
    try {
      return JSON.parse(String(row.state));
    } catch {
      return null;
    }
  }

  /** One model and its snapshots, by exact name (never a prefix: "ws-1" must not hit "ws-12"). */
  deletePolicy(name: string): void {
    this.#db.prepare("DELETE FROM policy WHERE name = ?").run(name);
    this.#db.prepare("DELETE FROM policy_snapshots WHERE name = ?").run(name);
  }
}

function text(value: SQLInputValue | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function num(value: SQLInputValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function json<T>(value: SQLInputValue | undefined, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toOutcome(row: Row): OutcomeRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    botId: String(row.bot_id),
    provider: text(row.provider),
    model: text(row.model),
    category: String(row.category),
    origin: String(row.origin) as OutcomeOrigin,
    sourceKey: String(row.source_key),
    runId: text(row.run_id),
    taskId: text(row.task_id),
    deliveryId: text(row.delivery_id),
    startedAt: Number(row.started_at),
    endedAt: num(row.ended_at),
    durationMs: num(row.duration_ms),
    status: String(row.status) as OutcomeStatus,
    verification: text(row.verification) as VerificationGrade | null,
    verificationReasons: json<string[]>(row.verification_reasons, []),
    toolCalls: Number(row.tool_calls ?? 0),
    toolErrors: Number(row.tool_errors ?? 0),
    errorSignature: text(row.error_signature),
    promptChars: Number(row.prompt_chars ?? 0),
    tokens: num(row.tokens),
    costUsd: num(row.cost_usd),
    predictedFailure: num(row.predicted_failure),
    predictedDurationMs: num(row.predicted_duration_ms),
    predictionSource: text(row.prediction_source) as PredictionSource | null,
    features: json<Record<string, number> | null>(row.features, null),
    feedback: text(row.feedback) as OutcomeRow["feedback"],
    feedbackNote: text(row.feedback_note),
    excluded: Number(row.excluded ?? 0) === 1,
    summary: String(row.summary ?? ""),
    learned: Number(row.learned ?? 0) === 1,
  };
}

function toExperience(row: Row): ExperienceRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: String(row.kind) as ExperienceKind,
    trust: String(row.trust) as ExperienceTrust,
    category: text(row.category),
    botId: text(row.bot_id),
    outcomeId: text(row.outcome_id),
    text: String(row.text),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    expiresAt: num(row.expires_at),
    uses: Number(row.uses ?? 0),
    lastUsedAt: num(row.last_used_at),
    correctedFrom: text(row.corrected_from),
  };
}

function toDecision(row: Row): DecisionRow {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    at: Number(row.at),
    kind: String(row.kind) as DecisionRow["kind"],
    subject: text(row.subject),
    category: text(row.category),
    chosenBotId: text(row.chosen_bot_id),
    defaultBotId: text(row.default_bot_id),
    applied: Number(row.applied ?? 0) === 1,
    explanation: String(row.explanation),
    candidates: json<unknown>(row.candidates, []),
    outcomeId: text(row.outcome_id),
    outcomeLabel: num(row.outcome_label),
  };
}
