import { createSignal, For, onMount, Show } from "solid-js";
import type { VoiceModelInfo } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";
import { language } from "../preferences";
import {
  cleanVoiceError,
  loadVoiceState,
  speakingId,
  speakText,
  stopSpeaking,
  updateVoiceSettings,
  voiceState,
} from "../voice-store";

/** Most-spoken Indian languages first; the rest appear behind "Show all". */
const FIRST_INDIC = ["indic-hi", "indic-bn", "indic-mr", "indic-te", "indic-ta", "indic-gu"];

const SUMMARY_KEYS: Record<string, MessageKey> = {
  "english-fast": "voiceSumEnglishFast",
  "hinglish-swift": "voiceSumHinglishFast",
  "hinglish-apex": "voiceSumHinglishBest",
  "whisper-turbo": "voiceSumWhisper",
  "rasa-indic": "voiceSumRasa",
  "kokoro-english": "voiceSumKokoro",
};

const NAME_KEYS: Record<string, MessageKey> = {
  "english-fast": "voiceNameEnglishFast",
  "hinglish-swift": "voiceNameHinglishFast",
  "hinglish-apex": "voiceNameHinglishBest",
  "rasa-indic": "voiceNameRasa",
  "kokoro-english": "voiceNameKokoro",
};

const SPEAKER_KEYS: Record<string, MessageKey> = {
  Light: "voiceSpeakerLight",
  Warm: "voiceSpeakerWarm",
  Deep: "voiceSpeakerDeep",
  "Deep 2": "voiceSpeakerDeep2",
};

/** Whisper turbo language choices: Indian languages it knows, then common world languages. */
const WHISPER_LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["hi", "हिन्दी"],
  ["bn", "বাংলা"],
  ["mr", "मराठी"],
  ["te", "తెలుగు"],
  ["ta", "தமிழ்"],
  ["gu", "ગુજરાતી"],
  ["kn", "ಕನ್ನಡ"],
  ["ml", "മലയാളം"],
  ["pa", "ਪੰਜਾਬੀ"],
  ["ur", "اردو"],
  ["ne", "नेपाली"],
  ["as", "অসমীয়া"],
  ["sa", "संस्कृतम्"],
  ["sd", "سنڌي"],
  ["ar", "العربية"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["ja", "日本語"],
  ["zh", "中文"],
];

