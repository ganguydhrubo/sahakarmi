import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentEvent } from "../../shared/ipc";
import type { KnowledgeWorkerMessage, KnowledgeWorkerRequest } from "./knowledge-api";
import { KnowledgeHost, type WorkerChild } from "./knowledge-host";
import { runKnowledgeWorker } from "./knowledge-worker-core";

let tmp: string;
let host: KnowledgeHost | null;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sahkarmi-knowledge-host-"));
  host = null;
});

afterEach(async () => {
  host?.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A worker in this process behind a message channel shaped like Electron's utility process. */
function fakeFork(log: { forks: number; children: FakeChild[] }) {
  return (): WorkerChild => {
    log.forks += 1;
    const child = new FakeChild();
    log.children.push(child);
    return child;
  };
}

class FakeChild implements WorkerChild {
  #toHost: Array<(message: unknown) => void> = [];
  #onExit: Array<(code: number) => void> = [];
  #toWorker: Array<(message: { data: unknown }) => void> = [];
  dead = false;

  constructor() {
    runKnowledgeWorker(
      {
        postMessage: (message: KnowledgeWorkerMessage) => {
          if (this.dead) return;
          setImmediate(() => {
            for (const listener of this.#toHost) listener(structuredClone(message));
          });
        },
        on: (_event, listener) => {
          this.#toWorker.push(listener);
        },
      },
      (code) => this.exit(code),
    );
  }

  postMessage(message: KnowledgeWorkerRequest): void {
    if (this.dead) throw new Error("dead");
    setImmediate(() => {
      for (const listener of this.#toWorker) listener({ data: structuredClone(message) });
    });
  }

  on(event: "message" | "exit", listener: (value: never) => void): this {
    if (event === "message") this.#toHost.push(listener as (message: unknown) => void);
    else this.#onExit.push(listener as (code: number) => void);
    return this;
  }

  kill(): boolean {
    this.exit(1);
    return true;
  }

  exit(code: number): void {
    if (this.dead) return;
    this.dead = true;
    // A real crash frees the worker's files; here its service is closed instead.
    for (const listener of this.#toWorker) listener({ data: { kind: "close" } });
    for (const listener of this.#onExit) listener(code);
  }
}

async function docs(): Promise<string> {
  const folder = join(tmp, "docs");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "rent.md"), "# Rent\n\nThe late fee is 500 rupees.\n");
  return folder;
}

const bot = { id: "asha", workspaceId: "shop" };

describe("KnowledgeHost", () => {
  it("runs Knowledge in the worker and mirrors the bases for synchronous reads", async () => {
    const log = { forks: 0, children: [] as FakeChild[] };
    host = new KnowledgeHost(join(tmp, "user-data"), { fork: fakeFork(log) });
    const events: AgentEvent[] = [];
    const lines: string[] = [];
    host.on("event", (event: AgentEvent) => events.push(event));
    host.on("log", (line: string) => lines.push(line));
    await host.initialize();
    expect(host.mode).toBe("worker");
    expect(host.capabilities?.fts5).toBe(true);
    expect(lines.some((line) => line.includes("FTS5 ok"))).toBe(true);

    const [base] = await host.create({ name: "Docs", workspaceId: "shop" });
    await host.addFolder(base?.id ?? "", await docs());
    await host.idle();
    const hits = await host.searchForBot(bot, "late fee");
    expect(hits[0]?.citation.fileName).toBe("rent.md");
    const section = await host.readSection(base?.id ?? "", hits[0]?.citation.documentId ?? "");
    expect(section.fileName).toBe("rent.md");
    expect(host.basesForBot(bot).map((b) => b.name)).toEqual(["Docs"]);
    expect(host.basesForBot({ id: "asha", workspaceId: "other" })).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(events.some((event) => event.type === "knowledge-changed")).toBe(true);
    expect(host.list()[0]?.sources[0]?.status).toBe("ready");
    await expect(host.readSection("kb-missing", "x")).rejects.toThrow(/Unknown knowledge base/);
  });

  it("restarts a crashed worker, then falls back to this process, with the same files", async () => {
    const log = { forks: 0, children: [] as FakeChild[] };
    const userData = join(tmp, "user-data");
    host = new KnowledgeHost(userData, { fork: fakeFork(log), maxRestarts: 1 });
    await host.initialize();
    const [base] = await host.create({ name: "Docs", workspaceId: "shop" });
    await host.addFolder(base?.id ?? "", await docs());
    await host.idle();

    log.children.at(-1)?.exit(3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(log.forks).toBe(2);
    expect(host.mode).toBe("worker");
    expect((await host.searchForBot(bot, "late fee")).length).toBe(1);

    log.children.at(-1)?.exit(3);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(host.mode).toBe("local");
    expect((await host.searchForBot(bot, "late fee")).length).toBe(1);
    expect(host.list()).toHaveLength(1);
  });

  it("uses this process when the worker cannot start", async () => {
    host = new KnowledgeHost(join(tmp, "user-data"), {
      fork: () => {
        throw new Error("no utility process here");
      },
    });
    await host.initialize();
    expect(host.mode).toBe("local");
    const [base] = await host.create({ name: "Docs", workspaceId: "shop" });
    expect(base?.name).toBe("Docs");
    expect(host.basesForBot(bot)).toHaveLength(1);
  });

  it("falls back when the worker never answers", async () => {
    host = new KnowledgeHost(join(tmp, "user-data"), {
      readyTimeoutMs: 100,
      fork: () =>
        ({
          postMessage: () => undefined,
          on: () => undefined,
          kill: () => true,
        }) as WorkerChild,
    });
    await host.initialize();
    expect(host.mode).toBe("local");
  });
});
