import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KnowledgeDb } from "./knowledge-db";

let tmp: string;
let db: KnowledgeDb;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sahkarmi-knowledge-db-"));
  db = new KnowledgeDb(join(tmp, "kb.sqlite"));
});

afterEach(async () => {
  db.close();
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function insert(id: string, name: string, kind: "pdf" | "text" = "pdf") {
  return db.insertDocument({
    id,
    path: join(tmp, name),
    name,
    kind,
    size: 10,
    mtimeMs: 1,
    folderId: null,
  });
}

describe("KnowledgeDb", () => {
  it("stores documents, replaces chunks and ranks by BM25 with page citations", () => {
    insert("d1", "GST_Rules.pdf");
    db.replaceChunks(
      "d1",
      "GST_Rules.pdf",
      [
        {
          chunkIndex: 0,
          page: 1,
          slide: null,
          sheet: null,
          heading: "Registration",
          charStart: 0,
          charEnd: 40,
          text: "Registration is mandatory above the turnover threshold of 40 lakh.",
        },
        {
          chunkIndex: 1,
          page: 14,
          slide: null,
          sheet: null,
          heading: "Returns",
          charStart: 0,
          charEnd: 40,
          text: "GSTR-3B is a monthly summary return. Late fees apply after the due date.",
        },
      ],
      { sha256: "abc", size: 10, mtimeMs: 1, pages: 14 },
    );
    expect(db.getDocument("d1")).toMatchObject({ status: "ready", chunkCount: 2, pages: 14 });

    const rows = db.search('"GSTR-3B" OR "monthly"', 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentId: "d1", page: 14, heading: "Returns" });
    expect(rows[0]?.rank).toBeLessThan(0);

    // Replacing chunks drops the old ones from the index.
    db.replaceChunks(
      "d1",
      "GST_Rules.pdf",
      [
        {
          chunkIndex: 0,
          page: 2,
          slide: null,
          sheet: null,
          heading: null,
          charStart: 0,
          charEnd: 5,
          text: "Only this remains.",
        },
      ],
      { sha256: "def", size: 11, mtimeMs: 2, pages: 2 },
    );
    expect(db.search('"GSTR-3B"', 5)).toHaveLength(0);
    expect(db.search('"remains"', 5)).toHaveLength(1);
    expect(db.chunkCount()).toBe(1);
  });

  it("skips disabled documents and deletes chunks with their document", () => {
    insert("a", "a.txt", "text");
    insert("b", "b.txt", "text");
    const chunk = (text: string) => ({
      chunkIndex: 0,
      page: null,
      slide: null,
      sheet: null,
      heading: null,
      charStart: 0,
      charEnd: text.length,
      text,
    });
    db.replaceChunks("a", "a.txt", [chunk("Invoice payment terms are thirty days.")], {
      sha256: "1",
      size: 1,
      mtimeMs: 1,
      pages: null,
    });
    db.replaceChunks("b", "b.txt", [chunk("Payment terms for suppliers are sixty days.")], {
      sha256: "2",
      size: 1,
      mtimeMs: 1,
      pages: null,
    });
    expect(
      db
        .search('"payment"', 5)
        .map((row) => row.documentId)
        .sort(),
    ).toEqual(["a", "b"]);

    db.updateDocument("b", { enabled: false });
    expect(db.search('"payment"', 5).map((row) => row.documentId)).toEqual(["a"]);

    db.deleteDocument("a");
    expect(db.search('"payment"', 5)).toHaveLength(0);
    expect(db.listDocuments().map((document) => document.id)).toEqual(["b"]);
    expect(db.chunkCount()).toBe(1);
  });

  it("finds Hindi and Bengali words and reads a page or a window of chunks", () => {
    insert("h", "niyam.txt", "text");
    const texts = [
      "पंजीकरण अनिवार्य है जब कारोबार सीमा से ऊपर हो।",
      "রিটার্ন প্রতি মাসে জমা দিতে হবে।",
      "Third chunk about penalties.",
      "Fourth chunk about appeals.",
    ];
    db.replaceChunks(
      "h",
      "niyam.txt",
      texts.map((text, index) => ({
        chunkIndex: index,
        page: index < 2 ? 1 : 2,
        slide: null,
        sheet: null,
        heading: null,
        charStart: 0,
        charEnd: text.length,
        text,
      })),
      { sha256: "h", size: 1, mtimeMs: 1, pages: 2 },
    );
    expect(db.search('"पंजीकरण"', 5)[0]?.text).toContain("पंजीकरण");
    expect(db.search('"রিটার্ন"', 5)[0]?.text).toContain("রিটার্ন");
    expect(db.readChunks("h", { page: 2 }).map((chunk) => chunk.chunkIndex)).toEqual([2, 3]);
    expect(
      db.readChunks("h", { fromIndex: 1, toIndex: 2 }).map((chunk) => chunk.chunkIndex),
    ).toEqual([1, 2]);
    expect(db.findDocumentByPath(join(tmp, "niyam.txt"))?.id).toBe("h");
  });

  it("reopens the same file with its data intact", () => {
    insert("p", "p.txt", "text");
    db.close();
    db = new KnowledgeDb(join(tmp, "kb.sqlite"));
    expect(db.getDocument("p")?.name).toBe("p.txt");
  });
});

function chunk(chunkIndex: number, text: string, heading: string | null = null) {
  return {
    chunkIndex,
    page: null,
    slide: null,
    sheet: null,
    heading,
    charStart: 0,
    charEnd: text.length,
    text,
  };
}

describe("KnowledgeDb v2: stemming and vectors", () => {
  it("stems English words so plural and verb forms match", () => {
    insert("d1", "notes.txt", "text");
    db.replaceChunks(
      "d1",
      "notes.txt",
      [chunk(0, "Registrations were running late this quarter.")],
      { sha256: "a", size: 10, mtimeMs: 1, pages: null },
    );
    expect(db.search('"registration"', 5)).toHaveLength(1);
    expect(db.search('"run"', 5)).toHaveLength(1);
    expect(db.search('"quarterly"', 5)).toHaveLength(0);
    expect(db.schemaVersion).toBe(2);
  });

  it("stores int8 vectors per chunk and searches them by cosine over enabled documents", () => {
    insert("d1", "leave.md", "text");
    insert("d2", "prices.csv", "text");
    db.replaceChunks(
      "d1",
      "leave.md",
      [chunk(0, "Every employee gets 24 days of paid leave.", "Leave")],
      {
        sha256: "a",
        size: 10,
        mtimeMs: 1,
        pages: null,
      },
    );
    db.replaceChunks("d2", "prices.csv", [chunk(0, "Darjeeling tea | 250")], {
      sha256: "b",
      size: 10,
      mtimeMs: 1,
      pages: null,
    });
    const pending = db.chunksWithoutVectors("m", 10);
    expect(pending.map((entry) => entry.heading)).toEqual(["Leave", null]);
    const [leave, prices] = pending;
    db.putVectors("m", [
      { seq: leave?.seq ?? -1, scale: 1 / 127, data: new Int8Array([127, 0, 0, 0]) },
      { seq: prices?.seq ?? -1, scale: 1 / 127, data: new Int8Array([0, 127, 0, 0]) },
    ]);
    expect(db.vectorCount("m")).toBe(2);
    expect(db.chunksWithoutVectors("m", 10)).toEqual([]);
    // Another model name sees no vectors of its own.
    expect(db.chunksWithoutVectors("other", 10)).toHaveLength(2);

    const query = new Float32Array([0.9, 0.436, 0, 0]);
    const hits = db.semanticSearch(query, "m", 5, 0.3);
    expect(hits.map((hit) => hit.name)).toEqual(["leave.md", "prices.csv"]);
    expect(hits[0]?.score).toBeCloseTo(0.9, 2);
    expect(hits[0]?.heading).toBe("Leave");
    expect(db.semanticSearch(query, "m", 5, 0.5).map((hit) => hit.name)).toEqual(["leave.md"]);
    // A different dimension cannot be compared.
    expect(db.semanticSearch(new Float32Array([1, 0]), "m", 5, 0)).toEqual([]);

    db.updateDocument("d1", { enabled: false });
    expect(db.semanticSearch(query, "m", 5, 0.3).map((hit) => hit.name)).toEqual(["prices.csv"]);
    db.updateDocument("d1", { enabled: true });

    // Re-indexing a document drops its vectors with its chunks.
    db.replaceChunks(
      "d1",
      "leave.md",
      [chunk(0, "Every employee gets 30 days of paid leave.", "Leave")],
      {
        sha256: "c",
        size: 10,
        mtimeMs: 2,
        pages: null,
      },
    );
    expect(db.vectorCount("m")).toBe(1);
    expect(db.chunksWithoutVectors("m", 10)).toHaveLength(1);
    db.deleteDocument("d2");
    expect(db.vectorCount("m")).toBe(0);
    db.clearVectors();
    expect(db.semanticSearch(query, "m", 5, 0)).toEqual([]);
  });

  it("upgrades a v1 file: the index is rebuilt with stemming and the vectors table appears", () => {
    const path = join(tmp, "old.sqlite");
    const raw = new DatabaseSync(path);
    raw.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta VALUES ('schema', '1');
      CREATE TABLE documents (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, kind TEXT NOT NULL,
        size INTEGER NOT NULL, mtime_ms INTEGER NOT NULL, sha256 TEXT NOT NULL DEFAULT '',
        pages INTEGER, chunk_count INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
        folder_id TEXT, status TEXT NOT NULL DEFAULT 'pending', error TEXT, indexed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE chunks (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL, name TEXT NOT NULL, page INTEGER, slide INTEGER, sheet TEXT,
        heading TEXT, char_start INTEGER NOT NULL, char_end INTEGER NOT NULL, text TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(name, heading, text, content='chunks',
        content_rowid='seq', tokenize='unicode61 remove_diacritics 2');
      CREATE TRIGGER chunks_after_insert AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, name, heading, text)
        VALUES (new.seq, new.name, coalesce(new.heading, ''), new.text);
      END;
      INSERT INTO documents (id, path, name, kind, size, mtime_ms, status, chunk_count, created_at)
        VALUES ('d1', 'C:/x/notes.txt', 'notes.txt', 'text', 10, 1, 'ready', 1, 'now');
      INSERT INTO chunks (document_id, chunk_index, name, char_start, char_end, text)
        VALUES ('d1', 0, 'notes.txt', 0, 20, 'Registrations closed.');
    `);
    // Before the upgrade, the stem does not match.
    expect(
      raw
        .prepare("SELECT count(*) AS n FROM chunks_fts WHERE chunks_fts MATCH ?")
        .get('"registration"'),
    ).toMatchObject({ n: 0 });
    raw.close();

    const upgraded = new KnowledgeDb(path);
    try {
      expect(upgraded.schemaVersion).toBe(2);
      expect(upgraded.search('"registration"', 5).map((row) => row.name)).toEqual(["notes.txt"]);
      expect(upgraded.chunksWithoutVectors("m", 10)).toHaveLength(1);
      expect(upgraded.vectorCount("m")).toBe(0);
    } finally {
      upgraded.close();
    }
  });
});