const SAMPLES: Record<string, string> = {
  hi: "नमस्ते! मैं आपका सहकर्मी हूँ। आज कौन सा काम करें?",
  bn: "নমস্কার! আমি আপনার সহকর্মী। আজ কোন কাজটা করব?",
  en: "Hello! I am your coworker. What shall we do today?",
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

function modelName(model: VoiceModelInfo): string {
  const key = NAME_KEYS[model.id];
  return key ? t(key) : model.name;
}

function modelSummary(model: VoiceModelInfo): string {
  const key = SUMMARY_KEYS[model.id];
  return key ? t(key) : t("voiceSumIndic");
}

export function VoiceSettings() {
  const [error, setError] = createSignal<string | null>(null);
  const [showAll, setShowAll] = createSignal(false);
  onMount(loadVoiceState);

  const models = () => voiceState()?.models ?? [];
  const settings = () => voiceState()?.settings;
  const dictation = (group: VoiceModelInfo["group"]) =>
    models().filter((model) => model.type === "dictation" && model.group === group);
  const indic = () =>
    dictation("indic").filter(
      (model) =>
        showAll() || model.installed || model.phase !== "idle" || FIRST_INDIC.includes(model.id),
    );
  const speech = () => models().filter((model) => model.type === "speech");
  const busy = (model: VoiceModelInfo) =>
    model.phase === "downloading" || model.phase === "installing";

  function run(action: () => Promise<unknown>) {
    setError(null);
    void action().catch((cause) => setError(cleanVoiceError(cause)));
  }

  function remove(model: VoiceModelInfo) {
    if (!window.confirm(t("voiceRemoveConfirm", { name: modelName(model) }))) return;
    run(() => window.sahkarmi.voice.remove(model.id));
  }

  function tryVoice(model: VoiceModelInfo) {
    if (speakingId() === `try-${model.id}`) {
      stopSpeaking();
      return;
    }
    const wanted = model.languages.includes(language()) ? language() : model.languages[0];
    const text = SAMPLES[wanted ?? "en"] ?? SAMPLES.hi ?? "";
    run(() => speakText(`try-${model.id}`, text));
  }

  function setSpeaker(model: VoiceModelInfo, id: number) {
    const speakers = { ...(settings()?.speakers ?? {}) };
    for (const code of model.languages) speakers[code] = id;
    run(() => updateVoiceSettings({ speakers }));
  }

  const speakerFor = (model: VoiceModelInfo) =>
    settings()?.speakers[model.languages[0] ?? ""] ?? model.speakers[0]?.id ?? 0;

  const ModelRow = (props: { model: VoiceModelInfo }) => {
    const inUse = () =>
      props.model.type === "dictation" && settings()?.dictationModel === props.model.id;
    return (
      <li class="feature-row voice-model-row" classList={{ "voice-model-active": inUse() }}>
        <div class="voice-model-text">
          <strong>{modelName(props.model)}</strong>
          <Show when={inUse()}>
            <span class="feature-availability feature-availability-available">
              {t("voiceInUse")}
            </span>
          </Show>
          <p>{modelSummary(props.model)}</p>
          <small>
            {formatSize(props.model.sizeBytes)} · {props.model.licence}
          </small>
          <Show when={busy(props.model)}>
            <div
              class="voice-progress"
              role="progressbar"
              aria-label={modelName(props.model)}
              aria-valuemin={0}
              aria-valuemax={props.model.sizeBytes}
              aria-valuenow={props.model.receivedBytes}
            >
              <span
                style={{
                  width: `${Math.min(100, (props.model.receivedBytes / Math.max(1, props.model.sizeBytes)) * 100)}%`,
                }}
              />
            </div>
            <small>
              {props.model.phase === "installing"
                ? t("voiceUnpacking")
                : t("voiceDownloading", {
                    done: formatSize(props.model.receivedBytes),
                    total: formatSize(props.model.sizeBytes),
                  })}
            </small>
          </Show>
          <Show when={props.model.phase === "failed" && props.model.message}>
            <small class="voice-model-error" role="alert">
              {props.model.message}
            </small>
          </Show>
        </div>
        <div class="settings-buttons voice-model-actions">
          <Show when={!props.model.installed && !busy(props.model)}>
            <button
              type="button"
              class="button-primary"
              onClick={() => run(() => window.sahkarmi.voice.install(props.model.id))}
            >
              {props.model.phase === "failed" ? t("voiceTryAgain") : t("voiceDownload")}
            </button>
          </Show>
          <Show when={busy(props.model)}>
            <button
              type="button"
              onClick={() => run(() => window.sahkarmi.voice.cancel(props.model.id))}
            >
              {t("cancel")}
            </button>
          </Show>
          <Show when={props.model.installed && props.model.type === "dictation" && !inUse()}>
            <button
              type="button"
              onClick={() => run(() => updateVoiceSettings({ dictationModel: props.model.id }))}
            >
              {t("voiceUse")}
            </button>
          </Show>
          <Show when={props.model.installed && props.model.type === "speech"}>
            <button type="button" onClick={() => tryVoice(props.model)}>
              {speakingId() === `try-${props.model.id}` ? t("voiceStopReading") : t("voiceTry")}
            </button>
          </Show>
          <Show when={props.model.installed}>
            <button type="button" class="button-danger-quiet" onClick={() => remove(props.model)}>
              {t("voiceRemove")}
            </button>
          </Show>
        </div>
        <Show when={props.model.installed && props.model.speakers.length > 1}>
          <div class="voice-speakers">
            <fieldset class="segmented" aria-label={t("voiceChooseVoice")}>
              <For each={props.model.speakers}>
                {(speaker) => (
                  <button
                    type="button"
                    classList={{ "segmented-active": speakerFor(props.model) === speaker.id }}
                    aria-pressed={speakerFor(props.model) === speaker.id}
                    onClick={() => setSpeaker(props.model, speaker.id)}
                  >
                    {SPEAKER_KEYS[speaker.name]
                      ? t(SPEAKER_KEYS[speaker.name] as MessageKey)
                      : speaker.name}
                  </button>
                )}
              </For>
            </fieldset>
          </div>
        </Show>
      </li>
    );
  };

  return (
    <div class="voice-settings">
      <p>{t("voiceIntro")}</p>
      <p class="settings-meta">
        {t("voiceOfflineNote")}
        <Show when={voiceState() && !voiceState()?.engineInstalled}>
          {" "}
          {t("voiceEngineNote", { size: formatSize(voiceState()?.engineSizeBytes ?? 0) })}
        </Show>
      </p>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>

      <h3>{t("voiceDictationTitle")}</h3>
      <p class="settings-meta">{t("voiceDictationHelp")}</p>
      <h4 class="voice-group-title">{t("voiceGroupIndic")}</h4>
      <ul class="feature-list voice-model-list">
        <For each={indic()}>{(model) => <ModelRow model={model} />}</For>
      </ul>
      <button type="button" class="voice-show-all" onClick={() => setShowAll(!showAll())}>
        {showAll() ? t("voiceShowFewer") : t("voiceShowAll", { count: "22" })}
      </button>
      <h4 class="voice-group-title">{t("voiceGroupHinglish")}</h4>
      <ul class="feature-list voice-model-list">
        <For each={dictation("hinglish")}>{(model) => <ModelRow model={model} />}</For>
      </ul>
      <h4 class="voice-group-title">{t("voiceGroupWorld")}</h4>
      <ul class="feature-list voice-model-list">
        <For each={dictation("world")}>{(model) => <ModelRow model={model} />}</For>
      </ul>
      <Show when={settings()?.dictationModel === "whisper-turbo"}>
        <label class="voice-field">
          <span>{t("voiceWhisperLanguage")}</span>
          <select
            value={settings()?.dictationLanguage ?? ""}
            onChange={(event) =>
              run(() => updateVoiceSettings({ dictationLanguage: event.currentTarget.value }))
            }
          >
            <option value="">{t("voiceAutoDetect")}</option>
            <For each={WHISPER_LANGUAGES}>
              {([code, name]) => <option value={code}>{name}</option>}
            </For>
          </select>
        </label>
      </Show>

      <h3>{t("voiceRepliesTitle")}</h3>
      <p class="settings-meta">{t("voiceRepliesHelp")}</p>
      <ul class="feature-list voice-model-list">
        <For each={speech()}>{(model) => <ModelRow model={model} />}</For>
        <li class="feature-row">
          <div>
            <strong>{t("voiceReadAloudToggle")}</strong>
            <p>{t("voiceReadAloudHelp")}</p>
          </div>
          <button
            type="button"
            role="switch"
            class="feature-switch"
            aria-checked={settings()?.readAloud === true}
            aria-label={t("voiceReadAloudToggle")}
            disabled={!speech().some((model) => model.installed)}
            onClick={() => run(() => updateVoiceSettings({ readAloud: !settings()?.readAloud }))}
          >
            <span />
          </button>
        </li>
      </ul>
      <div class="voice-field">
        <span>{t("voiceSpeed")}</span>
        <fieldset class="segmented">
          <For
            each={
              [
                [0.85, "voiceSpeedSlow"],
                [1, "voiceSpeedNormal"],
                [1.2, "voiceSpeedFast"],
              ] as [number, MessageKey][]
            }
          >
            {([speed, label]) => (
              <button
                type="button"
                classList={{ "segmented-active": settings()?.speed === speed }}
                aria-pressed={settings()?.speed === speed}
                onClick={() => run(() => updateVoiceSettings({ speed }))}
              >
                {t(label)}
              </button>
            )}
          </For>
        </fieldset>
      </div>
    </div>
  );
}
