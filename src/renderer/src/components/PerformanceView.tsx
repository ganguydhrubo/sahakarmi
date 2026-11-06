import { createSignal, For, onMount, Show } from "solid-js";
import type { PerformanceRow, PerformanceSummary } from "../../../shared/ipc";
import { t } from "../i18n";

function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function Table(props: { title: string; rows: PerformanceRow[] }) {
  return (
    <Show when={props.rows.length > 0}>
      <h4 class="orch-section-title">{props.title}</h4>
      <table class="performance-table">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">{t("performanceTurns")}</th>
            <th scope="col">{t("performanceDone")}</th>
            <th scope="col">{t("performanceFailed")}</th>
            <th scope="col">{t("performanceMedian")}</th>
            <th scope="col">{t("performanceTools")}</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.rows}>
            {(row) => (
              <tr>
                <th scope="row">{row.key}</th>
                <td>{row.turns}</td>
                <td>{row.completed}</td>
                <td>{row.failed}</td>
                <td>{duration(row.medianDurationMs)}</td>
                <td>{row.averageTools}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}

/** How coworker turns went on this PC. The numbers come from a local file only. */
export function PerformanceView() {
  const [summary, setSummary] = createSignal<PerformanceSummary | null>(null);
  const load = async () => {
    try {
      setSummary(await window.sahkarmi.orchestrator.performance());
    } catch (error) {
      console.error("Unable to read the performance record:", error);
    }
  };
  onMount(() => void load());

  return (
    <section class="performance-view" aria-label={t("performanceTitle")}>
      <div class="performance-head">
        <h3>{t("performanceTitle")}</h3>
        <button type="button" onClick={() => void load()}>
          {t("performanceRefresh")}
        </button>
      </div>
      <p class="settings-meta">{t("performanceIntro")}</p>
      <Show
        when={(summary()?.totalTurns ?? 0) > 0}
        fallback={<p class="settings-meta">{t("performanceEmpty")}</p>}
      >
        <Table title={t("performanceByCoworker")} rows={summary()?.byCoworker ?? []} />
        <Table title={t("performanceByModel")} rows={summary()?.byModel ?? []} />
        <h4 class="orch-section-title">{t("performanceRecent")}</h4>
        <ul class="performance-recent">
          <For each={summary()?.recent ?? []}>
            {(event) => (
              <li data-outcome={event.outcome}>
                <span>{new Date(event.startedAt).toLocaleString()}</span>
                <span>{event.botName ?? event.botId}</span>
                <span>{event.model ?? event.provider ?? ""}</span>
                <span>{duration(event.durationMs)}</span>
                <span>
                  {event.toolCount} · {event.outcome}
                </span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
