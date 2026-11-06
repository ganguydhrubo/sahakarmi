import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  type AgentModelOption,
  type AgentProviderId,
  isReasoningEffort,
  modelIdForProvider,
  PROVIDER_LABELS,
} from "../shared/ipc";
import { isRecord } from "./protocol";

export function mergeProviderCatalog(
  provider: AgentProviderId,
  response: unknown,
  fallbacks: AgentModelOption[],
  previous: AgentModelOption[],
): AgentModelOption[] {
  if (!isRecord(response) || !Array.isArray(response.data))
    return previous.length ? previous : fallbacks;
  const reported: AgentModelOption[] = [];
  for (const row of response.data.slice(0, 500)) {
    if (!isRecord(row) || row.hidden === true || typeof row.model !== "string") continue;
    const id = modelIdForProvider(provider, row.model);
    if (!id) continue;
    const fallback = fallbacks.find((item) => item.id === id);
    const efforts = Array.isArray(row.supportedReasoningEfforts)
      ? row.supportedReasoningEfforts
          .filter(isRecord)
          .map((item) => item.reasoningEffort)
          .filter(isReasoningEffort)
      : [];
    reported.push({
      id,
      name:
        typeof row.displayName === "string" && row.displayName.trim()
          ? row.displayName.trim().slice(0, 120)
          : row.model,
      description:
        fallback?.description ??
        `Reported by ${PROVIDER_LABELS[provider]}. Availability depends on your account.`,
      defaultReasoningEffort: isReasoningEffort(row.defaultReasoningEffort)
        ? row.defaultReasoningEffort
        : (fallback?.defaultReasoningEffort ?? "medium"),
      supportedReasoningEfforts: efforts.length
        ? efforts
        : (fallback?.supportedReasoningEfforts ?? ["medium"]),
    });
  }
  if (!reported.length) return previous.length ? previous : fallbacks;
  return [...new Map([...fallbacks, ...reported].map((item) => [item.id, item])).values()];
}

/**
 * A provider's model list saved with the CLI version it came from. A different version, or an
 * entry older than `maxAgeMs`, reads as missing.
 */
export async function readCachedCatalog<T>(
  path: string,
  version: string,
  maxAgeMs: number,
  now = Date.now(),
): Promise<T | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(parsed) || parsed.version !== version || !Array.isArray(parsed.models)) {
      return null;
    }
    const savedAt = typeof parsed.savedAt === "number" ? parsed.savedAt : 0;
    if (now - savedAt > maxAgeMs || savedAt > now) return null;
    return parsed.models as T;
  } catch {
    return null;
  }
}

export async function writeCachedCatalog(
  path: string,
  version: string,
  models: unknown[],
  now = Date.now(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version, savedAt: now, models }), "utf8");
  await rename(temporary, path);
}

/** Coalesce periodic refreshes with throttled window-focus refreshes. */
export class ModelRefreshLoop {
  #timer: ReturnType<typeof setInterval> | null = null;
  #pending: Promise<void> | null = null;
  #lastRun = 0;
  #stopped = true;
  constructor(
    private readonly refresh: () => Promise<void>,
    private readonly intervalMs = 15 * 60_000,
    private readonly focusThrottleMs = 60_000,
  ) {}
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#lastRun = Date.now();
    this.#timer = setInterval(() => void this.request(), this.intervalMs);
    this.#timer.unref?.();
  }
  request(force = false): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    if (this.#pending) return this.#pending;
    if (!force && Date.now() - this.#lastRun < this.focusThrottleMs) return Promise.resolve();
    this.#lastRun = Date.now();
    this.#pending = Promise.resolve()
      .then(this.refresh)
      .catch(() => undefined)
      .finally(() => {
        this.#pending = null;
      });
    return this.#pending;
  }
  stop(): void {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
