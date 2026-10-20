import { createSignal, onCleanup, Show } from "solid-js";
import { t } from "../i18n";
import { speechLocale } from "../preferences";

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export function recognitionConstructor(): SpeechRecognitionConstructor | null {
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** Dictation through the Web Speech API in the UI language (en-IN, hi-IN or bn-IN). */
export function VoiceInputButton(props: {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const [listening, setListening] = createSignal(false);
  let recognition: SpeechRecognitionLike | null = null;

  onCleanup(() => recognition?.stop());

  function toggle() {
    if (listening()) {
      recognition?.stop();
      return;
    }
    const Recognition = recognitionConstructor();
    if (!Recognition) {
      props.onError(t("voiceUnsupported"));
      return;
    }
    recognition = new Recognition();
    recognition.lang = speechLocale();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) props.onTranscript(result[0].transcript.trim());
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && event.error !== "no-speech") {
        props.onError(
          event.error === "not-allowed"
            ? t("voiceUnsupported")
            : `${t("voiceInput")}: ${event.error}`,
        );
      }
    };
    recognition.onend = () => setListening(false);
    try {
      recognition.start();
      setListening(true);
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <button
      type="button"
      class="composer-icon-button voice-input-button"
      classList={{ "voice-input-listening": listening() }}
      aria-label={listening() ? t("voiceListening") : t("voiceInput")}
      aria-pressed={listening()}
      title={listening() ? t("voiceListening") : t("voiceInput")}
      disabled={props.disabled && !listening()}
      onClick={toggle}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20">
        <rect x="7.5" y="3" width="5" height="9" rx="2.5" />
        <path d="M4.8 9.5a5.2 5.2 0 0 0 10.4 0M10 14.7V17" />
      </svg>
      <Show when={listening()}>
        <span class="voice-input-pulse" aria-hidden="true" />
      </Show>
    </button>
  );
}
