// @vitest-environment node

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnableConfig } from "@langchain/core/runnables";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_CHECKPOINTS_PER_RUN, TeamRunCheckpointSaver } from "./team-run-checkpoints";
import { pruneOrphanCheckpoints, SqliteCheckpointSaver } from "./team-run-checkpoints-sqlite";

let root: string;
const open: SqliteCheckpointSaver[] = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-sqlite-checkpoints-"));
});

afterEach(async () => {
  for (const saver of open.splice(0)) saver.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function saver(): SqliteCheckpointSaver {
  const created = new SqliteCheckpointSaver(root);
  open.push(created);
  return created;
}

function checkpoint(id: string, values: Record<string, unknown>) {
  return {
    v: 4,
    id,
    ts: new Date().toISOString(),
    channel_values: values,
    channel_versions: { tasks: 1 },
    versions_seen: {},
  };
}

const META = { source: "loop" as const, step: 1, parents: {} };

describe("SqliteCheckpointSaver", () => {
  it("stores a step and reads it back with its writes in order, after reopening", async () => {
    const first = saver();
    const config = await first.put(
      { configurable: { thread_id: "run-1" } },
      checkpoint("c1", { tasks: [{ id: "t1" }] }),
      META,
      {},
    );
    await first.putWrites(config, [["tasks", { id: "t2" }]], "task-b", "~__pregel_pull, work");
    await first.putWrites(config, [["tasks", { id: "t1" }]], "task-a", "~__pregel_pull, work");
    first.close();
    open.splice(open.indexOf(first), 1);

    const again = saver();
    const tuple = await again.getTuple({ configurable: { thread_id: "run-1" } });
    expect(tuple?.checkpoint.id).toBe("c1");
    expect(tuple?.checkpoint.channel_values).toEqual({ tasks: [{ id: "t1" }] });
    expect(tuple?.pendingWrites?.map((write) => write[0])).toEqual(["task-a", "task-b"]);
  });

  it("never writes a secret to disk", async () => {
    const store = saver();
    await store.put(
      { configurable: { thread_id: "run-2" } },
      checkpoint("c1", { result: "Use api_key=sk-live-1234567890abcdef and password: hunter2" }),
      META,
      {},
    );
    store.close();
    open.splice(open.indexOf(store), 1);
    const raw = await readFile(join(root, "team-runs.sqlite"));
    expect(raw.includes("sk-live-1234567890abcdef")).toBe(false);
    expect(raw.includes("hunter2")).toBe(false);
  });

  it("keeps only the newest steps of a run", async () => {
    const store = saver();
    let config: RunnableConfig = { configurable: { thread_id: "run-3" } };
    for (let index = 0; index < MAX_CHECKPOINTS_PER_RUN + 5; index += 1) {
      const id = `c${String(index).padStart(3, "0")}`;
      config = await store.put(config, checkpoint(id, { step: index }), META, {});
      await store.putWrites(config, [["step", index]], "task", "");
    }
    const ids = [];
    for await (const item of store.list({ configurable: { thread_id: "run-3" } })) {
      ids.push(item.checkpoint.id);
    }
    expect(ids).toHaveLength(MAX_CHECKPOINTS_PER_RUN);
    expect(ids[0]).toBe("c024");
  });

  it("imports an older JSON checkpoint file once and keeps the file readable", async () => {
    const json = new TeamRunCheckpointSaver(root);
    const config = await json.put(
      { configurable: { thread_id: "run-old" } },
      checkpoint("c7", { tasks: [{ id: "t1", status: "running" }] }),
      META,
      {},
    );
    await json.putWrites(config, [["tasks", { id: "t1", status: "completed" }]], "task-a", "");

    const store = saver();
    expect(await store.migrateJsonFiles()).toBe(1);
    expect(await store.migrateJsonFiles()).toBe(0);
    const tuple = await store.getTuple({ configurable: { thread_id: "run-old" } });
    expect(tuple?.checkpoint.id).toBe("c7");
    expect(tuple?.pendingWrites).toHaveLength(1);
    await access(TeamRunCheckpointSaver.pathFor(root, "run-old"));

    await store.deleteThread("run-old");
    expect(await store.getTuple({ configurable: { thread_id: "run-old" } })).toBeUndefined();
    await expect(access(TeamRunCheckpointSaver.pathFor(root, "run-old"))).rejects.toThrow();
  });

  it("removes checkpoints of runs the store no longer has, and nothing else", async () => {
    const store = saver();
    for (const id of ["run-kept", "run-dropped"]) {
      await store.put({ configurable: { thread_id: id } }, checkpoint("c1", {}), META, {});
    }
    const json = new TeamRunCheckpointSaver(root);
    await json.put(
      { configurable: { thread_id: "run-orphan-json" } },
      checkpoint("c1", {}),
      META,
      {},
    );

    const removed = await pruneOrphanCheckpoints(store, new Set(["run-kept"]));
    expect(removed.sort()).toEqual(["run-dropped", "run-orphan-json"]);
    expect(store.threadIds()).toEqual(["run-kept"]);
  });

  it("rejects unsafe run ids", async () => {
    await expect(
      saver().put({ configurable: { thread_id: "../escape" } }, checkpoint("c1", {}), META, {}),
    ).rejects.toThrow("Invalid run id");
  });
});
