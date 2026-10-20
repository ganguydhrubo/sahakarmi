import { createMemo, createSignal, For, Show } from "solid-js";
import { FREQUENT_INTERVAL_MINUTES, isFrequentCadence } from "../../../shared/cadence";
import type {
  Routine,
  RoutineCadence,
  RoutineRun,
  RoutineStepStatus,
  RoutinesState,
  SaveRoutineInput,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";
import {
  type CadenceDraft,
  CadencePicker,
  cadenceFromDraft,
  defaultCadenceDraft,
  describeCadence,
  localeTag,
} from "./ScheduleControls";

const RUN_STATUS: Record<RoutineRun["status"], MessageKey> = {
  running: "routineStatusRunning",
  done: "routineStatusDone",
  failed: "routineStatusFailed",
};

const STEP_STATUS: Record<RoutineStepStatus, MessageKey> = {
  queued: "stepStatusQueued",
  running: "stepStatusRunning",
  done: "stepStatusDone",
  failed: "stepStatusFailed",
  skipped: "stepStatusSkipped",
};

type ScheduleMode = "manual" | "scheduled" | "interval";

interface Draft {
  id?: string;
  name: string;
  steps: Array<{ id?: string; botId: string; instruction: string }>;
  scheduleMode: ScheduleMode;
  cadence: CadenceDraft;
  minutes: number;
  enabled: boolean;
}

export function describeRoutineCadence(cadence: RoutineCadence | null): string {
  if (!cadence) return t("routineManual");
  if (cadence.kind === "interval") return `${t("routineEvery")} · ${cadence.minutes} min`;
  return describeCadence(cadence);
}

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat(localeTag(), { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function draftFrom(routine: Routine | null, bots: BotProfile[]): Draft {
  const base: Draft = {
    name: "",
    steps: [{ botId: bots[0]?.id ?? "", instruction: "" }],
    scheduleMode: "manual",
    cadence: defaultCadenceDraft(),
    minutes: 60,
    enabled: true,
  };
  if (!routine) return base;
  const draft: Draft = {
    ...base,
    id: routine.id,
    name: routine.name,
    steps: routine.steps.map((step) => ({ ...step })),
    enabled: routine.enabled,
  };
  const cadence = routine.cadence;
  if (cadence?.kind === "interval") {
    draft.scheduleMode = "interval";
    draft.minutes = cadence.minutes;
  } else if (cadence) {
    draft.scheduleMode = "scheduled";
    draft.cadence = {
      kind: cadence.kind,
      time: "time" in cadence ? cadence.time : base.cadence.time,
      day: cadence.kind === "weekly" ? cadence.day : base.cadence.day,
      date: cadence.kind === "once" ? cadence.at.slice(0, 10) : base.cadence.date,
    };
  }
  return draft;
}

/** Routines: chains of coworker steps that run on a schedule or with Run now. */
export function RoutinesView(props: {
  state: RoutinesState;
  bots: BotProfile[];
  onSave: (input: SaveRoutineInput) => Promise<void>;
  onDelete: (routineId: string) => Promise<void>;
  onSetEnabled: (routineId: string, enabled: boolean) => Promise<void>;
  onRunNow: (routineId: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const selected = createMemo(
    () =>
      props.state.routines.find((routine) => routine.id === selectedId()) ??
      props.state.routines[0] ??
      null,
  );
  const runsOf = (routineId: string) =>
    props.state.runs.filter((run) => run.routineId === routineId);
  const botFor = (botId: string) => props.bots.find((bot) => bot.id === botId);

  async function act(action: () => Promise<void>) {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save(current: Draft) {
    const cadence: RoutineCadence | null =
      current.scheduleMode === "manual"
        ? null
        : current.scheduleMode === "interval"
          ? { kind: "interval", minutes: Math.round(current.minutes) }
          : cadenceFromDraft(current.cadence);
    let confirmFrequent = false;
    if (cadence && isFrequentCadence(cadence)) {
      if (!window.confirm(t("routineFrequentConfirm"))) return;
      confirmFrequent = true;
    }
    await act(async () => {
      await props.onSave({
        id: current.id,
        name: current.name,
        steps: current.steps,
        cadence,
        enabled: current.enabled,
        confirmFrequent,
      });
      setDraft(null);
    });
  }

  const updateDraft = (patch: Partial<Draft>) => {
    const current = draft();
    if (current) setDraft({ ...current, ...patch });
  };
  const updateStep = (index: number, patch: Partial<Draft["steps"][number]>) => {
    const current = draft();
    if (!current) return;
    updateDraft({
      steps: current.steps.map((step, position) =>
        position === index ? { ...step, ...patch } : step,
      ),
    });
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    const current = draft();
    if (!current) return;
    const steps = [...current.steps];
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    [steps[index], steps[target]] = [
      steps[target] as Draft["steps"][number],
      steps[index] as Draft["steps"][number],
    ];
    updateDraft({ steps });
  };

  return (
    <section class="center-view routines-view" aria-labelledby="routines-heading">
      <header class="center-view-header window-drag">
        <h1 id="routines-heading">{t("navRoutines")}</h1>
        <div class="center-view-actions">
          <button
            type="button"
            class="button-primary"
            disabled={props.bots.length === 0}
            onClick={() => setDraft(draftFrom(null, props.bots))}
          >
            {t("routineNew")}
          </button>
        </div>
      </header>
      <div class="center-view-body">
        <p class="center-view-intro">{t("routinesIntro")}</p>
        <Show when={error()}>
          <p class="center-view-error" role="alert">
            {error()}
          </p>
        </Show>
        <Show
          when={draft()}
          fallback={
            <Show
              when={props.state.routines.length > 0}
              fallback={<p class="center-view-empty">{t("routineEmpty")}</p>}
            >
              <div class="routines-layout">
                <label class="routine-switcher">
                  <span class="sr-only">{t("navRoutines")}</span>
                  <select
                    value={selected()?.id ?? ""}
                    onChange={(event) => setSelectedId(event.currentTarget.value)}
                  >
                    <For each={props.state.routines}>
                      {(routine) => <option value={routine.id}>{routine.name}</option>}
                    </For>
                  </select>
                </label>

                <Show when={selected()}>
                  {(routine) => {
                    const last = () => runsOf(routine().id)[0];
                    const stepRun = (stepId: string) =>
                      last()?.steps.find((step) => step.stepId === stepId);
                    return (
                      <article class="routine-details" aria-label={t("routineDetails")}>
                        <div class="routine-canvas">
                          <div class="routine-canvas-title">{routine().name}</div>
                          <ol class="routine-diagram">
                            <li class="routine-node routine-node-trigger">
                              <small>{t("routineStarts")}</small>
                              <strong>{describeRoutineCadence(routine().cadence)}</strong>
                              <Show when={routine().enabled && routine().nextRunAt}>
                                {(next) => (
                                  <small>
                                    {t("nextRun")}: {formatWhen(next())}
                                  </small>
                                )}
                              </Show>
                            </li>
                            <For each={routine().steps}>
                              {(step, index) => {
                                const status = () => stepRun(step.id)?.status;
                                return (
                                  <li
                                    class="routine-node"
                                    classList={{ [`routine-node-${status()}`]: Boolean(status()) }}
                                  >
                                    <div class="routine-node-head">
                                      <AgentAvatar bot={botFor(step.botId)} />
                                      <span>
                                        <small>
                                          {t("routineStepN", { n: String(index() + 1) })}
                                        </small>
                                        <strong>{botFor(step.botId)?.name ?? step.botId}</strong>
                                      </span>
                                      <Show when={status()}>
                                        {(value) => (
                                          <span
                                            class={`routine-step-status routine-step-${value()}`}
                                          >
                                            {t(STEP_STATUS[value()])}
                                          </span>
                                        )}
                                      </Show>
                                    </div>
                                    <p class="routine-node-text">{step.instruction}</p>
                                    <Show when={stepRun(step.id)?.result}>
                                      {(result) => <p class="routine-node-result">{result()}</p>}
                                    </Show>
                                  </li>
                                );
                              }}
                            </For>
                          </ol>{" "}
                        </div>
                        <aside class="routine-inspector">
                          <header class="routine-details-head">
                            <div>
                              <h2>{routine().name}</h2>
                              <p class="settings-meta">
                                {t("routineLastRun")}:{" "}
                                <Show when={last()} fallback={t("routineNeverRun")}>
                                  {(run) => (
                                    <>
                                      <span class={`routine-run-pill routine-run-${run().status}`}>
                                        {t(RUN_STATUS[run().status])}
                                      </span>{" "}
                                      {formatWhen(run().startedAt)}
                                    </>
                                  )}
                                </Show>
                              </p>
                            </div>
                            <div class="routine-actions">
                              <button
                                type="button"
                                class="button-primary"
                                disabled={busy() || last()?.status === "running"}
                                onClick={() => void act(() => props.onRunNow(routine().id))}
                              >
                                ▶ {t("runNow")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDraft(draftFrom(routine(), props.bots))}
                              >
                                {t("routineEdit")}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void act(() =>
                                    props.onSetEnabled(routine().id, !routine().enabled),
                                  )
                                }
                              >
                                {routine().enabled ? t("disable") : t("enable")}
                              </button>
                              <button
                                type="button"
                                class="button-danger-quiet"
                                onClick={() => {
                                  if (window.confirm(t("routineDeleteConfirm"))) {
                                    void act(() => props.onDelete(routine().id));
                                  }
                                }}
                              >
                                {t("routineDelete")}
                              </button>
                            </div>
                          </header>
                          <Show when={runsOf(routine().id).length > 0}>
                            <h3>{t("routineRunHistory")}</h3>
                            <ul class="routine-history">
                              <For each={runsOf(routine().id).slice(0, 8)}>
                                {(run) => (
                                  <li>
                                    <span class={`routine-run-pill routine-run-${run.status}`}>
                                      {t(RUN_STATUS[run.status])}
                                    </span>
                                    <span>{formatWhen(run.startedAt)}</span>
                                    <small>
                                      {run.trigger === "manual"
                                        ? t("routineTriggerManual")
                                        : t("routineTriggerSchedule")}{" "}
                                      · {run.steps.filter((step) => step.status === "done").length}/
                                      {run.steps.length}
                                    </small>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Show>
                        </aside>
                      </article>
                    );
                  }}
                </Show>
              </div>
            </Show>
          }
        >
          {(current) => (
            <form
              class="routine-editor"
              onSubmit={(event) => {
                event.preventDefault();
                void save(current());
              }}
            >
              <label class="routine-field">
                <span>{t("routineName")}</span>
                <input
                  required
                  maxLength={80}
                  value={current().name}
                  placeholder={t("routineNamePlaceholder")}
                  onInput={(event) => updateDraft({ name: event.currentTarget.value })}
                />
              </label>
              <fieldset class="routine-field">
                <legend>{t("routineSchedule")}</legend>
                <div class="cadence-kinds">
                  <For
                    each={
                      [
                        ["manual", "routineManual"],
                        ["scheduled", "routineScheduled"],
                        ["interval", "routineEvery"],
                      ] as Array<[ScheduleMode, MessageKey]>
                    }
                  >
                    {([mode, label]) => (
                      <button
                        type="button"
                        class="cadence-kind"
                        aria-pressed={current().scheduleMode === mode}
                        classList={{ "cadence-kind-active": current().scheduleMode === mode }}
                        onClick={() => updateDraft({ scheduleMode: mode })}
                      >
                        {t(label)}
                      </button>
                    )}
                  </For>
                </div>
                <Show when={current().scheduleMode === "scheduled"}>
                  <CadencePicker
                    draft={current().cadence}
                    onChange={(cadence) => updateDraft({ cadence })}
                  />
                </Show>
                <Show when={current().scheduleMode === "interval"}>
                  <label>
                    <span>{t("routineEveryMinutes")}</span>
                    <input
                      type="number"
                      min="1"
                      max="10080"
                      value={current().minutes}
                      onInput={(event) =>
                        updateDraft({ minutes: Number(event.currentTarget.value) })
                      }
                    />
                  </label>
                  <Show when={current().minutes < FREQUENT_INTERVAL_MINUTES}>
                    <p class="settings-meta routine-warning">{t("routineFrequentConfirm")}</p>
                  </Show>
                </Show>
              </fieldset>
              <fieldset class="routine-field">
                <legend>{t("routineSteps")}</legend>
                <ol class="routine-step-editor">
                  <For each={current().steps}>
                    {(step, index) => (
                      <li>
                        <span class="routine-step-number">{index() + 1}</span>
                        <div class="routine-step-fields">
                          <label>
                            <span>{t("routineStepCoworker")}</span>
                            <select
                              value={step.botId}
                              onChange={(event) =>
                                updateStep(index(), { botId: event.currentTarget.value })
                              }
                            >
                              <For each={props.bots}>
                                {(bot) => <option value={bot.id}>{bot.name}</option>}
                              </For>
                            </select>
                          </label>
                          <label>
                            <span>{t("routineStepInstruction")}</span>
                            <textarea
                              required
                              rows="3"
                              value={step.instruction}
                              onInput={(event) =>
                                updateStep(index(), { instruction: event.currentTarget.value })
                              }
                            />
                          </label>
                        </div>
                        <div class="routine-step-tools">
                          <button
                            type="button"
                            aria-label={t("routineMoveUp")}
                            disabled={index() === 0}
                            onClick={() => moveStep(index(), -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={t("routineMoveDown")}
                            disabled={index() === current().steps.length - 1}
                            onClick={() => moveStep(index(), 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            aria-label={t("routineRemoveStep")}
                            disabled={current().steps.length === 1}
                            onClick={() =>
                              updateDraft({
                                steps: current().steps.filter(
                                  (_, position) => position !== index(),
                                ),
                              })
                            }
                          >
                            ✕
                          </button>
                        </div>
                      </li>
                    )}
                  </For>
                </ol>
                <button
                  type="button"
                  disabled={current().steps.length >= 20}
                  onClick={() =>
                    updateDraft({
                      steps: [
                        ...current().steps,
                        {
                          botId: current().steps.at(-1)?.botId ?? props.bots[0]?.id ?? "",
                          instruction: "",
                        },
                      ],
                    })
                  }
                >
                  + {t("routineAddStep")}
                </button>
              </fieldset>
              <label class="activity-check">
                <input
                  type="checkbox"
                  checked={current().enabled}
                  onChange={(event) => updateDraft({ enabled: event.currentTarget.checked })}
                />
                <span>{t("routineEnabled")}</span>
              </label>
              <div class="settings-buttons">
                <button type="button" onClick={() => setDraft(null)}>
                  {t("routineCancel")}
                </button>
                <button type="submit" class="button-primary" disabled={busy()}>
                  {t("routineSave")}
                </button>
              </div>
            </form>
          )}
        </Show>
      </div>
    </section>
  );
}
