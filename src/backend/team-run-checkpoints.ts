import { readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";
import { hideSecrets } from "./workflow-export";

type PendingWrites = Parameters<BaseCheckpointSaver["putWrites"]>[1];
type ChannelVersions = Parameters<BaseCheckpointSaver["put"]>[3];
type ListOptions = Parameters<BaseCheckpointSaver["list"]>[1];
type CheckpointPendingWrite = NonNullable<CheckpointTuple["pendingWrites"]>[number];

/** One graph step, serialised by LangGraph's own serialiser and scrubbed of secrets. */
interface StoredCheckpoint {
  checkpoint: string;
  metadata: string;
  parentId: string | null;
}

/** [taskId, channel, value, taskPath] */
type StoredWrite = [string, string, string, string];

export interface ThreadFile {
  version: 1;
  /** namespace -> checkpoint id -> step */
  checkpoints: Record<string, Record<string, StoredCheckpoint>>;
  /** namespace -> checkpoint id -> "taskId,idx" -> write */
  writes: Record<string, Record<string, Record<string, StoredWrite>>>;
}

/** Steps kept per run. Older ones are dropped; a run only ever resumes from its latest. */
export const MAX_CHECKPOINTS_PER_RUN = 20;

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

function emptyThread(): ThreadFile {
  return { version: 1, checkpoints: {}, writes: {} };
}

export function isCheckpointThreadFile(value: unknown): value is ThreadFile {
  return (
    isRecord(value) && value.version === 1 && isRecord(value.checkpoints) && isRecord(value.writes)
  );
}

function assertSafeId(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`Invalid ${label} for a team run checkpoint.`);
  }
}

function compareWrites(a: [string, string, number], b: [string, string, number]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
  return a[2] - b[2];
}

/**
 * LangGraph checkpoints for team runs, one small JSON file per run under
 * <userData>/orchestrator/. Pure TypeScript on the app's own atomic JsonFile: no native
 * database, nothing to rebuild for Electron, and every write passes through hideSecrets() so a
 * key or password a coworker echoed never reaches disk. A run's file goes away with the run.
 */
export class TeamRunCheckpointSaver extends BaseCheckpointSaver {
  readonly #dir: string;
  readonly #threads = new Map<string, { file: JsonFile<ThreadFile>; data: ThreadFile }>();

  constructor(directory: string) {
    super();
    this.#dir = directory;
  }

  static pathFor(directory: string, runId: string): string {
    return join(directory, `${runId}.checkpoints.json`);
  }

  async #thread(threadId: string): Promise<{ file: JsonFile<ThreadFile>; data: ThreadFile }> {
    const cached = this.#threads.get(threadId);
    if (cached) return cached;
    const file = new JsonFile<ThreadFile>(TeamRunCheckpointSaver.pathFor(this.#dir, threadId));
    const data = await file.read(emptyThread, isCheckpointThreadFile);
    const entry = { file, data };
    this.#threads.set(threadId, entry);
    return entry;
  }

  async #serialise(value: unknown): Promise<string> {
    const [, bytes] = await this.serde.dumpsTyped(value);
    return hideSecrets(new TextDecoder().decode(bytes));
  }

