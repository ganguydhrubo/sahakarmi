import { createSignal, For, Show } from "solid-js";
import type { TurnPlan } from "../../../shared/ipc";
import { t } from "../i18n";

/** The coworker's live task list for the current turn, pinned above the message box. */
export function PlanCard(props: { plan: TurnPlan }) {
  const [open, setOpen] = createSignal(true);
  const done = () => props.plan.steps.filter((step) => step.status === "completed").length;
  const current = () => props.plan.steps.find((step) => step.status === "in_progress");

  return (
    <section class="plan-card" aria-label={t("planTitle")}>
      <button
        type="button"
        class="plan-card-header"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <strong>{t("planTitle")}</strong>
        <span class="plan-card-progress">
          {t("planProgress", {
            done: String(done()),
            total: String(props.plan.steps.length),
          })}
        </span>
        <Show when={!open() && current()}>
          {(step) => <span class="plan-card-current">{step().text}</span>}
        </Show>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          class="plan-card-chevron"
          classList={{ "plan-card-chevron-open": open() }}
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <Show when={open()}>
        <ol class="plan-card-steps">
          <For each={props.plan.steps}>
            {(step) => (
              <li class={`plan-step plan-step-${step.status}`}>
                <span class="plan-step-mark" aria-hidden="true">
                  <Show when={step.status === "completed"} fallback={<i />}>
                    <svg aria-hidden="true" viewBox="0 0 16 16">
                      <path d="m3.5 8.5 3 3 6-7" />
                    </svg>
                  </Show>
                </span>
                <span class="plan-step-text">{step.text}</span>
                <span class="sr-only">{t(`planStatus_${step.status}`)}</span>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </section>
  );
}
