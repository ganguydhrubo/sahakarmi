import type { AgentEvent } from "../../shared/ipc";
import {
  KNOWLEDGE_WORKER_METHODS,
  type KnowledgeWorkerMessage,
  type KnowledgeWorkerRequest,
} from "./knowledge-api";
import { KnowledgeService } from "./knowledge-service";
import { sqliteCapabilities } from "./sqlite-capabilities";

/** The two ends a worker needs: Electron's parentPort, or a fake one in tests. */
export interface WorkerPort {
  postMessage(message: KnowledgeWorkerMessage): void;
  on(event: "message", listener: (message: { data: unknown }) => void): void;
}

const METHODS = new Set<string>(KNOWLEDGE_WORKER_METHODS);

/**
 * The Knowledge Bases worker: one KnowledgeService (the same database files as before) answering
 * calls from the main process. Extraction, indexing, vectors and search all run here, so a
 * folder of thousands of PDFs never makes the window stutter.
 */
export function runKnowledgeWorker(port: WorkerPort, exit: (code: number) => void): void {
  let service: KnowledgeService | null = null;
  port.on("message", ({ data }) => {
    const request = data as KnowledgeWorkerRequest;
    if (request?.kind === "init") {
      void start(request.userDataPath);
    } else if (request?.kind === "call") {
      void call(request.id, request.method, request.args);
    } else if (request?.kind === "close") {
      service?.close();
      service = null;
      exit(0);
    }
  });

  async function start(userDataPath: string): Promise<void> {
    try {
      const capabilities = sqliteCapabilities();
      const created = new KnowledgeService(userDataPath);
      created.on("event", (event: AgentEvent) => port.postMessage({ kind: "event", event }));
      created.on("log", (line: string) => port.postMessage({ kind: "log", line }));
      await created.initialize();
      service = created;
      port.postMessage({ kind: "ready", capabilities, bases: created.list() });
    } catch (error) {
      port.postMessage({
        kind: "init-failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function call(id: number, method: string, args: unknown[]): Promise<void> {
    try {
      if (!service) throw new Error("Knowledge Bases are not ready.");
      if (!METHODS.has(method)) throw new Error(`Unknown knowledge call: ${method}`);
      const target = service as unknown as Record<string, (...values: unknown[]) => unknown>;
      const value = await target[method]?.apply(service, Array.isArray(args) ? args : []);
      port.postMessage({ kind: "result", id, ok: true, value });
    } catch (error) {
      port.postMessage({
        kind: "result",
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
