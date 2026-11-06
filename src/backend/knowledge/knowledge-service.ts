import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { type Dirent, mkdirSync as makeDirectorySync } from "node:fs";
import { readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import type {
  AgentEvent,
  BotSummary,
  CreateKnowledgeBaseInput,
  KnowledgeBaseSummary,
  KnowledgeCitation,
  KnowledgeFolderSummary,
  KnowledgeHit,
  KnowledgePrivacy,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSemanticStatus,
  KnowledgeSourceStatus,
  KnowledgeSourceSummary,
  UpdateKnowledgeBaseInput,
} from "../../shared/ipc";
import { JsonFile } from "../json-file";
import { isRecord } from "../protocol";
import { chunkDocument } from "./chunker";
import {
  extractDocument,
  isKnowledgeFile,
  knowledgeKindFor,
  MAX_SOURCE_BYTES,
} from "./document-extractors";
import { EmbeddingModelStore, type FetchLike, POTION_BASE_8M } from "./embedding-model-store";
import type { KnowledgeApi } from "./knowledge-api";
import { type ChunkRow, KnowledgeDb, type VectorInput } from "./knowledge-db";
import {
  buildMatchQuery,
  contentTerms,
  fuseHits,
  knowledgeContextLines,
  matchFromTerms,
  numberHits,
  passesGroundingFloor,
  rowsToHits,
  vectorText,
  wantsSemantic,
} from "./knowledge-search";
import { type Embedder, quantize, StaticEmbedder } from "./static-embedder";

/**
 * Knowledge Bases ("Granthagar"): named sets of the owner's documents, indexed on this computer
 * and searched by coworkers. The registry (names, who may use a base, linked folders) is one
 * JSON file; each base's documents and search index are one SQLite file next to it.
 *
 * Indexing runs one file at a time in the background of the main process and yields between
 * files; nothing is loaded until a base is first used, so the app starts as before.
 *
 * Search is lexical (FTS5 BM25). When the owner installs the optional embedding model, every
 * chunk also gets a 256-byte vector and searches fuse both rankings; the model is a lookup
 * table loaded on first use and dropped again after ten idle minutes.
 */

const REGISTRY_FILE = "registry.json";
const REGISTRY_VERSION = 1;
export const MAX_KNOWLEDGE_BASES = 50;
export const MAX_SOURCES_PER_BASE = 2_000;
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".cache", "__pycache__", "dist", "out"]);
/** Excerpts a turn starts with. */
const GROUNDING_HITS = 6;
/** Cosine below which a semantic match is noise: casual chat scores up to 0.29 with potion. */
const SEMANTIC_MIN_SCORE = 0.36;
/** An explicit search (the owner typed it, or a coworker asked) may show weaker matches. */
const SEMANTIC_MIN_SCORE_EXPLICIT = 0.3;
const VECTOR_BATCH = 256;
/**
 * Bump when extraction or chunking improves: every base re-reads its files in the background
 * the first time it is opened by the newer app, so better passages (and their vectors) arrive
 * without anyone removing and adding files again.
 */
export const INDEXER_VERSION = "2";
const EMBEDDER_IDLE_MS = 10 * 60_000;
const SEMANTIC_EMIT_INTERVAL_MS = 250;
/** While files are indexed, the window hears about it at most this often. */
const CHANGE_EMIT_INTERVAL_MS = 1_000;

export interface KnowledgeServiceOptions {
  /** Replaces the network for the model download (tests). */
  fetch?: FetchLike;
  /** A ready embedder, instead of the downloaded model (tests). */
  embedder?: Embedder;
}

interface StoredFolder {
  id: string;
  path: string;
}

interface StoredBase {
  id: string;
  name: string;
  workspaceId: string;
  botIds: string[];
  privacy: KnowledgePrivacy;
  createdAt: string;
  updatedAt: string;
  folders: StoredFolder[];
}

interface Registry {
  version: number;
  bases: StoredBase[];
}

interface IndexJob {
  kbId: string;
  documentId: string;
}

export interface Grounding {
  lines: string[];
  citations: KnowledgeCitation[];
}

export interface SectionRead {
  fileName: string;
  path: string;
  chunks: ChunkRow[];
}

