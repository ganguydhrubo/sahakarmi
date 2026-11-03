import { describe, expect, it } from "vitest";
import { chunkDocument, normalizeText } from "./chunker";

describe("chunkDocument", () => {
  it("packs paragraphs up to the limit and never crosses a page", () => {
    const paragraph = (n: number) => `Paragraph ${n}. ${"word ".repeat(60)}`.trim();
    const page1 = [paragraph(1), paragraph(2), paragraph(3), paragraph(4)].join("\n\n");
    const chunks = chunkDocument(
      [
        { page: 1, text: page1 },
        { page: 2, text: "Short second page." },
      ],
      { maxChars: 700, overlapChars: 0 },
    );
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(700);
    expect(chunks.at(-1)).toMatchObject({ page: 2, text: "Short second page." });
    expect(
      chunks.filter((chunk) => chunk.page === 1).every((c) => !c.text.includes("second")),
    ).toBe(true);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(chunks.map((_, index) => index));
  });

  it("keeps the heading a chunk sits under and overlaps neighbours", () => {
    const text = [
      "# Returns",
      `First sentence here. ${"Filler text. ".repeat(50)}`,
      "",
      "# Penalties",
      `Late fees apply. ${"More filler. ".repeat(50)}`,
    ].join("\n");
    const chunks = chunkDocument([{ text }], { maxChars: 400, overlapChars: 60 });
    expect(chunks[0]?.heading).toBe("Returns");
    const penalties = chunks.find((chunk) => chunk.text.includes("Late fees"));
    expect(penalties?.heading).toBe("Penalties");
    // A later chunk starts with the tail of the one before it.
    const second = chunks[1];
    const first = chunks[0];
    expect(second?.charStart).toBeLessThan(first?.charEnd ?? 0);
    expect(penalties?.text.startsWith("# Penalties")).toBe(true);
  });

  it("splits long single lines by sentence, including Hindi and Bengali danda", () => {
    const sentence = "यह एक वाक्य है जो नियमों के बारे में बताता है।";
    const text = Array.from({ length: 40 }, () => sentence).join(" ");
    const chunks = chunkDocument([{ text }], { maxChars: 300, overlapChars: 0 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(300);
      expect(chunk.text.trim().endsWith("।")).toBe(true);
    }
  });

  it("repeats a sheet's header line on every chunk and keeps the sheet name", () => {
    const rows = Array.from({ length: 30 }, (_, index) => `Item ${index} | ${index * 10} | pcs`);
    const chunks = chunkDocument(
      [{ sheet: "Prices", headerLine: "Item | Price | Unit", text: rows.join("\n") }],
      { maxChars: 200, overlapChars: 0 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.sheet).toBe("Prices");
      expect(chunk.text.startsWith("Item | Price | Unit\n")).toBe(true);
    }
  });

  it("normalizes line endings and drops empty units", () => {
    expect(normalizeText("a \r\nb\r\n\r\n\r\n\r\nc")).toBe("a\nb\n\nc");
    expect(chunkDocument([{ text: "   \n  " }, { text: "x" }])).toHaveLength(1);
  });
});
