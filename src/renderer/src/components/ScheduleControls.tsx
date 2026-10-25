import { For, Show } from "solid-js";
import type { ScheduleCadence, ScheduledTask, Weekday } from "../../../shared/ipc";
import { t } from "../i18n";
import { language } from "../preferences";

type CadenceKind = ScheduleCadence["kind"];

const CADENCE_OPTIONS: Array<{ kind: CadenceKind; label: () => string }> = [
  { kind: "once", label: () => t("scheduleOnce") },
  { kind: "hourly", label: () => t("scheduleHourly") },
  { kind: "daily", label: () => t("scheduleDaily") },
  { kind: "weekdays", label: () => t("scheduleWeekdays") },
  { kind: "weekly", label: () => t("scheduleWeekly") },
];

export interface CadenceDraft {
  kind: CadenceKind;
  time: string;
  day: Weekday;
  date: string;
}

export function defaultCadenceDraft(now = new Date()): CadenceDraft {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  return { kind: "daily", time: "09:30", day: 1, date: localDate(tomorrow) };
}

export function cadenceFromDraft(draft: CadenceDraft): ScheduleCadence {
  switch (draft.kind) {
    case "once":
      return { kind: "once", at: new Date(`${draft.date}T${draft.time}:00`).toISOString() };
    case "hourly":
      return { kind: "hourly" };
    case "weekly":
      return { kind: "weekly", day: draft.day, time: draft.time };
    default:
      return { kind: draft.kind, time: draft.time };
  }
}

function weekdayName(day: number, style: "long" | "short" = "long"): string {
  // 4 Jan 2026 is a Sunday, so 4 + day maps 0..6 onto Sunday..Saturday.
  return new Intl.DateTimeFormat(localeTag(), { weekday: style }).format(
    new Date(2026, 0, 4 + day),
  );
}

export function localeTag(): string {
  return language() === "hi" ? "hi-IN" : language() === "bn" ? "bn-IN" : "en-IN";
}

function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function describeCadence(cadence: ScheduleCadence): string {
  switch (cadence.kind) {
    case "once":
      return new Intl.DateTimeFormat(localeTag(), {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(cadence.at));
    case "hourly":
      return t("scheduleHourly");
    case "daily":
      return `${t("scheduleDaily")} · ${clockTime(cadence.time)}`;
    case "weekdays":
      return `${t("scheduleWeekdays")} · ${clockTime(cadence.time)}`;
    case "weekly":
      return `${weekdayName(cadence.day)} · ${clockTime(cadence.time)}`;
  }
}

/** "18:00" in the owner's own clock style, e.g. "6:00 pm". */
function clockTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return time;
  return new Intl.DateTimeFormat(localeTag(), { hour: "numeric", minute: "2-digit" }).format(
    new Date(2000, 0, 1, hours, minutes),
  );
}

/** Cadence picker shown above the composer when "Run on schedule" is on. */
export function CadencePicker(props: {
  draft: CadenceDraft;
  onChange: (draft: CadenceDraft) => void;
}) {
  const update = (patch: Partial<CadenceDraft>) => props.onChange({ ...props.draft, ...patch });
  return (
    <fieldset class="cadence-picker">
      <legend class="sr-only">{t("runOnSchedule")}</legend>
      <fieldset class="cadence-kinds">
        <legend class="sr-only">{t("runOnSchedule")}</legend>
        <For each={CADENCE_OPTIONS}>
          {(option) => (
            <button
              type="button"
              aria-pressed={props.draft.kind === option.kind}
              class="cadence-kind"
              classList={{ "cadence-kind-active": props.draft.kind === option.kind }}
              onClick={() => update({ kind: option.kind })}
            >
              {option.label()}
            </button>
          )}
        </For>
      </fieldset>
      <div class="cadence-fields">
        <Show when={props.draft.kind === "once"}>
          <label>
            <span>{t("scheduleOn")}</span>
            <input
              type="date"
              value={props.draft.date}
              onInput={(event) => update({ date: event.currentTarget.value })}
            />
          </label>
        </Show>
        <Show when={props.draft.kind === "weekly"}>
          <label>
            <span>{t("scheduleOn")}</span>
            <select
              value={props.draft.day}
              onChange={(event) => update({ day: Number(event.currentTarget.value) as Weekday })}
            >
              <For each={[1, 2, 3, 4, 5, 6, 0]}>
                {(day) => <option value={day}>{weekdayName(day)}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={props.draft.kind !== "hourly"}>
          <label>
            <span>{t("scheduleAt")}</span>
            <input
              type="time"
              value={props.draft.time}
              onInput={(event) => update({ time: event.currentTarget.value })}
            />
          </label>
        </Show>
      </div>
    </fieldset>
  );
}

/** The coworker's scheduled tasks, listed under the composer when scheduling is on. */
export function ScheduleList(props: {
  schedules: ScheduledTask[];
  onToggle: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  onRunNow: (task: ScheduledTask) => void;
}) {
  const formatNext = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(localeTag(), { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(value),
        )
      : "—";
  return (
    <section class="schedule-list" aria-label={t("schedules")}>
      <Show
        when={props.schedules.length > 0}
        fallback={<p class="schedule-empty">{t("noSchedules")}</p>}
      >
        <ul>
          <For each={props.schedules}>
            {(task) => (
              <li classList={{ "schedule-disabled": !task.enabled }}>
                <div class="schedule-copy">
                  <strong>{task.text}</strong>
                  <span>
                    {describeCadence(task.cadence)} · {t("nextRun")}:{" "}
                    {task.enabled ? formatNext(task.nextRunAt) : "—"}
                  </span>
                </div>
                <div class="schedule-actions">
                  <button type="button" onClick={() => props.onRunNow(task)}>
                    {t("runNow")}
                  </button>
                  <button type="button" onClick={() => props.onToggle(task)}>
                    {task.enabled ? t("disable") : t("enable")}
                  </button>
                  <button
                    type="button"
                    class="schedule-delete"
                    onClick={() => props.onDelete(task)}
                  >
                    {t("delete")}
                  </button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </section>
  );
}