export class KnowledgeService extends EventEmitter implements KnowledgeApi {
  readonly #root: string;
  readonly #registry: JsonFile<Registry>;
  readonly #dbs = new Map<string, KnowledgeDb>();
  readonly #models: EmbeddingModelStore;
  readonly #modelId: string;
  #bases: StoredBase[] = [];
  #initialized = false;
  #queue: IndexJob[] = [];
  #pumping = false;
  #closed = false;
  #embedder: Embedder | null;
  readonly #embedderInjected: boolean;
  #embedderLoading: Promise<Embedder | null> | null = null;
  #embedderTimer: NodeJS.Timeout | null = null;
  #backfilled = false;
  readonly #vectorizing = new Set<string>();
  #lastSemanticEmit = 0;
  /** Each base's file list, read again only after that base changed. */
  readonly #summaryCache = new Map<
    string,
    Pick<KnowledgeBaseSummary, "sources" | "folders" | "chunkCount">
  >();
  #lastChangeEmit = 0;
  #changeTimer: NodeJS.Timeout | null = null;

  constructor(userDataPath: string, options: KnowledgeServiceOptions = {}) {
    super();
    this.#root = join(userDataPath, "knowledge");
    this.#registry = new JsonFile<Registry>(join(this.#root, REGISTRY_FILE));
    this.#models = new EmbeddingModelStore(this.#root, POTION_BASE_8M, options.fetch);
    this.#modelId = POTION_BASE_8M.id;
    this.#embedder = options.embedder ?? null;
    this.#embedderInjected = Boolean(options.embedder);
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    const registry = await this.#registry.read(
      () => ({ version: REGISTRY_VERSION, bases: [] }),
      isRegistry,
    );
    this.#bases = registry.bases;
    this.#initialized = true;
  }

  /** Closes every open database; the app is quitting. */
  close(): void {
    this.#closed = true;
    this.#queue = [];
    if (this.#changeTimer) clearTimeout(this.#changeTimer);
    this.#changeTimer = null;
    this.#unloadEmbedder();
    for (const db of this.#dbs.values()) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
    this.#dbs.clear();
  }

  // ---- bases ----

  list(): KnowledgeBaseSummary[] {
    return this.#bases.map((base) => this.#summary(base));
  }

  get(id: string): KnowledgeBaseSummary | null {
    const base = this.#bases.find((candidate) => candidate.id === id);
    return base ? this.#summary(base) : null;
  }

  async create(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseSummary[]> {
    await this.initialize();
    if (this.#bases.length >= MAX_KNOWLEDGE_BASES) throw new Error("That is enough bases.");
    const name = requiredName(input.name);
    const now = new Date().toISOString();
    this.#bases.push({
      id: `kb-${randomUUID()}`,
      name,
      workspaceId: input.workspaceId,
      botIds: [],
      privacy: "coworkers",
      createdAt: now,
      updatedAt: now,
      folders: [],
    });
    await this.#persist();
    return this.#changed();
  }

  async update(input: UpdateKnowledgeBaseInput): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(input.id);
    if (input.name !== undefined) base.name = requiredName(input.name);
    if (input.botIds !== undefined) {
      base.botIds = [...new Set(input.botIds.filter((id) => typeof id === "string"))].slice(0, 200);
    }
    if (input.privacy !== undefined) {
      base.privacy = input.privacy === "owner" ? "owner" : "coworkers";
    }
    base.updatedAt = new Date().toISOString();
    await this.#persist();
    return this.#changed();
  }

  async delete(id: string): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(id);
    this.#queue = this.#queue.filter((job) => job.kbId !== id);
    const db = this.#dbs.get(id);
    if (db) {
      db.close();
      this.#dbs.delete(id);
    }
    this.#bases = this.#bases.filter((candidate) => candidate.id !== base.id);
    this.#summaryCache.delete(id);
    await this.#persist();
    for (const suffix of ["", "-wal", "-shm"]) {
      await removeWithRetry(`${this.#dbPath(id)}${suffix}`);
    }
    return this.#changed();
  }

  // ---- sources ----

  async addFiles(kbId: string, paths: string[]): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(kbId);
    const db = this.#db(base.id);
    for (const raw of paths) {
      if (!isKnowledgeFile(raw)) continue;
      const path = await this.#checkedPath(raw);
      if (db.listDocuments().length >= MAX_SOURCES_PER_BASE) break;
      const existing = db.findDocumentByPath(path);
      const info = await stat(path);
      if (existing) {
        db.updateDocument(existing.id, { status: "pending", error: null });
        this.#enqueue(base.id, existing.id);
        continue;
      }
      const kind = knowledgeKindFor(path);
      if (!kind) continue;
      const document = db.insertDocument({
        id: `doc-${randomUUID()}`,
        path,
        name: basename(path),
        kind,
        size: info.size,
        mtimeMs: info.mtimeMs,
        folderId: null,
      });
      this.#enqueue(base.id, document.id);
    }
    base.updatedAt = new Date().toISOString();
    await this.#persist();
    return this.#changed(base.id);
  }

  async addFolder(kbId: string, rawPath: string): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(kbId);
    const path = await this.#checkedPath(rawPath);
    if (!(await stat(path)).isDirectory()) throw new Error("Choose a folder.");
    if (!base.folders.some((folder) => folder.path === path)) {
      base.folders.push({ id: `kf-${randomUUID()}`, path });
      base.updatedAt = new Date().toISOString();
      await this.#persist();
    }
    return this.sync(base.id);
  }

  async removeFolder(kbId: string, folderId: string): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(kbId);
    base.folders = base.folders.filter((folder) => folder.id !== folderId);
    this.#queue = this.#queue.filter((job) => job.kbId !== kbId || !this.#inFolder(job, folderId));
    this.#db(base.id).deleteDocumentsInFolder(folderId);
    base.updatedAt = new Date().toISOString();
    await this.#persist();
    return this.#changed(base.id);
  }

  async removeSource(kbId: string, documentId: string): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(kbId);
    this.#queue = this.#queue.filter((job) => job.documentId !== documentId);
    this.#db(base.id).deleteDocument(documentId);
    return this.#changed(base.id);
  }

  async setSourceEnabled(
    kbId: string,
    documentId: string,
    enabled: boolean,
  ): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(kbId);
    this.#db(base.id).updateDocument(documentId, { enabled });
    return this.#changed(base.id);
  }

  /** Looks at every linked folder and file again; new and changed files are indexed. */
  async sync(kbId: string): Promise<KnowledgeBaseSummary[]> {
    const base = this.#require(kbId);
    const db = this.#db(base.id);
    const known = new Map(db.listDocuments().map((document) => [document.path, document]));
    const seen = new Set<string>();
    for (const folder of base.folders) {
      const files = await walkFolder(folder.path, MAX_SOURCES_PER_BASE - known.size);
      for (const file of files) {
        seen.add(file.path);
        const existing = known.get(file.path);
        if (!existing) {
          if (known.size + seen.size > MAX_SOURCES_PER_BASE) break;
          const kind = knowledgeKindFor(file.path);
          if (!kind) continue;
          const document = db.insertDocument({
            id: `doc-${randomUUID()}`,
            path: file.path,
            name: basename(file.path),
            kind,
            size: file.size,
            mtimeMs: file.mtimeMs,
            folderId: folder.id,
          });
          known.set(file.path, document);
          this.#enqueue(base.id, document.id);
        } else if (
          existing.status !== "indexing" &&
          (existing.size !== file.size ||
            Math.round(existing.mtimeMs) !== Math.round(file.mtimeMs) ||
            existing.status === "missing" ||
            existing.status === "pending")
        ) {
          if (existing.folderId !== folder.id)
            db.updateDocument(existing.id, { folderId: folder.id });
          this.#enqueue(base.id, existing.id);
        }
      }
    }
    for (const document of known.values()) {
      if (document.folderId) {
        if (!seen.has(document.path) && document.status !== "missing") {
          db.updateDocument(document.id, { status: "missing" });
        }
        continue;
      }
      try {
        const info = await stat(document.path);
        if (
          document.status === "missing" ||
          document.status === "pending" ||
          info.size !== document.size ||
          Math.round(info.mtimeMs) !== Math.round(document.mtimeMs)
        ) {
          this.#enqueue(base.id, document.id);
        }
      } catch {
        if (document.status !== "missing") db.updateDocument(document.id, { status: "missing" });
      }
    }
    return this.#changed(base.id);
  }

  // ---- search ----

  async search(
    input: KnowledgeSearchInput,
    scope: { workspaceId?: string } = {},
  ): Promise<KnowledgeSearchResult> {
    await this.initialize();
    const limit = Math.max(1, Math.min(input.limit ?? 8, 30));
    const bases = this.#bases.filter(
      (base) =>
        (!input.kbIds || input.kbIds.includes(base.id)) &&
        (!scope.workspaceId || base.workspaceId === scope.workspaceId),
    );
    return {
      hits: await this.#searchBases(bases, input.query, limit, SEMANTIC_MIN_SCORE_EXPLICIT),
      kbIds: bases.map((b) => b.id),
    };
  }

  /** The bases a coworker may read: its workspace's, open to it, and not owner-only. */
  basesForBot(bot: Pick<BotSummary, "id" | "workspaceId">): KnowledgeBaseSummary[] {
    return this.#basesForBot(bot).map((base) => this.#summary(base));
  }

  async searchForBot(
    bot: Pick<BotSummary, "id" | "workspaceId">,
    query: string,
    options: { limit?: number; kbId?: string } = {},
  ): Promise<KnowledgeHit[]> {
    await this.initialize();
    const bases = this.#basesForBot(bot).filter(
      (base) => !options.kbId || base.id === options.kbId,
    );
    return this.#searchBases(
      bases,
      query,
      Math.max(1, Math.min(options.limit ?? 8, 20)),
      SEMANTIC_MIN_SCORE_EXPLICIT,
    );
  }

  /** The context block a user message starts with, or null when nothing matched. */
  async groundingFor(
    bot: Pick<BotSummary, "id" | "workspaceId">,
    query: string,
  ): Promise<Grounding | null> {
    await this.initialize();
    const bases = this.#basesForBot(bot);
    if (bases.length === 0) return null;
    const hits = await this.#searchBases(bases, query, GROUNDING_HITS, SEMANTIC_MIN_SCORE, true);
    if (hits.length === 0) return null;
    const citations = hits.map((hit) => hit.citation);
    const names = [...new Set(citations.map((citation) => citation.kbName))];
    return { lines: knowledgeContextLines(citations, names), citations };
  }

  /** A document's chunks: one page, or a window around a chunk, or from the start. */
  readSection(
    kbId: string,
    documentId: string,
    options: { page?: number | null; chunkIndex?: number | null; span?: number } = {},
  ): SectionRead {
    const base = this.#require(kbId);
    const db = this.#db(base.id);
    const document = db.getDocument(documentId);
    if (!document) throw new Error("Unknown document.");
    const span = Math.max(1, Math.min(options.span ?? 3, 12));
    const chunks =
      typeof options.page === "number"
        ? db.readChunks(documentId, { page: options.page, limit: 20 })
        : typeof options.chunkIndex === "number"
          ? db.readChunks(documentId, {
              fromIndex: Math.max(0, options.chunkIndex - span),
              toIndex: options.chunkIndex + span,
              limit: span * 2 + 1,
            })
          : db.readChunks(documentId, { limit: 6 });
    return { fileName: document.name, path: document.path, chunks };
  }

  sourcePath(kbId: string, documentId: string): string {
    const base = this.#require(kbId);
    const document = this.#db(base.id).getDocument(documentId);
    if (!document) throw new Error("Unknown document.");
    return document.path;
  }

  /** Waits for the indexing queue to drain; tests and shutdown use it. */
  async idle(): Promise<void> {
    while (this.#pumping || this.#queue.length > 0 || this.#vectorizing.size > 0) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  }

  // ---- smarter search (optional embedding model) ----

  async semanticStatus(): Promise<KnowledgeSemanticStatus> {
    await this.initialize();
    const store = await this.#models.status();
    let vectors = 0;
    let chunks = 0;
    if (!this.#closed && (store.state === "ready" || this.#embedder)) {
      for (const base of this.#bases) {
        try {
          const db = this.#db(base.id);
          vectors += db.vectorCount(this.#modelId);
          chunks += db.chunkCount();
        } catch {
          /* counted as zero */
        }
      }
    }
    return {
      state: this.#embedderInjected ? "ready" : store.state,
      modelName: this.#models.manifest.name,
      license: this.#models.manifest.license,
      source: this.#models.manifest.source,
      sizeBytes: store.total,
      received: store.received,
      error: store.error,
      vectors,
      chunks,
      loaded: this.#embedder !== null,
    };
  }

  /** Downloads the model (once, with progress events), then prepares vectors for every base. */
  async installSemantic(): Promise<KnowledgeSemanticStatus> {
    await this.initialize();
    try {
      await this.#models.install((progress) => {
        void this.#emitSemantic(false, progress.received);
      });
    } catch (error) {
      await this.#emitSemantic(true);
      throw error;
    }
    await this.#emitSemantic(true);
    void this.#vectorizeAll();
    return this.semanticStatus();
  }

  /** Deletes the model files and every vector; search is lexical again. */
  async removeSemantic(): Promise<KnowledgeSemanticStatus> {
    await this.initialize();
    this.#unloadEmbedder();
    await this.#models.remove();
    for (const base of this.#bases) {
      try {
        this.#db(base.id).clearVectors();
      } catch (error) {
        this.emit("log", `knowledge vectors of ${base.name} not cleared: ${String(error)}`);
      }
    }
    await this.#emitSemantic(true);
    return this.semanticStatus();
  }

  // ---- internals ----

  /**
   * `grounding`: excerpts for a message nobody asked to search with. Small talk is ignored and
   * every lexical hit must clear the floor in knowledge-search.ts, so "hi, can you help me
   * today?" adds nothing while "late fee in the rent agreement" still finds its page.
   */
  async #searchBases(
    bases: StoredBase[],
    query: string,
    limit: number,
    minScore: number,
    grounding = false,
  ): Promise<KnowledgeHit[]> {
    if (bases.length === 0) return [];
    const terms = grounding ? contentTerms(query) : null;
    const match = terms ? matchFromTerms(terms) : buildMatchQuery(query);
    const embedder = wantsSemantic(query) ? await this.#embedderReady() : null;
    const vector = embedder ? embedder.embed(query) : null;
    if (!match && !vector) return [];
    const groups: KnowledgeHit[][] = [];
    for (const base of bases) {
      try {
        const db = this.#db(base.id);
        let lexical = match ? rowsToHits(db.search(match, limit * 3), base, limit) : [];
        if (terms) {
          const best = lexical[0]?.score ?? 0;
          lexical = lexical.filter((hit) =>
            passesGroundingFloor(
              terms,
              `${hit.citation.fileName} ${hit.citation.heading ?? ""} ${hit.citation.excerpt}`,
              hit.score,
              best,
            ),
          );
        }
        if (!vector) {
          groups.push(lexical);
          continue;
        }
        const semantic = rowsToHits(
          db.semanticSearch(vector, this.#modelId, limit * 3, minScore),
          base,
          limit,
        );
        groups.push(fuseHits(lexical, semantic, limit));
      } catch (error) {
        this.emit("log", `knowledge search in ${base.name} failed: ${String(error)}`);
      }
    }
    return numberHits(groups, limit);
  }

  /** The embedder when the model is installed: loaded on first use, dropped when idle. */
  async #embedderReady(): Promise<Embedder | null> {
    if (this.#closed) return null;
    if (this.#embedder) {
      this.#touchEmbedder();
      return this.#embedder;
    }
    if (this.#embedderLoading) return this.#embedderLoading;
    if (!(await this.#models.isInstalled())) return null;
    this.#embedderLoading = StaticEmbedder.fromFolder(this.#models.folder)
      .then((embedder) => {
        if (this.#closed) return null;
        this.#embedder = embedder;
        this.#touchEmbedder();
        if (!this.#backfilled) {
          this.#backfilled = true;
          void this.#vectorizeAll();
        }
        return embedder;
      })
      .catch((error: unknown) => {
        this.emit("log", `knowledge embedding model not loaded: ${String(error)}`);
        return null;
      })
      .finally(() => {
        this.#embedderLoading = null;
      });
    return this.#embedderLoading;
  }

  #touchEmbedder(): void {
    if (this.#embedderInjected) return;
    if (this.#embedderTimer) clearTimeout(this.#embedderTimer);
    this.#embedderTimer = setTimeout(() => this.#unloadEmbedder(), EMBEDDER_IDLE_MS);
    this.#embedderTimer.unref?.();
  }

  #unloadEmbedder(): void {
    if (this.#embedderTimer) clearTimeout(this.#embedderTimer);
    this.#embedderTimer = null;
    if (!this.#embedderInjected) this.#embedder = null;
    this.#backfilled = false;
  }

  async #vectorizeAll(): Promise<void> {
    for (const base of [...this.#bases]) {
      if (this.#closed) return;
      await this.#vectorizeBase(base.id);
    }
  }

  /** Vectors for every ready chunk of a base that lacks one, in small batches with pauses. */
  async #vectorizeBase(kbId: string): Promise<void> {
    if (this.#vectorizing.has(kbId)) return;
    this.#vectorizing.add(kbId);
    try {
      const embedder = await this.#embedderReady();
      if (!embedder) return;
      while (!this.#closed) {
        const db = this.#dbs.get(kbId) ?? this.#db(kbId);
        const batch = db.chunksWithoutVectors(this.#modelId, VECTOR_BATCH);
        if (batch.length === 0) break;
        const vectors: VectorInput[] = batch.map((chunk) => {
          const quantized = quantize(embedder.embed(vectorText(chunk)));
          return { seq: chunk.seq, scale: quantized.scale, data: quantized.data };
        });
        db.putVectors(this.#modelId, vectors);
        void this.#emitSemantic(false);
        await new Promise((resolveWait) => setImmediate(resolveWait));
      }
    } catch (error) {
      this.emit("log", `knowledge vectors failed: ${String(error)}`);
    } finally {
      this.#vectorizing.delete(kbId);
    }
  }

  async #emitSemantic(force: boolean, received?: number): Promise<void> {
    const now = Date.now();
    if (!force && now - this.#lastSemanticEmit < SEMANTIC_EMIT_INTERVAL_MS) return;
    this.#lastSemanticEmit = now;
    if (this.#closed) return;
    const status = await this.semanticStatus();
    if (received !== undefined) status.received = received;
    this.#emit({ type: "knowledge-semantic", status });
  }

  #basesForBot(bot: Pick<BotSummary, "id" | "workspaceId">): StoredBase[] {
    return this.#bases.filter(
      (base) =>
        base.workspaceId === bot.workspaceId &&
        base.privacy === "coworkers" &&
        (base.botIds.length === 0 || base.botIds.includes(bot.id)),
    );
  }

  #require(id: string): StoredBase {
    const base = this.#bases.find((candidate) => candidate.id === id);
    if (!base) throw new Error(`Unknown knowledge base: ${id}`);
    return base;
  }

  #dbPath(id: string): string {
    return join(this.#root, `${id}.sqlite`);
  }

  #db(id: string): KnowledgeDb {
    if (this.#closed) throw new Error("Knowledge Bases are closed.");
    let db = this.#dbs.get(id);
    if (!db) {
      mkdirSync(this.#root);
      db = new KnowledgeDb(this.#dbPath(id));
      this.#dbs.set(id, db);
      this.#upgradeIndex(id, db);
    }
    return db;
  }

  /** A base opened by a newer indexer re-reads its files; stale vectors go first. */
  #upgradeIndex(id: string, db: KnowledgeDb): void {
    try {
      if (db.getMeta("indexer") === INDEXER_VERSION) return;
      db.pruneVectors(this.#modelId);
      const ids = db.markAllForReindex();
      db.setMeta("indexer", INDEXER_VERSION);
      for (const documentId of ids) this.#enqueue(id, documentId);
      if (ids.length > 0) this.emit("log", `knowledge base ${id}: ${ids.length} files re-indexed`);
    } catch (error) {
      this.emit("log", `knowledge index upgrade failed: ${String(error)}`);
    }
  }

  #inFolder(job: IndexJob, folderId: string): boolean {
    const document = this.#dbs.get(job.kbId)?.getDocument(job.documentId);
    return document?.folderId === folderId;
  }

  #summary(base: StoredBase): KnowledgeBaseSummary {
    let files = this.#summaryCache.get(base.id);
    if (!files) {
      const documents = this.#db(base.id).listDocuments();
      const sources: KnowledgeSourceSummary[] = documents.map((document) => ({
        id: document.id,
        path: document.path,
        name: document.name,
        kind: document.kind,
        size: document.size,
        pages: document.pages,
        chunkCount: document.chunkCount,
        status: document.status,
        error: document.error,
        enabled: document.enabled,
        folderId: document.folderId,
        indexedAt: document.indexedAt,
      }));
      const perFolder = new Map<string, number>();
      for (const document of documents) {
        if (document.folderId) {
          perFolder.set(document.folderId, (perFolder.get(document.folderId) ?? 0) + 1);
        }
      }
      const folders: KnowledgeFolderSummary[] = base.folders.map((folder) => ({
        id: folder.id,
        path: folder.path,
        fileCount: perFolder.get(folder.id) ?? 0,
      }));
      files = {
        sources,
        folders,
        chunkCount: documents.reduce((sum, document) => sum + document.chunkCount, 0),
      };
      this.#summaryCache.set(base.id, files);
    }
    return {
      id: base.id,
      name: base.name,
      workspaceId: base.workspaceId,
      botIds: [...base.botIds],
      privacy: base.privacy,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
      sources: files.sources,
      folders: files.folders,
      chunkCount: files.chunkCount,
      indexing: this.#queue.some((job) => job.kbId === base.id),
    };
  }

  async #persist(): Promise<void> {
    await this.#registry.write({ version: REGISTRY_VERSION, bases: this.#bases });
  }

  /** The owner changed something: everyone hears about it now. */
  #changed(kbId?: string): KnowledgeBaseSummary[] {
    if (kbId) this.#summaryCache.delete(kbId);
    else this.#summaryCache.clear();
    if (this.#changeTimer) clearTimeout(this.#changeTimer);
    this.#changeTimer = null;
    const bases = this.list();
    this.#lastChangeEmit = Date.now();
    this.#emit({ type: "knowledge-changed", bases });
    return bases;
  }

  /**
   * Indexing changed a base: the window hears about it at most once a second (the last change
   * always arrives), so a folder of 2,000 files is not 2,000 full lists over IPC.
   */
  #changedSoon(kbId: string): void {
    this.#summaryCache.delete(kbId);
    if (this.#changeTimer || this.#closed) return;
    const wait = Math.max(0, this.#lastChangeEmit + CHANGE_EMIT_INTERVAL_MS - Date.now());
    this.#changeTimer = setTimeout(() => {
      this.#changeTimer = null;
      if (this.#closed) return;
      this.#lastChangeEmit = Date.now();
      this.#emit({ type: "knowledge-changed", bases: this.list() });
    }, wait);
    this.#changeTimer.unref?.();
  }
  #emit(event: AgentEvent): void {
    this.emit("event", event);
  }

  /** Files and folders inside Sahkarmi's own data folder are never indexed. */
  async #checkedPath(raw: string): Promise<string> {
    if (typeof raw !== "string" || !raw.trim() || !isAbsolute(raw)) {
      throw new Error("Choose a file or folder on this computer.");
    }
    const own = resolve(dirname(this.#root)) + sep;
    const guard = (path: string) => {
      if (resolve(path).startsWith(own)) throw new Error("Sahkarmi's own files cannot be indexed.");
    };
    guard(raw);
    let real: string;
    try {
      real = await realpath(raw);
    } catch {
      throw new Error(`Not found: ${basename(raw)}`);
    }
    guard(real);
    return real;
  }

  #enqueue(kbId: string, documentId: string): void {
    if (this.#queue.some((job) => job.kbId === kbId && job.documentId === documentId)) return;
    this.#queue.push({ kbId, documentId });
    void this.#pump();
  }

  async #pump(): Promise<void> {
    if (this.#pumping) return;
    this.#pumping = true;
    try {
      while (this.#queue.length > 0 && !this.#closed) {
        const job = this.#queue[0];
        if (!job) break;
        const total = this.#queue.filter((entry) => entry.kbId === job.kbId).length;
        try {
          await this.#index(job, total);
        } catch (error) {
          this.emit("log", `knowledge indexing failed: ${String(error)}`);
        }
        this.#queue = this.#queue.filter((entry) => entry !== job);
        if (this.#closed) break;
        this.#changedSoon(job.kbId);
        // Let the app breathe between files: UI events and coworker turns go first.
        await new Promise((resolveWait) => setImmediate(resolveWait));
      }
    } finally {
      this.#pumping = false;
    }
  }

  async #index(job: IndexJob, totalInBase: number): Promise<void> {
    const base = this.#bases.find((candidate) => candidate.id === job.kbId);
    if (!base) return;
    const db = this.#db(base.id);
    const document = db.getDocument(job.documentId);
    if (!document) return;
    const done = db.documentCounts().ready;
    this.#summaryCache.delete(base.id);
    const progress = (status: KnowledgeSourceStatus) =>
      this.#emit({
        type: "knowledge-progress",
        progress: {
          kbId: base.id,
          documentId: document.id,
          name: document.name,
          status,
          done,
          total: done + totalInBase,
        },
      });
    const fail = (error: unknown) => {
      db.failDocument(document.id, error instanceof Error ? error.message : String(error));
      progress("failed");
    };
    let buffer: Buffer;
    let info: { size: number; mtimeMs: number };
    try {
      const stats = await stat(document.path);
      info = { size: stats.size, mtimeMs: stats.mtimeMs };
    } catch {
      db.updateDocument(document.id, { status: "missing" });
      progress("missing");
      return;
    }
    // A huge file is refused before it is read into memory.
    if (info.size > MAX_SOURCE_BYTES) {
      db.updateDocument(document.id, { size: info.size, mtimeMs: info.mtimeMs });
      fail(new Error(`The file is larger than ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`));
      return;
    }
    try {
      buffer = await readFile(document.path);
    } catch {
      db.updateDocument(document.id, { status: "missing" });
      progress("missing");
      return;
    }
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    if (sha256 === document.sha256 && document.status === "ready") {
      db.updateDocument(document.id, { size: info.size, mtimeMs: info.mtimeMs });
      return;
    }
    db.updateDocument(document.id, { status: "indexing", error: null });
    progress("indexing");
    try {
      const extracted = await extractDocument(document.path, buffer);
      const chunks = chunkDocument(extracted.units);
      if (chunks.length === 0) {
        throw new Error("No readable text in this file (a scanned PDF needs OCR first).");
      }
      db.replaceChunks(document.id, document.name, chunks, {
        sha256,
        size: info.size,
        mtimeMs: info.mtimeMs,
        pages: extracted.pages,
      });
      progress("ready");
      await this.#vectorizeBase(base.id);
    } catch (error) {
      // The old passages described a version of the file that is gone: they go too.
      fail(error);
    }
  }
}
function requiredName(value: string): string {
  const name = String(value ?? "")
    .trim()
    .slice(0, 80);
  if (!name) throw new Error("Give the knowledge base a name.");
  return name;
}

function isRegistry(value: unknown): value is Registry {
  return (
    isRecord(value) &&
    typeof value.version === "number" &&
    Array.isArray(value.bases) &&
    value.bases.every(
      (base) =>
        isRecord(base) &&
        typeof base.id === "string" &&
        typeof base.name === "string" &&
        typeof base.workspaceId === "string" &&
        Array.isArray(base.botIds) &&
        (base.privacy === "coworkers" || base.privacy === "owner") &&
        Array.isArray(base.folders),
    )
  );
}

let madeRoot = "";
/** node:sqlite needs the folder to exist before it opens a file there. */
function mkdirSync(path: string): void {
  if (madeRoot === path) return;
  makeDirectorySync(path, { recursive: true });
  madeRoot = path;
}

interface WalkedFile {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Supported files under a folder, depth first, skipping build and hidden folders and links. */
export async function walkFolder(root: string, budget: number): Promise<WalkedFile[]> {
  const files: WalkedFile[] = [];
  const pending = [root];
  let depth = 0;
  while (pending.length > 0 && files.length < budget && depth < 50_000) {
    depth += 1;
    const directory = pending.shift();
    if (!directory) break;
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        pending.push(path);
      } else if (entry.isFile() && isKnowledgeFile(path) && !entry.name.startsWith("~$")) {
        try {
          const info = await stat(path);
          files.push({ path, size: info.size, mtimeMs: info.mtimeMs });
        } catch {
          /* vanished while walking */
        }
        if (files.length >= budget) break;
      }
    }
  }
  return files;
}

async function removeWithRetry(path: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { force: true });
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100 * (attempt + 1)));
    }
  }
}
