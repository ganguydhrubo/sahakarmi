import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentMemoryStore } from "./agent-memory-store";

describe("AgentMemoryStore", () => {
  let tempDir: string;
  let store: AgentMemoryStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "sahkarmi-memory-test-"));
    store = new AgentMemoryStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("saves and retrieves memories by category", async () => {
    const mem1 = await store.save({
      category: "decision",
      key: "Tech Stack",
      content: "We use Solid.js and Electron with TypeScript",
      tags: ["stack", "frontend"],
    });

    const mem2 = await store.save({
      category: "preference",
      key: "Language",
      content: "Bengali is preferred for communication",
      tags: ["language", "user"],
    });

    expect(mem1.id).toBeDefined();
    expect(mem2.id).toBeDefined();

    const all = await store.list();
    expect(all).toHaveLength(2);

    const decisions = await store.list("decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].key).toBe("Tech Stack");
  });

  it("searches memories by query across key, content, and tags", async () => {
    await store.save({
      category: "architecture",
      key: "Auth Strategy",
      content: "JWT stored in secure HTTP-only cookies",
      tags: ["security", "auth"],
    });

    const results = await store.search("cookie");
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("Auth Strategy");

    const tagResults = await store.search("security");
    expect(tagResults).toHaveLength(1);

    const emptyResults = await store.search("nonexistent");
    expect(emptyResults).toHaveLength(0);
  });

  it("deletes a memory by id", async () => {
    const mem = await store.save({
      category: "fact",
      key: "API Port",
      content: "Runs on 3000",
      tags: ["api"],
    });

    expect(await store.list()).toHaveLength(1);
    const deleted = await store.delete(mem.id);
    expect(deleted).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });

  it("persists memories across store instances", async () => {
    await store.save({
      category: "preference",
      key: "Theme",
      content: "Dark mode",
      tags: ["ui"],
    });

    const secondStore = new AgentMemoryStore(tempDir);
    const items = await secondStore.list();
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe("Theme");
  });
});