  #load<T>(text: string): Promise<T> {
    return this.serde.loadsTyped("json", text) as Promise<T>;
  }

  async #tuple(
    threadId: string,
    ns: string,
    checkpointId: string,
    data: ThreadFile,
  ): Promise<CheckpointTuple | undefined> {
    const stored = data.checkpoints[ns]?.[checkpointId];
    if (!stored) return undefined;
    const writes = data.writes[ns]?.[checkpointId] ?? {};
    const ordered = Object.entries(writes)
      .map(([key, record]) => {
        const comma = key.lastIndexOf(",");
        const taskId = key.slice(0, comma);
        const idx = Number(key.slice(comma + 1));
        return { sortKey: [record[3] ?? "", taskId, idx] as [string, string, number], record };
      })
      .sort((a, b) => compareWrites(a.sortKey, b.sortKey));
    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(
      ordered.map(
        async ({ record }) =>
          [record[0], record[1], await this.#load(record[2])] as CheckpointPendingWrite,
      ),
    );
    const tuple: CheckpointTuple = {
      config: {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpointId },
      },
      checkpoint: await this.#load<Checkpoint>(stored.checkpoint),
      metadata: await this.#load<CheckpointMetadata>(stored.metadata),
      pendingWrites,
    };
    if (stored.parentId) {
      tuple.parentConfig = {
        configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: stored.parentId },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (threadId === undefined) return undefined;
    assertSafeId("run id", threadId);
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const { data } = await this.#thread(threadId);
    let checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!checkpointId) {
      checkpointId = Object.keys(data.checkpoints[ns] ?? {})
        .sort()
        .reverse()[0];
      if (!checkpointId) return undefined;
    }
    return this.#tuple(threadId, ns, checkpointId, data);
  }

  async *list(config: RunnableConfig, options?: ListOptions): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (threadId === undefined) return;
    assertSafeId("run id", threadId);
    const wantedNs = config.configurable?.checkpoint_ns as string | undefined;
    const before = options?.before?.configurable?.checkpoint_id as string | undefined;
    let limit = options?.limit;
    const { data } = await this.#thread(threadId);
    for (const ns of Object.keys(data.checkpoints)) {
      if (wantedNs !== undefined && ns !== wantedNs) continue;
      const ids = Object.keys(data.checkpoints[ns] ?? {})
        .sort()
        .reverse();
      for (const id of ids) {
        if (before && id >= before) continue;
        if (limit !== undefined) {
          if (limit <= 0) return;
          limit -= 1;
        }
        const tuple = await this.#tuple(threadId, ns, id, data);
        if (!tuple) continue;
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
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    assertSafeId("run id", threadId);
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const parent = config.configurable?.checkpoint_id as string | undefined;
    const { file, data } = await this.#thread(threadId);
    data.checkpoints[ns] ??= {};
    const bucket = data.checkpoints[ns];
    bucket[checkpoint.id] = {
      checkpoint: await this.#serialise(checkpoint),
      metadata: await this.#serialise(metadata),
      parentId: parent ?? null,
    };
    // Keep the newest steps only; a run resumes from its latest checkpoint, never an old one.
    const ids = Object.keys(bucket).sort();
    while (ids.length > MAX_CHECKPOINTS_PER_RUN) {
      const oldest = ids.shift();
      if (!oldest) break;
      delete bucket[oldest];
      delete data.writes[ns]?.[oldest];
    }
    await file.write(data);
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
    assertSafeId("run id", threadId);
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!checkpointId) throw new Error("A team run write needs its checkpoint id.");
    const { file, data } = await this.#thread(threadId);
    if (!data.checkpoints[ns]?.[checkpointId]) return; // pruned already; nothing to attach to
    data.writes[ns] ??= {};
    data.writes[ns][checkpointId] ??= {};
    const bucket = data.writes[ns][checkpointId];
    for (const [idx, [channel, value]] of writes.entries()) {
      bucket[`${taskId},${idx}`] = [taskId, channel, await this.#serialise(value), taskPath];
    }
    await file.write(data);
  }

  async deleteThread(threadId: string): Promise<void> {
    assertSafeId("run id", threadId);
    this.#threads.delete(threadId);
    await rm(TeamRunCheckpointSaver.pathFor(this.#dir, threadId), { force: true });
  }

  /** Runs with a checkpoint file in the folder. */
  threadIds(): string[] {
    try {
      return readdirSync(this.#dir)
        .filter((name) => name.endsWith(".checkpoints.json"))
        .map((name) => name.slice(0, -".checkpoints.json".length))
        .filter((id) => SAFE_ID.test(id));
    } catch {
      return [];
    }
  }
}
