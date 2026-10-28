import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { type MessageKey, t } from "../i18n";

export interface TourStep {
  /** A data-tour attribute value on a real control. */
  target: string;
  title: MessageKey;
  body: MessageKey;
}

export const TOUR_STEPS: TourStep[] = [
  { target: "composer", title: "tourComposerTitle", body: "tourComposerBody" },
  { target: "browser", title: "tourBrowserTitle", body: "tourBrowserBody" },
  { target: "approvals", title: "tourApprovalsTitle", body: "tourApprovalsBody" },
];

const MARGIN = 12;
const GAP = 10;

function findTarget(step: TourStep): HTMLElement | null {
  const element = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? element : null;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Puts the card beside the target without leaving the window: right, above, below, left. */
export function placeCard(
  target: Box,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const clampLeft = (left: number) =>
    Math.max(MARGIN, Math.min(left, viewport.width - card.width - MARGIN));
  const clampTop = (top: number) =>
    Math.max(MARGIN, Math.min(top, viewport.height - card.height - MARGIN));
  const right = target.left + target.width + GAP;
  if (right + card.width + MARGIN <= viewport.width && target.width < viewport.width / 3) {
    return { top: clampTop(target.top + target.height / 2 - card.height / 2), left: right };
  }
  const above = target.top - GAP - card.height;
  if (above >= MARGIN) {
    return { top: above, left: clampLeft(target.left + target.width / 2 - card.width / 2) };
  }
  const below = target.top + target.height + GAP;
  if (below + card.height + MARGIN <= viewport.height) {
    return { top: below, left: clampLeft(target.left + target.width / 2 - card.width / 2) };
  }
  return {
    top: clampTop(target.top),
    left: clampLeft(target.left - GAP - card.width),
  };
}

/**
 * Show me around: at most three steps, started only by the owner. It never blocks clicks
 * (the ring ignores the pointer), skips a step whose control is not on screen, and ends
 * when nothing is left to show.
 */
export function GuidedTour(props: {
  steps?: TourStep[];
  onEnd: (result: "finished" | "skipped" | "nothing") => void;
}) {
  const steps = (props.steps ?? TOUR_STEPS).filter((step) => findTarget(step));
  const [index, setIndex] = createSignal(0);
  const [ring, setRing] = createSignal<Box | null>(null);
  const [cardPosition, setCardPosition] = createSignal({ top: -9999, left: -9999 });
  let card: HTMLElement | undefined;
  let frame: number | undefined;
  let ended = false;

  const end = (result: "finished" | "skipped" | "nothing") => {
    if (ended) return;
    ended = true;
    props.onEnd(result);
  };

  /** Moves to the next step in a direction whose control is still on screen. */
  const go = (direction: 1 | -1) => {
    for (let next = index() + direction; next >= 0 && next < steps.length; next += direction) {
      if (findTarget(steps[next])) {
        setIndex(next);
        measure();
        return;
      }
    }
    if (direction === 1) end("finished");
  };

  const measure = () => {
    const step = steps[index()];
    const element = step ? findTarget(step) : null;
    if (!element) {
      go(1);
      return;
    }
    const rect = element.getBoundingClientRect();
    const box = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    setRing(box);
    const size = card?.getBoundingClientRect() ?? { width: 300, height: 140 };
    setCardPosition(
      placeCard(
        box,
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  };

  const scheduleMeasure = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  };

  onMount(() => {
    if (steps.length === 0) {
      end("nothing");
      return;
    }
    measure();
    // The card's real size is known after the first paint.
    scheduleMeasure();
    card?.querySelector<HTMLElement>(".button-primary")?.focus();
    window.addEventListener("resize", scheduleMeasure);
    onCleanup(() => window.removeEventListener("resize", scheduleMeasure));
  });
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  const step = () => steps[index()];
  const last = () => index() >= steps.length - 1;

  return (
    <Show when={steps.length > 0 && step()}>
      <Show when={ring()}>
        {(box) => (
          <div
            class="tour-ring"
            aria-hidden="true"
            style={{
              top: `${box().top - 4}px`,
              left: `${box().left - 4}px`,
              width: `${box().width + 8}px`,
              height: `${box().height + 8}px`,
            }}
          />
        )}
      </Show>
      <section
        ref={(element) => (card = element)}
        class="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-card-title"
        aria-describedby="tour-card-body"
        style={{ top: `${cardPosition().top}px`, left: `${cardPosition().left}px` }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            end("skipped");
          }
        }}
      >
        <p class="tour-card-progress">
          {t("tourStep", { current: String(index() + 1), total: String(steps.length) })}
        </p>
        <h2 id="tour-card-title">{t(step().title)}</h2>
        <p id="tour-card-body">{t(step().body)}</p>
        <div class="tour-card-actions">
          <button type="button" class="tour-card-skip" onClick={() => end("skipped")}>
            {t("tourSkip")}
          </button>
          <span class="tour-card-spacer" />
          <Show when={index() > 0}>
            <button type="button" onClick={() => go(-1)}>
              {t("tourBack")}
            </button>
          </Show>
          <button
            type="button"
            class="button-primary"
            onClick={() => (last() ? end("finished") : go(1))}
          >
            {last() ? t("tourFinish") : t("tourNext")}
          </button>
        </div>
      </section>
    </Show>
  );
}
