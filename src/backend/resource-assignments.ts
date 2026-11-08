import { join } from "node:path";
import {
  type AccessSubject,
  accessAllows,
  EVERYONE_ACCESS,
  normaliseAccess,
  type ResourceAccess,
  type ResourceKind,
} from "../shared/resource-access";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

interface StoredAssignments {
  version: 1;
  /** Keyed "<kind>:<id>"; a resource with no entry is for everyone (as before assignments). */
  entries: Record<string, ResourceAccess>;
}

function isStored(value: unknown): value is StoredAssignments {
  return isRecord(value) && isRecord(value.entries);
}

/**
 * Which coworkers may use each connected app, skill and MCP server, in
 * <userData>/resource-assignments.json. (Web APIs keep their own access in their store.)
 * Read once at start, then from memory, so a coworker's tool list costs no disk reads.
 */
export class ResourceAssignmentStore {
  readonly #file: JsonFile<StoredAssignments>;
  #entries = new Map<string, ResourceAccess>();
  #listeners: ((kind: ResourceKind, id: string) => void)[] = [];

  constructor(userDataPath: string) {
    this.#file = new JsonFile<StoredAssignments>(join(userDataPath, "resource-assignments.json"));
  }

  async initialize(): Promise<void> {
    const stored = await this.#file
      .read(() => ({ version: 1, entries: {} }), isStored)
      .catch(() => ({ version: 1 as const, entries: {} }));
    this.#entries = new Map(
      Object.entries(stored.entries).map(([key, value]) => [key, normaliseAccess(value)]),
    );
  }

  /** Called after an assignment changes, so coworkers can be given their new tools. */
  onChanged(listener: (kind: ResourceKind, id: string) => void): void {
    this.#listeners.push(listener);
  }

  /** The owner's choice, or null when there is none (the resource is for everyone). */
  get(kind: ResourceKind, id: string): ResourceAccess | null {
    const entry = this.#entries.get(`${kind}:${id}`);
    return entry ? { ...entry } : null;
  }

  list(): { kind: ResourceKind; id: string; access: ResourceAccess }[] {
    return [...this.#entries.entries()].map(([key, access]) => {
      const at = key.indexOf(":");
      return { kind: key.slice(0, at) as ResourceKind, id: key.slice(at + 1), access };
    });
  }

  /** Saves who may use it; null (or "everyone") removes the entry: everyone again. */
  async set(kind: ResourceKind, id: string, access: ResourceAccess | null): Promise<void> {
    const key = `${kind}:${id}`;
    const value = access ? normaliseAccess(access) : null;
    if (!value || value.everyone) this.#entries.delete(key);
    else this.#entries.set(key, value);
    await this.#file.write({ version: 1, entries: Object.fromEntries(this.#entries) });
    for (const listener of this.#listeners) listener(kind, id);
  }

  allows(kind: ResourceKind, id: string, subject: AccessSubject): boolean {
    return accessAllows(this.#entries.get(`${kind}:${id}`) ?? EVERYONE_ACCESS, subject);
  }
}
