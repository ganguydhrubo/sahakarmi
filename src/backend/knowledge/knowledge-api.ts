import type { EventEmitter } from "node:events";
import type {
  BotSummary,
  CreateKnowledgeBaseInput,
  KnowledgeBaseSummary,
  KnowledgeHit,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSemanticStatus,
  UpdateKnowledgeBaseInput,
} from "../../shared/ipc";
import type { Grounding, SectionRead } from "./knowledge-service";
import type { SqliteCapabilities } from "./sqlite-capabilities";

/**
 * What the app and the coworkers use of the Knowledge Bases. KnowledgeService implements it in
 * the process that owns the databases; KnowledgeHost implements it in the main process by
 * calling a KnowledgeService in a utility process (so indexing never blocks the window), or an
 * in-process one when that process cannot start. Both emit "event" (AgentEvent) and "log".
 */
export interface KnowledgeApi extends EventEmitter {
  initialize(): Promise<void>;
  close(): void;
  list(): KnowledgeBaseSummary[];
  basesForBot(bot: Pick<BotSummary, "id" | "workspaceId">): KnowledgeBaseSummary[];
  create(input: CreateKnowledgeBaseInput): Promise<KnowledgeBaseSummary[]>;
  update(input: UpdateKnowledgeBaseInput): Promise<KnowledgeBaseSummary[]>;
  delete(id: string): Promise<KnowledgeBaseSummary[]>;
  addFiles(kbId: string, paths: string[]): Promise<KnowledgeBaseSummary[]>;
  addFolder(kbId: string, path: string): Promise<KnowledgeBaseSummary[]>;
  removeFolder(kbId: string, folderId: string): Promise<KnowledgeBaseSummary[]>;
  removeSource(kbId: string, documentId: string): Promise<KnowledgeBaseSummary[]>;
  setSourceEnabled(
    kbId: string,
    documentId: string,
    enabled: boolean,
  ): Promise<KnowledgeBaseSummary[]>;
  sync(kbId: string): Promise<KnowledgeBaseSummary[]>;
  search(
    input: KnowledgeSearchInput,
    scope?: { workspaceId?: string },
  ): Promise<KnowledgeSearchResult>;
  searchForBot(
    bot: Pick<BotSummary, "id" | "workspaceId">,
    query: string,
    options?: { limit?: number; kbId?: string },
  ): Promise<KnowledgeHit[]>;
  groundingFor(
    bot: Pick<BotSummary, "id" | "workspaceId">,
    query: string,
  ): Promise<Grounding | null>;
  readSection(
    kbId: string,
    documentId: string,
    options?: { page?: number | null; chunkIndex?: number | null; span?: number },
  ): SectionRead | Promise<SectionRead>;
  sourcePath(kbId: string, documentId: string): string | Promise<string>;
  semanticStatus(): Promise<KnowledgeSemanticStatus>;
  installSemantic(): Promise<KnowledgeSemanticStatus>;
  removeSemantic(): Promise<KnowledgeSemanticStatus>;
}

/** Methods the worker answers (everything async, plus the synchronous reads made async). */
export const KNOWLEDGE_WORKER_METHODS = [
  "list",
  "create",
  "update",
  "delete",
  "addFiles",
  "addFolder",
  "removeFolder",
  "removeSource",
  "setSourceEnabled",
  "sync",
  "search",
  "searchForBot",
  "groundingFor",
  "readSection",
  "sourcePath",
  "semanticStatus",
  "installSemantic",
  "removeSemantic",
  "idle",
] as const;

export type KnowledgeWorkerMethod = (typeof KNOWLEDGE_WORKER_METHODS)[number];

/** Main process to worker. */
export type KnowledgeWorkerRequest =
  | { kind: "init"; userDataPath: string }
  | { kind: "call"; id: number; method: KnowledgeWorkerMethod; args: unknown[] }
  | { kind: "close" };

/** Worker to main process. */
export type KnowledgeWorkerMessage =
  | { kind: "ready"; capabilities: SqliteCapabilities; bases: KnowledgeBaseSummary[] }
  | { kind: "init-failed"; error: string }
  | { kind: "result"; id: number; ok: true; value: unknown }
  | { kind: "result"; id: number; ok: false; error: string }
  | { kind: "event"; event: unknown }
  | { kind: "log"; line: string };
