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
  type SendKey,
  sendKey,
  setActivityStyle,
  setLanguage,
  setSendKey,
  setUiSize,
  type UiSize,
  uiSize,
} from "../preferences";
import { SETTINGS_SECTION_KEY } from "../settings-section";
import { AboutCard } from "./AboutCard";
import { AssignmentsSettings } from "./AssignmentsSettings";
import { FeaturesSettings } from "./FeaturesSettings";
import { McpSettings } from "./McpSettings";
import { ModelSuggestions } from "./ModelSuggestions";
import { PermissionsSettings } from "./PermissionsSettings";
import { ProviderConnect } from "./ProviderConnect";
import { SkillsSettings } from "./SkillsSettings";
import { StorageView } from "./StorageView";
import { TelegramSettings } from "./TelegramSettings";
import { ThemeSelector } from "./ThemeSelector";
import { UpdateControl } from "./UpdateControl";
import { VoiceSettings } from "./VoiceSettings";

type SettingsSection =
  | "general"
  | "ai"
  | "permissions"
  | "skills"
  | "mcp"
  | "assignments"
  | "voice"
  | "telegram"
  | "features"
  | "updates"
  | "data"
  | "storage"
  | "about";

interface SectionItem {
  id: SettingsSection;
  label: MessageKey;
  description: MessageKey;
}

/** Settings sections, grouped the way people look for them: their own setup, the team, the app. */
const SECTION_GROUPS: Array<{ label: MessageKey; items: SectionItem[] }> = [
  {
    label: "setGroupPersonal",
    items: [
      { id: "general", label: "setGeneral", description: "setDescGeneral" },
      { id: "voice", label: "setVoice", description: "setDescVoice" },
      { id: "telegram", label: "setTelegram", description: "setDescTelegram" },
    ],
  },
  {
    label: "setGroupCoworkers",
    items: [
      { id: "ai", label: "setAi", description: "setDescAi" },
      { id: "permissions", label: "setPermissions", description: "setDescPermissions" },
      { id: "skills", label: "setSkills", description: "setDescSkills" },
      { id: "mcp", label: "setMcp", description: "setDescMcp" },
      { id: "assignments", label: "assignmentsTitle", description: "setDescAssignments" },
    ],
  },
  {
    label: "setGroupApp",
    items: [
      { id: "features", label: "setFeatures", description: "setDescFeatures" },
      { id: "updates", label: "updates", description: "setDescUpdates" },
      { id: "data", label: "dataPrivacy", description: "setDescData" },
      { id: "storage", label: "setStorage", description: "setDescStorage" },
      { id: "about", label: "about", description: "setDescAbout" },
    ],
  },
];
const SECTIONS: SectionItem[] = SECTION_GROUPS.flatMap((group) => group.items);
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

