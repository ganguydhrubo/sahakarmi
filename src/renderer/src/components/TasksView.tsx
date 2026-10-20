import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import type { QueueDelivery, QueueDeliveryStatus, QueueSnapshot } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { speechLocale } from "../preferences";
import { AgentAvatar } from "./AgentAvatar";
import { VoiceInputButton } from "./VoiceInputButton";

const STATUS_LABELS: Record<QueueDeliveryStatus, MessageKey> = {
  queued: "taskQueued",
  starting: "taskRunning",
  running: "taskRunning",
  completed: "taskDone",
  failed: "taskFailed",
  interrupted: "taskStopped",
  cancelled: "taskCancelled",
};

const RECENT_LIMIT = 30;

/**
 * One box to hand work to any coworker, plus the recent tasks the owner sent across the team.
 * Sending goes through the normal message queue, so it behaves exactly like the coworker chat.
 */
export function TasksView(props: {
  bots: BotProfile[];
  queues: Record<string, QueueSnapshot>;
  defaultBotId: string;
  onSend: (botId: string, text: string) => Promise<boolean>;
  onOpenCoworker: (botId: string) => void;
}) {
  const [text, setText] = createSignal("");
  const [botId, setBotId] = createSignal(props.defaultBotId);
  const [sending, setSending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Keep the picker on a coworker that still exists in this workspace.
  createEffect(() => {
    if (!props.bots.some((bot) => bot.id === botId())) {
      setBotId(
        props.bots.find((bot) => bot.id === props.defaultBotId)?.id ?? props.bots[0]?.id ?? "",
      );
    }
  });

  const recent = createMemo(() => {
    const ids = new Set(props.bots.map((bot) => bot.id));
    const all: QueueDelivery[] = [];
    for (const [id, queue] of Object.entries(props.queues)) {
      if (!ids.has(id)) continue;
      for (const delivery of queue.deliveries) {
        if (delivery.sender.kind === "user") all.push(delivery);
      }
    }
    return all
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, RECENT_LIMIT);
  });

  async function send(event: Event) {
    event.preventDefault();
    const target = botId();
    const body = text().trim();
    if (!target || !body || sending()) return;
    setSending(true);
    setError(null);
    try {
      if (await props.onSend(target, body)) {
        setText("");
        props.onOpenCoworker(target);
      }
    } finally {
      setSending(false);
    }
  }

  const bot = (id: string) => props.bots.find((candidate) => candidate.id === id);

  return (
    <section class="center-view tasks-view" aria-labelledby="tasks-heading">
      <header class="center-view-header window-drag">
        <h1 id="tasks-heading">{t("navTasks")}</h1>
      </header>
      <div class="center-view-body">
        <form class="task-box" onSubmit={(event) => void send(event)}>
          <textarea
            aria-label={t("tasksPrompt")}
            placeholder={t("tasksPrompt")}
            rows={3}
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                void send(event);
              }
            }}
          />
          <div class="task-box-row">
            <label class="task-box-coworker">
              <span class="sr-only">{t("tasksAssignTo")}</span>
              <select
                aria-label={t("tasksAssignTo")}
                value={botId()}
                disabled={props.bots.length === 0}
                onChange={(event) => setBotId(event.currentTarget.value)}
              >
                <For each={props.bots}>
                  {(candidate) => (
                    <option value={candidate.id}>
                      {candidate.role ? `${candidate.name} · ${candidate.role}` : candidate.name}
                    </option>
                  )}
                </For>
              </select>
            </label>
            <span class="task-box-actions">
              <VoiceInputButton
                disabled={sending()}
                onTranscript={(spoken) =>
                  setText((current) => (current ? `${current.trimEnd()} ${spoken}` : spoken))
                }
                onError={setError}
              />
              <button
                type="submit"
                class="button-primary"
                disabled={!botId() || !text().trim() || sending()}
              >
                {t("tasksSend")}
              </button>
            </span>
          </div>
          <Show when={props.bots.length === 0}>
            <p class="settings-meta">{t("tasksNoCoworker")}</p>
          </Show>
          <Show when={error()}>
            <p class="center-view-error" role="alert">
              {error()}
            </p>
          </Show>
        </form>

        <h2 class="tasks-recent-heading">{t("tasksRecent")}</h2>
        <Show
          when={recent().length > 0}
          fallback={<p class="center-view-empty">{t("tasksEmpty")}</p>}
        >
          <ul class="task-list">
            <For each={recent()}>
              {(delivery) => (
                <li>
                  <button
                    type="button"
                    class="task-row"
                    onClick={() => props.onOpenCoworker(delivery.recipientBotId)}
                  >
                    <AgentAvatar bot={bot(delivery.recipientBotId)} />
                    <span class="task-row-copy">
                      <strong>{delivery.text || "—"}</strong>
                      <small>
                        {bot(delivery.recipientBotId)?.name ?? delivery.recipientBotId} ·{" "}
                        {formatWhen(delivery.createdAt)}
                      </small>
                    </span>
                    <span class={`task-status task-status-${delivery.status}`}>
                      {t(STATUS_LABELS[delivery.status])}
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </section>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(speechLocale(), { dateStyle: "short", timeStyle: "short" }).format(
    date,
  );
}
