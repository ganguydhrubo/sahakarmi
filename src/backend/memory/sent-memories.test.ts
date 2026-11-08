// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AgentMemory } from "../../shared/ipc";
import { memoryContextLines, SentMemories } from "./memory-context";

function memory(key: string, content = "c", updatedAt = "2026-11-08T00:00:00Z"): AgentMemory {
  return { id: key, key, content, category: "fact", tags: [], createdAt: updatedAt, updatedAt };
}

describe("sent memories", () => {
  it("attaches a memory once per chat, again when it changes, after compaction, or later on", () => {
    const sent = new SentMemories(3);
    expect(sent.fresh("t1", [memory("a"), memory("b")]).map((m) => m.key)).toEqual(["a", "b"]);
    expect(sent.fresh("t1", [memory("a"), memory("b")])).toEqual([]);
    // Another chat has not seen them.
    expect(sent.fresh("t2", [memory("a")]).map((m) => m.key)).toEqual(["a"]);
    // Changed content goes again.
    expect(sent.fresh("t1", [memory("a", "new")]).map((m) => m.key)).toEqual(["a"]);
    // Three messages after b was sent, it is sent again (the engine may have trimmed it).
    expect(sent.fresh("t1", [memory("b")]).map((m) => m.key)).toEqual(["b"]);
    sent.forget("t1");
    expect(sent.fresh("t1", [memory("a", "new")]).map((m) => m.key)).toEqual(["a"]);
    expect(memoryContextLines([])).toEqual([]);
  });

  it("keeps a bounded number of chats", () => {
    const sent = new SentMemories(10, 2);
    sent.fresh("t1", [memory("a")]);
    sent.fresh("t2", [memory("a")]);
    sent.fresh("t3", [memory("a")]);
    // t1 was dropped, so its memory counts as new again.
    expect(sent.fresh("t1", [memory("a")])).toHaveLength(1);
  });
});
