import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
