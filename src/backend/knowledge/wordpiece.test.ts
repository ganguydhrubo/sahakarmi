import { describe, expect, it } from "vitest";
import { normalize, pretokenize, WordPieceTokenizer } from "./wordpiece";

const VOCAB = {
  "[UNK]": 0,
  "[PAD]": 1,
  hello: 2,
  world: 3,
  "##s": 4,
  tea: 5,
  price: 6,
  ",": 7,
  un: 8,
  "##afford": 9,
  "##able": 10,
  "##ly": 11,
};

function tokenizer(): WordPieceTokenizer {
  return WordPieceTokenizer.fromJson(
    JSON.stringify({
      normalizer: { type: "BertNormalizer", lowercase: true },
      model: {
        type: "WordPiece",
        unk_token: "[UNK]",
        continuing_subword_prefix: "##",
        max_input_chars_per_word: 100,
        vocab: VOCAB,
      },
    }),
  );
}

describe("WordPieceTokenizer", () => {
  it("lowercases, strips accents, splits punctuation and greedily matches subwords", () => {
    const wp = tokenizer();
    expect(wp.vocabSize).toBe(Object.keys(VOCAB).length);
    expect(wp.encode("Hello, Wörlds")).toEqual([2, 7, 3, 4]);
    expect(wp.encode("unaffordable")).toEqual([8, 9, 10]);
    expect(wp.encode("unaffordably")).toEqual([]);
    expect(wp.encode("tea price")).toEqual([5, 6]);
  });

  it("drops unknown words and special tokens instead of returning [UNK]", () => {
    const wp = tokenizer();
    expect(wp.encode("zzz tea")).toEqual([5]);
    expect(wp.encode("[PAD] [UNK]")).toEqual([]);
    expect(wp.encode("")).toEqual([]);
    expect(wp.encode("   \n\t ")).toEqual([]);
    // A piece inside a word that cannot be matched makes the whole word unknown.
    expect(wp.encode("helloq")).toEqual([]);
  });

  it("normalizes like BertNormalizer and pre-tokenizes like BertPreTokenizer", () => {
    expect(normalize("Café\u0000 中文", true)).toBe("cafe  中  文 ");
    expect(normalize("Keep CASE", false)).toBe("Keep CASE");
    expect(pretokenize("hello, world! (tea)")).toEqual([
      "hello",
      ",",
      "world",
      "!",
      "(",
      "tea",
      ")",
    ]);
    expect(pretokenize("छुट्टी के नियम")).toEqual(["छुट्टी", "के", "नियम"]);
  });

  it("rejects tokenizer files of another kind", () => {
    expect(() => WordPieceTokenizer.fromJson(JSON.stringify({ model: { type: "BPE" } }))).toThrow(
      /not a WordPiece/,
    );
  });
});
