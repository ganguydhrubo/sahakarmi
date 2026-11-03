import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  docxMarkdown,
  extractDocument,
  htmlMarkdown,
  isKnowledgeFile,
  knowledgeKindFor,
  parseDelimited,
} from "./document-extractors";

/** A real ZIP (deflated entries, central directory) the way Office writes it. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const payload = deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, payload);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + payload.length;
  }
  const size = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** A minimal two-page PDF with Helvetica text, with a correct xref table. */
function pdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((text, index) => {
    const content = `BT /F1 12 Tf 50 700 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${run(text)}</w:p>`;

describe("document extractors", () => {
  it("knows the supported file kinds", () => {
    expect(knowledgeKindFor("C:/docs/GST.PDF")).toBe("pdf");
    expect(knowledgeKindFor("notes.markdown")).toBe("markdown");
    expect(knowledgeKindFor("data.tsv")).toBe("csv");
    expect(knowledgeKindFor("photo.png")).toBeNull();
    expect(isKnowledgeFile("a.docx")).toBe(true);
    expect(isKnowledgeFile("a.exe")).toBe(false);
  });

  it("reads a PDF page by page", async () => {
    const result = await extractDocument(
      "rules.pdf",
      pdf(["Registration threshold is forty lakh.", "Returns are filed monthly."]),
    );
    expect(result.kind).toBe("pdf");
    expect(result.pages).toBe(2);
    expect(result.units.map((unit) => unit.page)).toEqual([1, 2]);
    expect(result.units[0]?.text).toContain("forty lakh");
    expect(result.units[1]?.text).toContain("filed monthly");
  });

  it("turns Word headings into Markdown headings and tables into rows", () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${para("Leave policy", "Heading1")}${para("Everyone gets 24 days.")}<w:tbl><w:tr><w:tc>${para("Type")}</w:tc><w:tc>${para("Days")}</w:tc></w:tr><w:tr><w:tc>${para("Casual")}</w:tc><w:tc>${para("12")}</w:tc></w:tr></w:tbl></w:body></w:document>`;
    const markdown = docxMarkdown(zip({ "word/document.xml": xml }));
    expect(markdown).toContain("# Leave policy");
    expect(markdown).toContain("Everyone gets 24 days.");
    expect(markdown).toMatch(/\|\s*Casual\s*\|\s*12\s*\|/);
  });

  it("reads PowerPoint slides with their notes", async () => {
    const slide = (text: string) =>
      `<p:sld xmlns:a="a"><p:cSld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:cSld></p:sld>`;
    const buffer = zip({
      "ppt/slides/slide2.xml": slide("Second slide: pricing"),
      "ppt/slides/slide1.xml": slide("Welcome"),
      "ppt/notesSlides/notesSlide2.xml": slide("Mention the discount"),
    });
    const result = await extractDocument("deck.pptx", buffer);
    expect(result.units.map((unit) => unit.slide)).toEqual([1, 2]);
    expect(result.units[1]?.text).toContain("pricing");
    expect(result.units[1]?.text).toContain("Notes: Mention the discount");
    expect(result.pages).toBe(2);
  });

  it("reads Excel sheets by name with shared strings and inline values", async () => {
    const buffer = zip({
      "xl/workbook.xml": `<workbook><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>Item</t></si><si><t>Price</t></si><si><t>Tea</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row r="2"><c t="s"><v>2</v></c><c><v>250</v></c></row></sheetData></worksheet>`,
    });
    const result = await extractDocument("prices.xlsx", buffer);
    expect(result.units).toHaveLength(1);
    expect(result.units[0]?.sheet).toBe("Prices");
    expect(result.units[0]?.text).toBe("Item | Price\nTea | 250");
  });

  it("parses CSV with quotes and reads Markdown, JSON and HTML as text", async () => {
    expect(parseDelimited('a,"b, c",d\n1,2,3', ",")).toEqual([
      ["a", "b, c", "d"],
      ["1", "2", "3"],
    ]);
    const csv = await extractDocument("list.csv", Buffer.from("name,qty\nTea,2\nCoffee,5"));
    expect(csv.units[0]?.text).toContain("Tea | 2");

    const markdown = await extractDocument("notes.md", Buffer.from("\uFEFF# Title\n\nBody"));
    expect(markdown.units[0]?.text).toBe("# Title\n\nBody");

    const json = await extractDocument("data.json", Buffer.from('{"a":{"b":1}}'));
    expect(json.units[0]?.text).toContain('"b": 1');

    expect(htmlMarkdown("<h2>Hours</h2><p>Open <b>9 to 5</b></p><script>x()</script>")).toContain(
      "## Hours",
    );
    expect(htmlMarkdown("<p>a</p><script>evil()</script>")).not.toContain("evil");
  });
});
