import { createSignal, For, onMount, Show } from "solid-js";
import type {
  IntelligenceDecision,
  IntelligenceExperience,
  IntelligenceOutcome,
  IntelligencePerformanceRow,
  IntelligencePlanAnalysis,
  IntelligencePredictions,
  IntelligenceRecommendation,
  IntelligenceResources,
  IntelligenceStatus,
  PredictionSource,
  VerificationGrade,
} from "../../../shared/intelligence";
import type { OrchestratorRun } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

/**
 * Settings > Intelligence. Everything shown comes from the local Intelligence Core; nothing
 * here sends a message or changes a coworker. The only writes are the owner's own: 👍/👎,
 * leaving a record out, notes, returning the failure prediction to an earlier version, and
 * forgetting a workspace's learning (after a confirmation).
 */

const GRADE_KEYS: Record<VerificationGrade, MessageKey> = {
  verified: "intelGradeVerified",
  partial: "intelGradePartial",
  failed: "intelGradeFailed",
  inconclusive: "intelGradeInconclusive",
};
const SOURCE_KEYS: Record<PredictionSource, MessageKey> = {
  model: "intelSourceModel",
  history: "intelSourceHistory",
  estimate: "intelSourceEstimate",
};

function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms <= 0) return "0 s";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(Math.round(value * 100));
}

