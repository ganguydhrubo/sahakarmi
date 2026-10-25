/**
 * Voice note state machine. Pure transitions (tested) plus a thin MediaRecorder controller.
 *
 * idle → requesting-permission → recording ⇄ paused → processing → preview → sending → complete
 * Any state can fail to "error"; cancel/discard returns to idle and drops the audio.
 */

export type VoicePhase =
  | "idle"
  | "requesting-permission"
  | "recording"
  | "paused"
  | "processing"
  | "preview"
  | "sending"
  | "complete"
  | "error";

export interface VoiceState {
  phase: VoicePhase;
  elapsedMs: number;
  level: number;
  error: string | null;
  /** Typed or dictated text that travels with the audio; never machine-invented. */
  transcript: string;
  transcriptSource: "none" | "typed" | "live-dictation";
  durationMs: number | null;
}

export type VoiceEvent =
  | { type: "start" }
  | { type: "permission-granted" }
  | { type: "permission-denied"; message: string }
  | { type: "tick"; elapsedMs: number; level: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "processed"; durationMs: number }
  | { type: "dictated"; text: string }
  | { type: "edit-transcript"; text: string }
  | { type: "send" }
  | { type: "sent" }
  | { type: "fail"; message: string }
  | { type: "cancel" }
  | { type: "reset" };

export const INITIAL_VOICE_STATE: VoiceState = {
  phase: "idle",
  elapsedMs: 0,
  level: 0,
  error: null,
  transcript: "",
  transcriptSource: "none",
  durationMs: null,
};

/** Recording stops by itself at this length. */
export const MAX_RECORDING_MS = 5 * 60_000;

export function voiceReducer(state: VoiceState, event: VoiceEvent): VoiceState {
  switch (event.type) {
    case "start":
      return state.phase === "idle" || state.phase === "complete" || state.phase === "error"
        ? { ...INITIAL_VOICE_STATE, phase: "requesting-permission" }
        : state;
    case "permission-granted":
      return state.phase === "requesting-permission" ? { ...state, phase: "recording" } : state;
    case "permission-denied":
      return state.phase === "requesting-permission"
        ? { ...state, phase: "error", error: event.message }
        : state;
    case "tick":
      return state.phase === "recording"
        ? { ...state, elapsedMs: event.elapsedMs, level: Math.max(0, Math.min(1, event.level)) }
        : state;
    case "pause":
      return state.phase === "recording" ? { ...state, phase: "paused", level: 0 } : state;
    case "resume":
      return state.phase === "paused" ? { ...state, phase: "recording" } : state;
    case "stop":
      return state.phase === "recording" || state.phase === "paused"
        ? { ...state, phase: "processing", level: 0 }
        : state;
    case "processed":
      return state.phase === "processing"
        ? { ...state, phase: "preview", durationMs: event.durationMs }
        : state;
    case "dictated":
      if (!["recording", "paused", "processing", "preview"].includes(state.phase)) return state;
      if (state.transcriptSource === "typed" || !event.text.trim()) return state;
      return {
        ...state,
        transcript: state.transcript
          ? `${state.transcript} ${event.text.trim()}`
          : event.text.trim(),
        transcriptSource: "live-dictation",
      };
    case "edit-transcript":
      return state.phase === "preview"
        ? {
            ...state,
            transcript: event.text,
            transcriptSource: event.text.trim() ? "typed" : "none",
          }
        : state;
    case "send":
      return state.phase === "preview" ? { ...state, phase: "sending" } : state;
    case "sent":
      return state.phase === "sending" ? { ...state, phase: "complete" } : state;
    case "fail":
      return state.phase === "idle"
        ? state
        : { ...state, phase: "error", error: event.message, level: 0 };
    case "cancel":
    case "reset":
      return { ...INITIAL_VOICE_STATE };
    default:
      return state;
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Picks a container the platform can record; Chromium records Opus in WebM. */
export function pickAudioMimeType(isSupported: (type: string) => boolean): string {
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ]) {
    if (isSupported(type)) return type;
  }
  return "";
}

export interface RecorderCallbacks {
  onTick: (elapsedMs: number, level: number) => void;
  onLimit: () => void;
}

/** MediaRecorder + level meter. Audio stays in memory until the owner attaches it. */
export class VoiceRecorderController {
  #stream: MediaStream | null = null;
  #recorder: MediaRecorder | null = null;
  #chunks: Blob[] = [];
  #context: AudioContext | null = null;
  #analyser: AnalyserNode | null = null;
  #frame = 0;
  #startedAt = 0;
  #pausedTotal = 0;
  #pausedAt: number | null = null;
  #callbacks: RecorderCallbacks;

  constructor(callbacks: RecorderCallbacks) {
    this.#callbacks = callbacks;
  }

  /** The live microphone stream, so dictation can listen to the same recording. */
  get stream(): MediaStream | null {
    return this.#stream;
  }

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      throw new Error("unsupported");
    }
    this.#stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const mimeType = pickAudioMimeType((type) => MediaRecorder.isTypeSupported(type));
    this.#recorder = new MediaRecorder(this.#stream, mimeType ? { mimeType } : undefined);
    this.#chunks = [];
    this.#recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.#chunks.push(event.data);
    };
    this.#recorder.start(1_000);
    this.#startedAt = performance.now();
    this.#pausedTotal = 0;
    this.#pausedAt = null;
    try {
      this.#context = new AudioContext();
      this.#analyser = this.#context.createAnalyser();
      this.#analyser.fftSize = 512;
      this.#context.createMediaStreamSource(this.#stream).connect(this.#analyser);
    } catch {
      this.#analyser = null; // The meter is optional; recording still works.
    }
    this.#loop();
  }

  pause(): void {
    if (this.#recorder?.state !== "recording") return;
    this.#recorder.pause();
    this.#pausedAt = performance.now();
  }

  resume(): void {
    if (this.#recorder?.state !== "paused") return;
    this.#recorder.resume();
    if (this.#pausedAt !== null) this.#pausedTotal += performance.now() - this.#pausedAt;
    this.#pausedAt = null;
  }

  elapsed(): number {
    const now = this.#pausedAt ?? performance.now();
    return Math.max(0, now - this.#startedAt - this.#pausedTotal);
  }

  async stop(): Promise<{ blob: Blob; durationMs: number }> {
    const recorder = this.#recorder;
    const durationMs = this.elapsed();
    if (!recorder) throw new Error("Nothing was recorded.");
    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    const blob = new Blob(this.#chunks, { type: recorder.mimeType || "audio/webm" });
    this.dispose();
    if (blob.size === 0) throw new Error("The recording is empty. Check your microphone.");
    return { blob, durationMs };
  }

  dispose(): void {
    cancelAnimationFrame(this.#frame);
    if (this.#recorder && this.#recorder.state !== "inactive") {
      this.#recorder.onstop = null;
      this.#recorder.stop();
    }
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    void this.#context?.close().catch(() => undefined);
    this.#stream = null;
    this.#recorder = null;
    this.#context = null;
    this.#analyser = null;
  }

  #loop(): void {
    const samples = this.#analyser ? new Uint8Array(this.#analyser.fftSize) : null;
    const step = () => {
      if (!this.#recorder) return;
      let level = 0;
      if (this.#analyser && samples && this.#recorder.state === "recording") {
        this.#analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
        level = Math.min(1, Math.sqrt(sum / samples.length) * 3);
      }
      const elapsed = this.elapsed();
      this.#callbacks.onTick(elapsed, level);
      if (elapsed >= MAX_RECORDING_MS) {
        this.#callbacks.onLimit();
        return;
      }
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }
}
