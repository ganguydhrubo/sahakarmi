// @vitest-environment node

import { describe, expect, it } from "vitest";
import { JsonLineDecoder } from "./jsonl";

describe("JsonLineDecoder", () => {
  it("decodes fragmented and coalesced JSONL messages", () => {
    const decoder = new JsonLineDecoder();

    expect(decoder.push('{"id":1,"res')).toEqual([]);
    expect(
      decoder.push('ult":{"ok":true}}\n{"method":"turn/started","params":{"id":"t1"}}\n'),
    ).toEqual([
      { id: 1, result: { ok: true } },
      { method: "turn/started", params: { id: "t1" } },
    ]);
  });

  it("preserves a split multibyte character", () => {
    const decoder = new JsonLineDecoder();
    const payload = Buffer.from('{"method":"message","params":{"text":"cześć"}}\n');
    const splitAt = payload.indexOf(Buffer.from("ś")) + 1;

    expect(decoder.push(payload.subarray(0, splitAt))).toEqual([]);
    expect(decoder.push(payload.subarray(splitAt))).toEqual([
      { method: "message", params: { text: "cześć" } },
    ]);
  });

  it("rejects malformed lines", () => {
    const decoder = new JsonLineDecoder();
    expect(() => decoder.push("not-json\n")).toThrow("Invalid JSONL");
  });

  it("skips and reports a non-JSON line when a callback is given", () => {
    const skipped: string[] = [];
    const decoder = new JsonLineDecoder((line) => skipped.push(line));
    expect(decoder.push('Starting up...\n{"id":2,"result":{}}\n[1,2]\n')).toEqual([
      { id: 2, result: {} },
    ]);
    expect(decoder.end("trailing junk")).toEqual([]);
    expect(skipped).toEqual(["Starting up...", "[1,2]", "trailing junk"]);
  });
});
