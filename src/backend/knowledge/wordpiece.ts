/**
 * A BERT-style WordPiece tokenizer in plain TypeScript, enough to drive a static embedding
 * model (model2vec) without a native tokenizer library. Mirrors the HuggingFace
 * `BertNormalizer` + `BertPreTokenizer` + `WordPiece` pipeline for the uncased English vocab.
 */

export interface WordPieceOptions {
  lowercase: boolean;
  unkToken: string;
  continuingSubwordPrefix: string;
  maxInputCharsPerWord: number;
}

const DEFAULTS: WordPieceOptions = {
  lowercase: true,
  unkToken: "[UNK]",
  continuingSubwordPrefix: "##",
  maxInputCharsPerWord: 100,
};

/** Shape of the `tokenizer.json` fields this tokenizer reads. */
interface TokenizerJson {
  model?: {
    type?: string;
    unk_token?: string;
    continuing_subword_prefix?: string;
    max_input_chars_per_word?: number;
    vocab?: Record<string, number>;
  };
  normalizer?: { lowercase?: boolean };
}

export class WordPieceTokenizer {
  readonly #vocab: Map<string, number>;
  readonly #options: WordPieceOptions;
  readonly unkId: number;

  constructor(vocab: Map<string, number>, options: Partial<WordPieceOptions> = {}) {
    this.#vocab = vocab;
    this.#options = { ...DEFAULTS, ...options };
    this.unkId = vocab.get(this.#options.unkToken) ?? -1;
  }

  static fromJson(json: string): WordPieceTokenizer {
    const parsed = JSON.parse(json) as TokenizerJson;
    if (parsed.model?.type !== "WordPiece" || !parsed.model.vocab) {
      throw new Error("The tokenizer file is not a WordPiece tokenizer.");
    }
    return new WordPieceTokenizer(new Map(Object.entries(parsed.model.vocab)), {
      lowercase: parsed.normalizer?.lowercase !== false,
      unkToken: parsed.model.unk_token ?? DEFAULTS.unkToken,
      continuingSubwordPrefix:
        parsed.model.continuing_subword_prefix ?? DEFAULTS.continuingSubwordPrefix,
      maxInputCharsPerWord: parsed.model.max_input_chars_per_word ?? DEFAULTS.maxInputCharsPerWord,
    });
  }

  get vocabSize(): number {
    return this.#vocab.size;
  }

  /** Token ids without special tokens; unknown pieces are dropped (as model2vec does). */
  encode(text: string): number[] {
    const ids: number[] = [];
    for (const word of pretokenize(normalize(text, this.#options.lowercase))) {
      for (const id of this.#wordPiece(word)) {
        if (id !== this.unkId) ids.push(id);
      }
    }
    return ids;
  }

  #wordPiece(word: string): number[] {
    const chars = [...word];
    if (chars.length > this.#options.maxInputCharsPerWord) return [this.unkId];
    const ids: number[] = [];
    let start = 0;
    while (start < chars.length) {
      let end = chars.length;
      let found: number | undefined;
      while (start < end) {
        const piece =
          (start > 0 ? this.#options.continuingSubwordPrefix : "") +
          chars.slice(start, end).join("");
        const id = this.#vocab.get(piece);
        if (id !== undefined) {
          found = id;
          break;
        }
        end -= 1;
      }
      if (found === undefined) return [this.unkId];
      ids.push(found);
      start = end;
    }
    return ids;
  }
}

/** BertNormalizer: drop control characters, space out CJK, lowercase and strip accents. */
export function normalize(text: string, lowercase: boolean): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0 || code === 0xfffd || (isControl(char) && !/\s/.test(char))) continue;
    if (/\s/.test(char)) {
      out += " ";
      continue;
    }
    out += isCjk(code) ? ` ${char} ` : char;
  }
  if (lowercase) {
    out = out
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Mn}/gu, "");
  }
  return out;
}

/** BertPreTokenizer: whitespace splits words, every punctuation character is its own token. */
export function pretokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of text) {
    if (char === " ") {
      if (current) tokens.push(current);
      current = "";
    } else if (isPunctuation(char)) {
      if (current) tokens.push(current);
      current = "";
      tokens.push(char);
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function isControl(char: string): boolean {
  return /\p{Cc}|\p{Cf}/u.test(char);
}

function isPunctuation(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  ) {
    return true;
  }
  return /\p{P}/u.test(char);
}

function isCjk(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df) ||
    (code >= 0x2a700 && code <= 0x2b73f) ||
    (code >= 0x2b740 && code <= 0x2b81f) ||
    (code >= 0x2b820 && code <= 0x2ceaf) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x2f800 && code <= 0x2fa1f)
  );
}
