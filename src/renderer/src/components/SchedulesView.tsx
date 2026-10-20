import { createMemo, createSignal, For, Show } from "solid-js";
import type { Routine, RoutineRun, ScheduledTask } from "../../../shared/ipc";
import {
  type CalendarEntry,
  type CalendarMode,
  calendarDays,
  calendarEntries,
  calendarRange,
  sameDay,
  shiftAnchor,
  upcomingRuns,
} from "../calendar";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";
import { localeTag, ScheduleList } from "./ScheduleControls";

/** Entries shown per day before collapsing into "+N more" (week and month views). */
const MAX_PER_DAY = 3;

const MODES: Array<{ mode: CalendarMode; label: MessageKey }> = [
  { mode: "day", label: "calendarDay" },
  { mode: "week", label: "calendarWeek" },
  { mode: "month", label: "calendarMonth" },
];

const STATE_LABELS: Record<Exclude<CalendarEntry["state"], "upcoming">, MessageKey> = {
  ran: "calendarRan",
  running: "routineStatusRunning",
  done: "routineStatusDone",
  failed: "routineStatusFailed",
};

/** Every scheduled task and routine on a calendar, plus the task list grouped by coworker. */
export function SchedulesView(props: {
  schedules: ScheduledTask[];
  routines?: Routine[];
  runs?: RoutineRun[];
  bots: BotProfile[];
  /** Injected for tests; defaults to the current time. */
  now?: Date;
  onToggle: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  onRunNow: (task: ScheduledTask) => void;
  onOpenCoworker: (botId: string) => void;
}) {
  const groups = () =>
    props.bots
      .map((bot) => ({ bot, tasks: props.schedules.filter((task) => task.botId === bot.id) }))
      .filter((group) => group.tasks.length > 0);
  const now = () => props.now ?? new Date();
  const upcoming = createMemo(() => upcomingRuns(props.schedules, props.routines ?? [], now()));
  const botFor = (botId: string | null) => props.bots.find((bot) => bot.id === botId);
  const time = (date: Date) =>
    new Intl.DateTimeFormat(localeTag(), { timeStyle: "short" }).format(date);
  const when = (date: Date) =>
    new Intl.DateTimeFormat(localeTag(), {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
  return (
    <section class="center-view schedules-view" aria-labelledby="schedules-heading">
      <header class="center-view-header window-drag">
        <h1 id="schedules-heading">{t("navSchedules")}</h1>
        <Show when={props.schedules.length > 0}>
          <span class="center-view-badge">
            {props.schedules.filter((task) => task.enabled).length}
          </span>
        </Show>
      </header>
      <div class="center-view-body">
        <p class="center-view-intro">{t("schedulesIntro")}</p>
        <ScheduleCalendar
          schedules={props.schedules}
          routines={props.routines ?? []}
          runs={props.runs ?? []}
          bots={props.bots}
          now={now()}
        />
        <section class="upcoming-runs" aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading">{t("upcomingRuns")}</h2>
          <Show
            when={upcoming().length > 0}
            fallback={<p class="center-view-empty">{t("upcomingEmpty")}</p>}
          >
            <ul>
              <For each={upcoming()}>
                {(entry) => (
                  <li>
                    <AgentAvatar bot={botFor(entry.botId)} />
                    <span class="upcoming-title">
                      <strong>{entry.title}</strong>
                      <small>
                        {when(entry.at)} · {time(entry.at)}
                        <Show when={entry.kind === "routine"}> · {t("calendarRoutine")}</Show>
                      </small>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>
        <h2 class="schedules-subheading">{t("calendarAllTasks")}</h2>
        <Show
          when={groups().length > 0}
          fallback={<p class="center-view-empty">{t("noSchedules")}</p>}
        >
          <For each={groups()}>
            {(group) => (
              <section class="schedules-group" aria-label={group.bot.name}>
                <button
                  type="button"
                  class="approval-coworker"
                  onClick={() => props.onOpenCoworker(group.bot.id)}
                >
                  <AgentAvatar bot={group.bot} />
                  <span>
                    <strong>{group.bot.name}</strong>
                    <small>{group.bot.role}</small>
                  </span>
                </button>
                <ScheduleList
                  schedules={group.tasks}
                  onToggle={props.onToggle}
                  onDelete={props.onDelete}
                  onRunNow={props.onRunNow}
                />
              </section>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}

function ScheduleCalendar(props: {
  schedules: ScheduledTask[];
  routines: Routine[];
  runs: RoutineRun[];
  bots: BotProfile[];
  now: Date;
}) {
  const [mode, setMode] = createSignal<CalendarMode>("week");
  const [anchor, setAnchor] = createSignal(new Date(props.now));
  const days = createMemo(() => calendarDays(mode(), anchor()));
  const entries = createMemo(() => {
    const { start, end } = calendarRange(mode(), anchor());
    return calendarEntries(props.schedules, props.routines, props.runs, start, end, props.now);
  });
  const entriesOn = (day: Date) => entries().filter((entry) => sameDay(entry.at, day));
  const title = () => {
    const { start, end } = calendarRange(mode(), anchor());
    if (mode() === "day") {
      return new Intl.DateTimeFormat(localeTag(), { dateStyle: "full" }).format(start);
    }
    if (mode() === "month") {
      return new Intl.DateTimeFormat(localeTag(), { month: "long", year: "numeric" }).format(
        anchor(),
      );
    }
    const format = new Intl.DateTimeFormat(localeTag(), { day: "numeric", month: "short" });
    return `${format.format(start)} – ${format.format(new Date(end.getTime() - 1))}`;
  };
  const time = (date: Date) =>
    new Intl.DateTimeFormat(localeTag(), { timeStyle: "short" }).format(date);
  const dayLabel = (day: Date) =>
    new Intl.DateTimeFormat(localeTag(), {
      weekday: mode() === "month" ? undefined : "short",
      day: "numeric",
    }).format(day);
  const outsideMonth = (day: Date) => mode() === "month" && day.getMonth() !== anchor().getMonth();

  return (
    <section class="schedule-calendar" aria-label={title()}>
      <div class="calendar-toolbar">
        <div class="calendar-nav">
          <button
            type="button"
            aria-label={t("calendarPrevious")}
            onClick={() => setAnchor(shiftAnchor(mode(), anchor(), -1))}
          >
            ‹
          </button>
          <button type="button" onClick={() => setAnchor(new Date(props.now))}>
            {t("calendarToday")}
          </button>
          <button
            type="button"
            aria-label={t("calendarNext")}
            onClick={() => setAnchor(shiftAnchor(mode(), anchor(), 1))}
          >
            ›
          </button>
          <strong class="calendar-title">{title()}</strong>
        </div>
        <fieldset class="calendar-modes">
          <legend class="sr-only">{t("navSchedules")}</legend>
          <For each={MODES}>
            {(option) => (
              <button
                type="button"
                aria-pressed={mode() === option.mode}
                classList={{ "calendar-mode-active": mode() === option.mode }}
                onClick={() => setMode(option.mode)}
              >
                {t(option.label)}
              </button>
            )}
          </For>
        </fieldset>
      </div>
      <div class={`calendar-grid calendar-${mode()}`}>
        <For each={days()}>
          {(day) => {
            const items = () => entriesOn(day);
            const shown = () => (mode() === "day" ? items() : items().slice(0, MAX_PER_DAY));
            const hidden = () => items().length - shown().length;
            return (
              <div
                class="calendar-day"
                classList={{
                  "calendar-day-today": sameDay(day, props.now),
                  "calendar-day-outside": outsideMonth(day),
                }}
              >
                <div class="calendar-day-label">{dayLabel(day)}</div>
                <ul>
                  <For each={shown()}>
                    {(entry) => (
                      <li
                        class={`calendar-entry calendar-entry-${entry.state}`}
                        title={entry.title}
                      >
                        <span class="calendar-entry-time">{time(entry.at)}</span>
                        <span class="calendar-entry-title">{entry.title}</span>
                        <Show when={entry.state !== "upcoming"}>
                          <span class="calendar-entry-state">
                            {t(STATE_LABELS[entry.state as keyof typeof STATE_LABELS])}
                          </span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={hidden() > 0}>
                  <button
                    type="button"
                    class="calendar-more"
                    onClick={() => {
                      setAnchor(day);
                      setMode("day");
                    }}
                  >
                    {t("calendarMore", { count: String(hidden()) })}
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </section>
  );
}
