import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { KnowledgeSourceKind, KnowledgeSourceStatus } from "../../shared/ipc";
import { openDatabase } from "./sqlite-capabilities";

/**
 * One SQLite file per Knowledge Base, through Node's built-in `node:sqlite` (no native addon).
 * Documents and their chunks live here; an FTS5 table over the chunks gives BM25-ranked search
 * that understands English, Hindi and Bengali words (unicode61 tokenizer, diacritics folded,
 * English words stemmed so "registrations" finds "registration"). When the optional embedding
 * model is installed, each chunk also gets a small int8 vector for meaning-based search: the
 * sqlite-vec extension ranks them inside SQLite, or (if it cannot load) a brute-force scan over
 * an in-memory copy does.
 *
 * Search only sees documents that are enabled and whose file is there: a file that went missing
 * or failed to index again is never cited (its stale passages are not quoted as if current).
 */

/** Documents whose passages may be searched and cited. */
const SEARCHABLE = "d.enabled = 1 AND d.status NOT IN ('missing', 'failed')";

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
  scales: number[];
  /** Rows of `dim` int8 values, grown in place as vectors are added. */
  data: Int8Array;
  /** Rows whose chunk was deleted since the cache was built (filtered out when read). */
  stale: number;
}

export interface KnowledgeDbOptions {
  /** false: never load sqlite-vec (tests of the fallback). */
  vector?: boolean;
}

export interface DocumentCounts {
  total: number;
  ready: number;
  chunks: number;
}

export class KnowledgeDb {
  readonly #db: DatabaseSync;
  readonly path: string;
  #vectorCache: VectorCache | null = null;
  /** sqlite-vec is loaded into this connection. */
  readonly vectorExtension: boolean;

