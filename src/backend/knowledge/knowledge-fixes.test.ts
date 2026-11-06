import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../../shared/ipc";
import { KnowledgeDb } from "./knowledge-db";
import { contentTerms, passesGroundingFloor } from "./knowledge-search";
import { KnowledgeService } from "./knowledge-service";
import { sqliteCapabilities } from "./sqlite-capabilities";
import { quantize } from "./static-embedder";

let tmp: string;
let service: KnowledgeService;
let events: AgentEvent[];
const bot = { id: "asha", workspaceId: "shop" };

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sahkarmi-knowledge-fixes-"));
  service = new KnowledgeService(join(tmp, "user-data"));
  events = [];
  service.on("event", (event: AgentEvent) => events.push(event));
  await service.initialize();
});

afterEach(async () => {
  service.close();
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function folderWith(files: Record<string, string>): Promise<string> {
  const folder = join(tmp, "docs");
  await mkdir(folder, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(join(folder, name), text);
  return folder;
}

describe("Knowledge search never cites files that are gone", () => {
  it("a deleted file is no longer found or cited after a sync", async () => {
    const [base] = await service.create({ name: "Docs", workspaceId: "shop" });
    const id = base?.id ?? "";
    const docs = await folderWith({
      "rent.md": "# Rent agreement\n\nThe late fee is 500 rupees after the fifth of the month.\n",
      "notes.txt": "Supplier payment terms are thirty days net.\n",
    });
    await service.addFolder(id, docs);
    await service.idle();
    expect((await service.searchForBot(bot, "late fee"))[0]?.citation.fileName).toBe("rent.md");

    await rm(join(docs, "rent.md"));
    await service.sync(id);
    await service.idle();

    expect(service.list()[0]?.sources.find((s) => s.name === "rent.md")?.status).toBe("missing");
    expect(await service.searchForBot(bot, "late fee")).toEqual([]);
    expect(
      await service.groundingFor(bot, "what is the late fee in the rent agreement"),
    ).toBeNull();
    // The other file is still searchable.
    expect((await service.searchForBot(bot, "payment terms"))[0]?.citation.fileName).toBe(
      "notes.txt",
    );
  });

  it("a failed re-index removes the file's stale passages", async () => {
    const [base] = await service.create({ name: "Docs", workspaceId: "shop" });
    const id = base?.id ?? "";
    const docs = await folderWith({ "prices.md": "Darjeeling tea costs 250 rupees.\n" });
    await service.addFolder(id, docs);
    await service.idle();
    expect((await service.searchForBot(bot, "Darjeeling")).length).toBe(1);

    // The file now has no readable text: indexing fails, and the old price is not quoted.
    await writeFile(join(docs, "prices.md"), "   \n");
    await service.sync(id);
    await service.idle();
    const source = service.list()[0]?.sources.find((s) => s.name === "prices.md");
    expect(source?.status).toBe("failed");
    expect(source?.chunkCount).toBe(0);
    expect(await service.searchForBot(bot, "Darjeeling")).toEqual([]);
  });

  it("refuses a file over the size limit before reading it", async () => {
    const [base] = await service.create({ name: "Docs", workspaceId: "shop" });
    const big = join(tmp, "huge.txt");
    const handle = await open(big, "w");
    await handle.truncate(61 * 1024 * 1024);
    await handle.close();
    await service.addFiles(base?.id ?? "", [big]);
    await service.idle();
    const source = service.list()[0]?.sources[0];
    expect(source?.status).toBe("failed");
    expect(source?.error).toMatch(/larger than 60 MB/);
  });
});

describe("KnowledgeDb vector search", () => {
  function seed(db: KnowledgeDb) {
    for (const [id, name, text] of [
      ["d1", "leave.md", "Paid leave is 24 days."],
      ["d2", "notice.md", "Notice period is sixty days."],
    ] as const) {
      db.insertDocument({
        id,
        path: join(tmp, name),
        name,
        kind: "markdown",
        size: 1,
        mtimeMs: 1,
        folderId: null,
      });
      db.replaceChunks(
        id,
        name,
        [
          {
            chunkIndex: 0,
            page: null,
            slide: null,
            sheet: null,
            heading: null,
            charStart: 0,
            charEnd: text.length,
            text,
          },
        ],
        { sha256: id, size: 1, mtimeMs: 1, pages: null },
      );
    }
    const rows = db.chunksWithoutVectors("m", 10);
    const axis = (seq: number) => {
      const v = new Float32Array(4);
      v[seq % 2] = 1;
      v[2] = 0.1;
      return v;
    };
    db.putVectors(
      "m",
      rows.map((row) => {
        const q = quantize(axis(row.seq));
        return { seq: row.seq, scale: q.scale, data: q.data };
      }),
    );
    return rows.map((row) => ({ seq: row.seq, vector: axis(row.seq) }));
  }

  for (const vector of [true, false]) {
    it(`ranks by cosine and skips missing, failed and disabled files (${vector ? "sqlite-vec" : "scan"})`, () => {
      const db = new KnowledgeDb(join(tmp, `kb-${vector}.sqlite`), { vector });
      try {
        expect(db.vectorExtension).toBe(vector);
        const seeded = seed(db);
        const first = seeded[0];
        if (!first) throw new Error("no chunks");
        const hits = db.semanticSearch(first.vector, "m", 5, 0.3);
        expect(hits[0]?.seq).toBe(first.seq);
        expect(hits[0]?.score).toBeGreaterThan(0.95);
        const owner = hits[0]?.documentId ?? "";

        db.updateDocument(owner, { status: "missing" });
        expect(db.semanticSearch(first.vector, "m", 5, 0.3).map((h) => h.documentId)).not.toContain(
          owner,
        );
        db.updateDocument(owner, { status: "ready", enabled: false });
        expect(db.semanticSearch(first.vector, "m", 5, 0.3).map((h) => h.documentId)).not.toContain(
          owner,
        );
        db.updateDocument(owner, { enabled: true });
        db.failDocument(owner, "broken");
        expect(db.semanticSearch(first.vector, "m", 5, 0.3).map((h) => h.documentId)).not.toContain(
          owner,
        );
        expect(db.getDocument(owner)?.chunkCount).toBe(0);
        expect(db.documentCounts()).toEqual({ total: 2, ready: 1, chunks: 1 });
      } finally {
        db.close();
      }
    });
  }

  it("keeps the in-memory vector copy while indexing adds vectors", () => {
    const db = new KnowledgeDb(join(tmp, "kb-cache.sqlite"), { vector: false });
    try {
      const seeded = seed(db);
      const first = seeded[0];
      if (!first) throw new Error("no chunks");
      db.semanticSearch(first.vector, "m", 5, 0.3);
      expect(db.vectorCacheLoaded).toBe(true);
      db.insertDocument({
        id: "d3",
        path: join(tmp, "third.md"),
        name: "third.md",
        kind: "markdown",
        size: 1,
        mtimeMs: 1,
        folderId: null,
      });
      db.replaceChunks(
        "d3",
        "third.md",
        [
          {
            chunkIndex: 0,
            page: null,
            slide: null,
            sheet: null,
            heading: null,
            charStart: 0,
            charEnd: 5,
            text: "third",
          },
        ],
        { sha256: "d3", size: 1, mtimeMs: 1, pages: null },
      );
      const [row] = db.chunksWithoutVectors("m", 10);
      const v = new Float32Array([0, 0, 0, 1]);
      const q = quantize(v);
      db.putVectors("m", [{ seq: row?.seq ?? -1, scale: q.scale, data: q.data }]);
      expect(db.vectorCacheLoaded).toBe(true);
      expect(db.semanticSearch(v, "m", 1, 0.5)[0]?.documentId).toBe("d3");
    } finally {
      db.close();
    }
  });
});

describe("Grounding floor (owner messages nobody asked to search with)", () => {
  const corpus = {
    "rent.md":
      "# Rent agreement\n\nThe monthly rent is 25,000 rupees. The late fee is 500 rupees after the fifth of the month. The security deposit is two months of rent.\n",
    "leave.md":
      "# Leave policy\n\nEvery employee gets 24 days of paid leave a year. Can be carried over for one year. Help desk: hr@example.com.\n",
    "meeting.md":
      "# Weekly meeting\n\nThe team meets every Monday to plan the week. Today we discussed the new shop opening and what we need to get done.\n",
    "gst.md":
      "# GST registration\n\nRegistration is mandatory above the turnover threshold of 40 lakh. GSTR-3B is filed monthly.\n",
  };

  it("chatty messages add no excerpts; real questions keep their page", async () => {
    const [base] = await service.create({ name: "Docs", workspaceId: "shop" });
    await service.addFolder(base?.id ?? "", await folderWith(corpus));
    await service.idle();

    for (const chat of [
      "hi",
      "hello, how are you doing today?",
      "ok thanks, can you help me with something?",
      "haan bhai theek hai, karo",
      "great, go ahead and continue",
      "can you do it now please",
    ]) {
      expect(await service.groundingFor(bot, chat), chat).toBeNull();
    }

    const real: Array<[string, string]> = [
      ["What is the late fee in the rent agreement?", "rent.md"],
      ["how many days of paid leave do we get", "leave.md"],
      ["GST registration threshold", "gst.md"],
      ["security deposit", "rent.md"],
      ["registrations", "gst.md"],
      ["When does the team meeting happen?", "meeting.md"],
    ];
    for (const [question, file] of real) {
      const grounding = await service.groundingFor(bot, question);
      expect(grounding?.citations[0]?.fileName, question).toBe(file);
    }
    // A real question adds only its own file, not every file sharing one common word.
    const rent = await service.groundingFor(bot, "What is the late fee in the rent agreement?");
    expect(new Set(rent?.citations.map((c) => c.fileName))).toEqual(new Set(["rent.md"]));

    // An explicit search still finds a single common word.
    expect((await service.searchForBot(bot, "today")).length).toBeGreaterThan(0);
  });

  it("the floor needs enough of the message's real words", () => {
    const terms = contentTerms("What is the late fee in the rent agreement?");
    expect(terms).toEqual(["late", "fee", "rent", "agreement"]);
    expect(passesGroundingFloor(terms, "The late fee is 500.", 5, 5)).toBe(true);
    expect(passesGroundingFloor(terms, "Rent is due monthly.", 5, 5)).toBe(false);
    expect(passesGroundingFloor(terms, "late fee rent", 1, 5)).toBe(false);
    expect(contentTerms("ok thanks, can you help?")).toEqual([]);
  });
});

describe("Knowledge change events", () => {
  it("are throttled to about one a second while a folder is indexed", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) files[`note-${i}.txt`] = `Note number ${i} about topic ${i}.\n`;
    const [base] = await service.create({ name: "Many", workspaceId: "shop" });
    const before = events.filter((e) => e.type === "knowledge-changed").length;
    const started = Date.now();
    await service.addFolder(base?.id ?? "", await folderWith(files));
    await service.idle();
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const changes = events.filter((e) => e.type === "knowledge-changed").length - before;
    const seconds = (Date.now() - started) / 1_000;
    expect(changes).toBeLessThanOrEqual(Math.ceil(seconds) + 2);
    const last = [...events].reverse().find((e) => e.type === "knowledge-changed");
    // The last event has the final state of every file.
    expect(
      last?.type === "knowledge-changed" &&
        last.bases[0]?.sources.every((source) => source.status === "ready"),
    ).toBe(true);
    expect(last?.type === "knowledge-changed" && last.bases[0]?.sources.length).toBe(40);
  });
});

describe("SQLite capabilities", () => {
  it("has FTS5 with porter stemming and loads sqlite-vec", () => {
    const capabilities = sqliteCapabilities();
    expect(capabilities.fts5).toBe(true);
    expect(capabilities.vecVersion).toMatch(/^v0\.1\./);
  });
});
