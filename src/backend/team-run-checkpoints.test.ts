// @vitest-environment node

import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnableConfig } from "@langchain/core/runnables";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_CHECKPOINTS_PER_RUN, TeamRunCheckpointSaver } from "./team-run-checkpoints";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-checkpoints-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

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

describe("TeamRunCheckpointSaver", () => {
  it("stores a step and reads it back with its writes in order", async () => {
    const saver = new TeamRunCheckpointSaver(root);
    const config = await saver.put(
      { configurable: { thread_id: "run-1" } },
      checkpoint("c1", { tasks: [{ id: "t1", status: "pending" }] }),
      META,
      {},
    );
    await saver.putWrites(config, [["tasks", { id: "t2" }]], "task-b", "~__pregel_pull, work");
    await saver.putWrites(config, [["tasks", { id: "t1" }]], "task-a", "~__pregel_pull, work");
    const tuple = await saver.getTuple({ configurable: { thread_id: "run-1" } });
    expect(tuple?.checkpoint.id).toBe("c1");
    expect(tuple?.checkpoint.channel_values).toEqual({ tasks: [{ id: "t1", status: "pending" }] });
    expect(tuple?.pendingWrites?.map((write) => write[0])).toEqual(["task-a", "task-b"]);

    const fresh = new TeamRunCheckpointSaver(root);
    const again = await fresh.getTuple({ configurable: { thread_id: "run-1" } });
    expect(again?.checkpoint.id).toBe("c1");
    const listed = [];
    for await (const item of fresh.list({ configurable: { thread_id: "run-1" } }))
      listed.push(item);
    expect(listed).toHaveLength(1);
  });

  it("never writes a secret to disk", async () => {
    const saver = new TeamRunCheckpointSaver(root);
    await saver.put(
      { configurable: { thread_id: "run-2" } },
      checkpoint("c1", { result: "Use api_key=sk-live-1234567890abcdef and password: hunter2" }),
      META,
      {},
    );
    const raw = await readFile(TeamRunCheckpointSaver.pathFor(root, "run-2"), "utf8");
    expect(raw).not.toContain("sk-live-1234567890abcdef");
    expect(raw).not.toContain("hunter2");
    expect(raw).toContain("[hidden]");
  });

  it("keeps only the newest steps of a run", async () => {
    const saver = new TeamRunCheckpointSaver(root);
    let config: RunnableConfig = { configurable: { thread_id: "run-3" } };
    for (let index = 0; index < MAX_CHECKPOINTS_PER_RUN + 5; index += 1) {
      const id = `c${String(index).padStart(3, "0")}`;
      config = await saver.put(config, checkpoint(id, { step: index }), META, {});
      await saver.putWrites(config, [["step", index]], "task", "");
    }
    const ids = [];
    for await (const item of saver.list({ configurable: { thread_id: "run-3" } })) {
      ids.push(item.checkpoint.id);
    }
    expect(ids).toHaveLength(MAX_CHECKPOINTS_PER_RUN);
    expect(ids[0]).toBe("c024");
    const raw = JSON.parse(await readFile(TeamRunCheckpointSaver.pathFor(root, "run-3"), "utf8"));
    expect(Object.keys(raw.writes[""])).toHaveLength(MAX_CHECKPOINTS_PER_RUN);
  });

  it("removes a run's file with the run and rejects unsafe ids", async () => {
    const saver = new TeamRunCheckpointSaver(root);
    await saver.put({ configurable: { thread_id: "run-4" } }, checkpoint("c1", {}), META, {});
    await access(TeamRunCheckpointSaver.pathFor(root, "run-4"));
    await saver.deleteThread("run-4");
    await expect(access(TeamRunCheckpointSaver.pathFor(root, "run-4"))).rejects.toThrow();
    await expect(
      saver.put({ configurable: { thread_id: "../escape" } }, checkpoint("c1", {}), META, {}),
    ).rejects.toThrow("Invalid run id");
  });
});
