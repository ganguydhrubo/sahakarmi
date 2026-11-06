import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { access, copyFile, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMemory, AgentMemoryCategory } from "../shared/ipc";
import { JsonFile } from "./json-file";
import { contentTerms, matchFromTerms, passesGroundingFloor } from "./knowledge/knowledge-search";
import {
  cleanTags,
  MemoryDb,
  type MemoryRow,
  normalizeKey,
  type RecallMessage,
} from "./memory/memory-db";
import { isRecord } from "./protocol";

/**
 * Team memory ("Smriti"): facts, decisions and owner preferences coworkers save with
 * sahkarmi.save_memory, scoped to one workspace (Shop A's notes never reach Shop B).
 *
 * Memories live in SQLite (`memory/memory.sqlite`, FTS5 search, one memory per key). The first
 * start after the update moves the old `smriti-memory.json` in: every entry goes to the
 * workspace of the coworker that wrote it (or the active workspace when that is unknown) and
 * the JSON is kept beside it as `smriti-memory.json.bak`.
 *
 * If SQLite cannot open, the JSON file is used as before, written atomically (temp file and
 * rename). A JSON file that cannot be parsed is never overwritten: a copy is kept and memory
 * stays read-only until the owner looks at it.
 */

const MEMORY_FILE_NAME = "smriti-memory.json";
const MEMORY_DB_FOLDER = "memory";
const MEMORY_DB_FILE = "memory.sqlite";
/** Memories added to a message unasked, and their total size. */
export const AUTO_MEMORY_LIMIT = 3;
export const AUTO_MEMORY_CHARS = 1_500;
export const MEMORY_PAGE_MAX = 50;

export interface MemoryStoreOptions {
  /** The workspace a coworker belongs to (for the one-time move from JSON). */
  workspaceOfBot?: (botId: string) => string | undefined;
  /** The workspace shown in the window (owner of memories with no known author). */
  activeWorkspace?: () => string | undefined;
  log?: (level: "warn" | "error", line: string) => void;
  /** false: never open SQLite (tests of the JSON fallback). */
  sqlite?: boolean;
}

export interface MemoryEntry {
  workspaceId: string;
  key: string;
  content: string;
  category?: AgentMemoryCategory;
  tags?: string[];
  authorBotId?: string;
  id?: string;
}

export interface MemoryPage {
  memories: AgentMemory[];
  total: number;
  offset: number;
}

export type RecallHit = RecallMessage;

interface MemoryBackend {
  readonly kind: "sqlite" | "json";
  list(
    workspaceId: string,
    category: string | undefined,
    limit: number,
    offset: number,
  ): MemoryPage;
  search(
    workspaceId: string,
    query: string,
    category: string | undefined,
    limit: number,
  ): AgentMemory[];
  relevant(workspaceId: string, text: string, limit: number): AgentMemory[];
  save(
    entry: Required<Pick<MemoryEntry, "workspaceId" | "key" | "content" | "category" | "tags">> &
      MemoryEntry,
  ): Promise<AgentMemory>;
  delete(id: string, workspaceId: string | undefined): Promise<boolean>;
  recordMessages(messages: RecallMessage[]): void;
  recall(botIds: string[], words: string[], limit: number): RecallMessage[] | null;
  close(): void;
}

export class AgentMemoryStore {
  readonly #userDataPath: string;
  readonly #options: MemoryStoreOptions;
  #backend: MemoryBackend | null = null;
  #opening: Promise<MemoryBackend> | null = null;

  constructor(userDataPath: string, options: MemoryStoreOptions = {}) {
    this.#userDataPath = userDataPath;
    this.#options = options;
  }

  async initialize(): Promise<void> {
    await this.#ready();
  }

