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
                        <strong>{PROVIDER_LABELS[alert.provider]}</strong> {alert.message}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>

              <div class="usage-providers">
                <For each={data().providers}>{(summary) => <ProviderCard summary={summary} />}</For>
              </div>

              <section class="usage-section" aria-labelledby="usage-days">
                <h2 id="usage-days" class="center-view-subheading">
                  {t("usageDaily")} <DataLabel label="verified" />
                </h2>
                <p class="settings-meta">{t("usageDailyHint")}</p>
                <div class="usage-chart" role="img" aria-label={t("usageDailyAria")}>
                  <For each={days()}>
                    {(day) => (
                      <span
                        class="usage-bar"
                        style={{ height: `${Math.max(2, (day.tokens / maxDay()) * 100)}%` }}
                        title={`${day.date}: ${formatNumber(day.tokens)} ${t("usageTokens")}`}
                        classList={{ "usage-bar-empty": day.tokens === 0 }}
                      />
                    )}
                  </For>
                </div>
              </section>

              <section class="usage-section" aria-labelledby="usage-bots">
                <h2 id="usage-bots" class="center-view-subheading">
                  {t("usageByCoworker")}
                </h2>
                <Show
                  when={data().bots.length > 0}
                  fallback={<p class="center-view-empty">{t("usageNoActivity")}</p>}
                >
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
                            <td>
                              {props.bots.find((bot) => bot.id === row.botId)?.name ?? row.botId}
                            </td>
                            <td>{PROVIDER_LABELS[row.provider]}</td>
                            <td>{formatNumber(row.tokens30d)}</td>
                            <td>{row.turns30d}</td>
                            <td>{formatWhen(row.lastAt)}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
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

function ProviderCard(props: { summary: ProviderUsageSummary }) {
  const summary = () => props.summary;
  return (
    <article class="usage-card" aria-labelledby={`usage-${summary().provider}`}>
      <header class="usage-card-head">
        <h2 id={`usage-${summary().provider}`}>{PROVIDER_LABELS[summary().provider]}</h2>
        <span class={`usage-connection usage-connection-${summary().connection}`}>
          {connectionLabel(summary().connection)}
        </span>
      </header>
      <Show when={summary().plan}>
        <p class="settings-meta">
          {t("usagePlan")}: {summary().plan}
        </p>
      </Show>

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
        <p class="usage-source">{summary().limitsNote}</p>
      </Show>

      <h3>
        {t("usageTokens")} <DataLabel label={summary().tokensLabel} />
      </h3>
      <Show
        when={summary().tokens30d !== null}
        fallback={<p class="usage-unavailable">{t("usageTokensUnavailable")}</p>}
      >
        <dl class="usage-stats">
          <div>
            <dt>{t("usageToday")}</dt>
            <dd>{formatNumber(summary().tokensToday ?? 0)}</dd>
          </div>
          <div>
            <dt>{t("usage7d")}</dt>
            <dd>{formatNumber(summary().tokens7d ?? 0)}</dd>
          </div>
          <div>
            <dt>{t("usage30d")}</dt>
            <dd>{formatNumber(summary().tokens30d ?? 0)}</dd>
          </div>
        </dl>
        <p class="usage-source">{t("usageTokensHint")}</p>
      </Show>

      <Show when={summary().costUsd30d !== null}>
        <h3>
          {t("usageCost")} <DataLabel label={summary().costLabel} />
        </h3>
        <p class="usage-cost">US$ {formatUsd(summary().costUsd30d ?? 0)}</p>
        <p class="usage-source">{t("usageCostHint")}</p>
      </Show>

      <Show when={summary().context}>
        {(context) => (
          <p class="usage-source">
            {t("usageContext", {
              used: formatNumber(context().used),
              size: formatNumber(context().size),
            })}
          </p>
        )}
      </Show>
    </article>
  );
}

function LimitRow(props: { window: UsageLimitWindow }) {
  const percent = () => props.window.usedPercent;
  return (
    <li class={`usage-window usage-window-${props.window.status}`}>
      <div class="usage-window-head">
        <span>{props.window.label}</span>
        <span>
          {percent() === null ? statusLabel(props.window.status) : `${Math.round(percent() ?? 0)}%`}
          <Show when={props.window.dataLabel === "stale"}>
            {" "}
            <DataLabel label="stale" />
          </Show>
        </span>
      </div>
      <Show when={percent() !== null}>
        <div class="usage-meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, percent() ?? 0)}%` }} />
        </div>
      </Show>
      <small>
        <Show when={props.window.resetsAt}>
          {t("usageResets", { when: formatWhen(props.window.resetsAt ?? "") })} ·{" "}
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat(localeTag()).format(value);
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
