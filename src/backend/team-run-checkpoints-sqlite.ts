import { mkdirSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
import { JsonFile } from "./json-file";
import {
  isCheckpointThreadFile,
  MAX_CHECKPOINTS_PER_RUN,
  TeamRunCheckpointSaver,
  type ThreadFile,
} from "./team-run-checkpoints";
import { hideSecrets } from "./workflow-export";

type PendingWrites = Parameters<BaseCheckpointSaver["putWrites"]>[1];
type ChannelVersions = Parameters<BaseCheckpointSaver["put"]>[3];
type ListOptions = Parameters<BaseCheckpointSaver["list"]>[1];
type CheckpointPendingWrite = NonNullable<CheckpointTuple["pendingWrites"]>[number];

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
const JSON_SUFFIX = ".checkpoints.json";

interface CheckpointRow {
  id: string;
  checkpoint: string;
  metadata: string;
  parent_id: string | null;
}

interface WriteRow {
  task_id: string;
  idx: number;
  channel: string;
  value: string;
  task_path: string;
}

function assertSafeId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error("Invalid run id for a team run checkpoint.");
  }
}

function compareWrites(a: WriteRow, b: WriteRow): number {
  if (a.task_path !== b.task_path) return a.task_path < b.task_path ? -1 : 1;
  if (a.task_id !== b.task_id) return a.task_id < b.task_id ? -1 : 1;
  return a.idx - b.idx;
}

/**
 * LangGraph checkpoints for every team run in one SQLite file (<userData>/orchestrator/
 * team-runs.sqlite), through Node's built-in node:sqlite: no native addon to rebuild. Same
 * rules as the JSON saver it replaces: secrets scrubbed before anything reaches disk, only the
 * newest steps kept per run, a run's rows go with the run. Older per-run JSON files are
 * imported on open and left in place (an older Sahkarmi can still read them) until their run
 * is removed.
 */
