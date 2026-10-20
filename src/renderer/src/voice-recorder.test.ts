import { describe, expect, it } from "vitest";
import {
  formatDuration,
  INITIAL_VOICE_STATE,
  pickAudioMimeType,
  type VoiceEvent,
  voiceReducer,
} from "./voice-recorder";

function run(...events: VoiceEvent[]) {
  return events.reduce(voiceReducer, INITIAL_VOICE_STATE);
}

describe("voice recorder state machine", () => {
  it("walks the happy path from permission to complete", () => {
    const phases = [
      { type: "start" },
      { type: "permission-granted" },
      { type: "pause" },
      { type: "resume" },
      { type: "stop" },
      { type: "processed", durationMs: 4_200 },
      { type: "send" },
      { type: "sent" },
    ] as VoiceEvent[];
    const seen: string[] = [];
    let state = INITIAL_VOICE_STATE;
    for (const event of phases) {
      state = voiceReducer(state, event);
      seen.push(state.phase);
    }
    expect(seen).toEqual([
      "requesting-permission",
      "recording",
      "paused",
      "recording",
      "processing",
      "preview",
      "sending",
      "complete",
    ]);
    expect(state.durationMs).toBe(4_200);
  });

  it("reports a denied microphone and can start again", () => {
    const denied = run({ type: "start" }, { type: "permission-denied", message: "Blocked" });
    expect(denied).toMatchObject({ phase: "error", error: "Blocked" });
    expect(voiceReducer(denied, { type: "start" }).phase).toBe("requesting-permission");
  });

  it("ignores events that do not fit the current phase", () => {
    expect(run({ type: "stop" }).phase).toBe("idle");
    expect(run({ type: "send" }).phase).toBe("idle");
    expect(run({ type: "start" }, { type: "start" }).phase).toBe("requesting-permission");
    const recording = run({ type: "start" }, { type: "permission-granted" });
    expect(voiceReducer(recording, { type: "edit-transcript", text: "x" })).toBe(recording);
  });

  it("cancel drops everything, including the transcript", () => {
    const state = run(
      { type: "start" },
      { type: "permission-granted" },
      { type: "dictated", text: "GST bill bhejna hai" },
      { type: "cancel" },
    );
    expect(state).toEqual(INITIAL_VOICE_STATE);
  });

  it("labels where the text came from and never overwrites the owner's own words", () => {
    const dictated = run(
      { type: "start" },
      { type: "permission-granted" },
      { type: "dictated", text: "कल तक" },
      { type: "dictated", text: "भेजो" },
      { type: "stop" },
      { type: "processed", durationMs: 1_000 },
    );
    expect(dictated).toMatchObject({ transcript: "कल तक भेजो", transcriptSource: "live-dictation" });
    const typed = voiceReducer(dictated, { type: "edit-transcript", text: "Send by tomorrow" });
    expect(typed.transcriptSource).toBe("typed");
    expect(voiceReducer(typed, { type: "dictated", text: "late result" }).transcript).toBe(
      "Send by tomorrow",
    );
  });

  it("clamps the meter and formats durations", () => {
    const state = run(
      { type: "start" },
      { type: "permission-granted" },
      { type: "tick", elapsedMs: 65_000, level: 4 },
    );
    expect(state.level).toBe(1);
    expect(formatDuration(state.elapsedMs)).toBe("1:05");
    expect(pickAudioMimeType((type) => type === "audio/webm")).toBe("audio/webm");
    expect(pickAudioMimeType(() => false)).toBe("");
  });
});
