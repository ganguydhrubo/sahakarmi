import { createEffect, createMemo, createSignal, on, Show, untrack } from "solid-js";
import { type ActivityState, isActivePhase } from "../activity";
import {
  format,
  formatElapsed,
  LABELS,
  LONG_RUNNING,
  MASTI_LONG,
  MASTI_THINKING,
  PRIMARY,
  SECONDARY,
  TOOL_FAILED_PRIMARY,
  TOOL_FAILED_SECONDARY,
  TOOL_PRIMARY,
  TOOL_SECONDARY,
} from "../activity-hinglish";
import type { BotProfile } from "../data";
import { type ActivityStyle, activityStyle } from "../preferences";
import { AgentAvatar } from "./AgentAvatar";

/** Secondary lines rotate this often while the same real event is in progress. */
export const ROTATE_MS = 4_000;
/** After this long without a new event, rotate reassuring long-wait lines instead. */
export const LONG_WAIT_MS = 20_000;

/**
 * Masti style only replaces the generic "thinking" line, where no specific action is claimed;
 * it rotates like Claude Code's verbs. Everything tied to a real action stays factual.
 */
export function mastiLine(
  activity: ActivityState,
  style: ActivityStyle,
  msInState: number,
  seed: number,
): string | null {
  if (style !== "masti" || activity.phase !== "thinking") return null;
  const pool = msInState >= LONG_WAIT_MS ? MASTI_LONG : MASTI_THINKING;
  return secondaryLine(pool, Math.floor(msInState / ROTATE_MS), seed);
}

export function primaryLine(activity: ActivityState): string {
  if (activity.phase === "processing_result" && activity.toolFailed) return TOOL_FAILED_PRIMARY;
  if (
    (activity.phase === "executing_tool" || activity.phase === "researching") &&
    activity.category
  ) {
    return TOOL_PRIMARY[activity.category];
  }
  return PRIMARY[activity.phase];
}

export function secondaryPool(activity: ActivityState, msInState: number): string[] {
  if (!isActivePhase(activity.phase)) return [];
  if (["waiting_approval", "waiting_user", "paused"].includes(activity.phase)) {
    return SECONDARY[activity.phase];
  }
  if (msInState >= LONG_WAIT_MS) return LONG_RUNNING;
  if (activity.phase === "processing_result" && activity.toolFailed) return TOOL_FAILED_SECONDARY;
  if (
    (activity.phase === "executing_tool" || activity.phase === "researching") &&
    activity.category
  ) {
    return TOOL_SECONDARY[activity.category];
  }
  return SECONDARY[activity.phase];
}

/** Deterministic rotation: consecutive slots never repeat while the pool has two or more lines. */
export function secondaryLine(pool: string[], slot: number, seed: number): string {
  if (pool.length === 0) return "";
  return pool[(seed + slot) % pool.length] ?? "";
}

/**
 * Claude Code-style live activity line for one coworker. Every message is Roman-script Hinglish.
 * The primary line only changes on real events; the secondary line rotates within the event's
 * own vocabulary, and nothing is claimed that the event does not imply.
 */
export function ActivityIndicator(props: {
  bot: BotProfile | undefined;
  activity: ActivityState;
  /** Clock from the parent (ticks once a second only while something is active). */
  now: number;
  /** When the current request became active, for the elapsed-time chip. */
  activeSince: number | null;
}) {
  const [stateSince, setStateSince] = createSignal(props.now);
  const [seed, setSeed] = createSignal(0);
  // Memoised so the effect runs only when the event key really changes, not on every clock tick.
  const activityKey = createMemo(() => props.activity.key);
  createEffect(
    on(activityKey, () => {
      setStateSince(untrack(() => props.now));
      setSeed(Math.floor(Math.random() * 7));
    }),
  );

  const visible = () => props.activity.phase !== "idle";
  const active = () => isActivePhase(props.activity.phase);
  const msInState = () => Math.max(0, props.now - stateSince());
  const primary = createMemo(() => primaryLine(props.activity));
  const shownPrimary = createMemo(
    () => mastiLine(props.activity, activityStyle(), msInState(), seed()) ?? primary(),
  );
  const secondary = createMemo(() => {
    const pool = secondaryPool(props.activity, msInState());
    const slot = Math.floor(msInState() / ROTATE_MS);
    return secondaryLine(pool, slot, seed());
  });
  const detail = () => {
    if (props.activity.retry?.attempt && props.activity.retry.maxRetries) {
      return format(LABELS.retryAttempt, {
        attempt: props.activity.retry.attempt,
        max: props.activity.retry.maxRetries,
      });
    }
    return props.activity.detail;
  };
  const elapsed = () =>
    active() && props.activeSince !== null && props.now - props.activeSince >= 1_000
      ? formatElapsed(props.now - props.activeSince)
      : null;
  const name = () => props.bot?.name ?? "Coworker";

  return (
    <div
      class={`agent-activity-entry activity-phase-${props.activity.phase}`}
      classList={{
        "agent-activity-entry-visible": visible(),
        "agent-activity-active": active(),
      }}
      role="status"
      aria-hidden={!visible()}
      aria-label={visible() ? `${name()}: ${primary()}` : undefined}
    >
      <AgentAvatar bot={props.bot} class="agent-activity-avatar" />
      {/* Announced to screen readers only when a real event changes the primary line. */}
      <span class="sr-only">{visible() ? primary() : ""}</span>
      <div class="agent-activity-card" aria-hidden="true">
        <div class="agent-activity-row">
          <span class="activity-mark">
            <Show
              when={active()}
              fallback={
                <svg viewBox="0 0 20 20" class="activity-outcome-icon" aria-hidden="true">
                  <Show
                    when={props.activity.phase === "completed"}
                    fallback={<path d="M6 6l8 8M14 6l-8 8" />}
                  >
                    <path d="m5 10.5 3.2 3.2L15 7" />
                  </Show>
                </svg>
              }
            >
              <span class="activity-spinner">
                <i />
                <i />
                <i />
              </span>
            </Show>
          </span>
          <span class="activity-primary-wrap">
            {/* Keyed by text so each new event fades in instead of swapping abruptly. */}
            <Show when={shownPrimary()} keyed>
              {(text) => <span class="activity-primary">{text}</span>}
            </Show>
          </span>
          <Show when={elapsed()}>
            <span class="activity-elapsed">{elapsed()}</span>
          </Show>
        </div>
        <Show when={(active() && secondary()) || detail()}>
          <div class="activity-secondary-row">
            <Show when={secondary()} keyed>
              {(text) => <span class="activity-secondary">{text}</span>}
            </Show>
            <Show when={detail()}>
              <code class="activity-detail">{detail()}</code>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
