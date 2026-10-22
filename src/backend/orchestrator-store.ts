import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  AgentCollaborationMessage,
  AgentExecutionInstance,
  OrchestratorRun,
  OrchestratorTask,
} from "../shared/ipc";

interface StoredOrchestratorState {
  version: 1;
  runs: OrchestratorRun[];
}

const DEFAULT_STATE: StoredOrchestratorState = {
  version: 1,
  runs: [],
};

export class OrchestratorStore {
  readonly #statePath: string;
  #state: StoredOrchestratorState = { ...DEFAULT_STATE };
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataRoot: string) {
    this.#statePath = join(userDataRoot, "orchestrator-state.json");
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.#statePath), { recursive: true });
    try {
      const content = await readFile(this.#statePath, "utf8");
      const parsed = JSON.parse(content) as StoredOrchestratorState;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.runs)) {
        this.#state = parsed;
      }
    } catch {
      await this.#persist();
    }
  }

  async getRuns(): Promise<OrchestratorRun[]> {
    return [...this.#state.runs].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  async getRun(runId: string): Promise<OrchestratorRun | null> {
    const run = this.#state.runs.find((r) => r.id === runId);
    return run ? JSON.parse(JSON.stringify(run)) : null;
  }

  async saveRun(run: OrchestratorRun): Promise<OrchestratorRun> {
    const copy = JSON.parse(JSON.stringify(run)) as OrchestratorRun;
    const index = this.#state.runs.findIndex((r) => r.id === run.id);
    if (index >= 0) {
      this.#state.runs[index] = copy;
    } else {
      this.#state.runs.unshift(copy);
    }
    // Cap stored runs to 50 for storage hygiene
    if (this.#state.runs.length > 50) {
      this.#state.runs = this.#state.runs.slice(0, 50);
    }
    await this.#persist();
    return copy;
  }

  async updateTask(runId: string, task: OrchestratorTask): Promise<OrchestratorRun | null> {
    const run = this.#state.runs.find((r) => r.id === runId);
    if (!run) return null;
    const taskIndex = run.tasks.findIndex((t) => t.id === task.id);
    if (taskIndex >= 0) {
      run.tasks[taskIndex] = { ...task, updatedAt: new Date().toISOString() };
    } else {
      run.tasks.push({ ...task, updatedAt: new Date().toISOString() });
    }
    await this.#persist();
    return JSON.parse(JSON.stringify(run));
  }

  async addMessage(message: AgentCollaborationMessage): Promise<OrchestratorRun | null> {
    const run = this.#state.runs.find((r) => r.id === message.runId);
    if (!run) return null;
    run.messages.push(message);
    await this.#persist();
    return JSON.parse(JSON.stringify(run));
  }

  async updateInstance(
    runId: string,
    instance: AgentExecutionInstance,
  ): Promise<OrchestratorRun | null> {
    const run = this.#state.runs.find((r) => r.id === runId);
    if (!run) return null;
    const instIndex = run.instances.findIndex((i) => i.instanceId === instance.instanceId);
    if (instIndex >= 0) {
      run.instances[instIndex] = instance;
    } else {
      run.instances.push(instance);
    }
    await this.#persist();
    return JSON.parse(JSON.stringify(run));
  }

  async #persist(): Promise<void> {
    this.#writeQueue = this.#writeQueue
      .catch(() => {})
      .then(async () => {
        const tempPath = `${this.#statePath}.${process.pid}.${Date.now()}.tmp`;
        const serialized = JSON.stringify(this.#state, null, 2);
        await writeFile(tempPath, serialized, { encoding: "utf8" });
        await this.#safeRename(tempPath, this.#statePath);
      });
    await this.#writeQueue;
  }

  async #safeRename(source: string, destination: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rename(source, destination);
        return;
      } catch {
        if (attempt === 4) {
          await copyFile(source, destination);
          await unlink(source).catch(() => {});
          return;
        }
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
      }
    }
  }
}
