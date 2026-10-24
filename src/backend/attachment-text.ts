import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { AttachmentSummary } from "../shared/ipc";

/**
 * What a coworker gets from an attached file, and what the owner gets back from a coworker's
 * files. Text is pulled out of PDF, Word, PowerPoint, Excel and plain-text attachments here, so
 * every provider (including free text-only models that cannot open a PDF) reads the content.
 * Files a coworker writes during a turn become attachments of its reply (images show inline).
 */

export const MAX_ATTACHMENT_TEXT_CHARS = 60_000;
const MAX_FILE_BYTES = 40 * 1024 * 1024;

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|log|xml|ya?ml|html?|tsx?|jsx?|css|py|sql|ini|toml)$/i;

/** Plain text of an attachment, or null when the type carries none (images, binaries). */
export async function extractAttachmentText(
  path: string,
  name = basename(path),
  limit = MAX_ATTACHMENT_TEXT_CHARS,
): Promise<string | null> {
  const extension = extname(name).toLowerCase();
  if (statSync(path).size > MAX_FILE_BYTES) return null;
  let text: string | null = null;
  if (extension === ".pdf") text = await pdfText(readFileSync(path));
  else if (extension === ".docx") text = docxText(readFileSync(path));
  else if (extension === ".pptx") text = pptxText(readFileSync(path));
  else if (extension === ".xlsx") text = xlsxText(readFileSync(path));
  else if (TEXT_EXTENSIONS.test(name)) text = readFileSync(path, "utf8");
  if (text === null) return null;
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return clean.length > limit
    ? `${clean.slice(0, limit)}\n\n[… ${clean.length - limit} more characters not shown]`
    : clean;
}

/** The block appended to a coworker's prompt for every attachment with readable content. */
export async function attachmentPromptBlocks(
  attachments: Array<{ name: string; path: string; kind: string }>,
  perFileLimit = MAX_ATTACHMENT_TEXT_CHARS,
): Promise<string> {
  const blocks: string[] = [];
  for (const attachment of attachments) {
    if (attachment.kind === "image") continue;
    try {
      const text = await extractAttachmentText(attachment.path, attachment.name, perFileLimit);
      if (text === null) continue;
      blocks.push(
        `<attachment name="${attachment.name.replace(/"/g, "'")}">\n${text || "(the file has no readable text)"}\n</attachment>`,
      );
    } catch (error) {
      blocks.push(
        `<attachment name="${attachment.name.replace(/"/g, "'")}">\n(could not read: ${error instanceof Error ? error.message : String(error)})\n</attachment>`,
      );
    }
  }
  return blocks.length
    ? `\n\nContent of the attached files (extracted by Sahkarmi; the originals are at the paths above):\n${blocks.join("\n")}`
    : "";
}

// ---------------------------------------------------------------------------------------------
// PDF (pdf-parse → pdf.js)

async function pdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Office Open XML (docx / pptx / xlsx are ZIPs of XML; no library needed)

export function docxText(buffer: Buffer): string {
  const entries = readZip(buffer);
  const document = entries.get("word/document.xml");
  if (!document) return "";
  return xmlParagraphs(document.toString("utf8"), "w:p");
}

export function pptxText(buffer: Buffer): string {
  const entries = readZip(buffer);
  const slides = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  return slides
    .map(
      (name, index) =>
        `--- Slide ${index + 1} ---\n${xmlParagraphs(entries.get(name)?.toString("utf8") ?? "", "a:p")}`,
    )
    .join("\n\n");
}

