import { For, Show } from "solid-js";
import { OPEN_SOURCE_CREDITS, type OpenSourceCredit } from "../../../shared/open-source-credits";
import { t } from "../i18n";

/**
 * Settings > About > Open-source credits: rendered straight from shared/open-source-credits.ts,
 * the one list every skill pack and preset adds itself to.
 */
export function OpenSourceCredits(props: { credits?: OpenSourceCredit[] }) {
  const credits = () => props.credits ?? OPEN_SOURCE_CREDITS;
  return (
    <details class="open-source-credits">
      <summary>
        <h3 class="about-heading">{t("creditsHeading")}</h3>
      </summary>
      <p class="settings-meta">{t("creditsIntro")}</p>
      <ul class="extension-list open-source-credit-list">
        <For each={credits()}>
          {(credit) => (
            <li class="extension-item open-source-credit">
              <span class="extension-item-text">
                <strong>{credit.project}</strong>
                <small>
                  {t("creditsLicence")}: {credit.licence} · {credit.copyright}
                </small>
                <small>
                  {t("creditsUsedFor")}: {credit.usedFor}
                </small>
                <Show
                  when={credit.notice}
                  fallback={
                    <Show when={credit.licence === "Apache-2.0"}>
                      <small class="extension-source">{t("creditsNoNotice")}</small>
                    </Show>
                  }
                >
                  {(notice) => (
                    <>
                      <small>{t("creditsNotice")}</small>
                      <pre class="open-source-notice">{notice()}</pre>
                    </>
                  )}
                </Show>
                <small class="extension-source">{credit.url}</small>
              </span>
              <button
                type="button"
                onClick={() => void window.sahkarmi.openUrl(credit.url).catch(() => undefined)}
              >
                {t("creditsOpen")}
              </button>
            </li>
          )}
        </For>
      </ul>
    </details>
  );
}
