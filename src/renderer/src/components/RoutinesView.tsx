import { createMemo, createSignal, For, Show } from "solid-js";
import { FREQUENT_INTERVAL_MINUTES, isFrequentCadence } from "../../../shared/cadence";
import type {
  Routine,
  RoutineCadence,
  RoutineDraft,
  RoutineRun,
  RoutineStep,
  RoutineStepKind,
  RoutineStepStatus,
  RoutinesState,
  RoutineTrigger,
  SaveRoutineInput,
  WorkflowImportPreview,
} from "../../../shared/ipc";
import {
  coworkerForRole,
  ROUTINE_TEMPLATES,
  type RoutineTemplate,
} from "../../../shared/routine-templates";
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
import { Tip } from "./Tip";
import { WorkflowExportMenu } from "./WorkflowExportMenu";

const RUN_STATUS: Record<RoutineRun["status"], MessageKey> = {
  running: "routineStatusRunning",
  done: "routineStatusDone",
  failed: "routineStatusFailed",
};

const STEP_STATUS: Record<RoutineStepStatus, MessageKey> = {
  queued: "stepStatusQueued",
  running: "stepStatusRunning",
  waiting: "stepStatusWaiting",
  done: "stepStatusDone",
  failed: "stepStatusFailed",
  skipped: "stepStatusSkipped",
};

type ScheduleMode = "manual" | "scheduled" | "interval" | "folder";

const STEP_KINDS: Array<[RoutineStepKind, MessageKey]> = [
  ["agent", "routineKindAgent"],
  ["condition", "routineKindCondition"],
  ["approval", "routineKindApproval"],
  ["output", "routineKindOutput"],
];

const KIND_LABEL = Object.fromEntries(STEP_KINDS) as Record<RoutineStepKind, MessageKey>;

/** In the editor every step has an id, so a condition can point at a later step. */
type DraftStep = Omit<RoutineStep, "id"> & { id: string };

const newStepId = () => crypto.randomUUID();

/** Agent and condition steps are done by a coworker; approval and output steps are not. */
const usesCoworker = (step: { kind?: RoutineStepKind }) =>
  !step.kind || step.kind === "agent" || step.kind === "condition";

interface Draft {
  id?: string;
  name: string;
  steps: DraftStep[];
  scheduleMode: ScheduleMode;
  cadence: CadenceDraft;
  minutes: number;
  /** Watched folder for the "When a file is added" trigger. */
  folder: string;
  enabled: boolean;
}

