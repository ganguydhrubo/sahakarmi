import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { KnowledgeSourceKind, KnowledgeSourceStatus } from "../../shared/ipc";

/**
 * One SQLite file per Knowledge Base, through Node's built-in `node:sqlite` (no native addon).
 * Documents and their chunks live here; an FTS5 table over the chunks gives BM25-ranked search
 * that understands English, Hindi and Bengali words (unicode61 tokenizer, diacritics folded,
 * English words stemmed so "registrations" finds "registration"). When the optional embedding
 * model is installed, each chunk also gets a small int8 vector for meaning-based search.
 */

/** v2: porter stemming on the FTS index and the `vectors` table. */
const SCHEMA_VERSION = 2;

export interface DocumentRow {
  id: string;
  path: string;
  name: string;
  kind: KnowledgeSourceKind;
  size: number;
  mtimeMs: number;
  sha256: string;
  pages: number | null;
  chunkCount: number;
  enabled: boolean;
  folderId: string | null;
  status: KnowledgeSourceStatus;
  error: string | null;
  indexedAt: string | null;
  createdAt: string;
}

export interface ChunkInput {
  chunkIndex: number;
  page: number | null;
  slide: number | null;
  sheet: string | null;
  heading: string | null;
  charStart: number;
  charEnd: number;
  text: string;
}

export interface ChunkRow extends ChunkInput {
  seq: number;
  documentId: string;
  name: string;
  path: string;
}

export interface SearchRow extends ChunkRow {
  /** bm25 rank: lower is better (SQLite returns negatives). */
  rank: number;
  snippet: string;
}

/** A chunk's text as the embedder sees it. */
export interface ChunkText {
  seq: number;
  heading: string | null;
  text: string;
}

export interface VectorInput {
  seq: number;
  scale: number;
  data: Int8Array;
}

export interface VectorHit extends ChunkRow {
  /** Cosine similarity, 0..1 for related text. */
  score: number;
}

interface VectorCache {
  model: string;
  dim: number;
  seqs: number[];
  scales: Float32Array;
  data: Int8Array;
}

export class KnowledgeDb {
  readonly #db: DatabaseSync;
  readonly path: string;
  #vectorCache: VectorCache | null = null;

  constructor(path: string) {
    this.path = path;
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = NORMAL");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#migrate();
  }