function bytes(value: number | null | undefined): string {
  if (!value) return "—";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function api() {
  return window.sahkarmi.intelligence;
}

export function IntelligenceSettings() {
  const [status, setStatus] = createSignal<IntelligenceStatus | null>(null);
  const [record, setRecord] = createSignal<IntelligencePerformanceRow[]>([]);
  const [outcomes, setOutcomes] = createSignal<IntelligenceOutcome[]>([]);
  const [forecast, setForecast] = createSignal<IntelligencePredictions | null>(null);
  const [decisions, setDecisions] = createSignal<IntelligenceDecision[]>([]);
  const [notes, setNotes] = createSignal<IntelligenceExperience[]>([]);
  const [resources, setResources] = createSignal<IntelligenceResources | null>(null);
  const [runs, setRuns] = createSignal<OrchestratorRun[]>([]);
  const [analysis, setAnalysis] = createSignal<IntelligencePlanAnalysis | null>(null);
  const [ask, setAsk] = createSignal("");
  const [advice, setAdvice] = createSignal<IntelligenceRecommendation | null>(null);
  const [noteText, setNoteText] = createSignal("");
  const [noteKind, setNoteKind] = createSignal<"fact" | "preference">("fact");
  const [editing, setEditing] = createSignal<{ id: string; text: string } | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function guard(action: () => Promise<unknown>) {
    try {
      setError(null);
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function load() {
    const bridge = api();
    if (!bridge) return;
    setLoading(true);
    await guard(async () => {
      const [
        nextStatus,
        nextRecord,
        nextOutcomes,
        nextForecast,
        nextDecisions,
        nextNotes,
        nextResources,
      ] = await Promise.all([
        bridge.status(),
        bridge.performance(),
        bridge.outcomes({ limit: 30 }),
        bridge.predictions(),
        bridge.decisions(),
        bridge.experiences(),
        bridge.resources(),
      ]);
      setStatus(nextStatus);
      setRecord(nextRecord);
      setOutcomes(nextOutcomes);
      setForecast(nextForecast);
      setDecisions(nextDecisions);
      setNotes(nextNotes);
      setResources(nextResources);
      const allRuns = await window.sahkarmi.orchestrator.getRuns().catch(() => []);
      setRuns(
        [...allRuns]
          .filter(
            (run) => run.workspaceId === nextStatus.workspaceId || run.workspaceId === "default",
          )
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .slice(0, 10),
      );
    });
    setLoading(false);
  }

  onMount(() => void load());

  const modeKey = (): { label: MessageKey; hint: MessageKey } => {
    switch (status()?.mode) {
      case "adaptive":
        return { label: "intelModeAdaptive", hint: "intelModeHintAdaptive" };
      case "observe":
        return { label: "intelModeObserve", hint: "intelModeHintObserve" };
      default:
        return { label: "intelModeOff", hint: "intelModeHintOff" };
    }
  };

  const modelLine = () => {
    const model = status()?.model;
    if (!model) return "";
    const values = {
      updates: String(model.updates),
      brier: String(model.brier ?? "—"),
      baseline: String(model.baselineBrier ?? "—"),
    };
    if (model.useful) return t("intelModelUseful", values);
    if (model.updates >= 30) return t("intelModelNotUseful", values);
    return t("intelModelNotYet", values);
  };

  const sourceTag = (source: PredictionSource | null | undefined) => (
    <Show when={source}>
      {(value) => (
        <span class={`intel-tag intel-source-${value()}`}>{t(SOURCE_KEYS[value()])}</span>
      )}
    </Show>
  );

  const gradeTag = (grade: VerificationGrade | null, running: boolean) => (
    <span class={`intel-tag intel-grade-${running ? "running" : (grade ?? "inconclusive")}`}>
      {running ? t("intelGradeRunning") : t(GRADE_KEYS[grade ?? "inconclusive"])}
    </span>
  );

  const nameOf = (botId: string | null) =>
    (botId && record().find((row) => row.botId === botId)?.botName) ||
    (botId && outcomes().find((row) => row.botId === botId)?.botName) ||
    (botId && advice()?.candidates.find((row) => row.botId === botId)?.botName) ||
    botId ||
    "—";

  return (
    <div class="intelligence-settings">
      <Show when={!api()}>
        <p class="settings-meta">{t("intelModeHintOff")}</p>
      </Show>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>

      {/* Status */}
      <section class="settings-card">
        <div class="intel-head">
          <h2>{t("intelStatusTitle")}</h2>
          <span class={`intel-tag intel-mode-${status()?.mode ?? "off"}`}>
            {t(modeKey().label)}
          </span>
          <button
            type="button"
            class="intel-refresh"
            disabled={loading()}
            onClick={() => void load()}
          >
            {loading() ? t("intelLoading") : t("intelRefresh")}
          </button>
        </div>
        <p class="settings-meta">{t(modeKey().hint)}</p>
        <Show when={status()}>
          {(current) => (
            <>
              <h3>{t("intelRecorded")}</h3>
              <p class="settings-meta">
                {t("intelGrades", {
                  verified: String(current().outcomes.byGrade.verified),
                  partial: String(current().outcomes.byGrade.partial),
                  failed: String(current().outcomes.byGrade.failed),
                  inconclusive: String(current().outcomes.byGrade.inconclusive),
                })}
              </p>
              <p class="settings-meta">
                {t("intelLearnable", {
                  labelled: String(current().outcomes.labelled),
                  finished: String(current().outcomes.finished),
                  feedback: String(current().outcomes.withFeedback),
                  excluded: String(current().outcomes.excluded),
                })}
              </p>
              <h3>{t("intelModelTitle")}</h3>
              <p class="settings-meta">{modelLine()}</p>
              <Show when={current().accuracy.scored > 0}>
                <p class="settings-meta">
                  {t("intelAccuracy", {
                    scored: String(current().accuracy.scored),
                    brier: String(current().accuracy.brier ?? "—"),
                    baseline: String(current().accuracy.baselineBrier ?? "—"),
                  })}
                </p>
              </Show>
              <Show when={current().accuracy.durationError !== null}>
                <p class="settings-meta">
                  {t("intelDurationError", {
                    percent: percent(current().accuracy.durationError),
                    count: String(current().accuracy.durationScored),
                  })}
                </p>
              </Show>
              <h3>{t("intelRoutingTitle")}</h3>
              <p class="settings-meta">{current().routing.verdict}</p>
              <p class="settings-meta">
                {t("intelStorage", {
                  outcomes: String(current().storage.outcomes),
                  experiences: String(current().storage.experiences),
                  size: bytes(current().storage.bytes),
                })}
              </p>
              <Show when={current().lastError}>
                {(problem) => (
                  <p class="settings-meta">{t("intelLastError", { error: problem() })}</p>
                )}
              </Show>
            </>
          )}
        </Show>
      </section>

      {/* Ask */}
      <section class="settings-card">
        <h2>{t("intelAskTitle")}</h2>
        <p class="settings-meta">{t("intelAskHint")}</p>
        <form
          class="intel-ask"
          onSubmit={(event) => {
            event.preventDefault();
            const text = ask().trim();
            const bridge = api();
            if (!text || !bridge) return;
            void guard(async () => setAdvice(await bridge.recommend({ text })));
          }}
        >
          <input
            type="text"
            value={ask()}
            placeholder={t("intelAskPlaceholder")}
            aria-label={t("intelAskTitle")}
            onInput={(event) => setAsk(event.currentTarget.value)}
          />
          <button type="submit" disabled={!ask().trim()}>
            {t("intelAskButton")}
          </button>
        </form>
        <Show when={advice()}>
          {(result) => (
            <div class="intel-advice">
              <p>
                <strong>{t("intelKindOfWork", { category: result().category })}</strong>
                {" · "}
                {t("intelPick", { name: nameOf(result().chosenBotId) })}
                {" · "}
                {t("intelConfidence", { level: result().confidence })}
              </p>
              <p class="settings-meta">{result().explanation}</p>
              <Show when={result().failure}>
                {(failure) => (
                  <p class="settings-meta">
                    {t("intelFailureRisk", { percent: percent(failure().probability) })}{" "}
                    {sourceTag(failure().source)} {failure().basis}
                  </p>
                )}
              </Show>
              <Show when={result().duration}>
                {(estimate) => (
                  <p class="settings-meta">
                    {t("intelTypicalTime", {
                      median: duration(estimate().medianMs),
                      slow: duration(estimate().p90Ms),
                    })}{" "}
                    {sourceTag(estimate().source)} {estimate().basis}
                  </p>
                )}
              </Show>
              <table class="performance-table intel-table">
                <thead>
                  <tr>
                    <th scope="col">{t("intelColCoworker")}</th>
                    <th scope="col">{t("intelColSuccess")}</th>
                    <th scope="col">{t("intelColTasks")}</th>
                    <th scope="col">{t("intelColVerified")}</th>
                    <th scope="col">{t("intelColFailed")}</th>
                    <th scope="col">{t("intelColTime")}</th>
                    <th scope="col">{t("intelColWait")}</th>
                    <th scope="col">{t("intelColScore")}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={result().candidates}>
                    {(row) => (
                      <tr classList={{ "intel-chosen": row.botId === result().chosenBotId }}>
                        <th scope="row" title={row.reasons.join("; ")}>
                          {row.botName}
                        </th>
                        <td>
                          {percent(row.successRate)}% ({percent(row.lower)}–{percent(row.upper)})
                        </td>
                        <td>{row.samples}</td>
                        <td>{row.verified}</td>
                        <td>{row.failed}</td>
                        <td>{duration(row.medianMs)}</td>
                        <td>{duration(row.waitMs)}</td>
                        <td>{row.score}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
              <Show when={result().similar.length > 0}>
                <h3>{t("intelSimilar")}</h3>
                <ul class="intel-list">
                  <For each={result().similar}>
                    {(item) => (
                      <li>
                        <span class={`intel-tag intel-trust-${item.trust}`}>{item.trust}</span>{" "}
                        {item.text}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          )}
        </Show>
      </section>

      {/* Track record */}
      <section class="settings-card">
        <h2>{t("intelRecordTitle")}</h2>
        <Show
          when={record().length > 0}
          fallback={<p class="settings-meta">{t("intelRecordEmpty")}</p>}
        >
          <table class="performance-table intel-table">
            <thead>
              <tr>
                <th scope="col">{t("intelColCoworker")}</th>
                <th scope="col">{t("intelColKind")}</th>
                <th scope="col">{t("intelColTasks")}</th>
                <th scope="col">{t("intelColVerified")}</th>
                <th scope="col">{t("intelColFailed")}</th>
                <th scope="col">{t("intelColSuccess")}</th>
                <th scope="col">{t("intelColTime")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={record()}>
                {(row) => (
                  <tr>
                    <th scope="row">{row.botName}</th>
                    <td>{row.category}</td>
                    <td>{row.samples}</td>
                    <td>{row.verified}</td>
                    <td>{row.failed}</td>
                    <td>
                      {percent(row.successRate)}% ({percent(row.lower)}–{percent(row.upper)})
                    </td>
                    <td>{duration(row.medianMs)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </section>

      {/* Forecast */}
      <section class="settings-card">
        <h2>{t("intelForecastTitle")}</h2>
        <Show when={forecast()}>
          {(current) => (
            <>
              <ul
                class="intel-list"
                hidden={!current().overload.some((row) => row.queued > 0 || row.busy)}
              >
                <For each={current().overload.filter((row) => row.queued > 0 || row.busy)}>
                  {(row) => (
                    <li classList={{ "intel-warn": row.overloaded }}>
                      {row.overloaded
                        ? t("intelOverloaded", { name: row.botName, reason: row.reason ?? "" })
                        : t("intelQueueRow", {
                            name: row.botName,
                            queued: String(row.queued),
                            wait: duration(row.expectedWaitMs),
                          })}{" "}
                      {sourceTag(row.source)}
                    </li>
                  )}
                </For>
              </ul>
              <Show when={!current().overload.some((row) => row.overloaded)}>
                <p class="settings-meta">{t("intelNoOverload")}</p>
              </Show>
              <h3>{t("intelRepeatedErrors")}</h3>
              <Show
                when={current().errorPatterns.some((item) => item.repeated)}
                fallback={<p class="settings-meta">{t("intelNoErrors")}</p>}
              >
                <ul class="intel-list">
                  <For
                    each={current()
                      .errorPatterns.filter((item) => item.repeated)
                      .slice(0, 6)}
                  >
                    {(item) => (
                      <li>
                        <code>
                          {t("intelErrorRow", {
                            count: String(item.count),
                            signature: item.signature,
                          })}
                        </code>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={current().bottlenecks.length > 0}>
                <h3>{t("intelBottlenecks")}</h3>
                <ul class="intel-list">
                  <For each={current().bottlenecks}>{(item) => <li>{item.detail}</li>}</For>
                </ul>
              </Show>
              <p class="settings-meta">
                {t("intelMemory", {
                  free: String(current().memory.freeMb),
                  total: String(current().memory.totalMb),
                  pressure: current().memoryPressure,
                  heavy: String(current().memory.heavyTurnMb),
                })}
              </p>
            </>
          )}
        </Show>
      </section>

      {/* Team-run plan check */}
      <section class="settings-card">
        <h2>{t("intelRunsTitle")}</h2>
        <p class="settings-meta">{t("intelRunsHint")}</p>
        <Show
          when={runs().length > 0}
          fallback={<p class="settings-meta">{t("intelRunsEmpty")}</p>}
        >
          <ul class="intel-list">
            <For each={runs()}>
              {(run) => (
                <li>
                  <button
                    type="button"
                    class="intel-link"
                    onClick={() => {
                      const bridge = api();
                      if (bridge)
                        void guard(async () => setAnalysis(await bridge.analyzeRun(run.id)));
                    }}
                  >
                    {t("intelAnalyse")}
                  </button>{" "}
                  {run.objective.slice(0, 90)} <span class="settings-meta">({run.status})</span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <Show when={analysis()}>
          {(plan) => (
            <div class="intel-advice">
              <p>
                <strong>{plan().objective.slice(0, 120)}</strong>
              </p>
              <p class="settings-meta">
                {t("intelPlanSummary", {
                  steps: String(plan().tasks.length),
                  layers: String(plan().layers.length),
                  parallel: String(plan().maxParallel),
                  time: duration(plan().predictedRemainingMs),
                  chance: percent(plan().successChance),
                })}
              </p>
              <Show when={plan().bottleneck}>
                {(item) => <p class="settings-meta">{item().detail}</p>}
              </Show>
              <table class="performance-table intel-table">
                <tbody>
                  <For each={plan().tasks}>
                    {(task) => (
                      <tr>
                        <th scope="row">
                          {task.layer ?? "—"}. {task.title}{" "}
                          <Show when={task.critical}>
                            <span class="intel-tag intel-grade-partial">{t("intelCritical")}</span>
                          </Show>
                        </th>
                        <td>{nameOf(task.botId)}</td>
                        <td>{task.status}</td>
                        <td>
                          {duration(task.durationMs)} {sourceTag(task.durationSource)}
                        </td>
                        <td>
                          {percent(task.failureRisk)}% {sourceTag(task.riskSource)}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
              <h3>{t("intelIssues")}</h3>
              <Show
                when={plan().issues.length > 0}
                fallback={<p class="settings-meta">{t("intelNoIssues")}</p>}
              >
                <ul class="intel-list">
                  <For each={plan().issues}>
                    {(issue) => (
                      <li class="intel-warn">
                        <span class="intel-tag">{issue.kind}</span> {issue.detail}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <Show when={plan().suggestions.length > 0}>
                <h3>{t("intelSuggestions")}</h3>
                <ul class="intel-list">
                  <For each={plan().suggestions}>{(item) => <li>{item.explanation}</li>}</For>
                </ul>
              </Show>
            </div>
          )}
        </Show>
      </section>

      {/* Recent work */}
      <section class="settings-card">
        <h2>{t("intelRecentTitle")}</h2>
        <Show
          when={outcomes().length > 0}
          fallback={<p class="settings-meta">{t("intelRecentEmpty")}</p>}
        >
          <ul class="intel-list intel-outcomes">
            <For each={outcomes()}>
              {(row) => (
                <li classList={{ "intel-excluded": row.excluded }}>
                  <div class="intel-outcome-head">
                    {gradeTag(row.verification, row.status === "running")}
                    <strong>{row.botName}</strong>
                    <span class="settings-meta">
                      {row.category} · {row.origin} · {new Date(row.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <p class="intel-summary">{row.summary || "—"}</p>
                  <p class="settings-meta">
                    {t("intelPredictedVsActual", {
                      predicted: percent(row.predictedFailure),
                      took: duration(row.durationMs),
                      estimated: duration(row.predictedDurationMs),
                    })}{" "}
                    {sourceTag(row.predictionSource)}
                  </p>
                  <Show when={row.verificationReasons.length > 0}>
                    <details>
                      <summary class="settings-meta">{row.labelBasis ?? row.status}</summary>
                      <ul class="intel-reasons">
                        <For each={row.verificationReasons}>{(reason) => <li>{reason}</li>}</For>
                      </ul>
                    </details>
                  </Show>
                  <Show when={row.status !== "running"}>
                    <div class="settings-buttons intel-actions">
                      <button
                        type="button"
                        aria-pressed={row.feedback === "good"}
                        onClick={() =>
                          void guard(async () => {
                            await api()?.setFeedback({
                              outcomeId: row.id,
                              feedback: row.feedback === "good" ? null : "good",
                            });
                            await load();
                          })
                        }
                      >
                        👍 {t("intelGood")}
                      </button>
                      <button
                        type="button"
                        aria-pressed={row.feedback === "bad"}
                        onClick={() =>
                          void guard(async () => {
                            await api()?.setFeedback({
                              outcomeId: row.id,
                              feedback: row.feedback === "bad" ? null : "bad",
                            });
                            await load();
                          })
                        }
                      >
                        👎 {t("intelBad")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void guard(async () => {
                            await api()?.setExcluded({
                              outcomeId: row.id,
                              excluded: !row.excluded,
                            });
                            await load();
                          })
                        }
                      >
                        {row.excluded ? t("intelInclude") : t("intelExclude")}
                      </button>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      {/* Decisions */}
      <section class="settings-card">
        <h2>{t("intelDecisionsTitle")}</h2>
        <Show
          when={decisions().length > 0}
          fallback={<p class="settings-meta">{t("intelDecisionsEmpty")}</p>}
        >
          <ul class="intel-list">
            <For each={decisions().slice(0, 20)}>
              {(item) => (
                <li>
                  <span
                    class={`intel-tag ${item.applied ? "intel-mode-adaptive" : "intel-mode-observe"}`}
                  >
                    {item.kind} · {item.applied ? t("intelApplied") : t("intelAdvice")}
                  </span>{" "}
                  {item.explanation}
                  <Show when={item.outcomeLabel !== null}>
                    {" "}
                    <span class="settings-meta">→ {percent(item.outcomeLabel)}%</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      {/* Notes */}
      <section class="settings-card">
        <h2>{t("intelNotesTitle")}</h2>
        <p class="settings-meta">{t("intelNotesHint")}</p>
        <form
          class="intel-ask"
          onSubmit={(event) => {
            event.preventDefault();
            const text = noteText().trim();
            if (!text) return;
            void guard(async () => {
              await api()?.addExperience({ kind: noteKind(), text });
              setNoteText("");
              await load();
            });
          }}
        >
          <select
            aria-label={t("intelAddNote")}
            value={noteKind()}
            onChange={(event) => setNoteKind(event.currentTarget.value as "fact" | "preference")}
          >
            <option value="fact">{t("intelNoteFact")}</option>
            <option value="preference">{t("intelNotePreference")}</option>
          </select>
          <input
            type="text"
            value={noteText()}
            maxLength={400}
            placeholder={t("intelNotePlaceholder")}
            aria-label={t("intelAddNote")}
            onInput={(event) => setNoteText(event.currentTarget.value)}
          />
          <button type="submit" disabled={!noteText().trim()}>
            {t("intelAddNote")}
          </button>
        </form>
        <Show
          when={notes().length > 0}
          fallback={<p class="settings-meta">{t("intelNotesEmpty")}</p>}
        >
          <ul class="intel-list">
            <For each={notes()}>
              {(note) => (
                <li>
                  <span class="intel-tag">{note.kind}</span>{" "}
                  <span class={`intel-tag intel-trust-${note.trust}`}>{note.trust}</span>{" "}
                  <Show
                    when={editing()?.id === note.id}
                    fallback={
                      <>
                        {note.text}{" "}
                        <button
                          type="button"
                          class="intel-link"
                          onClick={() => setEditing({ id: note.id, text: note.text })}
                        >
                          {t("intelEdit")}
                        </button>{" "}
                        <button
                          type="button"
                          class="intel-link"
                          onClick={() =>
                            void guard(async () => {
                              await api()?.deleteExperience({ id: note.id });
                              await load();
                            })
                          }
                        >
                          {t("intelDelete")}
                        </button>
                      </>
                    }
                  >
                    <form
                      class="intel-ask"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const draft = editing();
                        if (!draft?.text.trim()) return;
                        void guard(async () => {
                          await api()?.correctExperience({ id: draft.id, text: draft.text });
                          setEditing(null);
                          await load();
                        });
                      }}
                    >
                      <input
                        type="text"
                        maxLength={400}
                        value={editing()?.text ?? ""}
                        aria-label={t("intelEdit")}
                        onInput={(event) =>
                          setEditing({ id: note.id, text: event.currentTarget.value })
                        }
                      />
                      <button type="submit">{t("intelSave")}</button>
                      <button type="button" onClick={() => setEditing(null)}>
                        {t("intelCancel")}
                      </button>
                    </form>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>

      {/* Resources */}
      <section class="settings-card">
        <h2>{t("intelResourcesTitle")}</h2>
        <p class="settings-meta">{t("intelResourcesHint")}</p>
        <Show when={resources()}>
          {(current) => (
            <>
              <p class="settings-meta">
                {t("intelResourcesTotals", {
                  ops: String(current().totalOperations),
                  ms: String(current().totalMs),
                  cpu: String(current().totalCpuMs),
                  heap: String(current().heapUsedMb),
                  rss: String(current().rssMb),
                  db: bytes(current().dbBytes),
                })}
              </p>
              <Show when={current().operations.length > 0}>
                <table class="performance-table intel-table">
                  <tbody>
                    <For each={current().operations.slice(0, 12)}>
                      {(op) => (
                        <tr>
                          <th scope="row">{op.name}</th>
                          <td>{op.count}×</td>
                          <td>{op.totalMs} ms</td>
                          <td>max {op.maxMs} ms</td>
                          <td>CPU {op.cpuMs} ms</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
              <Show when={current().runtimes}>
                {(groups) => (
                  <>
                    <h3>{t("intelRuntimes")}</h3>
                    <ul class="intel-list">
                      <For each={groups()}>
                        {(group) => (
                          <li>
                            {group.label}: {group.mb} MB ({group.processes})
                          </li>
                        )}
                      </For>
                    </ul>
                  </>
                )}
              </Show>
            </>
          )}
        </Show>
      </section>

      {/* Undo learning */}
      <section class="settings-card">
        <h2>{t("intelControlsTitle")}</h2>
        <p class="settings-meta">{t("intelControlsHint")}</p>
        <Show
          when={(status()?.modelSnapshots.length ?? 0) > 0}
          fallback={<p class="settings-meta">{t("intelRollbackNone")}</p>}
        >
          <div class="settings-buttons">
            <For each={status()?.modelSnapshots ?? []}>
              {(snapshot) => (
                <button
                  type="button"
                  onClick={() =>
                    void guard(async () => {
                      const next = await api()?.rollbackModel({ snapshotId: snapshot.id });
                      if (next) setStatus(next);
                    })
                  }
                >
                  {t("intelRollback")} {snapshot.updates} (
                  {new Date(snapshot.createdAt).toLocaleDateString()})
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="settings-buttons">
          <button
            type="button"
            class="button-danger-quiet"
            onClick={() => {
              if (!window.confirm(t("intelResetConfirm"))) return;
              void guard(async () => {
                await api()?.resetLearning();
                setAdvice(null);
                setAnalysis(null);
                await load();
              });
            }}
          >
            {t("intelReset")}
          </button>
        </div>
      </section>
    </div>
  );
}