export function describeRoutineCadence(
  cadence: RoutineCadence | null,
  trigger?: RoutineTrigger | null,
): string {
  if (trigger?.kind === "folder") return t("routineFolderStarts", { folder: trigger.folder });
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
    steps: [{ id: newStepId(), botId: bots[0]?.id ?? "", instruction: "" }],
    scheduleMode: "manual",
    cadence: defaultCadenceDraft(),
    minutes: 60,
    folder: "",
    enabled: true,
  };
  if (!routine) return base;
  const draft: Draft = {
    ...base,
    id: routine.id,
    name: routine.name,
    steps: routine.steps.map((step) => structuredClone(step)),
    enabled: routine.enabled,
  };
  const cadence = routine.cadence;
  if (routine.trigger?.kind === "folder") {
    draft.scheduleMode = "folder";
    draft.folder = routine.trigger.folder;
  } else if (cadence?.kind === "interval") {
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

/** A ready-made workflow as an unsaved draft, with the owner's coworkers matched by role. */
function draftFromTemplate(template: RoutineTemplate, bots: BotProfile[]): Draft {
  const ids = new Map(template.steps.map((step) => [step.id, newStepId()]));
  const steps = template.steps.map((step): DraftStep => {
    const draftStep: DraftStep = {
      id: ids.get(step.id) as string,
      botId: usesCoworker(step) ? coworkerForRole(step.role, bots) : "",
      instruction: step.instruction,
    };
    if (step.kind) draftStep.kind = step.kind;
    if (step.onNo) {
      draftStep.onNo =
        step.onNo.action === "jump"
          ? { action: "jump", stepId: ids.get(step.onNo.stepId) as string }
          : { action: "stop" };
    }
    if (step.output) draftStep.output = structuredClone(step.output);
    return draftStep;
  });
  const draft = draftFrom(
    {
      id: "",
      name: t(template.nameKey as MessageKey),
      steps,
      cadence: template.cadence,
      enabled: true,
      createdAt: "",
      lastRunAt: null,
      nextRunAt: null,
    },
    bots,
  );
  delete draft.id;
  return draft;
}

/** A routine a coworker drafted from the owner's words, with fresh step ids for the editor. */
function draftFromDesign(design: RoutineDraft, bots: BotProfile[]): Draft {
  const ids = new Map(design.steps.map((step) => [step.id ?? "", newStepId()]));
  const steps = design.steps.map((step): DraftStep => {
    const draftStep: DraftStep = { ...structuredClone(step), id: ids.get(step.id ?? "") as string };
    if (step.onNo?.action === "jump") {
      draftStep.onNo = { action: "jump", stepId: ids.get(step.onNo.stepId) ?? "" };
    }
    return draftStep;
  });
  const draft = draftFrom(
    {
      id: "",
      name: design.name,
      steps,
      cadence: design.cadence,
      enabled: true,
      createdAt: "",
      lastRunAt: null,
      nextRunAt: null,
    },
    bots,
  );
  delete draft.id;
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
  onRerunFrom: (runId: string, stepId: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [importing, setImporting] = createSignal<WorkflowImportPreview | null>(null);
  const [assign, setAssign] = createSignal<Record<string, string>>({});
  const [notice, setNotice] = createSignal<string | null>(null);
  const [showTemplates, setShowTemplates] = createSignal(false);
  const [describing, setDescribing] = createSignal(false);
  const [wish, setWish] = createSignal("");
  const [designing, setDesigning] = createSignal(false);
  const designer = () =>
    props.bots.find((bot) => bot.role.toLowerCase() === "orchestrator") ?? props.bots[0];

  async function design() {
    const bot = designer();
    if (!bot || !wish().trim() || designing()) return;
    setDesigning(true);
    setError(null);
    setNotice(null);
    try {
      const drafted = await window.sahkarmi.routines.design({
        description: wish(),
        botId: bot.id,
      });
      setDescribing(false);
      setWish("");
      setDraft(draftFromDesign(drafted, props.bots));
      setNotice(t("routineDescribeDone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDesigning(false);
    }
  }

  function useTemplate(template: RoutineTemplate) {
    setShowTemplates(false);
    setError(null);
    setNotice(
      template.steps.some((step) => step.output?.kind === "file") ? t("tplFolderNote") : null,
    );
    setDraft(draftFromTemplate(template, props.bots));
  }

  function startImport() {
    setNotice(null);
    void act(async () => {
      const preview = await window.sahkarmi.workflow.readImport();
      if (!preview) return;
      setAssign(preview.suggestions);
      setImporting(preview);
    });
  }

  function finishImport(preview: WorkflowImportPreview) {
    void act(async () => {
      const ids = new Set(props.bots.map((bot) => bot.id));
      const stepIds = preview.doc.steps.map(() => newStepId());
      const steps = preview.doc.steps.map((step, index): DraftStep => {
        const id = stepIds[index] as string;
        if (step.kind === "approval") {
          return { id, kind: "approval", botId: "", instruction: step.do };
        }
        if (step.kind === "output") {
          return {
            id,
            kind: "output",
            botId: "",
            instruction: step.do,
            // A folder belongs to one computer, so a file output asks for one again.
            output:
              step.sendTo === "telegram" ? { kind: "telegram" } : { kind: "file", folder: "" },
          };
        }
        const botId = assign()[step.by];
        if (!botId || !ids.has(botId)) throw new Error(t("importAssign"));
        if (step.kind === "condition") {
          const target = step.ifNoSkipTo ? stepIds[step.ifNoSkipTo - 1] : undefined;
          return {
            id,
            kind: "condition",
            botId,
            instruction: step.do,
            onNo: target ? { action: "jump", stepId: target } : { action: "stop" },
          };
        }
        return { id, botId, instruction: step.do };
      });
      if (steps.some((step) => step.output?.kind === "file")) {
        // The owner picks the output folder in the editor, then saves.
        setImporting(null);
        setDraft({ ...draftFrom(null, props.bots), name: preview.doc.name, steps });
        setError(t("routineOutputFolderRequired"));
        return;
      }
      await props.onSave({ name: preview.doc.name, steps, cadence: null, enabled: true });
      setImporting(null);
      setNotice(t("importDone", { name: preview.doc.name }));
    });
  }

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
    const trigger: RoutineTrigger | null =
      current.scheduleMode === "folder" ? { kind: "folder", folder: current.folder } : null;
    if (trigger && !trigger.folder) {
      setError(t("routineFolderRequired"));
      return;
    }
    const cadence: RoutineCadence | null =
      current.scheduleMode === "manual" || current.scheduleMode === "folder"
        ? null
        : current.scheduleMode === "interval"
          ? { kind: "interval", minutes: Math.round(current.minutes) }
          : cadenceFromDraft(current.cadence);
    const missingFolder = current.steps.some(
      (step) => step.kind === "output" && step.output?.kind === "file" && !step.output.folder,
    );
    if (missingFolder) {
      setError(t("routineOutputFolderRequired"));
      return;
    }
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
        trigger,
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
  const updateStep = (index: number, patch: Partial<DraftStep>) => {
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
    [steps[index], steps[target]] = [steps[target] as DraftStep, steps[index] as DraftStep];
    updateDraft({ steps });
  };
  const setStepKind = (index: number, kind: RoutineStepKind) => {
    const current = draft();
    const step = current?.steps[index];
    if (!current || !step) return;
    const lastBot = current.steps.slice(0, index).reverse().find(usesCoworker)?.botId;
    const next: DraftStep = { id: step.id, botId: "", instruction: step.instruction };
    if (kind !== "agent") next.kind = kind;
    if (kind === "agent" || kind === "condition") {
      next.botId = step.botId || lastBot || props.bots[0]?.id || "";
    }
    if (kind === "condition") next.onNo = { action: "stop" };
    if (kind === "output") next.output = { kind: "file", folder: "" };
    updateDraft({
      steps: current.steps.map((item, position) => (position === index ? next : item)),
    });
  };
  const removeStep = (index: number) => {
    const current = draft();
    const removed = current?.steps[index];
    if (!current || !removed) return;
    // A "no" that jumped to the removed step now stops the routine.
    updateDraft({
      steps: current.steps
        .filter((_, position) => position !== index)
        .map((step) =>
          step.onNo?.action === "jump" && step.onNo.stepId === removed.id
            ? { ...step, onNo: { action: "stop" as const } }
            : step,
        ),
    });
  };

  return (
    <section class="center-view routines-view" aria-labelledby="routines-heading">
      <header class="center-view-header window-drag">
        <h1 id="routines-heading">{t("navRoutines")}</h1>
        <div class="center-view-actions">
          <button
            type="button"
            disabled={props.bots.length === 0}
            aria-pressed={describing()}
            onClick={() => {
              setShowTemplates(false);
              setDescribing(!describing());
            }}
          >
            {t("routineDescribe")}
          </button>
          <button
            type="button"
            disabled={props.bots.length === 0}
            aria-pressed={showTemplates()}
            onClick={() => {
              setDescribing(false);
              setShowTemplates(!showTemplates());
            }}
          >
            {t("tplButton")}
          </button>
          <button type="button" disabled={props.bots.length === 0 || busy()} onClick={startImport}>
            {t("importWorkflow")}
          </button>
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
        <Show when={!draft()}>
          <Tip id="routines-start" text="tipRoutinesStart" />
        </Show>
        <Show when={describing() && !draft()}>
          <section
            class="routine-describe settings-card"
            aria-labelledby="routine-describe-heading"
          >
            <h2 id="routine-describe-heading">{t("routineDescribeTitle")}</h2>
            <p class="settings-meta">
              {t("routineDescribeHelp", { name: designer()?.name ?? "" })}
            </p>
            <textarea
              rows="4"
              maxLength={4000}
              value={wish()}
              disabled={designing()}
              placeholder={t("routineDescribePlaceholder")}
              onInput={(event) => setWish(event.currentTarget.value)}
            />
            <div class="settings-buttons">
              <button
                type="button"
                class="button-primary"
                disabled={designing() || !wish().trim()}
                onClick={() => void design()}
              >
                {designing()
                  ? t("routineDescribeBusy", { name: designer()?.name ?? "" })
                  : t("routineDescribeBuild")}
              </button>
              <button type="button" disabled={designing()} onClick={() => setDescribing(false)}>
                {t("routineCancel")}
              </button>
            </div>
          </section>
        </Show>
        <Show when={showTemplates() && !draft()}>
          <section class="routine-templates" aria-labelledby="routine-templates-heading">
            <h2 id="routine-templates-heading">{t("tplTitle")}</h2>
            <p class="settings-meta">{t("tplIntro")}</p>
            <ul class="routine-template-grid">
              <For each={ROUTINE_TEMPLATES}>
                {(template) => (
                  <li class="routine-template-card">
                    <strong>{t(template.nameKey as MessageKey)}</strong>
                    <p>{t(template.descriptionKey as MessageKey)}</p>
                    <small>
                      {t("tplSteps", { count: String(template.steps.length) })} ·{" "}
                      {describeRoutineCadence(template.cadence)}
                    </small>
                    <button
                      type="button"
                      class="button-primary"
                      onClick={() => useTemplate(template)}
                    >
                      {t("tplUse")}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>
        <Show when={notice()}>
          <p class="settings-meta" role="status">
            {notice()}
          </p>
        </Show>
        <Show when={importing()}>
          {(preview) => (
            <section class="workflow-import settings-card" aria-label={t("importWorkflow")}>
              <h2>{t("importTitle", { name: preview().doc.name })}</h2>
              <p class="settings-meta">
                {t("importSteps", { count: String(preview().doc.steps.length) })}
              </p>
              <ol class="workflow-import-steps">
                <For each={preview().doc.steps}>
                  {(step) => (
                    <li>
                      <strong>
                        {step.kind === "approval" || step.kind === "output"
                          ? t(KIND_LABEL[step.kind])
                          : step.by || "—"}
                        :
                      </strong>{" "}
                      {step.do.split(/\r?\n/)[0]}
                    </li>
                  )}
                </For>
              </ol>
              <h3>{t("importAssign")}</h3>
              <For
                each={[
                  ...new Set(
                    preview()
                      .doc.steps.filter((step) => !step.kind || step.kind === "condition")
                      .map((step) => step.by),
                  ),
                ]}
              >
                {(name) => (
                  <label class="voice-field">
                    <span>{name || "—"}</span>
                    <select
                      value={assign()[name] ?? ""}
                      onChange={(event) => {
                        const botId = event.currentTarget.value;
                        setAssign((current) => ({ ...current, [name]: botId }));
                      }}
                    >
                      <For each={props.bots}>
                        {(bot) => <option value={bot.id}>{bot.name}</option>}
                      </For>
                    </select>
                  </label>
                )}
              </For>
              <div class="settings-buttons">
                <button
                  type="button"
                  class="button-primary"
                  disabled={busy()}
                  onClick={() => finishImport(preview())}
                >
                  {t("importCreate")}
                </button>
                <button type="button" disabled={busy()} onClick={() => setImporting(null)}>
                  {t("importCancel")}
                </button>
              </div>
            </section>
          )}
        </Show>
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
                              <div class="routine-node-head">
                                <span class="routine-trigger-icon" aria-hidden="true">
                                  <svg
                                    viewBox="0 0 24 24"
                                    width="18"
                                    height="18"
                                    aria-hidden="true"
                                  >
                                    <circle
                                      cx="12"
                                      cy="12"
                                      r="9"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="2"
                                    />
                                    <path
                                      d="M12 7v5l3 2"
                                      fill="none"
                                      stroke="currentColor"
                                      stroke-width="2"
                                      stroke-linecap="round"
                                    />
                                  </svg>
                                </span>
                                <span>
                                  <small>{t("routineStarts")}</small>
                                  <strong>
                                    {describeRoutineCadence(routine().cadence, routine().trigger)}
                                  </strong>
                                </span>
                                <span
                                  class="routine-state-pill"
                                  classList={{ "routine-state-paused": !routine().enabled }}
                                >
                                  {routine().enabled ? t("routineActive") : t("paused")}
                                </span>
                              </div>
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
                                      <Show
                                        when={usesCoworker(step)}
                                        fallback={
                                          <span class="routine-kind-icon" aria-hidden="true">
                                            {step.kind === "approval" ? "✋" : "📤"}
                                          </span>
                                        }
                                      >
                                        <AgentAvatar bot={botFor(step.botId)} />
                                      </Show>
                                      <span>
                                        <small>
                                          {t("routineStepN", { n: String(index() + 1) })}
                                          <Show when={step.kind && step.kind !== "agent"}>
                                            {" · "}
                                            {t(KIND_LABEL[step.kind ?? "agent"])}
                                          </Show>
                                        </small>
                                        <Show
                                          when={usesCoworker(step)}
                                          fallback={
                                            <strong>
                                              {step.kind === "approval"
                                                ? t("routineApprovalYou")
                                                : step.output?.kind === "telegram"
                                                  ? t("routineOutputTelegram")
                                                  : step.output?.kind === "file"
                                                    ? step.output.folder
                                                    : ""}
                                            </strong>
                                          }
                                        >
                                          <strong>{botFor(step.botId)?.name ?? step.botId}</strong>
                                          <Show when={botFor(step.botId)?.role}>
                                            {(role) => <small>{role()}</small>}
                                          </Show>
                                        </Show>
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
                                    <Show when={step.instruction}>
                                      <p class="routine-node-text">{step.instruction}</p>
                                    </Show>
                                    <Show when={stepRun(step.id)?.result}>
                                      {(result) => <p class="routine-node-result">{result()}</p>}
                                    </Show>
                                    <Show when={stepRun(step.id)?.reused}>
                                      <small class="routine-node-reused">
                                        {t("routineReused")}
                                      </small>
                                    </Show>
                                    <Show
                                      when={
                                        last() &&
                                        last()?.status !== "running" &&
                                        stepRun(step.id) &&
                                        index() > 0
                                      }
                                    >
                                      <button
                                        type="button"
                                        class="routine-rerun"
                                        disabled={busy()}
                                        title={t("routineRerunHelp")}
                                        onClick={() =>
                                          void act(() =>
                                            props.onRerunFrom(last()?.id ?? "", step.id),
                                          )
                                        }
                                      >
                                        ↻ {t("routineRerunHere")}
                                      </button>
                                    </Show>
                                  </li>
                                );
                              }}
                            </For>
                          </ol>
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
                              <WorkflowExportMenu
                                options={[
                                  {
                                    label: "exportButton",
                                    source: { kind: "routine", routineId: routine().id },
                                  },
                                ]}
                              />
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
                            <Tip id="routine-runs" text="tipRoutineRun" />
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
                                        : run.trigger === "folder"
                                          ? t("routineTriggerFolder")
                                          : run.trigger === "rerun"
                                            ? t("routineTriggerRerun")
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
              <Tip id="routine-editor" text="tipRoutineEditor" />
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
                        ["folder", "routineOnFolder"],
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
                <Show when={current().scheduleMode === "folder"}>
                  <div class="routine-folder-trigger">
                    <span>{t("routineFolderLabel")}</span>
                    <code class="routine-folder-path" data-testid="routine-folder-path">
                      {current().folder || t("routineFolderNone")}
                    </code>
                    <button
                      type="button"
                      onClick={() =>
                        void act(async () => {
                          const folder = await window.sahkarmi.routines.pickFolder();
                          if (folder) updateDraft({ folder });
                        })
                      }
                    >
                      {t("routineFolderChoose")}
                    </button>
                    <p class="settings-meta">{t("routineFolderHelp")}</p>
                  </div>
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
                            <span>{t("routineStepKind")}</span>
                            <select
                              value={step.kind ?? "agent"}
                              onChange={(event) =>
                                setStepKind(index(), event.currentTarget.value as RoutineStepKind)
                              }
                            >
                              <For each={STEP_KINDS}>
                                {([kind, label]) => <option value={kind}>{t(label)}</option>}
                              </For>
                            </select>
                          </label>
                          <Show when={usesCoworker(step)}>
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
                          </Show>
                          <Show when={step.kind !== "output"}>
                            <label>
                              <span>
                                {t(
                                  step.kind === "condition"
                                    ? "routineConditionQuestion"
                                    : step.kind === "approval"
                                      ? "routineApprovalQuestion"
                                      : "routineStepInstruction",
                                )}
                              </span>
                              <textarea
                                required
                                rows={step.kind === "condition" || step.kind === "approval" ? 2 : 3}
                                value={step.instruction}
                                placeholder={
                                  step.kind === "condition"
                                    ? t("routineConditionPlaceholder")
                                    : step.kind === "approval"
                                      ? t("routineApprovalPlaceholder")
                                      : undefined
                                }
                                onInput={(event) =>
                                  updateStep(index(), { instruction: event.currentTarget.value })
                                }
                              />
                            </label>
                          </Show>
                          <Show when={step.kind === "condition"}>
                            <label>
                              <span>{t("routineConditionNo")}</span>
                              <select
                                value={step.onNo?.action === "jump" ? step.onNo.stepId : ""}
                                onChange={(event) => {
                                  const target = event.currentTarget.value;
                                  updateStep(index(), {
                                    onNo: target
                                      ? { action: "jump", stepId: target }
                                      : { action: "stop" },
                                  });
                                }}
                              >
                                <option value="">{t("routineConditionStop")}</option>
                                <For each={current().steps.slice(index() + 2)}>
                                  {(later) => (
                                    <option value={later.id}>
                                      {t("routineConditionJump", {
                                        n: String(current().steps.indexOf(later) + 1),
                                      })}
                                    </option>
                                  )}
                                </For>
                              </select>
                            </label>
                            <p class="settings-meta">{t("routineConditionHelp")}</p>
                          </Show>
                          <Show when={step.kind === "approval"}>
                            <p class="settings-meta">{t("routineApprovalHelp")}</p>
                          </Show>
                          <Show when={step.kind === "output"}>
                            <fieldset class="routine-output-choice">
                              <legend>{t("routineOutputWhere")}</legend>
                              <label class="activity-check">
                                <input
                                  type="radio"
                                  name={`output-${step.id}`}
                                  checked={step.output?.kind !== "telegram"}
                                  onChange={() =>
                                    updateStep(index(), {
                                      output: {
                                        kind: "file",
                                        folder:
                                          step.output?.kind === "file" ? step.output.folder : "",
                                      },
                                    })
                                  }
                                />
                                <span>{t("routineOutputFile")}</span>
                              </label>
                              <Show when={step.output?.kind !== "telegram"}>
                                <div class="routine-folder-trigger">
                                  <code class="routine-folder-path">
                                    {(step.output?.kind === "file" && step.output.folder) ||
                                      t("routineFolderNone")}
                                  </code>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void act(async () => {
                                        const folder = await window.sahkarmi.routines.pickFolder();
                                        if (folder) {
                                          updateStep(index(), { output: { kind: "file", folder } });
                                        }
                                      })
                                    }
                                  >
                                    {t("routineFolderChoose")}
                                  </button>
                                </div>
                              </Show>
                              <label class="activity-check">
                                <input
                                  type="radio"
                                  name={`output-${step.id}`}
                                  checked={step.output?.kind === "telegram"}
                                  onChange={() =>
                                    updateStep(index(), { output: { kind: "telegram" } })
                                  }
                                />
                                <span>{t("routineOutputTelegram")}</span>
                              </label>
                            </fieldset>
                          </Show>
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
                            onClick={() => removeStep(index())}
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
                          id: newStepId(),
                          botId:
                            [...current().steps].reverse().find(usesCoworker)?.botId ??
                            props.bots[0]?.id ??
                            "",
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
