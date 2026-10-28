import { Show } from "solid-js";
import { t } from "../i18n";

/** First-run card inside an empty chat. Never an overlay: the chat and composer stay usable. */
export function WelcomeCard(props: {
  agentReady: boolean;
  onStart: () => void;
  onConnect: () => void;
  onExplore: () => void;
  onDismiss: () => void;
}) {
  return (
    <section class="welcome-card" aria-labelledby="welcome-card-title">
      <div class="welcome-card-copy">
        <h2 id="welcome-card-title">{t("welcomeTitle")}</h2>
        <p>{t("welcomeBody")}</p>
        <Show when={!props.agentReady}>
          <p>{t("welcomeNeedsProvider")}</p>
        </Show>
      </div>
      <div class="welcome-card-actions">
        <button
          type="button"
          class="button-primary"
          onClick={() => (props.agentReady ? props.onStart() : props.onConnect())}
        >
          {props.agentReady ? t("welcomeStart") : t("welcomeConnect")}
        </button>
        <button type="button" onClick={props.onExplore}>
          {t("welcomeExplore")}
        </button>
        <button type="button" class="welcome-card-dismiss" onClick={props.onDismiss}>
          {t("welcomeNotNow")}
        </button>
      </div>
    </section>
  );
}
