import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AgentMemory, AgentMemoryCategory } from "../../shared/ipc";

/**
 * Team memory and chat recall in one SQLite file (`memory/memory.sqlite` under userData),
 * through the same built-in `node:sqlite` engine as the Knowledge Bases.
 *
 * - `memories`: one row per remembered fact, scoped to a workspace, unique by its key there
 *   (saving the same key again updates it instead of adding a duplicate).
 * - `memory_tags`: the tags of each memory, for filtering and search.
 * - `memories_fts`: FTS5 over key, content and tags (porter + unicode61, like Knowledge), so
 *   "invoices" finds "invoice" in English, Hindi or Bengali text.
 * - `recall_messages` + `recall_fts`: chat messages already seen by the app, so a coworker's
 *   search of past chats is one index lookup instead of reading every chat (and never needs to
 *   wake an AI that is asleep).
 */

const SCHEMA_VERSION = 1;
/** Longer messages are cut before they are indexed; the search shows an excerpt anyway. */
const RECALL_TEXT_LIMIT = 20_000;

export interface MemoryRow extends AgentMemory {
  workspaceId: string;
}

export interface MemoryWrite {
  workspaceId: string;
  key: string;
  content: string;
  category: AgentMemoryCategory;
  tags: string[];
  authorBotId?: string;
  /** When given, the memory with this id is updated (the owner editing it). */
  id?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MemoryHit extends MemoryRow {
  /** bm25 rank: lower is better. */
  rank: number;
}

export interface RecallMessage {
  messageId: string;
  botId: string;
  author: string;
  createdAt: string;
  text: string;
}

export class MemoryDb {
  readonly #db: DatabaseSync;
  readonly path: string;
  #inTransaction = false;

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
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        key TEXT NOT NULL,
        key_norm TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        author_bot_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, key_norm)
      );
      CREATE INDEX IF NOT EXISTS memories_by_workspace ON memories(workspace_id, updated_at);
      CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (memory_id, tag)
      );
      CREATE INDEX IF NOT EXISTS memory_tags_by_tag ON memory_tags(tag);
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        key, content, tags,
        content='memories', content_rowid='seq',
        tokenize='porter unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS memories_after_insert AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, key, content, tags)
        VALUES (new.seq, new.key, new.content, new.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_after_delete AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, content, tags)
        VALUES ('delete', old.seq, old.key, old.content, old.tags);
      END;
      CREATE TRIGGER IF NOT EXISTS memories_after_update AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, key, content, tags)
        VALUES ('delete', old.seq, old.key, old.content, old.tags);
        INSERT INTO memories_fts(rowid, key, content, tags)
        VALUES (new.seq, new.key, new.content, new.tags);
      END;
      CREATE TABLE IF NOT EXISTS recall_messages (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        bot_id TEXT NOT NULL,
        author TEXT NOT NULL,
        created_at TEXT NOT NULL,
        text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS recall_by_bot ON recall_messages(bot_id, created_at);
      CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5(
        text,
        content='recall_messages', content_rowid='seq',
        tokenize='porter unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS recall_after_insert AFTER INSERT ON recall_messages BEGIN
        INSERT INTO recall_fts(rowid, text) VALUES (new.seq, new.text);
      END;
      CREATE TRIGGER IF NOT EXISTS recall_after_delete AFTER DELETE ON recall_messages BEGIN
        INSERT INTO recall_fts(recall_fts, rowid, text) VALUES ('delete', old.seq, old.text);
      END;
      CREATE TRIGGER IF NOT EXISTS recall_after_update AFTER UPDATE OF text ON recall_messages BEGIN
        INSERT INTO recall_fts(recall_fts, rowid, text) VALUES ('delete', old.seq, old.text);
        INSERT INTO recall_fts(rowid, text) VALUES (new.seq, new.text);
      END;
    `);
    this.setMeta("schema", String(SCHEMA_VERSION));
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

  close(): void {
    this.#db.close();
  }

  /** Runs `work` in one transaction (all rows or none); a nested call joins the outer one. */
  transaction<T>(work: () => T): T {
    if (this.#inTransaction) return work();
    this.#db.exec("BEGIN IMMEDIATE");
    this.#inTransaction = true;
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    } finally {
      this.#inTransaction = false;
    }
  }

  // ---- memories ----

  count(workspaceId: string, category?: string): number {
    const row = (
      category
        ? this.#db
            .prepare("SELECT count(*) AS n FROM memories WHERE workspace_id = ? AND category = ?")
            .get(workspaceId, category)
        : this.#db
            .prepare("SELECT count(*) AS n FROM memories WHERE workspace_id = ?")
            .get(workspaceId)
    ) as { n: number };
    return Number(row.n);
  }

  list(
    workspaceId: string,
    options: { category?: string; limit?: number; offset?: number } = {},
  ): MemoryRow[] {
    const conditions = ["workspace_id = ?"];
    const values: SQLInputValue[] = [workspaceId];
    if (options.category) {
      conditions.push("category = ?");
      values.push(options.category);
    }
    values.push(Math.max(1, Math.min(options.limit ?? 50, 500)), Math.max(0, options.offset ?? 0));
    const rows = this.#db
      .prepare(
        `SELECT * FROM memories WHERE ${conditions.join(" AND ")}
         ORDER BY updated_at DESC, seq DESC LIMIT ? OFFSET ?`,
      )
      .all(...values) as unknown as RawMemory[];
    return rows.map(memoryFromRaw);
  }

  get(id: string): MemoryRow | null {
    const row = this.#db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as
      | RawMemory
      | undefined;
    return row ? memoryFromRaw(row) : null;
  }

  findByKey(workspaceId: string, key: string): MemoryRow | null {
    const row = this.#db
      .prepare("SELECT * FROM memories WHERE workspace_id = ? AND key_norm = ?")
      .get(workspaceId, normalizeKey(key)) as RawMemory | undefined;
    return row ? memoryFromRaw(row) : null;
  }

  /**
   * Saves a memory: by id when given (the owner editing one), else by key in its workspace, so
   * a coworker saving "Owner language" twice updates the one memory instead of adding another.
   */
  upsert(entry: MemoryWrite, newId: () => string): MemoryRow {
    return this.transaction(() => {
      const now = entry.updatedAt ?? new Date().toISOString();
      const byId = entry.id ? this.get(entry.id) : null;
      const byKey = this.findByKey(entry.workspaceId, entry.key);
      const tags = cleanTags(entry.tags);
      const existing = byId ?? byKey;
      if (byId && byKey && byKey.id !== byId.id) {
        // The owner renamed a memory to the key of another one: the edited one wins.
        this.#db.prepare("DELETE FROM memories WHERE id = ?").run(byKey.id);
      }
      if (existing) {
        this.#db
          .prepare(
            `UPDATE memories SET workspace_id = ?, key = ?, key_norm = ?, category = ?, content = ?,
               tags = ?, author_bot_id = coalesce(?, author_bot_id), updated_at = ? WHERE id = ?`,
          )
          .run(
            entry.workspaceId,
            entry.key,
            normalizeKey(entry.key),
            entry.category,
            entry.content,
            tags.join(" "),
            entry.authorBotId ?? null,
            now,
            existing.id,
          );
        this.#setTags(existing.id, tags);
        const updated = this.get(existing.id);
        if (!updated) throw new Error("The memory was not stored.");
        return updated;
      }
      const id = entry.id ?? newId();
      this.#db
        .prepare(
          `INSERT INTO memories (id, workspace_id, key, key_norm, category, content, tags,
             author_bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          entry.workspaceId,
          entry.key,
          normalizeKey(entry.key),
          entry.category,
          entry.content,
          tags.join(" "),
          entry.authorBotId ?? null,
          entry.createdAt ?? now,
          now,
        );
      this.#setTags(id, tags);
      const stored = this.get(id);
      if (!stored) throw new Error("The memory was not stored.");
      return stored;
    });
  }

  #setTags(memoryId: string, tags: string[]): void {
    this.#db.prepare("DELETE FROM memory_tags WHERE memory_id = ?").run(memoryId);
    const insert = this.#db.prepare(
      "INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)",
    );
    for (const tag of tags) insert.run(memoryId, tag.toLowerCase());
  }

  delete(id: string): boolean {
    const result = this.#db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  /** BM25 over one workspace's memories. `match` is built by memory-search (never raw text). */
  search(
    workspaceId: string,
    match: string,
    options: { category?: string; limit?: number } = {},
  ): MemoryHit[] {
    const conditions = ["memories_fts MATCH ?", "m.workspace_id = ?"];
    const values: SQLInputValue[] = [match, workspaceId];
    if (options.category) {
      conditions.push("m.category = ?");
      values.push(options.category);
    }
    values.push(Math.max(1, Math.min(options.limit ?? 20, 200)));
    const rows = this.#db
      .prepare(
        `SELECT m.*, bm25(memories_fts, 3.0, 1.0, 2.0) AS rank
         FROM memories_fts JOIN memories m ON m.seq = memories_fts.rowid
         WHERE ${conditions.join(" AND ")} ORDER BY rank LIMIT ?`,
      )
      .all(...values) as unknown as Array<RawMemory & { rank: number }>;
    return rows.map((row) => ({ ...memoryFromRaw(row), rank: Number(row.rank) }));
  }

  // ---- chat recall ----

  /** Adds or refreshes messages in the recall index (a message's text can still grow). */
  recordMessages(messages: RecallMessage[]): number {
    if (messages.length === 0) return 0;
    return this.transaction(() => {
      const upsert = this.#db.prepare(
        `INSERT INTO recall_messages (message_id, bot_id, author, created_at, text)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET text = excluded.text
         WHERE recall_messages.text <> excluded.text`,
      );
      let changed = 0;
      for (const message of messages) {
        const result = upsert.run(
          message.messageId,
          message.botId,
          message.author,
          message.createdAt,
          message.text.slice(0, RECALL_TEXT_LIMIT),
        );
        changed += Number(result.changes);
      }
      return changed;
    });
  }

  /** Messages of these coworkers that match `match` (an FTS5 AND expression), newest first. */
  recall(botIds: string[], match: string, limit: number): RecallMessage[] {
    if (botIds.length === 0) return [];
    const rows = this.#db
      .prepare(
        `SELECT r.message_id, r.bot_id, r.author, r.created_at, r.text
         FROM recall_fts JOIN recall_messages r ON r.seq = recall_fts.rowid
         WHERE recall_fts MATCH ? AND r.bot_id IN (${botIds.map(() => "?").join(", ")})
         ORDER BY r.created_at DESC LIMIT ?`,
      )
      .all(match, ...botIds, Math.max(1, Math.min(limit, 100))) as unknown as Array<{
      message_id: string;
      bot_id: string;
      author: string;
      created_at: string;
      text: string;
    }>;
    return rows.map((row) => ({
      messageId: row.message_id,
      botId: row.bot_id,
      author: row.author,
      createdAt: row.created_at,
      text: row.text,
    }));
  }

  recallCount(): number {
    const row = this.#db.prepare("SELECT count(*) AS n FROM recall_messages").get() as {
      n: number;
    };
    return Number(row.n);
  }
}

interface RawMemory {
  id: string;
  workspace_id: string;
  key: string;
  category: string;
  content: string;
  tags: string;
  author_bot_id: string | null;
  created_at: string;
  updated_at: string;
}

function memoryFromRaw(row: RawMemory): MemoryRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    key: row.key,
    category: row.category as AgentMemoryCategory,
    content: row.content,
    tags: row.tags ? row.tags.split(" ").filter(Boolean) : [],
    ...(row.author_bot_id ? { authorBotId: row.author_bot_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** "Owner  Language " and "owner language" are the same memory. */
export function normalizeKey(key: string): string {
  return key.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Tags are single words in the index: "hindi docs" becomes "hindi-docs". */
export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw).trim().replace(/\s+/g, "-").slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}