export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  readonly #dir: string;
  readonly #db: DatabaseSync;
  #closed = false;

  constructor(directory: string) {
    super();
    this.#dir = directory;
    mkdirSync(directory, { recursive: true });
    this.#db = new DatabaseSync(join(directory, "team-runs.sqlite"));
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = NORMAL");
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        thread_id TEXT NOT NULL, ns TEXT NOT NULL, id TEXT NOT NULL,
        checkpoint TEXT NOT NULL, metadata TEXT NOT NULL, parent_id TEXT,
        PRIMARY KEY (thread_id, ns, id)
      );
      CREATE TABLE IF NOT EXISTS writes (
        thread_id TEXT NOT NULL, ns TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL, idx INTEGER NOT NULL, channel TEXT NOT NULL,
        value TEXT NOT NULL, task_path TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (thread_id, ns, checkpoint_id, task_id, idx)
      );
      CREATE TABLE IF NOT EXISTS imported (thread_id TEXT PRIMARY KEY);
    `);
  }

  /** Imports every older JSON checkpoint file not imported yet. Safe to call again. */
  async migrateJsonFiles(): Promise<number> {
    let imported = 0;
    for (const threadId of this.#jsonThreadIds()) {
      if (this.#closed) break;
      if (this.#db.prepare("SELECT 1 FROM imported WHERE thread_id = ?").get(threadId)) continue;
      const data = await new JsonFile<ThreadFile>(
        TeamRunCheckpointSaver.pathFor(this.#dir, threadId),
      )
        .read(() => ({ version: 1, checkpoints: {}, writes: {} }), isCheckpointThreadFile)
        .catch(() => null);
      if (!data) continue;
      this.#transaction(() => {
        const putCheckpoint = this.#db.prepare(
          "INSERT OR IGNORE INTO checkpoints (thread_id, ns, id, checkpoint, metadata, parent_id) VALUES (?, ?, ?, ?, ?, ?)",
        );
        for (const [ns, bucket] of Object.entries(data.checkpoints)) {
          for (const [id, stored] of Object.entries(bucket)) {
            putCheckpoint.run(
              threadId,
              ns,
              id,
              stored.checkpoint,
              stored.metadata,
              stored.parentId,
            );
          }
        }
        const putWrite = this.#db.prepare(
          "INSERT OR IGNORE INTO writes (thread_id, ns, checkpoint_id, task_id, idx, channel, value, task_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        );
        for (const [ns, byCheckpoint] of Object.entries(data.writes)) {
          for (const [checkpointId, records] of Object.entries(byCheckpoint)) {
            for (const [key, record] of Object.entries(records)) {
              const idx = Number(key.slice(key.lastIndexOf(",") + 1));
              putWrite.run(
                threadId,
                ns,
                checkpointId,
                record[0],
                Number.isFinite(idx) ? idx : 0,
                record[1],
                record[2],
                record[3] ?? "",
              );
            }
          }
        }
        this.#db.prepare("INSERT OR IGNORE INTO imported (thread_id) VALUES (?)").run(threadId);
      });
      imported += 1;
    }
    return imported;
  }

  #jsonThreadIds(): string[] {
    try {
      return readdirSync(this.#dir)
        .filter((name) => name.endsWith(JSON_SUFFIX))
        .map((name) => name.slice(0, -JSON_SUFFIX.length))
        .filter((id) => SAFE_ID.test(id));
    } catch {
      return [];
    }
  }

  #transaction(work: () => void): void {
    if (this.#closed) return;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  async #serialise(value: unknown): Promise<string> {
    const [, bytes] = await this.serde.dumpsTyped(value);
    return hideSecrets(new TextDecoder().decode(bytes));
  }

  #load<T>(text: string): Promise<T> {
    return this.serde.loadsTyped("json", text) as Promise<T>;
  }

  async #tuple(threadId: string, ns: string, row: CheckpointRow): Promise<CheckpointTuple> {
    const writes = this.#db
      .prepare(
        "SELECT task_id, idx, channel, value, task_path FROM writes WHERE thread_id = ? AND ns = ? AND checkpoint_id = ?",
      )
      .all(threadId, ns, row.id) as unknown as WriteRow[];
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      writes
        .sort(compareWrites)
        .map(
          async (write) =>
            [write.task_id, write.channel, await this.#load(write.value)] as CheckpointPendingWrite,
        ),
    );
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: row.id } },
      checkpoint: await this.#load<Checkpoint>(row.checkpoint),
      metadata: await this.#load<CheckpointMetadata>(row.metadata),
      pendingWrites,
    };
    if (row.parent_id) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: row.parent_id },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (threadId === undefined || this.#closed) return undefined;
    assertSafeId(threadId);
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const wanted = config.configurable?.checkpoint_id as string | undefined;
    const row = (
      wanted
        ? this.#db
            .prepare(
              "SELECT id, checkpoint, metadata, parent_id FROM checkpoints WHERE thread_id = ? AND ns = ? AND id = ?",
            )
            .get(threadId, ns, wanted)
        : this.#db
            .prepare(
              "SELECT id, checkpoint, metadata, parent_id FROM checkpoints WHERE thread_id = ? AND ns = ? ORDER BY id DESC LIMIT 1",
            )
            .get(threadId, ns)
    ) as CheckpointRow | undefined;
    return row ? this.#tuple(threadId, ns, row) : undefined;
  }

  async *list(config: RunnableConfig, options?: ListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (threadId === undefined || this.#closed) return;
    assertSafeId(threadId);
    const wantedNs = config.configurable?.checkpoint_ns as string | undefined;
    const before = options?.before?.configurable?.checkpoint_id as string | undefined;
    let limit = options?.limit;
    const rows = this.#db
      .prepare(
        "SELECT ns, id, checkpoint, metadata, parent_id FROM checkpoints WHERE thread_id = ? ORDER BY ns, id DESC",
      )
      .all(threadId) as unknown as Array<CheckpointRow & { ns: string }>;
    for (const row of rows) {
      if (wantedNs !== undefined && row.ns !== wantedNs) continue;
      if (before && row.id >= before) continue;
      if (limit !== undefined) {
        if (limit <= 0) return;
        limit -= 1;
      }
      const tuple = await this.#tuple(threadId, row.ns, row);
      if (options?.filter) {
        const metadata = (tuple.metadata ?? {}) as Record<string, unknown>;
        const matches = Object.entries(options.filter).every(
          ([key, value]) => metadata[key] === value,
        );
        if (!matches) continue;
      }
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    assertSafeId(threadId);
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const parent = config.configurable?.checkpoint_id as string | undefined;
    const serialisedCheckpoint = await this.#serialise(checkpoint);
    const serialisedMetadata = await this.#serialise(metadata);
    this.#transaction(() => {
      this.#db
        .prepare(
          "INSERT OR REPLACE INTO checkpoints (thread_id, ns, id, checkpoint, metadata, parent_id) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(threadId, ns, checkpoint.id, serialisedCheckpoint, serialisedMetadata, parent ?? null);
      // Keep the newest steps only; a run resumes from its latest checkpoint, never an old one.
      const stale = this.#db
        .prepare(
          "SELECT id FROM checkpoints WHERE thread_id = ? AND ns = ? ORDER BY id DESC LIMIT -1 OFFSET ?",
        )
        .all(threadId, ns, MAX_CHECKPOINTS_PER_RUN) as Array<{ id: string }>;
      const dropCheckpoint = this.#db.prepare(
        "DELETE FROM checkpoints WHERE thread_id = ? AND ns = ? AND id = ?",
      );
      const dropWrites = this.#db.prepare(
        "DELETE FROM writes WHERE thread_id = ? AND ns = ? AND checkpoint_id = ?",
      );
      for (const { id } of stale) {
        dropCheckpoint.run(threadId, ns, id);
        dropWrites.run(threadId, ns, id);
      }
    });
    return {
      configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrites,
    taskId: string,
    taskPath = "",
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    assertSafeId(threadId);
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!checkpointId) throw new Error("A team run write needs its checkpoint id.");
    if (this.#closed) return;
    const exists = this.#db
      .prepare("SELECT 1 FROM checkpoints WHERE thread_id = ? AND ns = ? AND id = ?")
      .get(threadId, ns, checkpointId);
    if (!exists) return; // pruned already; nothing to attach to
    const values = await Promise.all(writes.map(([, value]) => this.#serialise(value)));
    this.#transaction(() => {
      const statement = this.#db.prepare(
        "INSERT OR REPLACE INTO writes (thread_id, ns, checkpoint_id, task_id, idx, channel, value, task_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      );
      for (const [idx, [channel]] of writes.entries()) {
        statement.run(
          threadId,
          ns,
          checkpointId,
          taskId,
          idx,
          channel,
          values[idx] ?? "",
          taskPath,
        );
      }
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    assertSafeId(threadId);
    this.#transaction(() => {
      this.#db.prepare("DELETE FROM checkpoints WHERE thread_id = ?").run(threadId);
      this.#db.prepare("DELETE FROM writes WHERE thread_id = ?").run(threadId);
      this.#db.prepare("DELETE FROM imported WHERE thread_id = ?").run(threadId);
    });
    await rm(TeamRunCheckpointSaver.pathFor(this.#dir, threadId), { force: true });
  }

  /** Runs that still have checkpoints here (rows, or an older JSON file). */
  threadIds(): string[] {
    if (this.#closed) return [];
    const rows = this.#db.prepare("SELECT DISTINCT thread_id FROM checkpoints").all() as Array<{
      thread_id: string;
    }>;
    return [...new Set([...rows.map((row) => row.thread_id), ...this.#jsonThreadIds()])];
  }

  /** Later calls (a graph step settling after shutdown) read nothing and write nothing. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}

/**
 * Removes checkpoints of runs the store no longer has (dropped beyond the newest 50, or
 * removed while the app was closed). Only run-shaped ids that are not in `keep` go.
 */
export async function pruneOrphanCheckpoints(
  saver: { threadIds(): string[]; deleteThread(threadId: string): Promise<void> },
  keep: ReadonlySet<string>,
): Promise<string[]> {
  const removed: string[] = [];
  for (const threadId of saver.threadIds()) {
    if (keep.has(threadId) || !SAFE_ID.test(threadId)) continue;
    await saver.deleteThread(threadId).catch(() => undefined);
    removed.push(threadId);
  }
  return removed;
}