  /** "sqlite", or "json" when SQLite could not open (memory still works, scoped and atomic). */
  async kind(): Promise<"sqlite" | "json"> {
    return (await this.#ready()).kind;
  }

  /** One page of a workspace's memories, newest first. */
  async list(
    workspaceId: string,
    options: { category?: string; limit?: number; offset?: number } = {},
  ): Promise<MemoryPage> {
    const limit = clamp(options.limit ?? 20, 1, 500);
    return (await this.#ready()).list(
      workspaceId,
      options.category,
      limit,
      Math.max(0, Math.floor(options.offset ?? 0)),
    );
  }

  /** Word search (every form of a word matches), best first; an empty query lists the newest. */
  async search(
    workspaceId: string,
    query: string,
    options: { category?: string; limit?: number } = {},
  ): Promise<AgentMemory[]> {
    const backend = await this.#ready();
    const limit = clamp(options.limit ?? 20, 1, 100);
    if (!query.trim()) return backend.list(workspaceId, options.category, limit, 0).memories;
    return backend.search(workspaceId, query, options.category, limit);
  }

  /**
   * The memories worth adding to a message: at most three, within 1,500 characters, and only
   * ones that share enough real words with it (small talk brings none).
   */
  async relevant(workspaceId: string, text: string): Promise<AgentMemory[]> {
    const found = (await this.#ready()).relevant(workspaceId, text, AUTO_MEMORY_LIMIT * 3);
    const picked: AgentMemory[] = [];
    let used = 0;
    for (const memory of found) {
      const size = memory.key.length + memory.content.length;
      if (used + size > AUTO_MEMORY_CHARS) {
        if (picked.length > 0) break;
        // One long memory alone is cut to fit.
        picked.push({
          ...memory,
          content: `${memory.content.slice(0, Math.max(0, AUTO_MEMORY_CHARS - memory.key.length - 1))}…`,
        });
        break;
      }
      picked.push(memory);
      used += size;
      if (picked.length >= AUTO_MEMORY_LIMIT) break;
    }
    return picked;
  }

  /** Saves by id (the owner editing) or by key in the workspace (no duplicates). */
  async save(entry: MemoryEntry): Promise<AgentMemory> {
    const key = entry.key.trim().replace(/\s+/g, " ").slice(0, 120);
    const content = entry.content.trim().slice(0, 8_000);
    if (!key || !content) throw new Error("A memory needs a key and content.");
    if (!entry.workspaceId) throw new Error("A memory belongs to a workspace.");
    return (await this.#ready()).save({
      ...entry,
      key,
      content,
      category: memoryCategory(entry.category),
      tags: cleanTags(Array.isArray(entry.tags) ? entry.tags : []),
    });
  }

  /** Deletes a memory; with a workspace, only one of that workspace. */
  async delete(id: string, workspaceId?: string): Promise<boolean> {
    return (await this.#ready()).delete(id, workspaceId);
  }

  /** Adds chat messages to the recall index (no-op without SQLite). */
  async recordMessages(messages: RecallMessage[]): Promise<void> {
    (await this.#ready()).recordMessages(messages);
  }

  /**
   * Messages of these coworkers containing every word, newest first; null when there is no
   * index (the caller then searches the chats it has in memory).
   */
  async recall(botIds: string[], words: string[], limit: number): Promise<RecallHit[] | null> {
    return (await this.#ready()).recall(botIds, words, limit);
  }

  close(): void {
    this.#backend?.close();
    this.#backend = null;
    this.#opening = null;
  }

  async #ready(): Promise<MemoryBackend> {
    if (this.#backend) return this.#backend;
    this.#opening ??= this.#open().then((backend) => {
      this.#backend = backend;
      return backend;
    });
    return this.#opening;
  }

  async #open(): Promise<MemoryBackend> {
    const jsonPath = join(this.#userDataPath, MEMORY_FILE_NAME);
    if (this.#options.sqlite !== false) {
      try {
        const folder = join(this.#userDataPath, MEMORY_DB_FOLDER);
        mkdirSync(folder, { recursive: true });
        const db = new MemoryDb(join(folder, MEMORY_DB_FILE));
        try {
          await this.#importJson(db, jsonPath);
        } catch (error) {
          db.close();
          throw error;
        }
        return new SqliteBackend(db);
      } catch (error) {
        this.#log(
          "error",
          `team memory database unavailable, using ${MEMORY_FILE_NAME}: ${String(error)}`,
        );
      }
    }
    return JsonBackend.open(jsonPath, this.#options, (level, line) => this.#log(level, line));
  }

  /** The one-time move of smriti-memory.json into SQLite. */
  async #importJson(db: MemoryDb, jsonPath: string): Promise<void> {
    if (db.getMeta("json-imported")) return;
    let raw: string;
    try {
      raw = await readFile(jsonPath, "utf8");
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        db.setMeta("json-imported", new Date().toISOString());
        return;
      }
      throw error;
    }
    let list: unknown;
    try {
      list = JSON.parse(raw);
      if (!Array.isArray(list)) throw new Error("not a list");
    } catch (error) {
      // Left exactly as it is; the next start tries again. New memories go to SQLite.
      this.#log("error", `${MEMORY_FILE_NAME} is damaged and was not imported: ${String(error)}`);
      return;
    }
    const entries = list
      .filter(isStoredMemory)
      .sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    db.transaction(() => {
      for (const item of entries) {
        const workspaceId =
          (item.authorBotId ? this.#options.workspaceOfBot?.(item.authorBotId) : undefined) ??
          this.#options.activeWorkspace?.() ??
          "default";
        db.upsert(
          {
            workspaceId,
            key: item.key.trim().slice(0, 120) || "Note",
            content: item.content,
            category: memoryCategory(item.category),
            tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [],
            authorBotId: item.authorBotId,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
          () => (typeof item.id === "string" && !db.get(item.id) ? item.id : randomUUID()),
        );
      }
      db.setMeta("json-imported", new Date().toISOString());
    });
    await rename(jsonPath, await freeName(`${jsonPath}.bak`)).catch((error: unknown) => {
      this.#log("warn", `${MEMORY_FILE_NAME} imported but not renamed: ${String(error)}`);
    });
    this.#log("warn", `team memory: ${entries.length} memories moved into ${MEMORY_DB_FILE}`);
  }

  #log(level: "warn" | "error", line: string): void {
    this.#options.log?.(level, line);
  }
}

class SqliteBackend implements MemoryBackend {
  readonly kind = "sqlite" as const;
  readonly #db: MemoryDb;

  constructor(db: MemoryDb) {
    this.#db = db;
  }

  list(
    workspaceId: string,
    category: string | undefined,
    limit: number,
    offset: number,
  ): MemoryPage {
    return {
      memories: this.#db.list(workspaceId, { category, limit, offset }).map(publicMemory),
      total: this.#db.count(workspaceId, category),
      offset,
    };
  }

  search(
    workspaceId: string,
    query: string,
    category: string | undefined,
    limit: number,
  ): AgentMemory[] {
    const match = matchFromTerms(contentTerms(query)) ?? matchFromTerms(queryWords(query));
    if (!match) return [];
    return this.#db.search(workspaceId, match, { category, limit }).map(publicMemory);
  }

  relevant(workspaceId: string, text: string, limit: number): AgentMemory[] {
    const terms = contentTerms(text);
    const match = matchFromTerms(terms);
    if (!match) return [];
    const hits = this.#db.search(workspaceId, match, { limit });
    const best = hits[0] ? -hits[0].rank : 0;
    return hits
      .filter((hit) =>
        passesGroundingFloor(
          terms,
          `${hit.key} ${hit.content} ${hit.tags.join(" ")}`,
          -hit.rank,
          best,
        ),
      )
      .map(publicMemory);
  }

  async save(
    entry: MemoryEntry & { category: AgentMemoryCategory; tags: string[] },
  ): Promise<AgentMemory> {
    if (entry.id) {
      const existing = this.#db.get(entry.id);
      if (existing && existing.workspaceId !== entry.workspaceId) {
        throw new Error("That memory belongs to another workspace.");
      }
    }
    return publicMemory(this.#db.upsert(entry, randomUUID));
  }

  async delete(id: string, workspaceId: string | undefined): Promise<boolean> {
    const existing = this.#db.get(id);
    if (!existing || (workspaceId && existing.workspaceId !== workspaceId)) return false;
    return this.#db.delete(id);
  }

  recordMessages(messages: RecallMessage[]): void {
    this.#db.recordMessages(messages);
  }

  recall(botIds: string[], words: string[], limit: number): RecallMessage[] {
    const parts = words.map((word) => `"${word.replace(/"/g, '""')}"*`);
    if (parts.length === 0) return [];
    return this.#db.recall(botIds, parts.join(" AND "), limit);
  }

  close(): void {
    this.#db.close();
  }
}

/** The old JSON file, now written atomically and scoped by workspace. */
class JsonBackend implements MemoryBackend {
  readonly kind = "json" as const;
  readonly #file: JsonFile<AgentMemory[]>;
  readonly #memories = new Map<string, AgentMemory & { workspaceId: string }>();
  /** Set when the file could not be parsed: nothing is written over it. */
  #readOnlyReason: string | null = null;

  private constructor(path: string) {
    this.#file = new JsonFile<AgentMemory[]>(path);
  }

  static async open(
    path: string,
    options: MemoryStoreOptions,
    log: (level: "warn" | "error", line: string) => void,
  ): Promise<JsonBackend> {
    const backend = new JsonBackend(path);
    try {
      const list = await backend.#file.read(() => [], isMemoryList);
      for (const item of list.filter(isStoredMemory)) {
        const workspaceId =
          item.workspaceId ??
          (item.authorBotId ? options.workspaceOfBot?.(item.authorBotId) : undefined) ??
          options.activeWorkspace?.() ??
          "default";
        backend.#memories.set(item.id, {
          ...item,
          category: memoryCategory(item.category),
          tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === "string") : [],
          workspaceId,
        });
      }
    } catch (error) {
      const copy = await freeName(`${path}.corrupt.bak`);
      await copyFile(path, copy).catch(() => undefined);
      backend.#readOnlyReason = `Team memory is read-only: ${MEMORY_FILE_NAME} could not be read (a copy is kept at ${copy}).`;
      log("error", `${backend.#readOnlyReason} ${String(error)}`);
    }
    return backend;
  }

