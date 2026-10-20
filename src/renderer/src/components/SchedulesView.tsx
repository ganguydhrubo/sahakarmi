import { For, Show } from "solid-js";
import type { ScheduledTask } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";
import { ScheduleList } from "./ScheduleControls";

/** Every scheduled task in one place, grouped by coworker. */
export function SchedulesView(props: {
  schedules: ScheduledTask[];
  bots: BotProfile[];
  onToggle: (task: ScheduledTask) => void;
  onDelete: (task: ScheduledTask) => void;
  onRunNow: (task: ScheduledTask) => void;
  onOpenCoworker: (botId: string) => void;
}) {
  const groups = () =>
    props.bots
      .map((bot) => ({ bot, tasks: props.schedules.filter((task) => task.botId === bot.id) }))
      .filter((group) => group.tasks.length > 0);
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
