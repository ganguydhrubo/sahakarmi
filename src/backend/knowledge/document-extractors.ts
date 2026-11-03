import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { KnowledgeSourceKind } from "../../shared/ipc";
import { decodeXml, readZip, stripTags } from "../attachment-text";
import type { DocumentUnit } from "./chunker";

/**
 * Reads a file into units that keep their place in the document: PDF pages, PowerPoint slides,
 * spreadsheet sheets, or the whole text with its headings. Nothing here needs a library beyond
 * the pdf-parse the app already ships; Office files are ZIPs of XML.
 */

export interface ExtractedDocument {
  kind: KnowledgeSourceKind;
  units: DocumentUnit[];
  /** Pages, slides or sheets, for the source list. */
  pages: number | null;
}

const KINDS: Record<string, KnowledgeSourceKind> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".csv": "csv",
  ".tsv": "csv",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".log": "text",
  ".json": "json",
  ".html": "html",
  ".htm": "html",
};

/** More than this and a file is an archive, not a document someone wants answers from. */
export const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
/** Rows per spreadsheet chunk; the header row is repeated on each. */
const SHEET_ROWS_PER_UNIT = 40;

export function knowledgeKindFor(path: string): KnowledgeSourceKind | null {
  return KINDS[extname(path).toLowerCase()] ?? null;
}

export function isKnowledgeFile(path: string): boolean {
  return knowledgeKindFor(path) !== null;
}

export async function extractDocument(path: string, buffer?: Buffer): Promise<ExtractedDocument> {
  const kind = knowledgeKindFor(path);
  if (!kind) throw new Error(`Unsupported file type: ${extname(path) || path}`);
  const data = buffer ?? (await readFile(path));
  if (data.length > MAX_SOURCE_BYTES) {
    throw new Error(`The file is larger than ${Math.round(MAX_SOURCE_BYTES / 1024 / 1024)} MB.`);
  }
  switch (kind) {
    case "pdf":
      return pdfUnits(data);
    case "docx":
      return { kind, units: [{ text: docxMarkdown(data) }], pages: null };
    case "pptx":
      return pptxUnits(data);
    case "xlsx":
      return xlsxUnits(data);
    case "csv":
      return csvUnits(data.toString("utf8"), extname(path).toLowerCase() === ".tsv" ? "\t" : ",");
    case "json":
      return { kind, units: [{ text: jsonText(data.toString("utf8")) }], pages: null };
    case "html":
      return { kind, units: [{ text: htmlMarkdown(data.toString("utf8")) }], pages: null };
    default:
      return { kind, units: [{ text: stripBom(data.toString("utf8")) }], pages: null };
  }
}

// ---------------------------------------------------------------------------------------------
// PDF: one unit per page (pdf-parse → pdf.js)

async function pdfUnits(buffer: Buffer): Promise<ExtractedDocument> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages = result.pages ?? [];
    const units: DocumentUnit[] = pages
      .map((page) => ({ page: page.num, text: dehyphenate(page.text ?? "") }))
      .filter((unit) => unit.text.trim());
    return {
      kind: "pdf",
      units: units.length ? units : [{ text: dehyphenate(result.text ?? "") }],
      pages: pages.length || null,
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** Words broken at a line end ("regis-\ntration") are joined again. */
function dehyphenate(text: string): string {
  return text.replace(/(\p{L})-\n(\p{L})/gu, "$1$2");
}

// ---------------------------------------------------------------------------------------------
// Word: headings become Markdown headings, table rows become "a | b | c" lines

export function docxMarkdown(buffer: Buffer): string {
  const entries = readZip(buffer);
  const document = entries.get("word/document.xml")?.toString("utf8");
  if (!document) return "";
  const lines: string[] = [];
  // Tables first: each row becomes one line so a value stays next to its column neighbours.
  const withRows = document.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (table) => {
    const rows: string[] = [];
    for (const row of table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
      const cells = [...row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((cell) =>
        paragraphsOf(cell[0], "w:p")
          .map((paragraph) => paragraph.text)
          .join(" ")
          .trim(),
      );
      if (cells.some(Boolean)) rows.push(`| ${cells.join(" | ")} |`);
    }
    return rows.length ? `<w:p><w:t>${escapeXml(rows.join("\n"))}</w:t></w:p>` : "";
  });
  for (const paragraph of paragraphsOf(withRows, "w:p")) {
    const level = headingLevel(paragraph.xml);
    if (level) lines.push(`${"#".repeat(level)} ${paragraph.text}`, "");
    else lines.push(paragraph.text, "");
  }
  return lines.join("\n").trim();
}

function headingLevel(paragraphXml: string): number {
  const style = /<w:pStyle\b[^>]*w:val="([^"]+)"/.exec(paragraphXml)?.[1] ?? "";
  const match = /^(?:Heading|heading|Title)(\d)?$/.exec(style);
  if (!match) return 0;
  const level = Number(match[1] ?? "1");
  return Math.min(Math.max(level, 1), 4);
}

