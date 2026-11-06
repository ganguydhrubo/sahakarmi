import { EventEmitter } from "node:events";
import type {
  AgentEvent,
  BotSummary,
  CreateKnowledgeBaseInput,
  KnowledgeBaseSummary,
  KnowledgeHit,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  KnowledgeSemanticStatus,
  UpdateKnowledgeBaseInput,
} from "../../shared/ipc";
import type {
  KnowledgeApi,
  KnowledgeWorkerMessage,
  KnowledgeWorkerMethod,
  KnowledgeWorkerRequest,
} from "./knowledge-api";
import { type Grounding, KnowledgeService, type SectionRead } from "./knowledge-service";
import { type SqliteCapabilities, sqliteCapabilities } from "./sqlite-capabilities";

/** The parts of Electron's UtilityProcess the host uses (a fake one in tests). */
export interface WorkerChild {
  postMessage(message: KnowledgeWorkerRequest): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): boolean;
}

export interface KnowledgeHostOptions {
  /** Starts the worker; when missing or failing, Knowledge runs in this process. */
  fork?: () => WorkerChild;
  readyTimeoutMs?: number;
  /** Restarts after a crash before falling back to this process. */
  maxRestarts?: number;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * The main process side of the Knowledge Bases. Every call goes to a utility process that owns
 * the databases, so reading, indexing and searching never block the window. The list of bases
 * is mirrored here (from each answer and change event) for the synchronous reads coworker
 * instructions need. If the worker cannot start, or keeps crashing, the same KnowledgeService
 * runs in this process instead: the same files, so existing bases keep working either way.
 */
export class KnowledgeHost extends EventEmitter implements KnowledgeApi {
  readonly #userDataPath: string;
  readonly #options: KnowledgeHostOptions;
  #child: WorkerChild | null = null;
  #local: KnowledgeService | null = null;
  #bases: KnowledgeBaseSummary[] = [];
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #restarts = 0;
  #closed = false;
  #initializing: Promise<void> | null = null;
  #capabilities: SqliteCapabilities | null = null;

  constructor(userDataPath: string, options: KnowledgeHostOptions = {}) {
    super();
    this.#userDataPath = userDataPath;
    this.#options = options;
  }