  constructor(path: string, options: KnowledgeDbOptions = {}) {
    this.path = path;
    const opened = openDatabase(path, { vector: options.vector });
    this.#db = opened.db;
    this.vectorExtension = opened.vector;
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

  getMeta(key: string): string | null {
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.#db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, value);
  }

  /** Documents that were indexed (or failed) and should be read again by a newer indexer. */
  markAllForReindex(): string[] {
    const ids = (
      this.#db
        .prepare("SELECT id FROM documents WHERE status IN ('ready', 'failed')")
        .all() as Array<{ id: string }>
    ).map((row) => String(row.id));
    if (ids.length > 0) {
      this.#db.exec("UPDATE documents SET status = 'pending' WHERE status IN ('ready', 'failed')");
    }
    return ids;
  }

  /** Drops vectors of any model but the current one (left behind by a model change). */
  pruneVectors(model: string): number {
    const result = this.#db.prepare("DELETE FROM vectors WHERE model <> ?").run(model);
    if (Number(result.changes) > 0) this.#vectorCache = null;
    return Number(result.changes);
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

  /** Counts for a summary or progress, without reading every row. */
  documentCounts(): DocumentCounts {
    const row = this.#db
      .prepare(
        `SELECT count(*) AS total, coalesce(sum(status = 'ready'), 0) AS ready,
                coalesce(sum(chunk_count), 0) AS chunks FROM documents`,
      )
      .get() as { total: number; ready: number; chunks: number };
    return { total: Number(row.total), ready: Number(row.ready), chunks: Number(row.chunks) };
  }

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
  }

  deleteDocument(id: string): void {
    this.#db.exec("BEGIN IMMEDIATE");
    let removed = 0;
    try {
      removed = Number(
        this.#db.prepare("DELETE FROM chunks WHERE document_id = ?").run(id).changes,
      );
      this.#db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    this.#markStale(removed);
  }

  /**
   * A document that could not be indexed again loses its old passages, so nothing stale from it
   * is cited; it shows as failed with the reason.
   */
  failDocument(id: string, error: string): void {
    this.#db.exec("BEGIN IMMEDIATE");
    let removed = 0;
    try {
      removed = Number(
        this.#db.prepare("DELETE FROM chunks WHERE document_id = ?").run(id).changes,
      );
      this.#db
        .prepare(
          "UPDATE documents SET status = 'failed', error = ?, chunk_count = 0, sha256 = '' WHERE id = ?",
        )
        .run(error, id);
      this.#db.exec("COMMIT");
    } catch (failure) {
      this.#db.exec("ROLLBACK");
      throw failure;
    }
    this.#markStale(removed);
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
    let removed = 0;
    try {
      removed = Number(
        this.#db.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId).changes,
      );
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
    this.#markStale(removed);
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
   * BM25 over the chunks of enabled documents whose file is still there. `match` is an FTS5 expression built by
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
         WHERE chunks_fts MATCH ? AND ${SEARCHABLE}
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
    this.#appendToCache(model, vectors);
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
   * Cosine search over the vectors of searchable documents. With sqlite-vec loaded the ranking
   * runs inside SQLite (exact, brute force, a few milliseconds for tens of thousands of chunks)
   * and the filter on enabled and present files is part of the query. Without it, the vectors
   * are cached in memory as int8 (256 bytes a chunk) and scanned in JavaScript.
   */
  semanticSearch(query: Float32Array, model: string, limit: number, minScore: number): VectorHit[] {
    const top = Math.max(1, Math.min(limit, 200));
    if (this.vectorExtension) {
      try {
        return this.#semanticSearchSql(query, model, top, minScore);
      } catch {
        // A damaged row or an odd vector: the scan below still answers.
      }
    }
    return this.#semanticSearchScan(query, model, top, minScore);
  }

  #semanticSearchSql(
    query: Float32Array,
    model: string,
    limit: number,
    minScore: number,
  ): VectorHit[] {
    const quantized = quantizeQuery(query);
    if (!quantized) return [];
    const rows = this.#db
      .prepare(
        `SELECT c.*, d.path AS path,
                1.0 - vec_distance_cosine(vec_int8(v.data), vec_int8(?)) AS score
         FROM vectors v JOIN chunks c ON c.seq = v.seq JOIN documents d ON d.id = c.document_id
         WHERE v.model = ? AND length(v.data) = ? AND ${SEARCHABLE}
         ORDER BY score DESC LIMIT ?`,
      )
      .all(
        new Uint8Array(quantized.buffer, quantized.byteOffset, quantized.byteLength),
        model,
        quantized.length,
        limit,
      ) as unknown as Array<RawChunk & { score: number }>;
    const hits: VectorHit[] = [];
    for (const row of rows) {
      const score = Number(row.score);
      if (!(score >= minScore)) break;
      hits.push({ ...chunkFromRaw(row), score });
    }
    return hits;
  }

  #semanticSearchScan(
    query: Float32Array,
    model: string,
    limit: number,
    minScore: number,
  ): VectorHit[] {
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
    // Deleted or switched-off chunks may still be cached: read a few more than asked for and
    // keep only rows the database still calls searchable.
    const hits: VectorHit[] = [];
    for (let from = 0; from < scored.length && hits.length < limit; from += limit * 2) {
      const window = scored.slice(from, from + limit * 2);
      const seqs = window.map((entry) => cache.seqs[entry.index] ?? -1);
      const rows = this.#db
        .prepare(
          `SELECT c.*, d.path AS path FROM chunks c JOIN documents d ON d.id = c.document_id
           WHERE c.seq IN (${seqs.map(() => "?").join(", ")}) AND ${SEARCHABLE}`,
        )
        .all(...seqs) as unknown as RawChunk[];
      const bySeq = new Map(rows.map((row) => [Number(row.seq), chunkFromRaw(row)]));
      for (const [position, entry] of window.entries()) {
        const chunk = bySeq.get(seqs[position] ?? -1);
        if (chunk) hits.push({ ...chunk, score: entry.score });
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  /** New vectors join the in-memory copy instead of throwing it away (indexing writes often). */
  #appendToCache(model: string, vectors: VectorInput[]): void {
    const cache = this.#vectorCache;
    if (!cache) return;
    if (cache.model !== model) {
      this.#vectorCache = null;
      return;
    }
    if (cache.dim === 0) cache.dim = vectors[0]?.data.length ?? 0;
    const known = new Set(cache.seqs);
    const fresh = vectors.filter(
      (vector) => vector.data.length === cache.dim && !known.has(vector.seq),
    );
    if (fresh.length < vectors.length) {
      // A vector was replaced (or has another size): rebuild on the next search.
      this.#vectorCache = null;
      return;
    }
    const needed = (cache.seqs.length + fresh.length) * cache.dim;
    if (cache.data.length < needed) {
      const grown = new Int8Array(Math.max(needed, cache.data.length * 2));
      grown.set(cache.data.subarray(0, cache.seqs.length * cache.dim));
      cache.data = grown;
    }
    for (const vector of fresh) {
      cache.data.set(vector.data, cache.seqs.length * cache.dim);
      cache.seqs.push(vector.seq);
      cache.scales.push(vector.scale);
    }
  }

  /** Deleted chunks stay in the cache until a quarter of it is stale, then it is rebuilt. */
  #markStale(count: number): void {
    const cache = this.#vectorCache;
    if (!cache || count === 0) return;
    cache.stale += count;
    if (cache.stale * 4 > cache.seqs.length) this.#vectorCache = null;
  }

  /** For tests: whether the in-memory vector copy is loaded. */
  get vectorCacheLoaded(): boolean {
    return this.#vectorCache !== null;
  }

  #vectors(model: string): VectorCache | null {
    if (this.#vectorCache && this.#vectorCache.model === model) return this.#vectorCache;
    const rows = this.#db
      .prepare("SELECT seq, scale, data FROM vectors WHERE model = ? ORDER BY seq")
      .all(model) as unknown as Array<{ seq: number; scale: number; data: Uint8Array }>;
    const dim = rows[0]?.data.byteLength ?? 0;
    const seqs: number[] = [];
    const scales: number[] = [];
    const data = new Int8Array(rows.length * dim);
    for (const row of rows) {
      if (row.data.byteLength !== dim) continue;
      data.set(new Int8Array(row.data.buffer, row.data.byteOffset, dim), seqs.length * dim);
      seqs.push(Number(row.seq));
      scales.push(Number(row.scale));
    }
    this.#vectorCache = { model, dim, seqs, scales, data, stale: 0 };
    return this.#vectorCache;
  }
}

/** The query as int8 for sqlite-vec (cosine ignores the scale), or null for a zero vector. */
function quantizeQuery(query: Float32Array): Int8Array | null {
  let max = 0;
  for (const value of query) max = Math.max(max, Math.abs(value));
  if (!(max > 0)) return null;
  const out = new Int8Array(query.length);
  for (let i = 0; i < query.length; i += 1) out[i] = Math.round(((query[i] ?? 0) / max) * 127);
  return out;
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
