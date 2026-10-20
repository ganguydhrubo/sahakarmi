import { createSignal, For, type JSX, Show } from "solid-js";
import type {
  AgentModelId,
  AgentModelOption,
  AgentStatus,
  AppInfo,
  UpdateStatus,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { featureOn } from "../features";
import { LANGUAGE_OPTIONS, type MessageKey, t } from "../i18n";
import {
  type ActivityStyle,
  activityStyle,
  language,
  setActivityStyle,
  setLanguage,
  setTheme,
  type ThemePreference,
  theme,
} from "../preferences";
import { SETTINGS_SECTION_KEY } from "../settings-section";
import { FeaturesSettings } from "./FeaturesSettings";
import { LogoMark } from "./Logo";
import { ModelSuggestions } from "./ModelSuggestions";
import { PermissionsSettings } from "./PermissionsSettings";
import { ProviderConnect } from "./ProviderConnect";
import { UpdateControl } from "./UpdateControl";

type SettingsSection =
  | "general"
  | "ai"
  | "permissions"
  | "voice"
  | "features"
  | "updates"
  | "data"
  | "about";

const SECTIONS: Array<{ id: SettingsSection; label: MessageKey }> = [
  { id: "general", label: "setGeneral" },
  { id: "ai", label: "setAi" },
  { id: "permissions", label: "setPermissions" },
  { id: "voice", label: "setVoice" },
  { id: "features", label: "setFeatures" },
  { id: "updates", label: "updates" },
  { id: "data", label: "dataPrivacy" },
  { id: "about", label: "about" },
];
const SECTION_KEY = SETTINGS_SECTION_KEY;

function storedSection(): SettingsSection {
  try {
    const value = window.localStorage.getItem(SECTION_KEY);
    return SECTIONS.some((section) => section.id === value)
      ? (value as SettingsSection)
      : "general";
  } catch {
    return "general";
  }
}

interface SettingsViewProps {
  appInfo: AppInfo | null;
  agentStatus: AgentStatus;
  updateStatus: UpdateStatus;
  bots: BotProfile[];
  modelOptions: AgentModelOption[];
  onUpdateModel: (botId: string, model: AgentModelId) => Promise<void>;
  onOpenPermissions: () => void;
  onUpdateAction: () => Promise<void>;
}

const ACTIVITY_STYLES: Array<{ value: ActivityStyle; label: MessageKey }> = [
  { value: "masti", label: "activityMasti" },
  { value: "seedha", label: "activitySeedha" },
];

const THEMES: Array<{ value: ThemePreference; label: () => string }> = [
  { value: "system", label: () => t("themeSystem") },
  { value: "light", label: () => t("themeLight") },
  { value: "dark", label: () => t("themeDark") },
];

export function SettingsView(props: SettingsViewProps) {
  const [message, setMessage] = createSignal<string | null>(null);
  const [section, setSection] = createSignal<SettingsSection>(storedSection());

  function select(next: SettingsSection) {
    setSection(next);
    try {
      window.localStorage.setItem(SECTION_KEY, next);
    } catch {
      // Remembering the section is a convenience only.
    }
  }

  const panel = (id: SettingsSection, content: () => JSX.Element) => (
    <Show when={section() === id}>
      <div
        class="settings-panel"
        role="tabpanel"
        id={`settings-${id}`}
        aria-labelledby={`settings-tab-${id}`}
      >
        {content()}
      </div>
    </Show>
  );

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
      <div class="center-view-body settings-layout">
        <div
          class="settings-nav"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t("settings")}
        >
          <For each={SECTIONS}>
            {(item) => (
              <button
                type="button"
                role="tab"
                id={`settings-tab-${item.id}`}
                aria-selected={section() === item.id}
                aria-controls={`settings-${item.id}`}
                classList={{ "settings-nav-active": section() === item.id }}
                onClick={() => select(item.id)}
              >
                {t(item.label)}
              </button>
            )}
          </For>
        </div>
        <div class="settings-content">
          {panel("general", () => (
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
              <h2>{t("activityStyleTitle")}</h2>
              <fieldset class="segmented">
                <legend class="sr-only">{t("activityStyleTitle")}</legend>
                <For each={ACTIVITY_STYLES}>
                  {(option) => (
                    <button
                      type="button"
                      aria-pressed={activityStyle() === option.value}
                      classList={{ "segmented-active": activityStyle() === option.value }}
                      onClick={() => setActivityStyle(option.value)}
                    >
                      {t(option.label)}
                    </button>
                  )}
                </For>
              </fieldset>
              <p class="settings-meta">{t("activityStyleHint")}</p>
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
          ))}

          {panel("ai", () => (
            <>
              <section class="settings-card">
                <h2>{t("providers")}</h2>
                <p>{t("connectIntro")}</p>
                <ProviderConnect agentStatus={props.agentStatus} />
                <Show when={account()}>
                  <p class="settings-meta">{account()}</p>
                </Show>
                <button type="button" onClick={props.onOpenPermissions}>
                  {t("manage")}
                </button>
              </section>
              <section class="settings-card">
                <h2>{t("suggestTitle")}</h2>
                <Show
                  when={featureOn("model-suggestions")}
                  fallback={<p class="settings-meta">{t("suggestOff")}</p>}
                >
                  <ModelSuggestions
                    bots={props.bots}
                    agentStatus={props.agentStatus}
                    modelOptions={props.modelOptions}
                    onApply={props.onUpdateModel}
                  />
                </Show>
              </section>
            </>
          ))}

          {panel("permissions", () => (
            <section class="settings-card">
              <h2>{t("setPermissions")}</h2>
              <PermissionsSettings bots={props.bots} />
            </section>
          ))}

          {panel("voice", () => (
            <section class="settings-card">
              <h2>{t("setVoice")}</h2>
              <p>{t("voiceSettingsNotes")}</p>
              <p class="settings-meta">{t("voiceSettingsPrivacy")}</p>
              <h3>{t("voiceTranscriptTitle")}</h3>
              <p class="settings-meta">{t("voiceTranscriptHonest")}</p>
              <p class="settings-meta">
                {featureOn("live-dictation") ? t("voiceDictationOn") : t("voiceDictationOff")}
              </p>
            </section>
          ))}

          {panel("features", () => (
            <section class="settings-card">
              <h2>{t("setFeatures")}</h2>
              <FeaturesSettings />
            </section>
          ))}

          {panel("updates", () => (
            <section class="settings-card">
              <h2>{t("updates")}</h2>
              <Show
                when={props.updateStatus.phase !== "unsupported"}
                fallback={<p class="settings-meta">{props.updateStatus.message}</p>}
              >
                <p class="settings-meta">{t("updateAutomatic")}</p>
                <UpdateControl status={props.updateStatus} onAction={props.onUpdateAction} />
              </Show>
              <p class="settings-meta">{t("updatePermissionHint")}</p>
            </section>
          ))}

          {panel("data", () => (
            <section class="settings-card">
              <h2>{t("dataPrivacy")}</h2>
              <p class="settings-meta">{t("dataStoredLocally")}</p>
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
            </section>
          ))}

          {panel("about", () => (
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
          ))}
        </div>

        <Show when={message()}>
          <p class="center-view-error" role="alert">
            {message()}
          </p>
        </Show>
      </div>
    </section>
  );
}