  /** "worker" while the utility process answers, "local" after the fallback. */
  get mode(): "worker" | "local" | "starting" {
    if (this.#local) return "local";
    return this.#child ? "worker" : "starting";
  }

  get capabilities(): SqliteCapabilities | null {
    return this.#capabilities;
  }

  initialize(): Promise<void> {
    this.#initializing ??= this.#start();
    return this.#initializing;
  }

  async #start(): Promise<void> {
    if (this.#options.fork && (await this.#startWorker())) return;
    await this.#useLocal("the knowledge worker could not start");
  }

  async #startWorker(): Promise<boolean> {
    const fork = this.#options.fork;
    if (!fork || this.#closed) return false;
    let child: WorkerChild;
    try {
      child = fork();
    } catch (error) {
      this.emit("log", `knowledge worker did not start: ${String(error)}`);
      return false;
    }
    let answered = false;
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.emit("log", "knowledge worker did not answer in time");
        resolve(false);
      }, this.#options.readyTimeoutMs ?? 20_000);
      timer.unref?.();
      child.on("message", (raw: unknown) => {
        const message = raw as KnowledgeWorkerMessage;
        if (message?.kind === "ready") {
          clearTimeout(timer);
          answered = true;
          this.#capabilities = message.capabilities;
          this.#bases = message.bases;
          this.#logCapabilities("worker");
          resolve(true);
        } else if (message?.kind === "init-failed") {
          clearTimeout(timer);
          this.emit("log", `knowledge worker failed to open: ${message.error}`);
          resolve(false);
        } else {
          this.#onMessage(message);
        }
      });
      child.on("exit", (code: number) => {
        clearTimeout(timer);
        resolve(false);
        // Before it answered, the start itself reports the failure.
        if (answered) this.#onExit(child, code);
      });
    });
    child.postMessage({ kind: "init", userDataPath: this.#userDataPath });
    this.#child = child;
    if (await ready) return true;
    this.#child = null;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    return false;
  }

  #onMessage(message: KnowledgeWorkerMessage): void {
    if (message?.kind === "result") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error));
    } else if (message?.kind === "event") {
      this.#forward(message.event as AgentEvent);
    } else if (message?.kind === "log") {
      this.emit("log", message.line);
    }
  }

  #onExit(child: WorkerChild, code: number): void {
    if (this.#child !== child) return;
    this.#child = null;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const call of pending) {
      call.reject(new Error("The Knowledge Bases worker stopped; try again."));
    }
    if (this.#closed) return;
    this.emit("log", `knowledge worker exited (code ${code})`);
    const maxRestarts = this.#options.maxRestarts ?? 2;
    void (async () => {
      if (this.#restarts < maxRestarts) {
        this.#restarts += 1;
        if (await this.#startWorker()) {
          this.#forward({ type: "knowledge-changed", bases: this.#bases });
          return;
        }
      }
      await this.#useLocal("the knowledge worker keeps stopping");
    })();
  }

  async #useLocal(reason: string): Promise<void> {
    if (this.#local || this.#closed) return;
    this.emit("log", `knowledge runs in the main process: ${reason}`);
    const local = new KnowledgeService(this.#userDataPath);
    local.on("event", (event: AgentEvent) => this.#forward(event));
    local.on("log", (line: string) => this.emit("log", line));
    this.#local = local;
    this.#capabilities = sqliteCapabilities();
    this.#logCapabilities("main process");
    await local.initialize();
    this.#bases = local.list();
  }

  #logCapabilities(where: string): void {
    const capabilities = this.#capabilities;
    if (!capabilities) return;
    if (!capabilities.fts5) {
      this.emit(
        "log",
        `knowledge search unavailable: SQLite has no FTS5 (${capabilities.error ?? "unknown"})`,
      );
    }
    this.emit(
      "log",
      `knowledge in the ${where}: FTS5 ${capabilities.fts5 ? "ok" : "missing"}, sqlite-vec ${
        capabilities.vecVersion ??
        `not loaded${capabilities.error ? ` (${capabilities.error})` : ""}`
      }`,
    );
  }

  #forward(event: AgentEvent): void {
    if (event?.type === "knowledge-changed") this.#bases = event.bases;
    this.emit("event", event);
  }

  async #call<T>(method: KnowledgeWorkerMethod, ...args: unknown[]): Promise<T> {
    await this.initialize();
    if (this.#closed) throw new Error("Knowledge Bases are closed.");
    if (this.#local) {
      const target = this.#local as unknown as Record<string, (...values: unknown[]) => unknown>;
      return (await target[method]?.apply(this.#local, args)) as T;
    }
    const child = this.#child;
    if (!child) throw new Error("The Knowledge Bases worker is restarting; try again.");
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        child.postMessage({ kind: "call", id, method, args });
      } catch (error) {
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async #mutate(
    method: KnowledgeWorkerMethod,
    ...args: unknown[]
  ): Promise<KnowledgeBaseSummary[]> {
    const bases = await this.#call<KnowledgeBaseSummary[]>(method, ...args);
    this.#bases = bases;
    return bases;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#local?.close();
    const child = this.#child;
    this.#child = null;
    if (child) {
      try {
        child.postMessage({ kind: "close" });
      } catch {
        /* gone */
      }
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* gone */
        }
      }, 1_500);
      timer.unref?.();
    }
    for (const call of this.#pending.values())
      call.reject(new Error("Knowledge Bases are closed."));
    this.#pending.clear();
  }

  // ---- KnowledgeApi ----

  list(): KnowledgeBaseSummary[] {
    return this.#local ? this.#local.list() : this.#bases;
  }

  basesForBot(bot: Pick<BotSummary, "id" | "workspaceId">): KnowledgeBaseSummary[] {
    if (this.#local) return this.#local.basesForBot(bot);
    return this.#bases.filter(
      (base) =>
        base.workspaceId === bot.workspaceId &&
        base.privacy === "coworkers" &&
        (base.botIds.length === 0 || base.botIds.includes(bot.id)),
    );
  }

  create(input: CreateKnowledgeBaseInput) {
    return this.#mutate("create", input);
  }

  update(input: UpdateKnowledgeBaseInput) {
    return this.#mutate("update", input);
  }

  delete(id: string) {
    return this.#mutate("delete", id);
  }

  addFiles(kbId: string, paths: string[]) {
    return this.#mutate("addFiles", kbId, paths);
  }

  addFolder(kbId: string, path: string) {
    return this.#mutate("addFolder", kbId, path);
  }

  removeFolder(kbId: string, folderId: string) {
    return this.#mutate("removeFolder", kbId, folderId);
  }

  removeSource(kbId: string, documentId: string) {
    return this.#mutate("removeSource", kbId, documentId);
  }

  setSourceEnabled(kbId: string, documentId: string, enabled: boolean) {
    return this.#mutate("setSourceEnabled", kbId, documentId, enabled);
  }

  sync(kbId: string) {
    return this.#mutate("sync", kbId);
  }

  search(input: KnowledgeSearchInput, scope: { workspaceId?: string } = {}) {
    return this.#call<KnowledgeSearchResult>("search", input, scope);
  }

  searchForBot(
    bot: Pick<BotSummary, "id" | "workspaceId">,
    query: string,
    options: { limit?: number; kbId?: string } = {},
  ) {
    return this.#call<KnowledgeHit[]>(
      "searchForBot",
      { id: bot.id, workspaceId: bot.workspaceId },
      query,
      options,
    );
  }

  groundingFor(bot: Pick<BotSummary, "id" | "workspaceId">, query: string) {
    return this.#call<Grounding | null>(
      "groundingFor",
      { id: bot.id, workspaceId: bot.workspaceId },
      query,
    );
  }

  readSection(
    kbId: string,
    documentId: string,
    options: { page?: number | null; chunkIndex?: number | null; span?: number } = {},
  ) {
    return this.#call<SectionRead>("readSection", kbId, documentId, options);
  }

  sourcePath(kbId: string, documentId: string) {
    return this.#call<string>("sourcePath", kbId, documentId);
  }

  semanticStatus() {
    return this.#call<KnowledgeSemanticStatus>("semanticStatus");
  }

  installSemantic() {
    return this.#call<KnowledgeSemanticStatus>("installSemantic");
  }

  removeSemantic() {
    return this.#call<KnowledgeSemanticStatus>("removeSemantic");
  }

  /** Waits for indexing to finish (tests and diagnostics). */
  idle(): Promise<void> {
    return this.#call<void>("idle");
  }
}
