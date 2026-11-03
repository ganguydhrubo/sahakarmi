import { describe, expect, it } from "vitest";
import {
  dequantize,
  dotQuantized,
  quantize,
  readSafetensors,
  StaticEmbedder,
} from "./static-embedder";

const VOCAB = { "[UNK]": 0, "[PAD]": 1, hello: 2, world: 3, "##s": 4, tea: 5, price: 6 };
const DIM = 4;
/** sqrt(1/2) to three places, what two equal unit axes average to. */
const HALF_ROOT2 = Number(Math.SQRT1_2.toFixed(3));
const ROWS: number[][] = [
  [0, 0, 0, 0], // [UNK]
  [0, 0, 0, 0], // [PAD]
  [0, 0, 1, 0], // hello
  [0, 0, 0, 1], // world
  [0, 0, 0, 1], // ##s
  [1, 0, 0, 0], // tea
  [0, 1, 0, 0], // price
];

function tokenizerJson(): string {
  return JSON.stringify({
    normalizer: { type: "BertNormalizer", lowercase: true },
    model: { type: "WordPiece", unk_token: "[UNK]", continuing_subword_prefix: "##", vocab: VOCAB },
  });
}

/** A safetensors file holding one float32 `embeddings` tensor, as model2vec writes it. */
function safetensorsOf(rows: number[][], key = "embeddings"): Buffer {
  const dim = rows[0]?.length ?? 0;
  const data = Buffer.alloc(rows.length * dim * 4);
  for (const [r, row] of rows.entries()) {
    for (const [i, value] of row.entries()) data.writeFloatLE(value, (r * dim + i) * 4);
  }
  let header = JSON.stringify({
    [key]: { dtype: "F32", shape: [rows.length, dim], data_offsets: [0, data.length] },
    __metadata__: { format: "pt" },
  });
  while (header.length % 8 !== 0) header += " ";
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([length, Buffer.from(header, "utf8"), data]);
}

describe("StaticEmbedder", () => {
  it("reads a safetensors table and embeds as the normalised mean of token vectors", () => {
    const embedder = StaticEmbedder.fromBuffers(tokenizerJson(), safetensorsOf(ROWS));
    expect(embedder.dim).toBe(DIM);
    const tea = embedder.embed("Tea");
    expect([...tea].map((v) => Number(v.toFixed(3)))).toEqual([1, 0, 0, 0]);
    const both = embedder.embed("tea price");
    expect([...both].map((v) => Number(v.toFixed(3)))).toEqual([HALF_ROOT2, HALF_ROOT2, 0, 0]);
    // "worlds" = world + ##s, both along the last axis.
    expect([...embedder.embed("worlds")].map((v) => Number(v.toFixed(3)))).toEqual([0, 0, 0, 1]);
    // Unknown words give the zero vector, never NaN.
    expect([...embedder.embed("zzz qqq")]).toEqual([0, 0, 0, 0]);
    expect(embedder.bytesInMemory).toBe(ROWS.length * DIM + ROWS.length * 4);
  });

  it("refuses a table whose row count differs from the vocabulary", () => {
    expect(() => StaticEmbedder.fromBuffers(tokenizerJson(), safetensorsOf(ROWS.slice(1)))).toThrow(
      /token vectors/,
    );
  });

  it("reads the header defensively", () => {
    expect(() => readSafetensors(Buffer.alloc(3))).toThrow(/empty/);
    const bad = Buffer.alloc(16);
    bad.writeBigUInt64LE(BigInt(1_000_000));
    expect(() => readSafetensors(bad)).toThrow(/malformed/);
    const whole = safetensorsOf(ROWS);
    expect(() => readSafetensors(whole.subarray(0, whole.length - 8))).toThrow(/truncated/);
    const other = readSafetensors(safetensorsOf(ROWS, "weights"));
    expect(other.rows).toBe(ROWS.length);
    expect(other.dim).toBe(DIM);
  });

  it("quantizes to int8 with a cosine error well under one percent", () => {
    const vector = new Float32Array([0.31, -0.72, 0.05, 0.4, 0.0, -0.11, 0.9, -0.33]);
    const norm = Math.hypot(...vector);
    const unit = vector.map((v) => v / norm);
    const quantized = quantize(unit);
    expect(Math.max(...quantized.data.map((v) => Math.abs(v)))).toBe(127);
    const back = dequantize(quantized);
    let dot = 0;
    for (let i = 0; i < unit.length; i += 1) dot += (unit[i] ?? 0) * (back[i] ?? 0);
    expect(dot).toBeGreaterThan(0.995);
    expect(dotQuantized(unit, quantized.data, 0, quantized.scale)).toBeCloseTo(dot, 6);
    expect(quantize(new Float32Array([0, 0])).data).toEqual(new Int8Array([0, 0]));
  });
});
