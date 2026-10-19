import { createSignal, For, Show } from "solid-js";
import type { AgentStatus, AppInfo, UpdateStatus } from "../../../shared/ipc";
import { LANGUAGE_OPTIONS, t } from "../i18n";
import { language, setLanguage, setTheme, type ThemePreference, theme } from "../preferences";
import { LogoMark } from "./Logo";

interface SettingsViewProps {
  appInfo: AppInfo | null;
  agentStatus: AgentStatus;
  updateStatus: UpdateStatus;
  onOpenPermissions: () => void;
  onUpdateAction: () => Promise<void>;
}

const THEMES: Array<{ value: ThemePreference; label: () => string }> = [
  { value: "system", label: () => t("themeSystem") },
  { value: "light", label: () => t("themeLight") },
  { value: "dark", label: () => t("themeDark") },
];

export function SettingsView(props: SettingsViewProps) {
  const [message, setMessage] = createSignal<string | null>(null);

  function run(action: () => Promise<unknown>) {
    setMessage(null);
    void action().catch((cause) =>
      setMessage(cause instanceof Error ? cause.message : String(cause)),
    );
  }

  const account = () => {
    const auth = props.agentStatus.auth;
    return "email" in auth ? (auth.email ?? auth.kind) : null;
  };

  return (
    <section class="center-view settings-view" aria-labelledby="settings-heading">
      <header class="center-view-header window-drag">
        <h1 id="settings-heading">{t("settings")}</h1>
      </header>
      <div class="center-view-body settings-grid">
        <section class="settings-card">
          <h2>{t("appearance")}</h2>
          <fieldset class="segmented">
            <legend class="sr-only">{t("appearance")}</legend>
            <For each={THEMES}>
              {(option) => (
                <button
                  type="button"
                  aria-pressed={theme() === option.value}
                  classList={{ "segmented-active": theme() === option.value }}
                  onClick={() => setTheme(option.value)}
                >
                  {option.label()}
                </button>
              )}
            </For>
          </fieldset>
          <h2>{t("languageLabel")}</h2>
          <fieldset class="segmented">
            <legend class="sr-only">{t("languageLabel")}</legend>
            <For each={LANGUAGE_OPTIONS}>
              {(option) => (
                <button
                  type="button"
                  lang={option.code}
                  aria-pressed={language() === option.code}
                  classList={{ "segmented-active": language() === option.code }}
                  onClick={() => setLanguage(option.code)}
                >
                  {option.label}
                </button>
              )}
            </For>
          </fieldset>
        </section>

        <section class="settings-card">
          <h2>{t("providers")}</h2>
          <p>{t("providersHint")}</p>
          <Show when={account()}>
            <p class="settings-meta">{account()}</p>
          </Show>
          <button type="button" onClick={props.onOpenPermissions}>
            {t("manage")}
          </button>
        </section>

        <section class="settings-card">
          <h2>{t("dataPrivacy")}</h2>
          <div class="settings-buttons">
            <button
              type="button"
              onClick={() => run(() => window.sahkarmi.maintenance.exportData())}
            >
              {t("exportData")}
            </button>
            <button
              type="button"
              onClick={() => run(() => window.sahkarmi.maintenance.exportDiagnostics())}
            >
              {t("exportDiagnostics")}
            </button>
          </div>
          <Show when={props.updateStatus.phase !== "unsupported"}>
            <h2>{t("updates")}</h2>
            <button type="button" onClick={() => run(props.onUpdateAction)}>
              {t("checkUpdates")}
            </button>
            <Show when={props.updateStatus.message}>
              <p class="settings-meta">{props.updateStatus.message}</p>
            </Show>
          </Show>
        </section>

        <section class="settings-card settings-about">
          <h2>{t("about")}</h2>
          <div class="settings-about-brand">
            <LogoMark size={44} />
            <div>
              <strong>Sahkarmi · सहकर्मी</strong>
              <span>v{props.appInfo?.version ?? "—"}</span>
            </div>
          </div>
          <ul class="settings-taglines">
            <li lang="en">Your AI team. Made in India.</li>
            <li lang="hi">आपकी AI टीम. भारत में बनी.</li>
            <li lang="bn">আপনার AI টিম. ভারতে তৈরি.</li>
          </ul>
          <p>{t("aboutBody")}</p>
          <p class="settings-meta">{t("attribution")}</p>
        </section>

        <Show when={message()}>
          <p class="center-view-error" role="alert">
            {message()}
          </p>
        </Show>
      </div>
    </section>
  );
}
