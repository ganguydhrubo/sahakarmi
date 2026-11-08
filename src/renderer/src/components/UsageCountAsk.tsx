import { createSignal, Show } from "solid-js";
import { t } from "../i18n";
import { chooseUsageCount, usageCountChoice } from "../usage-count";

/** Asked once, in the sidebar footer: may this PC count in the anonymous daily user number? */
export function UsageCountAsk() {
  const [failed, setFailed] = createSignal(false);
  const answer = (enabled: boolean) => {
    setFailed(false);
    chooseUsageCount(enabled).catch(() => setFailed(true));
  };
  return (
    <Show when={usageCountChoice() === "ask"}>
      <section class="usage-ask" aria-labelledby="usage-ask-title">
        <strong id="usage-ask-title">{t("usageAskTitle")}</strong>
        <p>{t("usageCountHelp")}</p>
        <Show when={failed()}>
          <p role="alert">{t("usageCountSaveFailed")}</p>
        </Show>
        <div class="usage-ask-actions">
          <button type="button" class="button-primary" onClick={() => answer(true)}>
            {t("usageAskYes")}
          </button>
          <button type="button" onClick={() => answer(false)}>
            {t("usageAskNo")}
          </button>
        </div>
      </section>
    </Show>
  );
}
