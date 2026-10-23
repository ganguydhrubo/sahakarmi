import { join } from "node:path";
import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  type AgentProviderStatus,
  type ProviderUsageSummary,
  type UsageAlert,
  type UsageByBot,
  type UsageDataLabel,
  type UsageDay,
  type UsageLimitWindow,
  type UsageOverview,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

/** Usage observed during one adapter run, as reported by the provider (never invented). */
export type UsageObservation =
  | {
      kind: "cumulative";
      provider: AgentProviderId;
      botId: string | null;
      /** Counter identity. "thread:" keys persist across restarts; others reset with the process. */
      counterKey: string;
      persistent: boolean;
      tokens: number | null;
      costUsd: number | null;
    }
  | { kind: "limits"; provider: AgentProviderId; windows: UsageLimitWindow[]; replace: boolean }
  | { kind: "context"; provider: AgentProviderId; used: number; size: number };

interface DayBucket {
  tokens: number;
  costUsd: number | null;
  turns: number;
  lastAt: string;
}

interface UsageFileState {
  version: 1;
  /** "YYYY-MM-DD|provider|botId" → totals for that day. */
  days: Record<string, DayBucket>;
  /** Last seen cumulative values for counters that survive restarts (Codex thread totals). */
  counters: Record<string, { tokens: number; costUsd: number }>;
  limits: Partial<Record<AgentProviderId, UsageLimitWindow[]>>;
  context: Partial<Record<AgentProviderId, { used: number; size: number; observedAt: string }>>;
}

const RETENTION_DAYS = 90;
const STALE_AFTER_MS = 30 * 60_000;
const SAVE_DELAY_MS = 2_000;

/** Where each provider's numbers come from; shown next to the data. */
export const USAGE_SOURCES: Record<AgentProviderId, { limits: string; tokens: string }> = {
  codex: {
    limits: "Codex App Server · account/rateLimits/read",
    tokens: "Codex App Server · thread/tokenUsage/updated",
  },
  claude: {
    limits: "Claude Agent SDK · rate_limit_event (sent during a task)",
    tokens: "Claude Agent SDK · result.modelUsage",
  },
  opencode: {
    limits: "OpenCode free models publish no quota",
    tokens: "OpenCode ACP · usage_update (context size and session cost)",
  },
  antigravity: {
    limits: "Google Antigravity quota",
    tokens: "Google Antigravity usage_update",
  },
};

/**
 * Local usage ledger. Stores only counts, percentages and timestamps — no prompts, replies,
 * audio or file names — in usage.json on this computer. Nothing is sent anywhere.
 */
export class UsageService {
  readonly #file: JsonFile<UsageFileState>;
  #state: UsageFileState = emptyState();
  readonly #sessionCounters = new Map<string, { tokens: number; costUsd: number }>();
  #saveTimer: NodeJS.Timeout | null = null;
  readonly #now: () => Date;

  constructor(userDataPath: string, now: () => Date = () => new Date()) {
    this.#file = new JsonFile(join(userDataPath, "usage.json"));
    this.#now = now;
  }

  async initialize(): Promise<void> {
    this.#state = await this.#file.read(emptyState, isUsageState);
    this.#prune();
  }

