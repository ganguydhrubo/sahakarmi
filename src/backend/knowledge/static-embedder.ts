import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WordPieceTokenizer } from "./wordpiece";

/**
 * A static (model2vec-style) sentence embedder: the embedding of a text is the mean of its
 * token vectors, normalised to unit length. No neural network runs at query time, so a
 * search embeds in well under a millisecond and the whole model is a lookup table that is
 * kept as int8 in memory (about a quarter of the file size).
 */

export interface Embedder {
  readonly dim: number;
  embed(text: string): Float32Array;
}

/** A vector stored as int8 with one scale: `value = data[i] * scale`. */
export interface QuantizedVector {
  scale: number;
  data: Int8Array;
}

export class StaticEmbedder implements Embedder {
  readonly dim: number;
  readonly #tokenizer: WordPieceTokenizer;
  readonly #rows: Int8Array;
  readonly #scales: Float32Array;
  readonly #vocabRows: number;

  constructor(tokenizer: WordPieceTokenizer, table: Float32Array, dim: number) {
    if (dim <= 0 || table.length % dim !== 0) throw new Error("The embedding table is malformed.");
    this.dim = dim;
    this.#tokenizer = tokenizer;
    this.#vocabRows = table.length / dim;
    this.#rows = new Int8Array(table.length);
    this.#scales = new Float32Array(this.#vocabRows);
    for (let row = 0; row < this.#vocabRows; row += 1) {
      const quantized = quantize(table.subarray(row * dim, (row + 1) * dim));
      this.#rows.set(quantized.data, row * dim);
      this.#scales[row] = quantized.scale;
    }
  }

  /** Loads `tokenizer.json` and `model.safetensors` from a model folder. */
  static async fromFolder(folder: string): Promise<StaticEmbedder> {
    const [tokenizerJson, safetensors] = await Promise.all([
      readFile(join(folder, "tokenizer.json"), "utf8"),
      readFile(join(folder, "model.safetensors")),
    ]);
    return StaticEmbedder.fromBuffers(tokenizerJson, safetensors);
  }

  static fromBuffers(tokenizerJson: string, safetensors: Buffer): StaticEmbedder {
    const tokenizer = WordPieceTokenizer.fromJson(tokenizerJson);
    const { table, dim, rows } = readSafetensors(safetensors);
    if (rows !== tokenizer.vocabSize) {
      throw new Error(
        `The model has ${rows} token vectors but the tokenizer has ${tokenizer.vocabSize} tokens.`,
      );
    }
    return new StaticEmbedder(tokenizer, table, dim);
  }

  /** Rough memory the loaded table takes, for the UI. */
  get bytesInMemory(): number {
    return this.#rows.byteLength + this.#scales.byteLength;
  }

  embed(text: string): Float32Array {
    const out = new Float32Array(this.dim);
    const ids = this.#tokenizer.encode(text);
    if (ids.length === 0) return out;
    for (const id of ids) {
      if (id < 0 || id >= this.#vocabRows) continue;
      const scale = this.#scales[id] ?? 0;
      const offset = id * this.dim;
      for (let i = 0; i < this.dim; i += 1) {
        out[i] = (out[i] ?? 0) + (this.#rows[offset + i] ?? 0) * scale;
      }
    }
    let norm = 0;
    for (let i = 0; i < this.dim; i += 1) norm += (out[i] ?? 0) ** 2;
    norm = Math.sqrt(norm);
    if (norm > 0) for (let i = 0; i < this.dim; i += 1) out[i] = (out[i] ?? 0) / norm;
    return out;
  }
}

/** int8 with one scale per vector: 4x smaller than float32, cosine error well under 1%. */
export function quantize(vector: Float32Array): QuantizedVector {
  let max = 0;
  for (const value of vector) max = Math.max(max, Math.abs(value));
  const scale = max > 0 ? max / 127 : 1;
  const data = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) data[i] = Math.round((vector[i] ?? 0) / scale);
  return { scale, data };
}

export function dequantize(vector: QuantizedVector): Float32Array {
  const out = new Float32Array(vector.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = (vector.data[i] ?? 0) * vector.scale;
  return out;
}

/** Dot product of a float query with an int8 row; both unit length, so this is the cosine. */
export function dotQuantized(
  query: Float32Array,
  rows: Int8Array,
  offset: number,
  scale: number,
): number {
  let sum = 0;
  for (let i = 0; i < query.length; i += 1) sum += (query[i] ?? 0) * (rows[offset + i] ?? 0);
  return sum * scale;
}

/** The one float32 tensor a model2vec file holds, as a view plus its shape. */
export function readSafetensors(buffer: Buffer): {
  table: Float32Array;
  dim: number;
  rows: number;
} {
  if (buffer.length < 8) throw new Error("The model file is empty.");
  const headerLength = Number(buffer.readBigUInt64LE(0));
  if (headerLength <= 0 || headerLength > buffer.length - 8) {
    throw new Error("The model file header is malformed.");
  }
  const header = JSON.parse(buffer.subarray(8, 8 + headerLength).toString("utf8")) as Record<
    string,
    { dtype?: string; shape?: number[]; data_offsets?: [number, number] }
  >;
  const entry =
    header.embeddings ??
    Object.entries(header).find(([key, value]) => key !== "__metadata__" && value.dtype)?.[1];
  if (entry?.dtype !== "F32" || !entry.shape || entry.shape.length !== 2) {
    throw new Error("The model file does not hold a float32 [vocab, dim] table.");
  }
  const [rows, dim] = entry.shape as [number, number];
  const [start, end] = entry.data_offsets ?? [0, rows * dim * 4];
  const dataStart = 8 + headerLength + start;
  const dataEnd = 8 + headerLength + end;
  if (dataEnd > buffer.length || end - start !== rows * dim * 4) {
    throw new Error("The model file is truncated.");
  }
  // Copy into an aligned buffer: a Buffer slice may not start on a 4-byte boundary.
  const copy = new ArrayBuffer(end - start);
  new Uint8Array(copy).set(buffer.subarray(dataStart, dataEnd));
  return { table: new Float32Array(copy), dim, rows };
}