  #migrate(): void {
    this.#db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as
      | { value: string }
      | undefined;
    const version = row ? Number(row.value) : 0;
    const rebuildIndex = version > 0 && version < 2;
    if (rebuildIndex) {
      // v1 indexed without stemming: the search index is built again below with porter.
      this.#db.exec(`
        DROP TRIGGER IF EXISTS chunks_after_insert;
        DROP TRIGGER IF EXISTS chunks_after_delete;
        DROP TABLE IF EXISTS chunks_fts;
      `);
    }
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        sha256 TEXT NOT NULL DEFAULT '',
        pages INTEGER,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        folder_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        indexed_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        name TEXT NOT NULL,
        page INTEGER,
        slide INTEGER,
        sheet TEXT,
        heading TEXT,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS chunks_by_document ON chunks(document_id, chunk_index);
      CREATE TABLE IF NOT EXISTS vectors (
        seq INTEGER PRIMARY KEY REFERENCES chunks(seq) ON DELETE CASCADE,
        model TEXT NOT NULL,
        scale REAL NOT NULL,
        data BLOB NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        name, heading, text,
        content='chunks', content_rowid='seq',
        tokenize='porter unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS chunks_after_insert AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, name, heading, text)
        VALUES (new.seq, new.name, coalesce(new.heading, ''), new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS chunks_after_delete AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, name, heading, text)
        VALUES ('delete', old.seq, old.name, coalesce(old.heading, ''), old.text);
      END;
    `);
    if (rebuildIndex) this.#db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')");
    if (version !== SCHEMA_VERSION) {
      this.#db
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)")
        .run(String(SCHEMA_VERSION));
    }
  }

  /** For tests and diagnostics. */
  get schemaVersion(): number {
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as
      | { value: string }
      | undefined;
    return row ? Number(row.value) : 0;
  }

  close(): void {
    this.#db.close();
  }

  // ---- documents ----

  listDocuments(): DocumentRow[] {
    const rows = this.#db
      .prepare("SELECT * FROM documents ORDER BY name COLLATE NOCASE")
      .all() as unknown as RawDocument[];
    return rows.map(documentFromRaw);
  }

  getDocument(id: string): DocumentRow | null {
    const row = this.#db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as
      | RawDocument
      | undefined;
    return row ? documentFromRaw(row) : null;
  }

  findDocumentByPath(path: string): DocumentRow | null {
    const row = this.#db.prepare("SELECT * FROM documents WHERE path = ?").get(path) as
      | RawDocument
      | undefined;
    return row ? documentFromRaw(row) : null;
  }

  insertDocument(
    document: Pick<DocumentRow, "id" | "path" | "name" | "kind" | "size" | "mtimeMs" | "folderId">,
  ): DocumentRow {
    this.#db
      .prepare(
        `INSERT INTO documents (id, path, name, kind, size, mtime_ms, folder_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        document.id,
        document.path,
        document.name,
        document.kind,
        document.size,
        Math.round(document.mtimeMs),
        document.folderId,
        new Date().toISOString(),
      );
    const stored = this.getDocument(document.id);
    if (!stored) throw new Error("The document was not stored.");
    return stored;
  }

  updateDocument(
    id: string,
    patch: Partial<
      Pick<
        DocumentRow,
        | "size"
        | "mtimeMs"
        | "sha256"
        | "pages"
        | "chunkCount"
        | "enabled"
        | "status"
        | "error"
        | "indexedAt"
        | "path"
        | "name"
        | "folderId"
      >
    >,
  ): void {
    const assignments: string[] = [];
    const values: SQLInputValue[] = [];
    const columns: Record<string, string> = {
      size: "size",
      mtimeMs: "mtime_ms",
      sha256: "sha256",
      pages: "pages",
      chunkCount: "chunk_count",
      enabled: "enabled",
      status: "status",
      error: "error",
      indexedAt: "indexed_at",
      path: "path",
      name: "name",
      folderId: "folder_id",
    };
    for (const [key, column] of Object.entries(columns)) {
      if (!(key in patch)) continue;
      const value = (patch as Record<string, unknown>)[key];
      assignments.push(`${column} = ?`);
      values.push(
        typeof value === "boolean"
          ? value
            ? 1
            : 0
          : typeof value === "number"
            ? Math.round(value)
            : ((value as string | null) ?? null),
      );
    }
    if (assignments.length === 0) return;
    values.push(id);
    this.#db.prepare(`UPDATE documents SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
    if ("enabled" in patch) this.#vectorCache = null;
  }

  deleteDocument(id: string): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM chunks WHERE document_id = ?").run(id);
      this.#db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    this.#vectorCache = null;
  }

  deleteDocumentsInFolder(folderId: string): number {
    const ids = (
      this.#db.prepare("SELECT id FROM documents WHERE folder_id = ?").all(folderId) as Array<{
        id: string;
      }>
    ).map((row) => row.id);
    for (const id of ids) this.deleteDocument(id);
    return ids.length;
  }

  /** Replaces a document's chunks and marks it ready, in one transaction. */
  replaceChunks(
    documentId: string,
    name: string,
    chunks: ChunkInput[],
    meta: { sha256: string; size: number; mtimeMs: number; pages: number | null },
  ): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
      const insert = this.#db.prepare(
        `INSERT INTO chunks (document_id, chunk_index, name, page, slide, sheet, heading, char_start, char_end, text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const chunk of chunks) {
        insert.run(
          documentId,
          chunk.chunkIndex,
          name,
          chunk.page,
          chunk.slide,
          chunk.sheet,
          chunk.heading,
          chunk.charStart,
          chunk.charEnd,
          chunk.text,
        );
      }
      this.#db
        .prepare(
          `UPDATE documents SET sha256 = ?, size = ?, mtime_ms = ?, pages = ?, chunk_count = ?,
             status = 'ready', error = NULL, indexed_at = ? WHERE id = ?`,
        )
        .run(
          meta.sha256,
          meta.size,
          Math.round(meta.mtimeMs),
          meta.pages,
          chunks.length,
          new Date().toISOString(),
          documentId,
        );
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    this.#vectorCache = null;
  }

  chunkCount(): number {
    const row = this.#db.prepare("SELECT count(*) AS n FROM chunks").get() as { n: number };
    return Number(row.n);
  }

  // ---- reading ----

  /** Chunks of one document in order, optionally only one page or a window around a chunk. */
  readChunks(
    documentId: string,
    options: { page?: number | null; fromIndex?: number; toIndex?: number; limit?: number } = {},
  ): ChunkRow[] {
    const conditions = ["c.document_id = ?"];
    const values: SQLInputValue[] = [documentId];
    if (typeof options.page === "number") {
      conditions.push("c.page = ?");
      values.push(options.page);
    }
    if (typeof options.fromIndex === "number") {
      conditions.push("c.chunk_index >= ?");
      values.push(options.fromIndex);
    }
    if (typeof options.toIndex === "number") {
      conditions.push("c.chunk_index <= ?");
      values.push(options.toIndex);
    }
    values.push(Math.max(1, Math.min(options.limit ?? 40, 200)));
    const rows = this.#db
      .prepare(
        `SELECT c.*, d.path AS path FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE ${conditions.join(" AND ")} ORDER BY c.chunk_index LIMIT ?`,
      )
      .all(...values) as unknown as RawChunk[];
    return rows.map(chunkFromRaw);
  }

  // ---- search ----

  /**
   * BM25 over the chunks of enabled documents. `match` is an FTS5 expression built by
   * knowledge-search.ts (never raw owner text). File name counts four times a body word and a
   * heading twice, so a query naming the file or its section floats that file up.
   */
  search(match: string, limit: number): SearchRow[] {
    const rows = this.#db
      .prepare(
        `SELECT c.*, d.path AS path, bm25(chunks_fts, 4.0, 2.0, 1.0) AS rank,
                snippet(chunks_fts, 2, '', '', '…', 28) AS snippet
         FROM chunks_fts JOIN chunks c ON c.seq = chunks_fts.rowid
         JOIN documents d ON d.id = c.document_id
         WHERE chunks_fts MATCH ? AND d.enabled = 1
         ORDER BY rank LIMIT ?`,
      )
      .all(match, Math.max(1, Math.min(limit, 200))) as unknown as Array<
      RawChunk & { rank: number; snippet: string }
    >;
    return rows.map((row) => ({
      ...chunkFromRaw(row),
      rank: Number(row.rank),
      snippet: String(row.snippet ?? ""),
    }));
  }

  // ---- vectors (optional, when the embedding model is installed) ----

  /** Chunks of ready documents that have no vector from this model yet. */
  chunksWithoutVectors(model: string, limit: number): ChunkText[] {
    const rows = this.#db
      .prepare(
        `SELECT c.seq, c.heading, c.text FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE d.status = 'ready'
           AND NOT EXISTS (SELECT 1 FROM vectors v WHERE v.seq = c.seq AND v.model = ?)
         ORDER BY c.seq LIMIT ?`,
      )
      .all(model, Math.max(1, Math.min(limit, 5_000))) as unknown as Array<{
      seq: number;
      heading: string | null;
      text: string;
    }>;
    return rows.map((row) => ({ seq: Number(row.seq), heading: row.heading, text: row.text }));
  }

  putVectors(model: string, vectors: VectorInput[]): void {
    if (vectors.length === 0) return;
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const insert = this.#db.prepare(
        "INSERT OR REPLACE INTO vectors (seq, model, scale, data) VALUES (?, ?, ?, ?)",
      );
      for (const vector of vectors) {
        insert.run(
          vector.seq,
          model,
          vector.scale,
          new Uint8Array(vector.data.buffer, vector.data.byteOffset, vector.data.byteLength),
        );
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    this.#vectorCache = null;
  }

  vectorCount(model: string): number {
    const row = this.#db
      .prepare("SELECT count(*) AS n FROM vectors WHERE model = ?")
      .get(model) as { n: number };
    return Number(row.n);
  }

  clearVectors(): void {
    this.#db.exec("DELETE FROM vectors");
    this.#vectorCache = null;
  }

  /**
   * Brute-force cosine search over the vectors of enabled documents. The vectors stay cached in
   * memory as int8 (256 bytes a chunk) until the base changes, so a search over tens of
   * thousands of chunks is a few milliseconds.
   */
  semanticSearch(query: Float32Array, model: string, limit: number, minScore: number): VectorHit[] {
    const cache = this.#vectors(model);
    if (!cache || cache.seqs.length === 0 || cache.dim !== query.length) return [];
    const scored: Array<{ index: number; score: number }> = [];
    for (let row = 0; row < cache.seqs.length; row += 1) {
      const offset = row * cache.dim;
      let sum = 0;
      for (let i = 0; i < cache.dim; i += 1) {
        sum += (query[i] ?? 0) * (cache.data[offset + i] ?? 0);
      }
      const score = sum * (cache.scales[row] ?? 0);
      if (score >= minScore) scored.push({ index: row, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, Math.max(1, Math.min(limit, 200)));
    if (top.length === 0) return [];
    const seqs = top.map((entry) => cache.seqs[entry.index] ?? -1);
    const rows = this.#db
      .prepare(
        `SELECT c.*, d.path AS path FROM chunks c JOIN documents d ON d.id = c.document_id
         WHERE c.seq IN (${seqs.map(() => "?").join(", ")})`,
      )
      .all(...seqs) as unknown as RawChunk[];
    const bySeq = new Map(rows.map((row) => [Number(row.seq), chunkFromRaw(row)]));
    const hits: VectorHit[] = [];
    for (const [position, entry] of top.entries()) {
      const chunk = bySeq.get(seqs[position] ?? -1);
      if (chunk) hits.push({ ...chunk, score: entry.score });
    }
    return hits;
  }

  #vectors(model: string): VectorCache | null {
    if (this.#vectorCache && this.#vectorCache.model === model) return this.#vectorCache;
    const rows = this.#db
      .prepare(
        `SELECT v.seq, v.scale, v.data FROM vectors v
         JOIN chunks c ON c.seq = v.seq JOIN documents d ON d.id = c.document_id
         WHERE d.enabled = 1 AND v.model = ? ORDER BY v.seq`,
      )
      .all(model) as unknown as Array<{ seq: number; scale: number; data: Uint8Array }>;
    const dim = rows[0]?.data.byteLength ?? 0;
    const seqs: number[] = [];
    const scales = new Float32Array(rows.length);
    const data = new Int8Array(rows.length * dim);
    let kept = 0;
    for (const row of rows) {
      if (row.data.byteLength !== dim) continue;
      seqs.push(Number(row.seq));
      scales[kept] = Number(row.scale);
      data.set(new Int8Array(row.data.buffer, row.data.byteOffset, dim), kept * dim);
      kept += 1;
    }
    this.#vectorCache = {
      model,
      dim,
      seqs,
      scales: scales.subarray(0, kept),
      data: data.subarray(0, kept * dim),
    };
    return this.#vectorCache;
  }
}

interface RawDocument {
  id: string;
  path: string;
  name: string;
  kind: string;
  size: number;
  mtime_ms: number;
  sha256: string;
  pages: number | null;
  chunk_count: number;
  enabled: number;
  folder_id: string | null;
  status: string;
  error: string | null;
  indexed_at: string | null;
  created_at: string;
}

interface RawChunk {
  seq: number;
  document_id: string;
  chunk_index: number;
  name: string;
  page: number | null;
  slide: number | null;
  sheet: string | null;
  heading: string | null;
  char_start: number;
  char_end: number;
  text: string;
  path: string;
}

function documentFromRaw(row: RawDocument): DocumentRow {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    kind: row.kind as KnowledgeSourceKind,
    size: Number(row.size),
    mtimeMs: Number(row.mtime_ms),
    sha256: row.sha256 ?? "",
    pages: row.pages === null ? null : Number(row.pages),
    chunkCount: Number(row.chunk_count),
    enabled: Number(row.enabled) === 1,
    folderId: row.folder_id,
    status: row.status as KnowledgeSourceStatus,
    error: row.error,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
  };
}

function chunkFromRaw(row: RawChunk): ChunkRow {
  return {
    seq: Number(row.seq),
    documentId: row.document_id,
    chunkIndex: Number(row.chunk_index),
    name: row.name,
    page: row.page === null ? null : Number(row.page),
    slide: row.slide === null ? null : Number(row.slide),
    sheet: row.sheet,
    heading: row.heading,
    charStart: Number(row.char_start),
    charEnd: Number(row.char_end),
    text: row.text,
    path: row.path,
  };
}