interface XmlParagraph {
  xml: string;
  text: string;
}

function paragraphsOf(xml: string, tag: string): XmlParagraph[] {
  const result: XmlParagraph[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  for (const match of xml.matchAll(pattern)) {
    const inner = (match[1] ?? "").replace(/<(w|a):tab\/>/g, "\t").replace(/<(w|a):br\/>/g, "\n");
    const text = decodeXml(stripTags(inner)).trim();
    if (text) result.push({ xml: match[0], text });
  }
  return result;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------------------------
// PowerPoint: one unit per slide, speaker notes included

function pptxUnits(buffer: Buffer): ExtractedDocument {
  const entries = readZip(buffer);
  const slides = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const units: DocumentUnit[] = [];
  for (const name of slides) {
    const number = slideNumber(name);
    const body = paragraphsOf(entries.get(name)?.toString("utf8") ?? "", "a:p")
      .map((paragraph) => paragraph.text)
      .join("\n");
    const notesXml = entries.get(`ppt/notesSlides/notesSlide${number}.xml`)?.toString("utf8");
    const notes = notesXml
      ? paragraphsOf(notesXml, "a:p")
          .map((paragraph) => paragraph.text)
          .filter((text) => !/^\d+$/.test(text))
          .join("\n")
      : "";
    const text = notes ? `${body}\n\nNotes: ${notes}` : body;
    if (text.trim()) units.push({ slide: number, text });
  }
  return { kind: "pptx", units, pages: slides.length || null };
}

function slideNumber(name: string): number {
  return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

// ---------------------------------------------------------------------------------------------
// Excel: one unit per sheet (long sheets in row windows), rows as "a | b | c"

function xlsxUnits(buffer: Buffer): ExtractedDocument {
  const entries = readZip(buffer);
  const shared = sharedStrings(entries.get("xl/sharedStrings.xml")?.toString("utf8") ?? "");
  const names = sheetNames(entries);
  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const units: DocumentUnit[] = [];
  for (const file of sheets) {
    const title = names.get(file) ?? `Sheet ${slideNumber(file)}`;
    const rows = sheetRows(entries.get(file)?.toString("utf8") ?? "", shared);
    if (rows.length === 0) continue;
    const header = rows[0] ?? "";
    for (let from = 0; from < rows.length; from += SHEET_ROWS_PER_UNIT) {
      const window = rows.slice(from, from + SHEET_ROWS_PER_UNIT);
      units.push({
        sheet: title,
        headerLine: from === 0 ? undefined : header,
        text: window.join("\n"),
      });
    }
  }
  return { kind: "xlsx", units, pages: sheets.length || null };
}

function sharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    strings.push(decodeXml(stripTags(match[1] ?? "")));
  }
  return strings;
}

/** Sheet file → the name the owner sees, through workbook.xml and its relationships. */
function sheetNames(entries: Map<string, Buffer>): Map<string, string> {
  const result = new Map<string, string>();
  const workbook = entries.get("xl/workbook.xml")?.toString("utf8") ?? "";
  const rels = entries.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targets = new Map<string, string>();
  for (const rel of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(rel[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  for (const sheet of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(sheet[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(sheet[0])?.[1];
    const target = rid ? targets.get(rid) : undefined;
    if (name && target) result.set(target, decodeXml(name));
  }
  return result;
}

function sheetRows(xml: string, shared: string[]): string[] {
  const rows: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cell[1] ?? "";
      const inner = cell[2] ?? "";
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1];
      let value = "";
      if (type === "s") {
        const index = Number(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? "-1");
        value = shared[index] ?? "";
      } else if (type === "inlineStr") {
        value = decodeXml(stripTags(inner));
      } else {
        value = decodeXml(/<v>([^<]*)<\/v>/.exec(inner)?.[1] ?? "");
      }
      cells.push(value.trim());
    }
    if (cells.some(Boolean)) rows.push(cells.join(" | "));
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// CSV / TSV

function csvUnits(text: string, delimiter: string): ExtractedDocument {
  const rows = parseDelimited(stripBom(text), delimiter)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => row.map((cell) => cell.trim()).join(" | "));
  const units: DocumentUnit[] = [];
  const header = rows[0] ?? "";
  for (let from = 0; from < rows.length; from += SHEET_ROWS_PER_UNIT) {
    units.push({
      headerLine: from === 0 ? undefined : header,
      text: rows.slice(from, from + SHEET_ROWS_PER_UNIT).join("\n"),
    });
  }
  return { kind: "csv", units, pages: null };
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------
// JSON, HTML, text

function jsonText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(stripBom(text)), null, 1);
  } catch {
    return stripBom(text);
  }
}

/** Headings, paragraphs, list items and table rows of a page, without scripts and styles. */
export function htmlMarkdown(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
      return `\n\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n\n`;
    })
    .replace(/<\/(tr)>/gi, " |\n")
    .replace(/<(td|th)\b[^>]*>/gi, "| ")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|table|blockquote|pre|header|footer|main)>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  return decodeXml(body.replace(/&nbsp;/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
