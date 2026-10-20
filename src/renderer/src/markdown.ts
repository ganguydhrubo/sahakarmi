/**
 * Small block-level Markdown parser for coworker replies. It produces plain data (never HTML),
 * so rendering stays XSS-safe, and it tolerates half-streamed input: an unclosed code fence
 * renders as code until the closing fence arrives.
 */

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "code"; language: string; code: string; closed: boolean }
  | { type: "list"; list: MarkdownList }
  | {
      type: "table";
      header: string[];
      align: Array<"left" | "center" | "right" | null>;
      rows: string[][];
    }
  | { type: "quote"; blocks: MarkdownBlock[] }
  | { type: "rule" };

export interface MarkdownList {
  ordered: boolean;
  start: number;
  items: MarkdownListItem[];
}

export interface MarkdownListItem {
  text: string;
  /** null: plain item; true/false: checklist item. */
  checked: boolean | null;
  children: MarkdownList[];
}

const FENCE = /^ {0,3}(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  return parseLines(lines);
}

function parseLines(lines: string[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  while (index < lines.length) {
    const line = lines[index] ?? "";

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1] ?? "```";
      const code: string[] = [];
      index += 1;
      let closed = false;
      while (index < lines.length) {
        const current = lines[index] ?? "";
        const closing = current.trim();
        if (
          /^(`{3,}|~{3,})$/.test(closing) &&
          closing[0] === marker[0] &&
          closing.length >= marker.length
        ) {
          closed = true;
          index += 1;
          break;
        }
        code.push(current);
        index += 1;
      }
      blocks.push({ type: "code", language: fence[2] ?? "", code: code.join("\n"), closed });
      continue;
    }

    if (!line.trim()) {
      flush();
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      flush();
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^\s{0,3}>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", blocks: parseLines(quoted) });
      continue;
    }

    if (
      line.includes("|") &&
      TABLE_SEPARATOR.test(lines[index + 1] ?? "") &&
      splitRow(line).length > 1
    ) {
      flush();
      const header = splitRow(line);
      const align = splitRow(lines[index + 1] ?? "").map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      index += 2;
      const rows: string[][] = [];
      while (
        index < lines.length &&
        (lines[index] ?? "").includes("|") &&
        (lines[index] ?? "").trim()
      ) {
        const cells = splitRow(lines[index] ?? "");
        rows.push(header.map((_, column) => cells[column] ?? ""));
        index += 1;
      }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item && (paragraph.length === 0 || (item[1] ?? "").length === 0)) {
      flush();
      const listLines: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? "";
        if (!current.trim()) {
          // A blank line ends the list unless the next line continues it.
          const next = lines[index + 1] ?? "";
          if (LIST_ITEM.test(next) || /^\s{2,}\S/.test(next)) {
            index += 1;
            continue;
          }
          break;
        }
        if (!LIST_ITEM.test(current) && !/^\s+\S/.test(current) && listLines.length) {
          // Lazy continuation of the previous item's text.
          if (FENCE.test(current) || HEADING.test(current) || /^\s{0,3}>/.test(current)) break;
          listLines.push(`  ${current}`);
          index += 1;
          continue;
        }
        listLines.push(current);
        index += 1;
      }
      blocks.push({ type: "list", list: parseList(listLines) });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flush();
  return blocks;
}

function parseList(lines: string[]): MarkdownList {
  const first = LIST_ITEM.exec(lines[0] ?? "");
  const baseIndent = indentWidth(first?.[1] ?? "");
  const marker = first?.[2] ?? "-";
  const ordered = /\d/.test(marker);
  const list: MarkdownList = {
    ordered,
    start: ordered ? Number.parseInt(marker, 10) || 1 : 1,
    items: [],
  };
  let current: { item: MarkdownListItem; childLines: string[] } | null = null;

  const finish = () => {
    if (!current) return;
    if (current.childLines.length) {
      const nested = current.childLines.filter((line) => LIST_ITEM.test(line));
      if (nested.length) {
        // Group consecutive sibling lists at the child level.
        current.item.children.push(parseList(current.childLines));
      } else {
        current.item.text += `\n${current.childLines.map((line) => line.trim()).join("\n")}`;
      }
    }
    list.items.push(current.item);
    current = null;
  };

  for (const line of lines) {
    const match = LIST_ITEM.exec(line);
    const indent = indentWidth(match?.[1] ?? line.match(/^\s*/)?.[0] ?? "");
    if (match && indent <= baseIndent + 1) {
      finish();
      let text = match[3] ?? "";
      let checked: boolean | null = null;
      const task = /^\[([ xX])\]\s+(.*)$/.exec(text);
      if (task) {
        checked = task[1] !== " ";
        text = task[2] ?? "";
      }
      current = { item: { text, checked, children: [] }, childLines: [] };
    } else if (current) {
      const target: { item: MarkdownListItem; childLines: string[] } = current;
      if (!match && target.childLines.length === 0) {
        target.item.text += `\n${line.trim()}`;
      } else {
        target.childLines.push(line);
      }
    }
  }
  finish();
  return list;
}

function indentWidth(whitespace: string): number {
  return whitespace.replace(/\t/g, "    ").length;
}

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

/** Tab-separated table text: pastes cleanly into Excel, Google Sheets and Tally imports. */
export function tableToTsv(header: string[], rows: string[][]): string {
  const clean = (cell: string) => stripInline(cell).replace(/[\t\n]/g, " ");
  return [header, ...rows].map((row) => row.map(clean).join("\t")).join("\n");
}

/** Plain text for "copy as text": drops Markdown markers but keeps structure and numbering. */
export function markdownToPlainText(source: string): string {
  return renderPlain(parseMarkdown(source)).trim();
}

function renderPlain(blocks: MarkdownBlock[], depth = 0): string {
  const pad = "  ".repeat(depth);
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
        case "paragraph":
          return stripInline(block.text);
        case "code":
          return block.code;
        case "rule":
          return "—";
        case "quote":
          return renderPlain(block.blocks)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        case "table":
          return tableToTsv(block.header, block.rows);
        case "list":
          return plainList(block.list, pad);
        default:
          return "";
      }
    })
    .join("\n\n");
}

function plainList(list: MarkdownList, pad: string): string {
  return list.items
    .map((item, index) => {
      const bullet = list.ordered ? `${list.start + index}.` : "•";
      const box = item.checked === null ? "" : item.checked ? "☑ " : "☐ ";
      const children = item.children.map((child) => `\n${plainList(child, `${pad}  `)}`).join("");
      return `${pad}${bullet} ${box}${stripInline(item.text)}${children}`;
    })
    .join("\n");
}

export function stripInline(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}
