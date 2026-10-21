import { createEffect, createSignal, For, type JSX, on, onCleanup, Show } from "solid-js";
import type { CoworkerStatus } from "../../../shared/ipc";
import type { ActivityPhase } from "../activity-hinglish";

/**
 * What a coworker is doing, shown as a small Indian-themed animation around its avatar:
 * thinking = a rangoli dot ring turning, working = marigold and peacock sparks orbiting,
 * waiting = a diya glow pulsing, done = a marigold petal burst, failed = a short red shake.
 */
export type AuraState = "thinking" | "working" | "waiting" | "done" | "failed" | null;

const RANGOLI_DOTS = 12;
const PETALS = 8;
/** How long the one-off done / failed animations stay on screen. */
export const AURA_FLASH_MS = 1_400;

/**
 * Aura for a coworker's overall status. A coworker that was working and is now idle gets the
 * one-off "done" burst; nothing else is inferred.
 */
export function statusAura(status: () => CoworkerStatus): () => AuraState {
  const [aura, setAura] = createSignal<AuraState>(null);
  createEffect(
    on(status, (next, previous) => {
      if (next === "working") setAura("working");
      else if (next === "waiting") setAura("waiting");
      else if (next === "error") setAura(previous === "working" ? "failed" : null);
      else setAura(previous === "working" ? "done" : null);
    }),
  );
  return aura;
}

/** Aura for the live activity line: tracks the real event phase. */
export function phaseAura(phase: ActivityPhase): AuraState {
  switch (phase) {
    case "initializing":
    case "thinking":
    case "generating":
    case "finalizing":
    case "retrying":
      return "thinking";
    case "researching":
    case "executing_tool":
    case "processing_result":
      return "working";
    case "waiting_approval":
    case "waiting_user":
    case "queued":
    case "paused":
      return "waiting";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

export function AvatarAura(props: {
  state: AuraState;
  size?: "small" | "medium";
  children: JSX.Element;
}) {
  // done/failed are flashes: they show once, then the aura goes quiet.
  const [flash, setFlash] = createSignal<AuraState>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => props.state,
      (state) => {
        clearTimeout(timer);
        if (state === "done" || state === "failed") {
          setFlash(state);
          timer = setTimeout(() => setFlash(null), AURA_FLASH_MS);
        } else {
          setFlash(null);
        }
      },
    ),
  );
  onCleanup(() => clearTimeout(timer));

  const shown = (): AuraState =>
    props.state === "done" || props.state === "failed" ? flash() : props.state;
  const still = prefersReducedMotion();

  return (
    <span
      class={`avatar-aura avatar-aura-${props.size ?? "small"}`}
      classList={{
        [`avatar-aura-${shown()}`]: Boolean(shown()),
        "avatar-aura-still": still,
      }}
      data-aura={shown() ?? "idle"}
    >
      {props.children}
      <Show when={shown()}>
        <svg class="avatar-aura-art" viewBox="0 0 60 60" aria-hidden="true">
          <defs>
            <radialGradient id="aura-diya" cx="50%" cy="50%" r="50%">
              <stop offset="55%" stop-color="#ffb22e" stop-opacity="0" />
              <stop offset="80%" stop-color="#ffb22e" stop-opacity="0.55" />
              <stop offset="100%" stop-color="#ff7a1a" stop-opacity="0" />
            </radialGradient>
          </defs>

          <Show when={shown() === "waiting"}>
            <circle class="aura-diya" cx="30" cy="30" r="29" fill="url(#aura-diya)" />
          </Show>

          <Show when={shown() === "thinking" || shown() === "working"}>
            <g class="aura-rangoli">
              <For each={Array.from({ length: RANGOLI_DOTS }, (_, index) => index)}>
                {(index) => {
                  const angle = (index / RANGOLI_DOTS) * Math.PI * 2;
                  return (
                    <circle
                      cx={30 + Math.cos(angle) * 26}
                      cy={30 + Math.sin(angle) * 26}
                      r={index % 3 === 0 ? 1.9 : 1.2}
                      class={`aura-dot aura-dot-${index % 3}`}
                    />
                  );
                }}
              </For>
            </g>
          </Show>

          <Show when={shown() === "working"}>
            <g class="aura-orbits">
              <g transform="rotate(-28 30 30)">
                <ellipse class="aura-orbit" cx="30" cy="30" rx="27" ry="10" />
                <Show
                  when={!still}
                  fallback={
                    <circle class="aura-spark aura-spark-marigold" cx="57" cy="30" r="2.6" />
                  }
                >
                  <circle class="aura-spark aura-spark-marigold" r="2.6">
                    <animateMotion
                      dur="2.4s"
                      repeatCount="indefinite"
                      path="M3,30 a27,10 0 1,0 54,0 a27,10 0 1,0 -54,0"
                    />
                  </circle>
                </Show>
              </g>
              <g transform="rotate(32 30 30)">
                <ellipse class="aura-orbit" cx="30" cy="30" rx="27" ry="10" />
                <Show
                  when={!still}
                  fallback={<circle class="aura-spark aura-spark-peacock" cx="3" cy="30" r="2.3" />}
                >
                  <circle class="aura-spark aura-spark-peacock" r="2.3">
                    <animateMotion
                      dur="3.1s"
                      repeatCount="indefinite"
                      path="M57,30 a27,10 0 1,1 -54,0 a27,10 0 1,1 54,0"
                    />
                  </circle>
                </Show>
              </g>
            </g>
          </Show>

          <Show when={shown() === "done"}>
            <g class="aura-petals">
              <For each={Array.from({ length: PETALS }, (_, index) => index)}>
                {(index) => (
                  <ellipse
                    class="aura-petal"
                    cx="30"
                    cy="9"
                    rx="2.4"
                    ry="4.6"
                    style={{ transform: `rotate(${(index * 360) / PETALS}deg)` }}
                  />
                )}
              </For>
            </g>
          </Show>

          <Show when={shown() === "failed"}>
            <circle class="aura-failed-ring" cx="30" cy="30" r="26" />
          </Show>
        </svg>
      </Show>
    </span>
  );
}
