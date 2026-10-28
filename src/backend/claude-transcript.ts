import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** What the Agent SDK's session messages leave out: when each line was written, and who wrote it. */
export interface TranscriptLineInfo {
  /** Milliseconds since epoch, or null when the line has no usable timestamp. */
  time: number | null;
  /** Claude Code's own note (compaction summary, background-task notice), not the owner's words. */
  internal: boolean;
}

const INTERRUPT_MARKER = /^\[Request interrupted by user(?: for tool use)?\]$/;

/** Claude Code writes this when a turn is stopped; it is not something the owner typed. */
export function isInterruptMarker(text: string): boolean {
  return INTERRUPT_MARKER.test(text.trim());
}

export function parseTranscriptLines(jsonl: string): Map<string, TranscriptLineInfo> {
  const lines = new Map<string, TranscriptLineInfo>();
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || typeof entry.uuid !== "string") continue;
    const time = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    lines.set(entry.uuid, {
      time: Number.isFinite(time) ? time : null,
      internal:
        entry.isCompactSummary === true ||
        (isRecord(entry.origin) && entry.origin.kind === "task-notification"),
    });
  }
  return lines;
}

/** Reads the session's transcript file; an unreadable or missing one gives an empty map. */
export async function readTranscriptLines(
  sessionId: string,
  configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"),
): Promise<Map<string, TranscriptLineInfo>> {
  const projects = join(configDir, "projects");
  const folders = await readdir(projects).catch(() => [] as string[]);
  for (const folder of folders) {
    const text = await readFile(join(projects, folder, `${sessionId}.jsonl`), "utf8").catch(
      () => null,
    );
    if (text !== null) return parseTranscriptLines(text);
  }
  return new Map();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