  #inWorkspace(workspaceId: string, category?: string) {
    return [...this.#memories.values()]
      .filter((m) => m.workspaceId === workspaceId && (!category || m.category === category))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  list(
    workspaceId: string,
    category: string | undefined,
    limit: number,
    offset: number,
  ): MemoryPage {
    const all = this.#inWorkspace(workspaceId, category);
    return { memories: all.slice(offset, offset + limit), total: all.length, offset };
  }

  search(
    workspaceId: string,
    query: string,
    category: string | undefined,
    limit: number,
  ): AgentMemory[] {
    const terms = queryWords(query);
    if (terms.length === 0) return [];
    return this.#inWorkspace(workspaceId, category)
      .map((m) => ({ m, n: countWords(terms, m) }))
      .filter((entry) => entry.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, limit)
      .map((entry) => entry.m);
  }

  relevant(workspaceId: string, text: string, limit: number): AgentMemory[] {
    const terms = contentTerms(text);
    if (terms.length === 0) return [];
    return this.#inWorkspace(workspaceId)
      .filter((m) => passesGroundingFloor(terms, `${m.key} ${m.content} ${m.tags.join(" ")}`, 1, 1))
      .slice(0, limit);
  }

  async save(
    entry: MemoryEntry & { category: AgentMemoryCategory; tags: string[] },
  ): Promise<AgentMemory> {
    if (this.#readOnlyReason) throw new Error(this.#readOnlyReason);
    const now = new Date().toISOString();
    const byId = entry.id ? this.#memories.get(entry.id) : undefined;
    if (byId && byId.workspaceId !== entry.workspaceId) {
      throw new Error("That memory belongs to another workspace.");
    }
    const byKey = [...this.#memories.values()].find(
      (m) => m.workspaceId === entry.workspaceId && normalizeKey(m.key) === normalizeKey(entry.key),
    );
    const existing = byId ?? byKey;
    if (byId && byKey && byKey.id !== byId.id) this.#memories.delete(byKey.id);
    const memory = {
      id: existing?.id ?? entry.id ?? randomUUID(),
      workspaceId: entry.workspaceId,
      category: entry.category,
      key: entry.key,
      content: entry.content,
      ...((entry.authorBotId ?? existing?.authorBotId)
        ? { authorBotId: entry.authorBotId ?? existing?.authorBotId }
        : {}),
      tags: entry.tags,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.#memories.set(memory.id, memory);
    await this.#file.write([...this.#memories.values()]);
    return memory;
  }

  async delete(id: string, workspaceId: string | undefined): Promise<boolean> {
    if (this.#readOnlyReason) throw new Error(this.#readOnlyReason);
    const existing = this.#memories.get(id);
    if (!existing || (workspaceId && existing.workspaceId !== workspaceId)) return false;
    this.#memories.delete(id);
    await this.#file.write([...this.#memories.values()]);
    return true;
  }

  recordMessages(): void {
    /* no recall index without SQLite */
  }

  recall(): null {
    return null;
  }

  close(): void {
    /* nothing open */
  }
}

function publicMemory(row: MemoryRow): AgentMemory {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    category: row.category,
    key: row.key,
    content: row.content,
    ...(row.authorBotId ? { authorBotId: row.authorBotId } : {}),
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function memoryCategory(value: unknown): AgentMemoryCategory {
  return value === "architecture" || value === "preference" || value === "decision"
    ? value
    : "fact";
}

/** Every word of an explicit search, small talk included (the coworker chose them). */
function queryWords(query: string): string[] {
  return [...query.normalize("NFC").matchAll(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’._-]*/gu)]
    .map((match) => match[0])
    .filter((word) => word.length >= 2)
    .slice(0, 12);
}

function countWords(terms: string[], memory: AgentMemory): number {
  const text = `${memory.key} ${memory.content} ${memory.tags.join(" ")}`.toLowerCase();
  return terms.filter((term) => text.includes(term.toLowerCase())).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function isStoredMemory(value: unknown): value is AgentMemory {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.key === "string" &&
    typeof value.content === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.createdAt === "string"
  );
}

function isMemoryList(value: unknown): value is AgentMemory[] {
  return Array.isArray(value);
}

/** `path`, or `path.1`, `path.2`… whichever does not exist yet. */
async function freeName(path: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? path : `${path}.${attempt}`;
    try {
      await access(candidate);
    } catch {
      return candidate;
    }
  }
  return `${path}.${Date.now()}`;
}
