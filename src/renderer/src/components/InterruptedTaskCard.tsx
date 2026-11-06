import { createMemo, createSignal, For, Show } from "solid-js";
import type { QueueSnapshot } from "../../../shared/ipc";
import { t } from "../i18n";

/**
 * Tasks interrupted when Sahkarmi closed (or the AI stopped) are offered again, one card each:
 * "Run again" sends the same message anew, "Dismiss" hides the offer. Nothing reruns by itself.
 */
export function InterruptedTaskCard(props: {
  botId: string;
  botName: string;
  queue: QueueSnapshot | undefined;
}) {
  const [busy, setBusy] = createSignal<string | null>(null);
  const offers = createMemo(() =>
    (props.queue?.deliveries ?? []).filter((delivery) => delivery.offerRerun),
  );
  const act = async (deliveryId: string, rerun: boolean) => {
    if (busy()) return;
    setBusy(deliveryId);
    try {
      const api = window.sahkarmi.agent;
      const input = { botId: props.botId, deliveryId };
      await (rerun ? api.rerunInterrupted(input) : api.dismissInterrupted(input));
    } catch (error) {
      console.error("Unable to act on the interrupted task:", error);
    } finally {
      setBusy(null);
    }
  };
  return (
    <For each={offers()}>
      {(delivery) => (
        <section class="interrupted-card" role="status">
          <div class="interrupted-card-text">
            <strong>{t("engineInterruptedTitle")}</strong>
            <span>{t("engineInterruptedBody", { name: props.botName })}</span>
            <Show when={delivery.text.trim()}>
              <q class="interrupted-card-quote">
                {delivery.text.length > 160 ? `${delivery.text.slice(0, 159)}…` : delivery.text}
              </q>
            </Show>
          </div>
          <div class="interrupted-card-actions">
            <button
              type="button"
              class="button-primary"
              disabled={busy() !== null}
              onClick={() => void act(delivery.id, true)}
            >
              {t("engineRunAgain")}
            </button>
            <button
              type="button"
              disabled={busy() !== null}
              onClick={() => void act(delivery.id, false)}
            >
              {t("engineDismiss")}
            </button>
          </div>
        </section>
      )}
    </For>
  );
}