  record(observation: UsageObservation): void {
    const at = this.#now().toISOString();
    if (observation.kind === "limits") {
      const kept = observation.replace
        ? []
        : (this.#state.limits[observation.provider] ?? []).filter(
            (window) => !observation.windows.some((next) => next.id === window.id),
          );
      this.#state.limits[observation.provider] = [...kept, ...observation.windows];
    } else if (observation.kind === "context") {
      this.#state.context[observation.provider] = {
        used: Math.max(0, observation.used),
        size: Math.max(0, observation.size),
        observedAt: at,
      };
    } else {
      this.#recordCumulative(observation, at);
    }
    this.#scheduleSave();
  }

  #recordCumulative(observation: Extract<UsageObservation, { kind: "cumulative" }>, at: string) {
    const store = observation.persistent ? null : this.#sessionCounters;
    const previous = store
      ? store.get(observation.counterKey)
      : this.#state.counters[observation.counterKey];
    const tokens = observation.tokens ?? previous?.tokens ?? 0;
    const cost = observation.costUsd ?? previous?.costUsd ?? 0;
    // A smaller running total means the provider restarted its count (new session, /clear).
    const tokenDelta = previous && tokens >= previous.tokens ? tokens - previous.tokens : tokens;
    const costDelta = previous && cost >= previous.costUsd ? cost - previous.costUsd : cost;
    const next = { tokens, costUsd: cost };
    if (store) store.set(observation.counterKey, next);
    else this.#state.counters[observation.counterKey] = next;
    if (tokenDelta <= 0 && costDelta <= 0) return;
    const key = `${at.slice(0, 10)}|${observation.provider}|${observation.botId ?? ""}`;
    const bucket = this.#state.days[key] ?? { tokens: 0, costUsd: null, turns: 0, lastAt: at };
    bucket.tokens += Math.max(0, tokenDelta);
    if (observation.costUsd !== null)
      bucket.costUsd = (bucket.costUsd ?? 0) + Math.max(0, costDelta);
    bucket.turns += 1;
    bucket.lastAt = at;
    this.#state.days[key] = bucket;
  }

  overview(
    providers: AgentProviderStatus[],
    plans: Partial<Record<AgentProviderId, string | null>> = {},
  ): UsageOverview {
    this.#prune();
    const now = this.#now();
    const today = now.toISOString().slice(0, 10);
    const since7 = dayOffset(now, -6);
    const since30 = dayOffset(now, -29);
    const entries = Object.entries(this.#state.days).map(([key, bucket]) => {
      const [date = "", provider = "", botId = ""] = key.split("|");
      return { date, provider: provider as AgentProviderId, botId, ...bucket };
    });

    const summaries: ProviderUsageSummary[] = AGENT_PROVIDERS.map((provider) => {
      const own = entries.filter((entry) => entry.provider === provider);
      const sum = (since: string) =>
        own
          .filter((entry) => entry.date >= since)
          .reduce((total, entry) => total + entry.tokens, 0);
      const costs = own.filter((entry) => entry.date >= since30 && entry.costUsd !== null);
      const hasTokens = provider === "codex" || provider === "claude";
      const limits = (this.#state.limits[provider] ?? []).map((window) => ({
        ...window,
        dataLabel: freshness(window, now),
      }));
      const status = providers.find((candidate) => candidate.id === provider);
      const context = this.#state.context[provider] ?? null;
      return {
        provider,
        connection: status?.state ?? "unknown",
        plan: plans[provider] ?? null,
        limits,
        limitsLabel:
          limits.length === 0
            ? "unavailable"
            : limits.some((window) => window.dataLabel === "stale")
              ? "stale"
              : "verified",
        limitsNote: USAGE_SOURCES[provider].limits,
        tokensToday: hasTokens ? sum(today) : null,
        tokens7d: hasTokens ? sum(since7) : null,
        tokens30d: hasTokens ? sum(since30) : null,
        tokensLabel: hasTokens ? "verified" : "unavailable",
        costUsd30d: costs.length
          ? costs.reduce((total, entry) => total + (entry.costUsd ?? 0), 0)
          : null,
        costLabel: costs.length ? "estimated" : "unavailable",
        context,
        lastActivityAt: own.reduce<string | null>(
          (latest, entry) => (!latest || entry.lastAt > latest ? entry.lastAt : latest),
          null,
        ),
      } satisfies ProviderUsageSummary;
    });

    const dayMap = new Map<string, UsageDay>();
    for (const entry of entries) {
      if (entry.date < since30) continue;
      const key = `${entry.date}|${entry.provider}`;
      const day = dayMap.get(key) ?? {
        date: entry.date,
        provider: entry.provider,
        tokens: 0,
        costUsd: null,
      };
      day.tokens += entry.tokens;
      if (entry.costUsd !== null) day.costUsd = (day.costUsd ?? 0) + entry.costUsd;
      dayMap.set(key, day);
    }

    const botMap = new Map<string, UsageByBot>();
    for (const entry of entries) {
      if (entry.date < since30 || !entry.botId) continue;
      const key = `${entry.botId}|${entry.provider}`;
      const bot = botMap.get(key) ?? {
        botId: entry.botId,
        provider: entry.provider,
        tokens30d: 0,
        turns30d: 0,
        lastAt: entry.lastAt,
      };
      bot.tokens30d += entry.tokens;
      bot.turns30d += entry.turns;
      if (entry.lastAt > bot.lastAt) bot.lastAt = entry.lastAt;
      botMap.set(key, bot);
    }

    const dates = entries.map((entry) => entry.date).sort();
    return {
      generatedAt: now.toISOString(),
      providers: summaries,
      days: [...dayMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
      bots: [...botMap.values()].sort((left, right) => right.tokens30d - left.tokens30d),
      alerts: usageAlerts(summaries),
      ledgerSince: dates[0] ?? null,
    };
  }

  async clear(): Promise<void> {
    this.#state = emptyState();
    this.#sessionCounters.clear();
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    await this.#file.write(this.#state);
  }

  #scheduleSave(): void {
    if (this.#saveTimer) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#file.write(this.#state).catch(() => undefined);
    }, SAVE_DELAY_MS);
    this.#saveTimer.unref?.();
  }

  #prune(): void {
    const cutoff = dayOffset(this.#now(), -(RETENTION_DAYS - 1));
    for (const key of Object.keys(this.#state.days)) {
      if (key.slice(0, 10) < cutoff) delete this.#state.days[key];
    }
    const counters = Object.keys(this.#state.counters);
    if (counters.length > 2_000) {
      for (const key of counters.slice(0, counters.length - 2_000))
        delete this.#state.counters[key];
    }
  }
}

export function usageAlerts(summaries: ProviderUsageSummary[]): UsageAlert[] {
  const alerts: UsageAlert[] = [];
  for (const summary of summaries) {
    for (const window of summary.limits) {
      if (window.dataLabel === "stale") continue;
      const percent = window.usedPercent;
      if (window.status === "limited" || (percent !== null && percent >= 95)) {
        alerts.push({
          id: `${summary.provider}:${window.id}:critical`,
          level: "critical",
          provider: summary.provider,
          message: `${window.label} is ${percent === null ? "at its limit" : `${Math.round(percent)}% used`}. Coworkers on this provider may stop until it resets.`,
        });
      } else if (window.status === "warning" || (percent !== null && percent >= 80)) {
        alerts.push({
          id: `${summary.provider}:${window.id}:warning`,
          level: "warning",
          provider: summary.provider,
          message: `${window.label} is ${percent === null ? "close to its limit" : `${Math.round(percent)}% used`}.`,
        });
      }
    }
    if (summary.connection === "sign-in-required") {
      alerts.push({
        id: `${summary.provider}:signed-out`,
        level: "info",
        provider: summary.provider,
        message: "Signed out. Coworkers using this provider cannot work until you sign in.",
      });
    }
  }
  return alerts;
}

function freshness(window: UsageLimitWindow, now: Date): UsageDataLabel {
  if (window.dataLabel === "unavailable" || window.dataLabel === "estimated")
    return window.dataLabel;
  const observed = Date.parse(window.observedAt);
  if (Number.isNaN(observed) || now.getTime() - observed > STALE_AFTER_MS) return "stale";
  // A window that has already reset no longer describes current usage.
  if (window.resetsAt && Date.parse(window.resetsAt) < now.getTime()) return "stale";
  return "verified";
}

function dayOffset(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function emptyState(): UsageFileState {
  return { version: 1, days: {}, counters: {}, limits: {}, context: {} };
}

function isUsageState(value: unknown): value is UsageFileState {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isRecord(value.days) &&
    isRecord(value.counters) &&
    isRecord(value.limits) &&
    isRecord(value.context)
  );
}
