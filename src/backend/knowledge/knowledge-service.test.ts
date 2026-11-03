import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../../shared/ipc";
import { KnowledgeDb } from "./knowledge-db";
import { INDEXER_VERSION, KnowledgeService } from "./knowledge-service";
import type { Embedder } from "./static-embedder";

let tmp: string;
let service: KnowledgeService;
let events: AgentEvent[];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sahkarmi-knowledge-"));
  service = new KnowledgeService(join(tmp, "user-data"));
  events = [];
  service.on("event", (event: AgentEvent) => events.push(event));
  await service.initialize();
});

afterEach(async () => {
  service.close();
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const bot = { id: "asha-accounts", workspaceId: "my-business" };

async function docsFolder(): Promise<string> {
  const docs = join(tmp, "docs");
  await mkdir(join(docs, "node_modules"), { recursive: true });
  await writeFile(
    join(docs, "leave-policy.md"),
    "# Leave policy\n\nEvery employee gets 24 days of paid leave a year.\n\n# Notice period\n\nThe notice period is sixty days for managers.\n",
  );
  await writeFile(join(docs, "prices.csv"), "item,price\nDarjeeling tea,250\nAssam tea,180\n");
  await writeFile(join(docs, "notes.txt"), "Supplier payment terms are thirty days net.\n");
  await writeFile(join(docs, "node_modules", "skip.md"), "never indexed");
  await writeFile(join(docs, "photo.png"), Buffer.from([1, 2, 3]));
  return docs;
}

describe("KnowledgeService", () => {
  it("indexes a folder in the background and answers searches with citations", async () => {
    const [base] = await service.create({ name: "Company docs", workspaceId: "my-business" });
    expect(base).toMatchObject({ name: "Company docs", privacy: "coworkers", botIds: [] });
    await service.addFolder(base?.id ?? "", await docsFolder());
    await service.idle();

    const [after] = service.list();
    expect(after?.sources.map((source) => source.name).sort()).toEqual([
      "leave-policy.md",
      "notes.txt",
      "prices.csv",
    ]);
    expect(after?.sources.every((source) => source.status === "ready")).toBe(true);
    expect(after?.folders[0]?.fileCount).toBe(3);
    expect(events.some((event) => event.type === "knowledge-progress")).toBe(true);

    const hits = await service.searchForBot(bot, "What is the notice period for managers?");
    expect(hits[0]?.citation).toMatchObject({
      id: "S1",
      fileName: "leave-policy.md",
      heading: "Notice period",
      kbName: "Company docs",
    });
    expect(hits[0]?.citation.excerpt).toContain("sixty days");

    const grounding = await service.groundingFor(bot, "Darjeeling tea price");
    expect(grounding?.citations[0]?.fileName).toBe("prices.csv");
    expect(grounding?.lines.join("\n")).toContain("Darjeeling tea | 250");

    const section = service.readSection(base?.id ?? "", hits[0]?.citation.documentId ?? "", {
      chunkIndex: hits[0]?.citation.chunkIndex ?? 0,
    });
    expect(section.fileName).toBe("leave-policy.md");
    expect(section.chunks.length).toBeGreaterThan(0);
  });

  it("respects who may read a base and keeps owner-only bases out of grounding", async () => {
    const [base] = await service.create({ name: "HR", workspaceId: "my-business" });
    const id = base?.id ?? "";
    await service.addFolder(id, await docsFolder());
    await service.idle();
    expect(service.basesForBot(bot)).toHaveLength(1);
    expect(service.basesForBot({ id: "x", workspaceId: "other" })).toHaveLength(0);

    await service.update({ id, botIds: ["mitra-lead"] });
    expect(service.basesForBot(bot)).toHaveLength(0);
    expect(service.basesForBot({ id: "mitra-lead", workspaceId: "my-business" })).toHaveLength(1);
    expect(await service.groundingFor(bot, "notice period")).toBeNull();

    await service.update({ id, botIds: [], privacy: "owner" });
    expect(service.basesForBot(bot)).toHaveLength(0);
    // The owner can still search it from the Knowledge screen.
    const owner = await service.search({ query: "notice period", kbIds: [id] });
    expect(owner.hits.length).toBeGreaterThan(0);
  });

  it("re-indexes changed files, marks missing ones, and drops disabled or removed sources", async () => {
    const [base] = await service.create({ name: "Docs", workspaceId: "my-business" });
    const id = base?.id ?? "";
    const docs = await docsFolder();
    await service.addFolder(id, docs);
    await service.idle();

    expect((await service.searchForBot(bot, "paid leave"))[0]?.citation.excerpt).toContain(
      "24 days",
    );
    const notes = join(docs, "notes.txt");
    await writeFile(notes, "Supplier payment terms are now ninety days net.\n");
    await utimes(notes, new Date(), new Date(Date.now() + 5_000));
    await rm(join(docs, "prices.csv"));
    await service.sync(id);
    await service.idle();
    const sources = service.list()[0]?.sources ?? [];
    expect(sources.find((source) => source.name === "prices.csv")?.status).toBe("missing");
    const changed = await service.searchForBot(bot, "ninety days");
    expect(changed[0]?.citation.excerpt).toContain("ninety days");
    expect(changed.some((hit) => hit.citation.excerpt.includes("thirty days"))).toBe(false);

    const leave = sources.find((source) => source.name === "leave-policy.md");
    await service.setSourceEnabled(id, leave?.id ?? "", false);
    expect((await service.searchForBot(bot, "paid leave")).length).toBe(0);
    await service.setSourceEnabled(id, leave?.id ?? "", true);
    expect((await service.searchForBot(bot, "paid leave")).length).toBeGreaterThan(0);

    await service.removeSource(id, leave?.id ?? "");
    expect((await service.searchForBot(bot, "paid leave")).length).toBe(0);

    await service.delete(id);
    expect(service.list()).toHaveLength(0);
    expect(events.filter((event) => event.type === "knowledge-changed").length).toBeGreaterThan(3);
  });

  it("adds single files, refuses its own data folder, and reports unreadable files", async () => {
    const [base] = await service.create({ name: "Files", workspaceId: "my-business" });
    const id = base?.id ?? "";
    const good = join(tmp, "good.txt");
    const empty = join(tmp, "empty.txt");
    await writeFile(good, "GST registration is mandatory above forty lakh turnover.");
    await writeFile(empty, "");
    await service.addFiles(id, [good, empty, join(tmp, "image.jpg")]);
    await expect(service.addFiles(id, [join(tmp, "gone.txt")])).rejects.toThrow(/Not found/);
    await service.idle();
    const sources = service.list()[0]?.sources ?? [];
    expect(sources.map((source) => [source.name, source.status])).toEqual([
      ["empty.txt", "failed"],
      ["good.txt", "ready"],
    ]);
    expect(sources[0]?.error).toContain("No readable text");
    await expect(
      service.addFiles(id, [join(tmp, "user-data", "knowledge", "x.txt")]),
    ).rejects.toThrow(/own files/);
    await expect(service.addFiles(id, ["relative.txt"])).rejects.toThrow(/on this computer/);

    // Data survives a restart of the service.
    service.close();
    service = new KnowledgeService(join(tmp, "user-data"));
    await service.initialize();
    expect(service.list()[0]?.sources.find((s) => s.name === "good.txt")?.status).toBe("ready");
    expect((await service.searchForBot(bot, "forty lakh")).length).toBe(1);
  });
});

/** A four-axis "meaning" embedder: leave / notice / prices / nothing. */
const CONCEPTS: Array<[RegExp, number]> = [
  [/leave|holiday|vacation|time off/i, 0],
  [/notice|quit|resign/i, 1],
  [/price|cost|tea|rate/i, 2],
];
const fakeEmbedder: Embedder = {
  dim: 4,
  embed(text: string): Float32Array {
    const out = new Float32Array(4);
    for (const [pattern, axis] of CONCEPTS) if (pattern.test(text)) out[axis] = 1;
    const norm = Math.hypot(...out);
    return norm > 0 ? out.map((v) => v / norm) : out;
  },
};

describe("KnowledgeService with the embedding model", () => {
  it("finds passages by meaning, fuses them with word matches and reports its state", async () => {
    service.close();
    service = new KnowledgeService(join(tmp, "user-data-semantic"), { embedder: fakeEmbedder });
    service.on("event", (event: AgentEvent) => events.push(event));
    await service.initialize();
    const [base] = await service.create({ name: "Company docs", workspaceId: "my-business" });
    await service.addFolder(base?.id ?? "", await docsFolder());
    await service.idle();

    const status = await service.semanticStatus();
    expect(status.state).toBe("ready");
    expect(status.chunks).toBeGreaterThan(0);
    expect(status.vectors).toBe(status.chunks);
    expect(events.some((event) => event.type === "knowledge-semantic")).toBe(true);

    // No document contains "holiday" or "entitlement": only meaning finds the leave policy.
    const byMeaning = await service.searchForBot(bot, "holiday entitlement");
    expect(byMeaning[0]?.citation.fileName).toBe("leave-policy.md");
    expect(byMeaning[0]?.citation.excerpt).toContain("paid leave");

    // Words and meaning agree: the notice-period passage is first, with its citation intact.
    const both = await service.groundingFor(bot, "how much notice must a manager give");
    expect(both?.citations[0]).toMatchObject({
      id: "S1",
      fileName: "leave-policy.md",
      heading: "Notice period",
    });

    // Unrelated text matches nothing by meaning either, so no grounding is forced on the turn.
    expect(await service.groundingFor(bot, "zebra quantum banana")).toBeNull();

    // A Hindi query skips the English model and still searches by words.
    expect(await service.searchForBot(bot, "छुट्टी")).toEqual([]);

    // A re-indexed file gets its vectors again.
    await service.sync(base?.id ?? "");
    await service.idle();
    const after = await service.semanticStatus();
    expect(after.vectors).toBe(after.chunks);
  });

  it("reports a failed model download without keeping anything", async () => {
    service.close();
    const calls: string[] = [];
    service = new KnowledgeService(join(tmp, "user-data-dl"), {
      fetch: async (url) => {
        calls.push(url);
        return new Response("gone", { status: 404 });
      },
    });
    service.on("event", (event: AgentEvent) => events.push(event));
    await service.initialize();
    expect((await service.semanticStatus()).state).toBe("absent");
    await expect(service.installSemantic()).rejects.toThrow(/404/);
    expect(calls[0]).toMatch(/^https:\/\/huggingface\.co\/minishlab\/potion-base-8M\//);
    const status = await service.semanticStatus();
    expect(status.state).toBe("error");
    expect(status.error).toMatch(/404/);
    expect(status.loaded).toBe(false);
    expect(events.filter((event) => event.type === "knowledge-semantic").length).toBeGreaterThan(0);
    // Without the model, searching is lexical and still works.
    const [base] = await service.create({ name: "Docs", workspaceId: "my-business" });
    await service.addFolder(base?.id ?? "", await docsFolder());
    await service.idle();
    expect((await service.searchForBot(bot, "notice period"))[0]?.citation.heading).toBe(
      "Notice period",
    );
    expect(await service.searchForBot(bot, "holiday entitlement")).toEqual([]);
    expect((await service.removeSemantic()).state).toBe("absent");
  });
});

describe("KnowledgeService index upgrades", () => {
  it("re-reads every file of a base the first time a newer indexer opens it", async () => {
    const [base] = await service.create({ name: "Docs", workspaceId: "my-business" });
    const id = base?.id ?? "";
    await service.addFolder(id, await docsFolder());
    await service.idle();
    expect(service.list()[0]?.sources.every((source) => source.status === "ready")).toBe(true);
    service.close();

    // An older app wrote this base: mark it so, and leave a vector of a model that is gone.
    const db = new KnowledgeDb(join(tmp, "user-data", "knowledge", `${id}.sqlite`));
    expect(db.getMeta("indexer")).toBe(INDEXER_VERSION);
    db.setMeta("indexer", "1");
    const [chunk] = db.chunksWithoutVectors("old-model", 1);
    db.putVectors("old-model", [
      { seq: chunk?.seq ?? -1, scale: 1, data: new Int8Array([1, 2, 3, 4]) },
    ]);
    db.close();

    service = new KnowledgeService(join(tmp, "user-data"));
    events = [];
    service.on("event", (event: AgentEvent) => events.push(event));
    await service.initialize();
    const reopened = service.list()[0];
    expect(reopened?.indexing).toBe(true);
    await service.idle();
    const after = service.list()[0];
    expect(after?.sources.every((source) => source.status === "ready")).toBe(true);
    expect(after?.sources.length).toBe(3);
    const check = new KnowledgeDb(join(tmp, "user-data", "knowledge", `${id}.sqlite`));
    expect(check.getMeta("indexer")).toBe(INDEXER_VERSION);
    expect(check.vectorCount("old-model")).toBe(0);
    check.close();
    expect((await service.searchForBot(bot, "notice period"))[0]?.citation.heading).toBe(
      "Notice period",
    );
  });
});
