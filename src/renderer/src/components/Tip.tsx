import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { type MessageKey, t } from "../i18n";
import {
  activeTip,
  claimTip,
  markTipSeen,
  releaseTip,
  setTipsOff,
  tipEligible,
} from "../onboarding";

/** Waits a moment so a tip never flashes while the owner is moving between screens. */
const SETTLE_MS = 700;

/**
 * A one-time tip shown in place next to a feature, the first time the owner reaches it.
 * It never covers anything, only one shows at a time, and Got it closes it for good.
 */
export function Tip(props: {
  id: string;
  text: MessageKey;
  params?: Record<string, string>;
  /** Show only while this is true, e.g. "the first approval is on screen". */
  when?: boolean;
}) {
  const [settled, setSettled] = createSignal(false);
  onMount(() => {
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    onCleanup(() => window.clearTimeout(timer));
  });
  const eligible = () => settled() && props.when !== false && tipEligible(props.id);
  createEffect(() => {
    if (eligible()) claimTip(props.id);
    else releaseTip(props.id);
  });
  onCleanup(() => releaseTip(props.id));
  const visible = () => eligible() && activeTip() === props.id;
  const close = () => {
    markTipSeen(props.id);
    releaseTip(props.id);
  };
  return (
    <Show when={visible()}>
      <aside class="feature-tip" role="note" data-tip={props.id}>
        <span class="feature-tip-icon" aria-hidden="true">
          💡
        </span>
        <p>{t(props.text, props.params)}</p>
        <div class="feature-tip-actions">
          <button type="button" class="feature-tip-ok" onClick={close}>
            {t("tipGotIt")}
          </button>
          <button
            type="button"
            class="feature-tip-off"
            onClick={() => {
              close();
              setTipsOff(true);
            }}
          >
            {t("tipTurnOff")}
          </button>
        </div>
      </aside>
    </Show>
  );
}