const UI_SIZES: Array<{ value: UiSize; label: MessageKey }> = [
  { value: "compact", label: "uiSizeCompact" },
  { value: "normal", label: "uiSizeNormal" },
  { value: "large", label: "uiSizeLarge" },
];
const SEND_KEYS: Array<{ value: SendKey; label: MessageKey }> = [
  { value: "enter", label: "sendKeyEnter" },
  { value: "ctrl-enter", label: "sendKeyCtrlEnter" },
];
const ACTIVITY_STYLES: Array<{ value: ActivityStyle; label: MessageKey }> = [
  { value: "masti", label: "activityMasti" },
  { value: "seedha", label: "activitySeedha" },
  { value: "english", label: "activityEnglish" },
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

  const panel = (id: SettingsSection, content: () => JSX.Element) => {
    const item = SECTIONS.find((entry) => entry.id === id);
    return (
      <Show when={section() === id}>
        <div
          class="settings-panel"
          role="tabpanel"
          id={`settings-${id}`}
          aria-labelledby={`settings-tab-${id}`}
        >
          <Show when={item}>
            {(entry) => (
              <header class="settings-panel-header">
                <h2>{t(entry().label)}</h2>
                <p>{t(entry().description)}</p>
              </header>
            )}
          </Show>
          {content()}
        </div>
      </Show>
    );
  };

  const segmented = <T extends string>(
    label: MessageKey,
    options: Array<{ value: T; label: MessageKey }>,
    current: () => T,
    choose: (value: T) => void,
  ) => (
    <fieldset class="segmented">
      <legend class="sr-only">{t(label)}</legend>
      <For each={options}>
        {(option) => (
          <button
            type="button"
            aria-pressed={current() === option.value}
            classList={{ "segmented-active": current() === option.value }}
            onClick={() => choose(option.value)}
          >
            {t(option.label)}
          </button>
        )}
      </For>
    </fieldset>
  );

  /** One setting: its name and help on the left, the control on the right (or below it). */
  const row = (
    label: MessageKey,
    hint: MessageKey | null,
    control: JSX.Element | null,
    stacked = false,
  ) => (
    <div class="settings-row" classList={{ "settings-row-stacked": stacked }}>
      <div class="settings-row-text">
        <h3>{t(label)}</h3>
        <Show when={hint}>{(key) => <p class="settings-meta">{t(key())}</p>}</Show>
      </div>
      <Show when={control}>
        <div class="settings-row-control">{control}</div>
      </Show>
    </div>
  );

  function run(action: () => Promise<unknown>) {
    setMessage(null);
    void action().catch((cause) =>
      setMessage(cause instanceof Error ? cause.message : String(cause)),
    );
  }

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
          <For each={SECTION_GROUPS}>
            {(group) => (
              <div class="settings-nav-group" role="presentation">
                <span class="settings-nav-label" aria-hidden="true">
                  {t(group.label)}
                </span>
                <For each={group.items}>
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
            )}
          </For>
        </div>
        <div class="settings-content">
          {panel("general", () => (
            <>
              <section class="settings-card">
                <h2>{t("setCardLook")}</h2>
                {row("appearance", "themeHint", <ThemeSelector />, true)}
                {row(
                  "uiSizeLabel",
                  "uiSizeHint",
                  segmented("uiSizeLabel", UI_SIZES, uiSize, setUiSize),
                )}
              </section>
              <section class="settings-card">
                <h2>{t("setCardLanguage")}</h2>
                {row(
                  "languageLabel",
                  "languageHint",
                  <fieldset class="segmented segmented-wrap">
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
                  </fieldset>,
                  true,
                )}
                {row(
                  "activityStyleTitle",
                  "activityStyleHint",
                  segmented("activityStyleTitle", ACTIVITY_STYLES, activityStyle, setActivityStyle),
                  true,
                )}
              </section>
              <section class="settings-card">
                <h2>{t("setCardKeyboard")}</h2>
                {row(
                  "sendKeyLabel",
                  null,
                  segmented("sendKeyLabel", SEND_KEYS, sendKey, setSendKey),
                  true,
                )}
                {row("shortcutsLabel", "shortcutsHint", null)}
              </section>
            </>
          ))}

          {panel("ai", () => (
            <>
              <section class="settings-card">
                <h2>{t("providers")}</h2>
                <p>{t("connectIntro")}</p>
                <ProviderConnect agentStatus={props.agentStatus} />
                <p class="settings-meta provider-permissions-link">
                  <button type="button" class="link-button" onClick={props.onOpenPermissions}>
                    {t("connectPermissionsLink")}
                  </button>
                </p>
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
              <PermissionsSettings bots={props.bots} />
            </section>
          ))}

          {panel("voice", () => (
            <section class="settings-card">
              <VoiceSettings />
              <h3>{t("voiceNotesTitle")}</h3>
              <p>{t("voiceSettingsNotes")}</p>
              <p class="settings-meta">{t("voiceSettingsPrivacy")}</p>
              <p class="settings-meta">{t("voiceTranscriptHonest")}</p>
              <p class="settings-meta">
                {featureOn("live-dictation") ? t("voiceDictationOn") : t("voiceDictationOff")}
              </p>
            </section>
          ))}

          {panel("skills", () => (
            <section class="settings-card">
              <SkillsSettings />
            </section>
          ))}

          {panel("mcp", () => (
            <section class="settings-card">
              <McpSettings />
            </section>
          ))}

          {panel("assignments", () => (
            <section class="settings-card">
              <AssignmentsSettings />
            </section>
          ))}

          {panel("telegram", () => (
            <section class="settings-card">
              <TelegramSettings bots={props.bots} />
            </section>
          ))}

          {panel("features", () => (
            <section class="settings-card">
              <FeaturesSettings />
            </section>
          ))}

          {panel("updates", () => (
            <section class="settings-card">
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

          {panel("storage", () => (
            <StorageView />
          ))}

          {panel("about", () => (
            <AboutCard version={props.appInfo?.version ?? null} />
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
