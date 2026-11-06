import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
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

/** Claude Code's folder name for a working directory: every character but a-z, A-Z, 0-9 is "-". */
export function claudeProjectFolder(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Claude shortens very long folder names in its own way; those are left to Claude to find. */
const MAX_PLAIN_PROJECT_FOLDER = 200;

/**
 * Whether Claude can resume the session from `cwd`. Claude looks for a saved session only in
 * the folder of the directory it runs in, so a transcript saved under another folder (the
 * coworker's folder moved) is copied there first. False when no transcript exists anywhere:
 * resuming would fail with "No conversation found", so the caller starts a new session.
 */
export async function prepareResume(
  sessionId: string,
  cwd: string,
  configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"),
): Promise<boolean> {
  const projects = join(configDir, "projects");
  const file = `${sessionId}.jsonl`;
  const folder = claudeProjectFolder(cwd);
  const isFile = async (path: string) => (await stat(path).catch(() => null))?.isFile() === true;
  if (await isFile(join(projects, folder, file))) return true;
  for (const other of await readdir(projects).catch(() => [] as string[])) {
    if (other === folder || !(await isFile(join(projects, other, file)))) continue;
    if (folder.length > MAX_PLAIN_PROJECT_FOLDER) return true;
    try {
      await mkdir(join(projects, folder), { recursive: true });
      await copyFile(join(projects, other, file), join(projects, folder, file));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Claude's answer when asked to resume a session it has no transcript for. */
export function isMissingSessionError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /No conversation found with session ID/i.test(text);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The session's transcript file and a stamp (size and time) that changes whenever Claude writes
 * to it, or null when there is none. Lets a reader skip parsing an unchanged transcript again.
 */
export async function transcriptStamp(
  sessionId: string,
  configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"),
): Promise<string | null> {
  const projects = join(configDir, "projects");
  const folders = await readdir(projects).catch(() => [] as string[]);
  for (const folder of folders) {
    const path = join(projects, folder, `${sessionId}.jsonl`);
    const info = await stat(path).catch(() => null);
    if (info?.isFile()) return `${path}|${info.size}|${info.mtimeMs}`;
  }
  return null;
}
