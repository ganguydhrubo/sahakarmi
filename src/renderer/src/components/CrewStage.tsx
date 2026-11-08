import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { CrewAvatar } from "../../../shared/ipc";
import { CREW, crewMember } from "../crew";
import type { CrewScene } from "../crew-scene";
import { t } from "../i18n";

const HIDDEN_KEY = "sahkarmi.crewStage.hidden";

function storedHidden(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function webglAvailable(): boolean {
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/**
 * "Meet the crew" in an empty chat: the five 3D robots. Tapping one (in the picture or its chip)
 * makes it wave and gives it to this coworker as its face. Hidden with one click, remembered.
 */
export function CrewStage(props: { current: CrewAvatar | null; onPick: (id: CrewAvatar) => void }) {
  const [hidden, setHidden] = createSignal(storedHidden());
  const [walking, setWalking] = createSignal(false);
  const [chosen, setChosen] = createSignal<CrewAvatar | null>(null);
  let scene: CrewScene | undefined;
  let disposed = false;

  function remember(value: boolean): void {
    setHidden(value);
    try {
      window.localStorage.setItem(HIDDEN_KEY, value ? "1" : "0");
    } catch {
      // Storage can be unavailable; the choice then lasts until the app closes.
    }
  }

  function pick(id: CrewAvatar): void {
    setChosen(id);
    props.onPick(id);
  }

  function mount(host: HTMLDivElement): void {
    if (!webglAvailable()) return;
    void import("../crew-scene")
      .then(({ mountCrewScene }) =>
        mountCrewScene(host, { reducedMotion: reducedMotion(), onPick: pick }),
      )
      .then((mounted) => {
        if (disposed) mounted.dispose();
        else {
          scene = mounted;
          host.classList.add("crew-stage-live");
        }
      })
      .catch(() => {
        // The still picture of the crew stays; the chips below still work.
      });
  }

  onCleanup(() => {
    disposed = true;
    scene?.dispose();
  });

  return (
    <Show
      when={!hidden()}
      fallback={
        <button type="button" class="link-button crew-stage-show" onClick={() => remember(false)}>
          {t("crewStageShow")}
        </button>
      }
    >
      <section class="crew-stage-card message-entry-animated" aria-label={t("crewStageTitle")}>
        <header class="crew-stage-head">
          <p class="starter-prompts-title">{t("crewStageTitle")}</p>
          <div class="crew-stage-actions">
            <button
              type="button"
              class="link-button"
              aria-pressed={walking()}
              onClick={() => {
                const next = !walking();
                setWalking(next);
                scene?.setWalking(next);
              }}
            >
              {walking() ? t("crewStageStop") : t("crewStageWalk")}
            </button>
            <button
              type="button"
              class="link-button"
              onClick={() => {
                scene?.dispose();
                scene = undefined;
                remember(true);
              }}
            >
              {t("crewStageHide")}
            </button>
          </div>
        </header>
        <CrewCanvas onMount={mount} />
        <div class="crew-stage-chips">
          <For each={CREW}>
            {(member) => (
              <button
                type="button"
                class="crew-stage-chip"
                classList={{ "crew-stage-chip-selected": props.current === member.id }}
                style={{ "--crew-halo": member.halo }}
                aria-pressed={props.current === member.id}
                aria-label={t("crewPickRobot", { name: member.name })}
                onClick={() => {
                  scene?.wave(member.id);
                  pick(member.id);
                }}
              >
                <i aria-hidden="true" />
                {member.name}
              </button>
            )}
          </For>
        </div>
        <p class="crew-stage-hint" aria-live="polite">
          {chosen()
            ? t("crewStageChosen", { name: crewMember(chosen())?.name ?? "" })
            : t("crewStageHint")}
        </p>
      </section>
    </Show>
  );
}

function CrewCanvas(props: { onMount: (host: HTMLDivElement) => void }) {
  let host!: HTMLDivElement;
  onMount(() => props.onMount(host));
  return (
    <div class="crew-stage-canvas" ref={host}>
      <div class="crew-stage-still" aria-hidden="true">
        <For each={CREW}>{(member) => <img src={member.still} alt="" draggable={false} />}</For>
      </div>
    </div>
  );
}
