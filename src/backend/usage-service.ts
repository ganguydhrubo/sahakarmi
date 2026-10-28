import { join } from "node:path";
import {
  ACP_AGENT_PROVIDERS,
  type AcpAgentProviderId,
  AGENT_PROVIDERS,
  type AgentProviderId,
  type AgentProviderStatus,
  PROVIDER_LABELS,
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
      /** This turn's own tokens, when the provider reports them separately. */
      turnTokens?: number | null;
      /**
       * First report after a saved session was resumed. Claude restores the session's earlier
       * running total on resume, so without a saved count to subtract only this turn is new.
       */
      resumed?: boolean;
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
  /** 2: Claude counts survive restarts. Version 1 counted a resumed Claude session again in full. */
  version: 1 | 2;
  /** "YYYY-MM-DD|provider|botId" → totals for that day. */
  days: Record<string, DayBucket>;
  /** Last seen cumulative values for counters that survive restarts (Codex thread totals). */
  counters: Record<string, { tokens: number; costUsd: number }>;
  limits: Partial<Record<AgentProviderId, UsageLimitWindow[]>>;
  context: Partial<Record<AgentProviderId, { used: number; size: number; observedAt: string }>>;
  /** When a provider's wrong totals were removed, so the page can say why counting restarted. */
  recounted?: Partial<Record<AgentProviderId, string>>;
}

const RETENTION_DAYS = 90;
const STALE_AFTER_MS = 30 * 60_000;
const RECOUNT_NOTICE_MS = 7 * 86_400_000;
const SAVE_DELAY_MS = 2_000;

/** Where each provider's numbers come from; shown next to the data. */
export const USAGE_SOURCES: Record<AgentProviderId, { limits: string; tokens: string }> = {
  codex: {
    limits: "Codex App Server · account/rateLimits/read",
    tokens: "Codex App Server · thread/tokenUsage/updated",
  },
  claude: {
    limits: "Claude Agent SDK · plan usage (on refresh) and rate_limit_event (during a task)",
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
  ...(Object.fromEntries(
    ACP_AGENT_PROVIDERS.map((provider) => [
      provider,
      {
        limits: `${PROVIDER_LABELS[provider]} publishes no quota to Sahkarmi`,
        tokens: `${PROVIDER_LABELS[provider]} ACP · usage_update`,
      },
    ]),
  ) as Record<AcpAgentProviderId, { limits: string; tokens: string }>),
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
    if (this.#state.version === 1) {
      // Version 1 counted every resumed Claude session again from its first day, so those
      // totals cannot be trusted. Codex counts were right and stay.
      for (const key of Object.keys(this.#state.days)) {
        if (key.split("|")[1] === "claude") delete this.#state.days[key];
      }
      this.#state.version = 2;
      this.#state.recounted = { ...this.#state.recounted, claude: this.#now().toISOString() };
      this.#scheduleSave();
    }
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
    let tokenDelta: number;
    let costDelta: number;
    if (previous && tokens >= previous.tokens && cost >= previous.costUsd) {
      tokenDelta = tokens - previous.tokens;
      costDelta = cost - previous.costUsd;
    } else if (observation.resumed) {
      // The total includes usage counted before the restart, and nothing saved says how much.
      // Count this turn only; its cost is its share of the session's cost (still an estimate).
      tokenDelta = Math.min(tokens, Math.max(0, observation.turnTokens ?? 0));
      costDelta = tokens > 0 ? cost * (tokenDelta / tokens) : 0;
    } else {
      // A smaller running total means the provider restarted its count (new session, /clear).
      tokenDelta = previous && tokens >= previous.tokens ? tokens - previous.tokens : tokens;
      costDelta = previous && cost >= previous.costUsd ? cost - previous.costUsd : cost;
    }
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
      alerts: [...usageAlerts(summaries), ...recountAlerts(this.#state.recounted, now)],
      ledgerSince: dates[0] ?? null,
    };
  }

  async clear(): Promise<void> {
    // Clearing on purpose starts every count fresh; no notice needed.
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

/** Shown for a week after wrong totals were removed, so a fresh count does not look like a fault. */
function recountAlerts(recounted: UsageFileState["recounted"], now: Date): UsageAlert[] {
  const alerts: UsageAlert[] = [];
  for (const [provider, at] of Object.entries(recounted ?? {}) as [AgentProviderId, string][]) {
    const since = Date.parse(at);
    if (Number.isNaN(since) || now.getTime() - since > RECOUNT_NOTICE_MS) continue;
    const day = new Date(since).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    alerts.push({
      id: `${provider}:recounted`,
      level: "info",
      provider,
      message: `Token counts start again from ${day}. Earlier counts were too high: a chat reopened after a restart was counted again, so they were removed.`,
    });
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
  return { version: 2, days: {}, counters: {}, limits: {}, context: {} };
}

function isUsageState(value: unknown): value is UsageFileState {
  return (
    isRecord(value) &&
    (value.version === 1 || value.version === 2) &&
    isRecord(value.days) &&
    isRecord(value.counters) &&
    isRecord(value.limits) &&
    isRecord(value.context)
  );
}