export function xlsxText(buffer: Buffer): string {
  const entries = readZip(buffer);
  const shared: string[] = [];
  const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
  if (sharedXml) {
    for (const match of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(decodeXml(stripTags(match[1] ?? "")));
    }
  }
  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  return sheets
    .map((name, index) => {
      const xml = entries.get(name)?.toString("utf8") ?? "";
      const rows: string[] = [];
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const cell of (row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
          const attributes = cell[1] ?? "";
          const inner = cell[2] ?? "";
          const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
          const inline = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
          if (/t="s"/.test(attributes)) cells.push(shared[Number(value)] ?? "");
          else if (inline !== undefined) cells.push(decodeXml(inline));
          else cells.push(decodeXml(value));
        }
        if (cells.some((cell) => cell !== "")) rows.push(cells.join("\t"));
      }
      return `--- Sheet ${index + 1} ---\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

function xmlParagraphs(xml: string, paragraphTag: string): string {
  const paragraphs: string[] = [];
  const pattern = new RegExp(`<${paragraphTag}\\b[^>]*>([\\s\\S]*?)</${paragraphTag}>`, "g");
  for (const match of xml.matchAll(pattern)) {
    const text = decodeXml(stripTags((match[1] ?? "").replace(/<(w|a):tab\/>/g, "\t")));
    if (text.trim()) paragraphs.push(text);
  }
  return paragraphs.join("\n");
}

function stripTags(xml: string): string {
  return xml.replace(/<[^>]+>/g, "");
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Reads every entry of a ZIP in memory (stored or deflated), keyed by its path. */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const minimum = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no central directory).");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Damaged ZIP entry.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    if (!name.endsWith("/")) {
      entries.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Files a coworker produced during a turn ("deliverables")

const DELIVERABLE_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|svg|pdf|docx?|pptx?|xlsx?|csv|md|txt|html?|json)$/i;
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".cache", "__pycache__", "dist", "out"]);

export interface DeliverableOptions {
  roots: string[];
  since: number;
  /** Folders never scanned (the mailbox's Transfers folder holds the owner's own uploads). */
  excludeRoots?: string[];
  maxDepth?: number;
  limit?: number;
}

/** New or changed files under the coworker's folders since the turn began, newest first. */
export function deliverableFiles(options: DeliverableOptions): string[] {
  const found: Array<{ path: string; mtime: number }> = [];
  const excluded = options.excludeRoots ?? [];
  const visit = (directory: string, depth: number) => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (excluded.some((root) => resolve(root) === resolve(path))) continue;
        if (!SKIP_DIRECTORIES.has(entry.name) && depth < (options.maxDepth ?? 3)) {
          visit(path, depth + 1);
        }
        continue;
      }
      if (!entry.isFile() || !DELIVERABLE_EXTENSIONS.test(entry.name)) continue;
      try {
        const stats = statSync(path);
        if (stats.mtimeMs >= options.since && stats.size > 0) {
          found.push({ path, mtime: stats.mtimeMs });
        }
      } catch {
        // unreadable: skip
      }
    }
  };
  for (const root of options.roots) visit(root, 0);
  return found
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, options.limit ?? 12)
    .map((entry) => entry.path);
}

/** Attachment ids for files on disk carry the path itself, so no registry is needed. */
export function localAttachmentId(path: string): string {
  return `local:${Buffer.from(resolve(path), "utf8").toString("base64url")}`;
}

export function localAttachmentPath(id: string): string | null {
  if (!id.startsWith("local:")) return null;
  try {
    return Buffer.from(id.slice("local:".length), "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function localAttachmentPreviewUrl(path: string): string {
  return `sahkarmi-attachment://local/${localAttachmentId(path).slice("local:".length)}`;
}

/** True when the path is inside one of the allowed roots (no ".." escapes). */
export function isUnderRoots(path: string, roots: string[]): boolean {
  const target = resolve(path);
  return roots.some((root) => {
    const rel = relative(resolve(root), target);
    return rel !== "" && !rel.startsWith("..") && !/^[a-zA-Z]:/.test(rel);
  });
}

export function mimeTypeFor(name: string): string {
  const extension = extname(name).toLowerCase();
  const table: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".csv": "text/csv",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
  };
  return table[extension] ?? "application/octet-stream";
}

export function localAttachmentSummary(path: string): AttachmentSummary {
  const name = basename(path);
  const mimeType = mimeTypeFor(name);
  const size = (() => {
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  })();
  const previewKind = mimeType.startsWith("image/")
    ? "image"
    : mimeType === "application/pdf"
      ? "pdf"
      : mimeType.startsWith("text/") || mimeType === "application/json"
        ? "text"
        : "none";
  return {
    id: localAttachmentId(path),
    name,
    size,
    kind: previewKind === "image" ? "image" : "file",
    mimeType,
    previewKind,
    previewUrl: localAttachmentPreviewUrl(path),
  };
}

/** A stable short hash for a path (used in tests and logs). */
export function pathDigest(path: string): string {
  return createHash("sha1").update(resolve(path)).digest("hex").slice(0, 12);
}
