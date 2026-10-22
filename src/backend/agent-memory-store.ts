import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMemory } from "../shared/ipc";

const MEMORY_FILE_NAME = "smriti-memory.json";

export class AgentMemoryStore {
  readonly #filePath: string;
  #memories: Map<string, AgentMemory> = new Map();
  #initialized = false;

  constructor(userDataPath: string) {
    this.#filePath = join(userDataPath, MEMORY_FILE_NAME);
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    try {
      const data = await readFile(this.#filePath, "utf-8");
      const list = JSON.parse(data) as AgentMemory[];
      if (Array.isArray(list)) {
        for (const item of list) {
          if (item?.id) this.#memories.set(item.id, item);
        }
      }
    } catch {
      // File does not exist yet; initialize empty
    }
    this.#initialized = true;
  }

  async list(category?: string): Promise<AgentMemory[]> {
    await this.initialize();
    const all = Array.from(this.#memories.values());
    const filtered = category ? all.filter((m) => m.category === category) : all;
    return filtered.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async search(query: string, category?: string): Promise<AgentMemory[]> {
    await this.initialize();
    const q = query.toLowerCase().trim();
    const items = await this.list(category);
    if (!q) return items;
    return items.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  async save(
    entry: Omit<AgentMemory, "id" | "createdAt" | "updatedAt"> & { id?: string },
  ): Promise<AgentMemory> {
    await this.initialize();
    const now = new Date().toISOString();
    const existing = entry.id ? this.#memories.get(entry.id) : undefined;

    const memory: AgentMemory = {
      id: entry.id ?? randomUUID(),
      category: entry.category ?? "fact",
      key: entry.key.trim(),
      content: entry.content.trim(),
      authorBotId: entry.authorBotId,
      tags: Array.isArray(entry.tags) ? entry.tags.map((t) => t.trim()).filter(Boolean) : [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.#memories.set(memory.id, memory);
    await this.#persist();
    return memory;
  }

  async delete(id: string): Promise<boolean> {
    await this.initialize();
    const deleted = this.#memories.delete(id);
    if (deleted) {
      await this.#persist();
    }
    return deleted;
  }

  async #persist(): Promise<void> {
    const list = Array.from(this.#memories.values());
    const json = JSON.stringify(list, null, 2);
    const tempPath = `${this.#filePath}.${Date.now()}.tmp`;
    await mkdir(join(this.#filePath, ".."), { recursive: true });
    await writeFile(tempPath, json, "utf-8");
    await copyFile(tempPath, this.#filePath);
    await unlink(tempPath).catch(() => {});
  }
}
