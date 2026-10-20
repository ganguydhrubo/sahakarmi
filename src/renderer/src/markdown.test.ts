import { describe, expect, it } from "vitest";
import { markdownToPlainText, parseMarkdown, tableToTsv } from "./markdown";

describe("parseMarkdown", () => {
  it("parses headings, paragraphs, rules and quotes", () => {
    expect(
      parseMarkdown("## आज का सार\nपहली पंक्ति\nदूसरी पंक्ति\n\n---\n> নোট: GST জমা\n> দ্বিতীয় লাইন"),
    ).toEqual([
      { type: "heading", level: 2, text: "आज का सार" },
      { type: "paragraph", text: "पहली पंक्ति\nदूसरी पंक्ति" },
      { type: "rule" },
      { type: "quote", blocks: [{ type: "paragraph", text: "নোট: GST জমা\nদ্বিতীয় লাইন" }] },
    ]);
  });

  it("parses nested ordered and unordered lists with checklists", () => {
    const [block] = parseMarkdown(
      "1. Collect invoices\n   - Sharma Traders\n   - [x] Gupta & Sons\n2. **Reconcile** GSTR-2B\n3. [ ] File GSTR-3B",
    );
    expect(block).toEqual({
      type: "list",
      list: {
        ordered: true,
        start: 1,
        items: [
          {
            text: "Collect invoices",
            checked: null,
            children: [
              {
                ordered: false,
                start: 1,
                items: [
                  { text: "Sharma Traders", checked: null, children: [] },
                  { text: "Gupta & Sons", checked: true, children: [] },
                ],
              },
            ],
          },
          { text: "**Reconcile** GSTR-2B", checked: null, children: [] },
          { text: "File GSTR-3B", checked: false, children: [] },
        ],
      },
    });
  });

  it("keeps ordered lists that start later and lists separated by blank lines", () => {
    const [block] = parseMarkdown("4. Four\n\n5. Five");
    expect(block?.type === "list" && block.list).toMatchObject({ start: 4, items: [{}, {}] });
  });

  it("parses tables with alignment and escaped pipes", () => {
    const [block] = parseMarkdown(
      "| Vendor | Amount (₹) | Status |\n|:--|--:|:-:|\n| Sharma \\| Sons | 18,500 | Due |\n| Gupta | 4,200 |",
    );
    expect(block).toEqual({
      type: "table",
      header: ["Vendor", "Amount (₹)", "Status"],
      align: ["left", "right", "center"],
      rows: [
        ["Sharma | Sons", "18,500", "Due"],
        ["Gupta", "4,200", ""],
      ],
    });
  });

  it("renders an unclosed fence as code while streaming, then closes it", () => {
    expect(parseMarkdown("Run:\n```bash\nnpm test")).toEqual([
      { type: "paragraph", text: "Run:" },
      { type: "code", language: "bash", code: "npm test", closed: false },
    ]);
    expect(parseMarkdown("```\n| not | a table |\n- not a list\n```\nafter")).toEqual([
      { type: "code", language: "", code: "| not | a table |\n- not a list", closed: true },
      { type: "paragraph", text: "after" },
    ]);
  });

  it("does not treat a hyphenated sentence or a lone pipe as structure", () => {
    expect(parseMarkdown("Price - ₹500 | negotiable")).toEqual([
      { type: "paragraph", text: "Price - ₹500 | negotiable" },
    ]);
  });
});

describe("copy formats", () => {
  it("copies tables as TSV and messages as readable plain text", () => {
    expect(tableToTsv(["A", "B"], [["**x**", "y\tz"]])).toBe("A\tB\nx\ty z");
    expect(markdownToPlainText("# Plan\n1. [x] **Done**\n2. Next\n   - sub")).toBe(
      "Plan\n\n1. ☑ Done\n2. Next\n  • sub",
    );
  });
});
