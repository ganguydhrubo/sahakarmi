import { createMemo, createSignal, For, Show } from "solid-js";
import type { QueueDelivery, QueueSnapshot } from "../../../shared/ipc";
import { t } from "../i18n";

interface TaskQueueStripProps {
  queue: QueueSnapshot | undefined;
  activeTurnId: string | null | undefined;
  onPause: () => void;
  onResume: () => void;
  onCancel: (deliveryId: string) => void;
  onStop: () => void;
}

const DONE_STATUSES = new Set(["completed", "failed", "interrupted", "cancelled"]);
const VISIBLE_DONE = 3;

/** Queued / running / done tasks for the selected coworker, pinned above the thread. */
export function TaskQueueStrip(props: TaskQueueStripProps) {
  const [expanded, setExpanded] = createSignal(false);
  const deliveries = () => props.queue?.deliveries ?? [];
  const queued = createMemo(() =>
    deliveries()
      .filter((delivery) => delivery.status === "queued")
      .sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
  );
  const running = createMemo(() =>
    deliveries().filter(
      (delivery) => delivery.status === "starting" || delivery.status === "running",
    ),
  );
  const done = createMemo(() =>
    deliveries()
      .filter((delivery) => DONE_STATUSES.has(delivery.status))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  );
  const visibleDone = () => (expanded() ? done() : done().slice(0, VISIBLE_DONE));
  const paused = () => Boolean(props.queue?.paused);
  const isEmpty = () => deliveries().length === 0;

  return (
    <section
      class="task-strip"
      aria-label={t("taskQueue")}
      classList={{ "task-strip-empty": isEmpty() }}
    >
      <div class="task-strip-counts">
        <span class="task-count task-count-queued">
          <b>{queued().length}</b> {t("queued")}
        </span>
        <span class="task-count task-count-running">
          <b>{running().length}</b> {t("running")}
        </span>
        <span class="task-count task-count-done">
          <b>{done().length}</b> {t("done")}
        </span>
        <Show when={paused()}>
          <span class="task-paused-pill">{t("paused")}</span>
        </Show>
        <span class="task-strip-spacer" />
        <Show
          when={paused()}
          fallback={
            <button
              type="button"
              class="task-strip-button"
              disabled={isEmpty()}
              onClick={props.onPause}
            >
              {t("pause")}
            </button>
          }
        >
          <button
            type="button"
            class="task-strip-button task-strip-button-primary"
            onClick={props.onResume}
          >
            {t("resume")}
          </button>
        </Show>
        <Show when={done().length > VISIBLE_DONE || queued().length + running().length > 3}>
          <button
            type="button"
            class="task-strip-button"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded() ? t("showLess") : t("showAll")}
          </button>
        </Show>
      </div>
      <Show when={!isEmpty()} fallback={<p class="task-strip-hint">{t("queueEmpty")}</p>}>
        <ol class="task-chips" classList={{ "task-chips-expanded": expanded() }}>
          <For each={running()}>
            {(delivery) => (
              <TaskChip delivery={delivery} state="running">
                <Show when={props.activeTurnId}>
                  <button
                    type="button"
                    onClick={props.onStop}
                    aria-label={`${t("stop")}: ${taskTitle(delivery)}`}
                  >
                    {t("stop")}
                  </button>
                </Show>
              </TaskChip>
            )}
          </For>
          <For each={queued()}>
            {(delivery) => (
              <TaskChip delivery={delivery} state="queued">
                <button
                  type="button"
                  onClick={() => props.onCancel(delivery.id)}
                  aria-label={`Cancel queued message ${delivery.position ?? ""}`.trim()}
                >
                  {t("cancel")}
                </button>
              </TaskChip>
            )}
          </For>
          <For each={visibleDone()}>
            {(delivery) => (
              <TaskChip
                delivery={delivery}
                state={delivery.status === "completed" ? "done" : "failed"}
              />
            )}
          </For>
        </ol>
      </Show>
    </section>
  );
}

function TaskChip(props: {
  delivery: QueueDelivery;
  state: "queued" | "running" | "done" | "failed";
  children?: unknown;
}) {
  return (
    <li
      class={`task-chip task-chip-${props.state}`}
      title={props.delivery.error ?? taskTitle(props.delivery)}
    >
      <span class="task-chip-dot" aria-hidden="true" />
      <span class="task-chip-title">
        <Show when={props.state === "queued" && props.delivery.position}>
          <small>#{props.delivery.position} </small>
        </Show>
        {taskTitle(props.delivery)}
      </span>
      {props.children as never}
    </li>
  );
}

function taskTitle(delivery: QueueDelivery): string {
  const text = delivery.text.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (text) return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  return delivery.attachments.map((attachment) => attachment.name).join(", ") || "Task";
}
