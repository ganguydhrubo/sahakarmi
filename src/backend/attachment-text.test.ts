import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  attachmentPromptBlocks,
  deliverableFiles,
  docxText,
  extractAttachmentText,
  isUnderRoots,
  localAttachmentId,
  localAttachmentPath,
  localAttachmentSummary,
  pptxText,
  xlsxText,
} from "./attachment-text";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "sahkarmi-attachments-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

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

describe("attachment text", () => {
  it("reads Word, PowerPoint and Excel files without a library", () => {
    const docx = zip({
      "word/document.xml":
        "<w:document><w:body><w:p><w:r><w:t>Invoice INV-482</w:t></w:r></w:p><w:p><w:r><w:t>Total &amp; GST: </w:t></w:r><w:r><w:t>₹18,500</w:t></w:r></w:p></w:body></w:document>",
    });
    expect(docxText(docx)).toBe("Invoice INV-482\nTotal & GST: ₹18,500");

    const pptx = zip({
      "ppt/slides/slide2.xml": "<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>",
      "ppt/slides/slide1.xml": "<p:sld><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:sld>",
    });
    expect(pptxText(pptx)).toBe("--- Slide 1 ---\nFirst slide\n\n--- Slide 2 ---\nSecond");

    const xlsx = zip({
      "xl/sharedStrings.xml": "<sst><si><t>Fruit</t></si><si><t>Mango</t></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>120</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="inlineStr"><is><t>₹180</t></is></c></row></sheetData></worksheet>',
    });
    expect(xlsxText(xlsx)).toBe("--- Sheet 1 ---\nFruit\t120\nMango\t₹180");
  });

  it("extracts text files, caps long content and skips images", async () => {
    const csv = join(tmp, "leads.csv");
    await writeFile(csv, "name,city\nSharma,Pune\n");
    expect(await extractAttachmentText(csv)).toBe("name,city\nSharma,Pune");
    const long = join(tmp, "long.txt");
    await writeFile(long, "x".repeat(200));
    expect(await extractAttachmentText(long, "long.txt", 50)).toContain("150 more characters");
    const png = join(tmp, "photo.png");
    await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await extractAttachmentText(png)).toBeNull();
    const docx = join(tmp, "note.docx");
    await writeFile(docx, zip({ "word/document.xml": "<w:p><w:t>Hello</w:t></w:p>" }));
    const block = await attachmentPromptBlocks([
      { name: "note.docx", path: docx, kind: "file" },
      { name: "photo.png", path: png, kind: "image" },
    ]);
    expect(block).toContain('<attachment name="note.docx">\nHello\n</attachment>');
    expect(block).not.toContain("photo.png");
  });

  it("lists files a coworker wrote during the turn, newest first, inside the roots only", async () => {
    const old = join(tmp, "old.png");
    await writeFile(old, "old");
    await utimes(old, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
    const since = Date.now() - 1_000;
    const fresh = join(tmp, "report.pdf");
    await writeFile(fresh, "%PDF");
    const nested = join(tmp, "out", "chart.png");
    await writeFile(join(tmp, "notes.exe"), "x").catch(() => undefined);
    await rm(join(tmp, "out"), { recursive: true, force: true });
    await writeFile(join(tmp, "a.png"), "img");
    expect(deliverableFiles({ roots: [tmp], since }).map((p) => p.split(/[\\/]/).at(-1))).toEqual(
      expect.arrayContaining(["report.pdf", "a.png"]),
    );
    expect(deliverableFiles({ roots: [tmp], since })).not.toContain(old);
    expect(deliverableFiles({ roots: [tmp], since })).not.toContain(nested);

    const id = localAttachmentId(fresh);
    expect(localAttachmentPath(id)).toBe(fresh);
    expect(localAttachmentSummary(fresh)).toMatchObject({
      id,
      name: "report.pdf",
      kind: "file",
      previewKind: "pdf",
      previewUrl: `sahkarmi-attachment://local/${id.slice("local:".length)}`,
    });
    expect(isUnderRoots(fresh, [tmp])).toBe(true);
    expect(isUnderRoots(join(tmp, "..", "elsewhere.png"), [tmp])).toBe(false);
  });
});
