import type { ChunkInput } from "./knowledge-db";

/**
 * Turns a document's units (pages, slides, sheets, or the whole text) into retrieval chunks of
 * about a paragraph each. A chunk never crosses a page, keeps the heading it sits under, and
 * overlaps its neighbour a little so a sentence cut at the edge is still found.
 */

export interface DocumentUnit {
  page?: number;
  slide?: number;
  sheet?: string;
  /** A table's header row, repeated at the top of every chunk of this unit. */
  headerLine?: string;
  text: string;
}

export interface ChunkOptions {
  maxChars: number;
  overlapChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { maxChars: 1_200, overlapChars: 160 };

/** Markdown headings; DOCX and HTML extractors emit the same shape. */
const HEADING = /^#{1,4}\s+(.+?)\s*#*\s*$/;
/** Sentence ends, with the Devanagari/Bengali danda and double danda. */
const SENTENCE_END = /(?<=[.!?।॥])\s+/u;

export function normalizeText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function chunkDocument(
  units: DocumentUnit[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): ChunkInput[] {
  const chunks: ChunkInput[] = [];
  let heading: string | null = null;
  for (const unit of units) {
    const text = normalizeText(unit.text);
    if (!text.trim()) continue;
    const header = unit.headerLine?.trim() ? `${unit.headerLine.trim()}\n` : "";
    for (const piece of splitUnit(text, options)) {
      const headingNow = headingOf(piece.text, heading);
      // A heading line found inside the piece applies from the piece on.
      heading = headingNow.after;
      const body = piece.text.trim();
      if (!body) continue;
      chunks.push({
        chunkIndex: chunks.length,
        page: unit.page ?? null,
        slide: unit.slide ?? null,
        sheet: unit.sheet ?? null,
        heading: headingNow.current,
        charStart: piece.start,
        charEnd: piece.end,
        text: header && !body.startsWith(header.trim()) ? `${header}${body}` : body,
      });
    }
  }
  return chunks;
}

interface Piece {
  text: string;
  start: number;
  end: number;
}

/** Paragraphs packed up to maxChars; long paragraphs split by sentence, then by length. */
function splitUnit(text: string, options: ChunkOptions): Piece[] {
  const blocks = paragraphBlocks(text);
  const pieces: Piece[] = [];
  let current: Piece | null = null;
  const flush = () => {
    if (current?.text.trim()) pieces.push(current);
    current = null;
  };
  for (const block of blocks) {
    // A heading starts a new chunk, so a citation's section is the one the text sits under.
    if (current && HEADING.test(block.text.split("\n")[0]?.trim() ?? "")) flush();
    if (block.end - block.start > options.maxChars) {
      flush();
      for (const part of splitLong(text, block, options)) pieces.push(part);
      continue;
    }
    if (!current) {
      current = { ...block };
      continue;
    }
    if (block.end - current.start <= options.maxChars) {
      current = {
        text: text.slice(current.start, block.end),
        start: current.start,
        end: block.end,
      };
    } else {
      flush();
      current = { ...block };
    }
  }
  flush();
  return addOverlap(text, pieces, options.overlapChars);
}

function paragraphBlocks(text: string): Piece[] {
  const blocks: Piece[] = [];
  const pattern = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    blocks.push({ text: match[0], start, end: start + match[0].length });
  }
  return blocks;
}

/** A single long paragraph (or table) cut at line ends, then sentence ends, then hard. */
function splitLong(text: string, block: Piece, options: ChunkOptions): Piece[] {
  const parts: Piece[] = [];
  let current: Piece | null = null;
  for (const segment of segmentsOf(block, options)) {
    if (segment.end - segment.start > options.maxChars) {
      if (current) parts.push(current);
      current = null;
      for (let from = segment.start; from < segment.end; from += options.maxChars) {
        const to = Math.min(segment.end, from + options.maxChars);
        parts.push({ text: text.slice(from, to), start: from, end: to });
      }
      continue;
    }
    if (!current) {
      current = { ...segment };
    } else if (segment.end - current.start <= options.maxChars) {
      current = {
        text: text.slice(current.start, segment.end),
        start: current.start,
        end: segment.end,
      };
    } else {
      parts.push(current);
      current = { ...segment };
    }
  }
  if (current) parts.push(current);
  if (parts.length === 0) parts.push({ ...block });
  return parts;
}

/** Lines of a block; a line longer than a chunk is cut into sentences. */
function segmentsOf(block: Piece, options: ChunkOptions): Piece[] {
  const segments: Piece[] = [];
  let offset = 0;
  for (const line of block.text.split("\n")) {
    const lineStart = block.start + offset;
    offset += line.length + 1;
    if (line.length <= options.maxChars) {
      segments.push({ text: line, start: lineStart, end: lineStart + line.length });
      continue;
    }
    let at = 0;
    for (const sentence of line.split(SENTENCE_END)) {
      const index = line.indexOf(sentence, at);
      const start = lineStart + (index === -1 ? at : index);
      at = (index === -1 ? at : index) + sentence.length;
      segments.push({ text: sentence, start, end: start + sentence.length });
    }
  }
  return segments;
}

/** Each piece after the first also carries the tail of the one before it. */
function addOverlap(text: string, pieces: Piece[], overlap: number): Piece[] {
  if (overlap <= 0) return pieces;
  return pieces.map((piece, index) => {
    if (index === 0) return piece;
    const previous = pieces[index - 1];
    if (!previous) return piece;
    // A section that starts with its heading needs nothing from the section before it.
    if (HEADING.test(piece.text.split("\n")[0]?.trim() ?? "")) return piece;
    const tailStart = Math.max(previous.start, previous.end - overlap);
    const tail = text.slice(tailStart, previous.end);
    const cut = tail.search(/(?<=[.!?।॥\n])\s*/u);
    const start = cut > 0 && cut < tail.length ? tailStart + cut : tailStart;
    const lead = text.slice(start, previous.end).trim();
    if (!lead || piece.start <= start) return piece;
    return { text: `${lead}\n${piece.text}`, start, end: piece.end };
  });
}

/** The heading a piece sits under: the last heading line before or in it. */
function headingOf(
  piece: string,
  inherited: string | null,
): { current: string | null; after: string | null } {
  let current = inherited;
  let first = true;
  let after = inherited;
  for (const line of piece.split("\n")) {
    const match = HEADING.exec(line.trim());
    if (!match) {
      first = false;
      continue;
    }
    const title = (match[1] ?? "").trim();
    if (first) current = title;
    after = title;
    first = false;
  }
  return { current, after };
}
