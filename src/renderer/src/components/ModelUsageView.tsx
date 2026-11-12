import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  PROVIDER_LABELS,
  type ProviderUsageSummary,
  type UsageLimitWindow,
  type UsageOverview,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { t } from "../i18n";
import { speechLocale as localeTag } from "../preferences";
import { DataLabel } from "./DataLabel";
import { ProviderLogo } from "./ProviderLogo";

const REFRESH_MS = 60_000;

export function ModelUsageView(props: { bots: BotProfile[] }) {
  const [overview, setOverview] = createSignal<UsageOverview | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  async function load(refresh = false) {
    setBusy(true);
    try {
      setOverview(
        refresh ? await window.sahkarmi.usage.refresh() : await window.sahkarmi.usage.overview(),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => {
    void load(true);
    // Only while this view is open; nothing polls in the background.
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  async function clearLedger() {
    if (!window.confirm(t("usageClearConfirm"))) return;
    setOverview(await window.sahkarmi.usage.clear());
  }

  const days = createMemo(() => {
    const data = overview()?.days ?? [];
    const totals = new Map<string, number>();
    for (const day of data) totals.set(day.date, (totals.get(day.date) ?? 0) + day.tokens);
    const result: Array<{ date: string; tokens: number }> = [];
    const today = new Date();
    for (let offset = 29; offset >= 0; offset -= 1) {
      const date = new Date(today.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
      result.push({ date, tokens: totals.get(date) ?? 0 });
    }
    return result;
  });
  const maxDay = () => Math.max(1, ...days().map((day) => day.tokens));
  const maxBot = () => Math.max(1, ...(overview()?.bots ?? []).map((row) => row.tokens30d));
  // Full cards only where the provider reports something; the rest share one quiet row.
  const reporting = () => (overview()?.providers ?? []).filter(hasData);
  const quiet = () => (overview()?.providers ?? []).filter((summary) => !hasData(summary));

  return (
    <section class="center-view usage-view" aria-labelledby="usage-heading">
      <header class="center-view-header window-drag">
        <h1 id="usage-heading">{t("navUsage")}</h1>
        <div class="center-view-actions">
          <button type="button" disabled={busy()} onClick={() => void load(true)}>
            {busy() ? t("usageRefreshing") : t("usageRefresh")}
          </button>
        </div>
      </header>
      <div class="center-view-body">
        <p class="center-view-intro">{t("usageIntro")}</p>
        <Show when={error()}>
          <p class="center-view-error" role="alert">
            {error()}
          </p>
        </Show>
        <Show when={overview()} fallback={<p class="center-view-empty">{t("usageLoading")}</p>}>
          {(data) => (
            <>
              <Show when={data().alerts.length > 0}>
                <ul class="usage-alerts" aria-label={t("usageAlerts")}>
                  <For each={data().alerts}>
                    {(alert) => (
                      <li class={`usage-alert usage-alert-${alert.level}`} role="status">
                        <span class="usage-alert-icon">
                          <ProviderLogo provider={alert.provider} size={16} />
                        </span>
                        <span>
                          <strong>{PROVIDER_LABELS[alert.provider]}</strong> {alert.message}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <div class="usage-providers">
                <For each={reporting()}>{(summary) => <ProviderCard summary={summary} />}</For>
              </div>

              <Show when={quiet().length > 0}>
                <section class="usage-quiet" aria-labelledby="usage-quiet-heading">
                  <h2 id="usage-quiet-heading" class="usage-quiet-heading">
                    {t("usageOtherProviders")}
                  </h2>
                  <ul class="usage-quiet-list">
                    <For each={quiet()}>
                      {(summary) => (
                        <li class="usage-quiet-item" title={summary.limitsNote}>
                          <ProviderLogo provider={summary.provider} size={16} />
                          <span class="usage-quiet-name">{PROVIDER_LABELS[summary.provider]}</span>
                          <span class={`usage-connection usage-connection-${summary.connection}`}>
                            {connectionLabel(summary.connection)}
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>

              <section class="usage-section usage-panel" aria-labelledby="usage-days">
                <div class="usage-panel-head">
                  <h2 id="usage-days" class="center-view-subheading">
                    {t("usageDaily")} <DataLabel label="verified" />
                  </h2>
                  <span class="usage-chart-max">
                    {formatCompact(maxDay())} {t("usageTokens")}
                  </span>
                </div>
                <p class="settings-meta">{t("usageDailyHint")}</p>
                <div class="usage-chart" role="img" aria-label={t("usageDailyAria")}>
                  <For each={days()}>
                    {(day, index) => (
                      <span
                        class="usage-bar"
                        style={{ height: `${Math.max(2, (day.tokens / maxDay()) * 100)}%` }}
                        title={`${formatDay(day.date)}: ${formatNumber(day.tokens)} ${t("usageTokens")}`}
                        classList={{
                          "usage-bar-empty": day.tokens === 0,
                          "usage-bar-today": index() === days().length - 1,
                        }}
                      />
                    )}
                  </For>
                </div>
                <div class="usage-chart-axis" aria-hidden="true">
                  <span>{formatDay(days()[0]?.date ?? "")}</span>
                  <span>{t("usageToday")}</span>
                </div>
              </section>

              <section class="usage-section usage-panel" aria-labelledby="usage-bots">
                <h2 id="usage-bots" class="center-view-subheading">
                  {t("usageByCoworker")}
                </h2>
                <Show
                  when={data().bots.length > 0}
                  fallback={<p class="center-view-empty">{t("usageNoActivity")}</p>}
                >
                  <div class="usage-table-wrap">
                    <table class="usage-table">
                      <thead>
                        <tr>
                          <th scope="col">{t("usageCoworker")}</th>
                          <th scope="col">{t("usageProvider")}</th>
                          <th scope="col">{t("usageTokens30")}</th>
                          <th scope="col">{t("usageTurns")}</th>
                          <th scope="col">{t("usageLast")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={data().bots}>
                          {(row) => (
                            <tr>
                              <td class="usage-table-name">
                                {props.bots.find((bot) => bot.id === row.botId)?.name ?? row.botId}
                              </td>
                              <td>
                                <span class="usage-table-provider">
                                  <ProviderLogo provider={row.provider} size={14} />
                                  {PROVIDER_LABELS[row.provider]}
                                </span>
                              </td>
                              <td>
                                <span class="usage-share" title={formatNumber(row.tokens30d)}>
                                  <span class="usage-share-value">
                                    {formatCompact(row.tokens30d)}
                                  </span>
                                  <span class="usage-share-track" aria-hidden="true">
                                    <span
                                      style={{
                                        width: `${Math.max(2, (row.tokens30d / maxBot()) * 100)}%`,
                                      }}
                                    />
                                  </span>
                                </span>
                              </td>
                              <td class="usage-table-number">{formatNumber(row.turns30d)}</td>
                              <td class="usage-table-when">{formatWhen(row.lastAt)}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </Show>
              </section>

              <footer class="usage-footer">
                <p class="settings-meta">
                  {data().ledgerSince
                    ? t("usageSince", { date: data().ledgerSince ?? "" })
                    : t("usageNothingYet")}{" "}
                  {t("usagePrivacy")}
                </p>
                <button
                  type="button"
                  class="button-danger-quiet"
                  onClick={() => void clearLedger()}
                >
                  {t("usageClear")}
                </button>
              </footer>
            </>
          )}
        </Show>
      </div>
    </section>
  );
}

/** Anything worth a full card: limits, token counts, a cost or a context reading. */
function hasData(summary: ProviderUsageSummary): boolean {
  return (
    summary.limits.length > 0 ||
    summary.tokens30d !== null ||
    summary.costUsd30d !== null ||
    summary.context !== null
  );
}

function ProviderCard(props: { summary: ProviderUsageSummary }) {
  const summary = () => props.summary;
  const contextShare = () => {
    const context = summary().context;
    return context && context.size > 0 ? Math.min(100, (context.used / context.size) * 100) : 0;
  };
  return (
    <article class="usage-card" aria-labelledby={`usage-${summary().provider}`}>
      <header class="usage-card-head">
        <ProviderLogo provider={summary().provider} size={22} tile />
        <div class="usage-card-title">
          <h2 id={`usage-${summary().provider}`}>{PROVIDER_LABELS[summary().provider]}</h2>
          <Show when={summary().plan}>
            <span class="usage-plan">
              {t("usagePlan")} · {capitalise(summary().plan ?? "")}
            </span>
          </Show>
        </div>
        <span class={`usage-connection usage-connection-${summary().connection}`}>
          {connectionLabel(summary().connection)}
        </span>
      </header>

      <section class="usage-block">
        <h3>
          {t("usageLimits")} <DataLabel label={summary().limitsLabel} />
        </h3>
        <Show
          when={summary().limits.length > 0}
          fallback={<p class="usage-unavailable">{summary().limitsNote}</p>}
        >
          <ul class="usage-windows">
            <For each={summary().limits}>{(window) => <LimitRow window={window} />}</For>
          </ul>
        </Show>
      </section>

      <section class="usage-block">
        <h3>
          {t("usageTokens")} <DataLabel label={summary().tokensLabel} />
        </h3>
        <Show
          when={summary().tokens30d !== null}
          fallback={<p class="usage-unavailable">{t("usageTokensUnavailable")}</p>}
        >
          <dl class="usage-stats">
            <Stat label={t("usageToday")} value={summary().tokensToday ?? 0} />
            <Stat label={t("usage7d")} value={summary().tokens7d ?? 0} />
            <Stat label={t("usage30d")} value={summary().tokens30d ?? 0} />
          </dl>
        </Show>
      </section>

      <Show when={summary().costUsd30d !== null}>
        <section class="usage-block">
          <h3>
            {t("usageCost")} <DataLabel label={summary().costLabel} />
          </h3>
          <p class="usage-cost">US$ {formatUsd(summary().costUsd30d ?? 0)}</p>
          <p class="usage-source">
            {summary().plan
              ? t("usageCostPlanHint", { plan: capitalise(summary().plan ?? "") })
              : t("usageCostHint")}
          </p>
        </section>
      </Show>

      <Show when={summary().context}>
        {(context) => (
          <section class="usage-block usage-context">
            <p class="usage-source">
              {t("usageContext", {
                used: formatCompact(context().used),
                size: formatCompact(context().size),
              })}
            </p>
            <div class="usage-meter usage-meter-thin" aria-hidden="true">
              <span style={{ width: `${Math.max(1, contextShare())}%` }} />
            </div>
          </section>
        )}
      </Show>

      <footer class="usage-card-foot">
        <Show when={summary().limits.length > 0}>
          <span>{summary().limitsNote}</span>
        </Show>
        <Show when={summary().tokens30d !== null}>
          <span>{t("usageTokensHint")}</span>
        </Show>
      </footer>
    </article>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div class="usage-stat">
      <dt>{props.label}</dt>
      <dd title={formatNumber(props.value)}>{formatCompact(props.value)}</dd>
    </div>
  );
}

function LimitRow(props: { window: UsageLimitWindow }) {
  const percent = () => props.window.usedPercent;
  // A window past its reset time says nothing about now; never show its old status.
  const wasReset = () =>
    props.window.resetsAt !== null && Date.parse(props.window.resetsAt) < Date.now();
  const status = () => (wasReset() ? "unknown" : props.window.status);
  return (
    <li class={`usage-window usage-window-${status()}`}>
      <div class="usage-window-head">
        <span class="usage-window-label">{props.window.label}</span>
        <span class="usage-window-value">
          <Show
            when={!wasReset() && percent() !== null}
            fallback={
              <span class={`usage-status usage-status-${status()}`}>
                {wasReset() ? t("usageNoReading") : statusLabel(status())}
              </span>
            }
          >
            {`${Math.round(percent() ?? 0)}%`}
          </Show>
          <Show when={props.window.dataLabel === "stale" && !wasReset()}>
            <DataLabel label="stale" />
          </Show>
        </span>
      </div>
      <Show when={!wasReset() && percent() !== null}>
        <div class="usage-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, percent() ?? 0)}%` }} />
        </div>
      </Show>
      <small>
        <Show when={props.window.resetsAt}>
          {wasReset()
            ? t("usageWasReset", { when: formatWhen(props.window.resetsAt ?? "") })
            : t("usageResets", { when: formatWhen(props.window.resetsAt ?? "") })}{" "}
          ·{" "}
        </Show>
        {t("usageObserved", { when: formatWhen(props.window.observedAt) })}
      </small>
    </li>
  );
}

function connectionLabel(state: ProviderUsageSummary["connection"]): string {
  switch (state) {
    case "available":
      return t("usageConnected");
    case "sign-in-required":
      return t("usageSignIn");
    case "not-installed":
      return t("usageNotInstalled");
    case "checking":
    case "not-started":
      return t("usageChecking");
    default:
      return t("usageNeedsAttention");
  }
}

function statusLabel(status: UsageLimitWindow["status"]): string {
  return status === "limited"
    ? t("usageLimited")
    : status === "warning"
      ? t("usageNearLimit")
      : status === "ok"
        ? t("usageOk")
        : t("labelUnavailable");
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(localeTag()).format(value);
}

/** Short form for big counts (1.37 bn, 137 Cr); the exact number is in the tooltip. */
function formatCompact(value: number): string {
  if (Math.abs(value) < 10_000) return formatNumber(value);
  return new Intl.NumberFormat(localeTag(), {
    notation: "compact",
    maximumSignificantDigits: 3,
  }).format(value);
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(localeTag(), { day: "numeric", month: "short" }).format(date);
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(localeTag(), { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

function formatUsd(value: number): string {
  return value > 0 && value < 1 ? value.toFixed(4) : value.toFixed(2);
}
