import { createSignal } from "solid-js";
import type { VoiceSettings, VoiceState } from "../../shared/ipc";

const [voiceState, setVoiceState] = createSignal<VoiceState | null>(null);
const [speakingId, setSpeakingId] = createSignal<string | null>(null);

export { speakingId, voiceState };

let subscribed = false;

/** Loads the voice state once and keeps it current from the main process. */
export function loadVoiceState(): void {
  if (subscribed || !window.sahkarmi?.voice) return;
  subscribed = true;
  window.sahkarmi.voice.onEvent(setVoiceState);
  void window.sahkarmi.voice
    .getState()
    .then(setVoiceState)
    .catch(() => undefined);
}

/** True when a downloaded model can turn speech into text on this PC. */
export function localDictationReady(): boolean {
  const state = voiceState();
  const id = state?.settings.dictationModel;
  return Boolean(id && state?.models.some((model) => model.id === id && model.installed));
}

export function cleanVoiceError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
}

export async function updateVoiceSettings(patch: Partial<VoiceSettings>): Promise<void> {
  setVoiceState(await window.sahkarmi.voice.setSettings(patch));
}

let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let speakRequest = 0;

export function stopSpeaking(): void {
  speakRequest += 1;
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already stopped.
    }
  }
  source = null;
  setSpeakingId(null);
}

/**
 * Reads text aloud with the downloaded voice for its language. Returns false when no voice fits,
 * so the caller can explain what to download. The WAV is decoded in memory and played through Web
 * Audio, so no media URL is needed under the app's content security policy.
 */
export async function speakText(id: string, text: string): Promise<boolean> {
  stopSpeaking();
  const request = speakRequest;
  setSpeakingId(id);
  try {
    const wav = await window.sahkarmi.voice.speak(text);
    if (request !== speakRequest) return true;
    if (!wav) {
      setSpeakingId(null);
      return false;
    }
    context ??= new AudioContext();
    if (context.state === "suspended") await context.resume();
    const bytes = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    const audio = await context.decodeAudioData(bytes);
    if (request !== speakRequest) return true;
    const node = context.createBufferSource();
    node.buffer = audio;
    node.connect(context.destination);
    node.onended = () => {
      if (request === speakRequest) {
        source = null;
        setSpeakingId(null);
      }
    };
    source = node;
    node.start();
    return true;
  } catch (error) {
    if (request === speakRequest) setSpeakingId(null);
    throw new Error(cleanVoiceError(error));
  }
}
