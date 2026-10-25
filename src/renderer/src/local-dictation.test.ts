import { describe, expect, it } from "vitest";
import { DICTATION_SAMPLE_RATE, SpeechSegmenter } from "./local-dictation";

const CHUNK = 4_096;

function audio(ms: number, loud: boolean): Float32Array[] {
  const total = Math.round((ms / 1_000) * DICTATION_SAMPLE_RATE);
  const chunks: Float32Array[] = [];
  for (let start = 0; start < total; start += CHUNK) {
    const chunk = new Float32Array(Math.min(CHUNK, total - start));
    for (let index = 0; index < chunk.length; index += 1) {
      chunk[index] = loud ? 0.2 * Math.sin(index / 5) : 0.001 * Math.sin(index);
    }
    chunks.push(chunk);
  }
  return chunks;
}

function feed(segmenter: SpeechSegmenter, chunks: Float32Array[]): Float32Array[] {
  return chunks.flatMap((chunk) => segmenter.push(chunk));
}

describe("SpeechSegmenter", () => {
  it("ignores silence", () => {
    const segmenter = new SpeechSegmenter();
    expect(feed(segmenter, audio(3_000, false))).toHaveLength(0);
    expect(segmenter.flush()).toBeNull();
  });

  it("cuts a phrase at a pause and keeps a little lead-in", () => {
    const segmenter = new SpeechSegmenter();
    feed(segmenter, audio(2_000, false));
    const phrases = feed(segmenter, [...audio(1_500, true), ...audio(1_000, false)]);
    expect(phrases).toHaveLength(1);
    const seconds = (phrases[0]?.length ?? 0) / DICTATION_SAMPLE_RATE;
    expect(seconds).toBeGreaterThan(2.1);
    expect(seconds).toBeLessThan(3.2);
  });

  it("splits two phrases separated by a pause", () => {
    const segmenter = new SpeechSegmenter();
    const phrases = feed(segmenter, [
      ...audio(1_000, true),
      ...audio(900, false),
      ...audio(1_000, true),
      ...audio(900, false),
    ]);
    expect(phrases).toHaveLength(2);
  });

  it("cuts long speech without a pause so text keeps coming", () => {
    const segmenter = new SpeechSegmenter({ maxMs: 5_000 });
    const phrases = feed(segmenter, audio(12_000, true));
    expect(phrases.length).toBeGreaterThanOrEqual(2);
    expect(segmenter.flush()).not.toBeNull();
  });

  it("drops a short click", () => {
    const segmenter = new SpeechSegmenter();
    const click = new Float32Array(400).fill(0.3);
    const phrases = feed(segmenter, [click, ...audio(1_000, false)]);
    expect(phrases).toHaveLength(0);
  });

  it("returns the phrase still being spoken when stopped", () => {
    const segmenter = new SpeechSegmenter();
    feed(segmenter, audio(1_200, true));
    expect(segmenter.flush()?.length).toBeGreaterThan(16_000);
  });
});
