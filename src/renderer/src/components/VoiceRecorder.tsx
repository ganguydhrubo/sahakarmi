import { createSignal, onCleanup, Show } from "solid-js";
import type { DraftAttachment } from "../../../shared/ipc";
import { featureOn } from "../features";
import { type MessageKey, t } from "../i18n";
import { speechLocale } from "../preferences";
import {
  formatDuration,
  INITIAL_VOICE_STATE,
  MAX_RECORDING_MS,
  type VoiceEvent,
  type VoicePhase,
  VoiceRecorderController,
  voiceReducer,
} from "../voice-recorder";
import { recognitionConstructor, type SpeechRecognitionLike } from "./VoiceInputButton";

const PHASE_KEYS: Record<VoicePhase, MessageKey> = {
  idle: "voiceIdle",
  "requesting-permission": "voiceRequesting",
  recording: "voiceRecording",
  paused: "voicePaused",
  processing: "voiceProcessing",
  preview: "voicePreview",
  sending: "voiceSending",
  complete: "voiceComplete",
  error: "voiceError",
};

/**
 * Voice notes: record, preview, then attach the audio (and any text you typed or dictated) to
 * the message. Coworkers cannot listen to audio, so the panel says so instead of pretending.
 */
export function VoiceRecorder(props: {
  disabled?: boolean;
  onAttach: (attachments: DraftAttachment[], transcript: string) => void;
  onError: (message: string) => void;
}) {
  const [state, setState] = createSignal(INITIAL_VOICE_STATE);
  const [open, setOpen] = createSignal(false);
  const [audioUrl, setAudioUrl] = createSignal<string | null>(null);
  let blob: Blob | null = null;
  let recognition: SpeechRecognitionLike | null = null;
  const dispatch = (event: VoiceEvent) => setState((current) => voiceReducer(current, event));

  const controller = new VoiceRecorderController({
    onTick: (elapsedMs, level) => dispatch({ type: "tick", elapsedMs, level }),
    onLimit: () => void stop(),
  });

  function releaseAudio() {
    const url = audioUrl();
    if (url) URL.revokeObjectURL(url);
    setAudioUrl(null);
    blob = null;
  }

  onCleanup(() => {
    controller.dispose();
    recognition?.stop();
    releaseAudio();
  });

  async function start() {
    releaseAudio();
    setOpen(true);
    dispatch({ type: "start" });
    try {
      await controller.start();
      dispatch({ type: "permission-granted" });
      if (featureOn("live-dictation")) startDictation();
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      dispatch({
        type: "permission-denied",
        message:
          name === "NotAllowedError" || name === "SecurityError"
            ? t("voiceMicDenied")
            : name === "NotFoundError"
              ? t("voiceNoMic")
              : t("voiceUnsupportedRecorder"),
      });
    }
  }

  function startDictation() {
    const Recognition = recognitionConstructor();
    if (!Recognition) return;
    recognition = new Recognition();
    recognition.lang = speechLocale();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) dispatch({ type: "dictated", text: result[0].transcript });
      }
    };
    recognition.onerror = () => {
      recognition = null; // Dictation is optional; the recording continues.
    };
    try {
      recognition.start();
    } catch {
      recognition = null;
    }
  }

  async function stop() {
    dispatch({ type: "stop" });
    recognition?.stop();
    recognition = null;
    try {
      const result = await controller.stop();
      blob = result.blob;
      setAudioUrl(URL.createObjectURL(result.blob));
      dispatch({ type: "processed", durationMs: result.durationMs });
    } catch (error) {
      dispatch({ type: "fail", message: error instanceof Error ? error.message : String(error) });
    }
  }

  function cancel() {
    controller.dispose();
    recognition?.stop();
    recognition = null;
    releaseAudio();
    dispatch({ type: "cancel" });
    setOpen(false);
  }

  async function attach() {
    if (!blob) return;
    dispatch({ type: "send" });
    try {
      const extension = blob.type.includes("ogg")
        ? "ogg"
        : blob.type.includes("mp4")
          ? "m4a"
          : "webm";
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const attachments = await window.sahkarmi.agent.importData([
        {
          name: `voice-note-${stamp}.${extension}`,
          mimeType: blob.type || "audio/webm",
          bytes: new Uint8Array(await blob.arrayBuffer()),
        },
      ]);
      dispatch({ type: "sent" });
      props.onAttach(attachments, state().transcript.trim());
      releaseAudio();
      setOpen(false);
      dispatch({ type: "reset" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "fail", message });
      props.onError(message);
    }
  }

  const phase = () => state().phase;
  const active = () => phase() === "recording" || phase() === "paused";

  return (
    <div class="voice-recorder">
      <button
        type="button"
        class="composer-icon-button voice-input-button"
        classList={{ "voice-input-listening": phase() === "recording" }}
        aria-label={open() ? t("voiceRecording") : t("voiceRecord")}
        aria-expanded={open()}
        title={t("voiceRecord")}
        disabled={props.disabled && !open()}
        onClick={() => (open() ? undefined : void start())}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20">
          <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
          <path d="M4.8 9.5a5.2 5.2 0 0 0 10.4 0M10 14.7V17" />
        </svg>
        <Show when={phase() === "recording"}>
          <span class="voice-input-pulse" aria-hidden="true" />
        </Show>
      </button>
      <Show when={open()}>
        <div class="voice-panel" role="dialog" aria-label={t("voiceRecord")}>
          <div class="voice-panel-head">
            <span class={`voice-phase voice-phase-${phase()}`} role="status" aria-live="polite">
              {t(PHASE_KEYS[phase()])}
            </span>
            <span class="voice-timer">
              {formatDuration(state().durationMs ?? state().elapsedMs)} /{" "}
              {formatDuration(MAX_RECORDING_MS)}
            </span>
          </div>
          <Show when={active()}>
            <div class="voice-level" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(0.04, state().level)})` }} />
            </div>
          </Show>
          <Show when={state().error}>
            <p class="voice-error" role="alert">
              {state().error}
            </p>
          </Show>
          <Show when={phase() === "preview" || phase() === "sending"}>
            <audio class="voice-audio" controls src={audioUrl() ?? undefined}>
              <track kind="captions" />
            </audio>
            <label class="voice-transcript">
              <span>
                {state().transcriptSource === "live-dictation"
                  ? t("voiceTextDictated")
                  : t("voiceTextTyped")}
              </span>
              <textarea
                rows={3}
                value={state().transcript}
                placeholder={t("voiceTextPlaceholder")}
                onInput={(event) =>
                  dispatch({ type: "edit-transcript", text: event.currentTarget.value })
                }
              />
            </label>
            <p class="voice-honest">{t("voiceHonest")}</p>
          </Show>
          <Show when={active() && featureOn("live-dictation")}>
            <p class="voice-honest">{t("voiceDictationDisclosure")}</p>
          </Show>
          <div class="voice-actions">
            <button type="button" class="button-danger-quiet" onClick={cancel}>
              {phase() === "preview" ? t("voiceDiscard") : t("cancel")}
            </button>
            <Show when={phase() === "recording"}>
              <button
                type="button"
                onClick={() => {
                  controller.pause();
                  dispatch({ type: "pause" });
                }}
              >
                {t("pause")}
              </button>
            </Show>
            <Show when={phase() === "paused"}>
              <button
                type="button"
                onClick={() => {
                  controller.resume();
                  dispatch({ type: "resume" });
                }}
              >
                {t("resume")}
              </button>
            </Show>
            <Show when={active()}>
              <button type="button" class="button-primary" onClick={() => void stop()}>
                {t("voiceStop")}
              </button>
            </Show>
            <Show when={phase() === "preview"}>
              <button type="button" class="button-primary" onClick={() => void attach()}>
                {t("voiceAttach")}
              </button>
            </Show>
            <Show when={phase() === "error"}>
              <button type="button" onClick={() => void start()}>
                {t("updateRetry")}
              </button>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
