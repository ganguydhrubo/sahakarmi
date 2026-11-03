import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { hideSecrets } from "./workflow-export";

/**
 * A coworker's standing rules live in one file at the root of its own folder: AGENTS.md, or
 * CLAUDE.md when only that one exists. The owner reads and edits it from the coworker's
 * settings; a coworker may edit it too when the owner asks it to remember a rule.
 */

export type InstructionsFileName = "AGENTS.md" | "CLAUDE.md";

export interface CoworkerInstructions {
  file: InstructionsFileName;
  folder: string;
  text: string;
  /** Short digest of the text; a save names the one it loaded so a change in between is noticed. */
  hash: string;
  exists: boolean;
}

/** More than this is a document, not a set of rules; the prompt and the editor both stop here. */
export const MAX_INSTRUCTIONS_CHARS = 32_000;

export class InstructionsChangedError extends Error {
  constructor() {
    super("The file changed since you opened it. Save again to replace that version.");
    this.name = "InstructionsChangedError";
  }
}

export function instructionsHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The file to use: AGENTS.md, or CLAUDE.md when it alone exists. Links out of the folder are refused. */
export async function instructionsPath(
  workspacePath: string,
): Promise<{ file: InstructionsFileName; path: string; exists: boolean }> {
  const candidates: InstructionsFileName[] = ["AGENTS.md", "CLAUDE.md"];
  for (const file of candidates) {
    const path = join(workspacePath, file);
    try {
      const info = await stat(path);
      if (!info.isFile()) continue;
      await assertInside(path, workspacePath);
      return { file, path, exists: true };
    } catch (error) {
      if (error instanceof InstructionsChangedError) throw error;
      if (isNotFound(error)) continue;
      throw error;
    }
  }
  return { file: "AGENTS.md", path: join(workspacePath, "AGENTS.md"), exists: false };
}

export async function readInstructions(workspacePath: string): Promise<CoworkerInstructions> {
  const target = await instructionsPath(workspacePath);
  let text = "";
  if (target.exists) {
    text = await readFile(target.path, "utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  }
  return {
    file: target.file,
    folder: workspacePath,
    text,
    hash: instructionsHash(text),
    exists: target.exists,
  };
}

/**
 * Replaces the file atomically. `expectedHash` is the digest the editor loaded; when the file
 * has moved on since (the coworker edited it), the save is refused once so nothing is lost.
 */
export async function saveInstructions(
  workspacePath: string,
  text: string,
  expectedHash: string | null,
): Promise<CoworkerInstructions> {
  if (text.length > MAX_INSTRUCTIONS_CHARS) {
    throw new Error(
      `Instructions are limited to ${MAX_INSTRUCTIONS_CHARS.toLocaleString()} characters.`,
    );
  }
  const current = await readInstructions(workspacePath);
  if (expectedHash !== null && current.hash !== expectedHash) throw new InstructionsChangedError();
  const target = await instructionsPath(workspacePath);
  const normalized = text.replace(/\r\n/g, "\n");
  const body = normalized.length && !normalized.endsWith("\n") ? `${normalized}\n` : normalized;
  const temporary = join(dirname(target.path), `.${target.file}.${randomUUID()}.tmp`);
  await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target.path);
  return readInstructions(workspacePath);
}

/** The prompt lines for a provider that does not read the file by itself. */
export function instructionsPromptLines(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const safe = hideSecrets(trimmed.slice(0, MAX_INSTRUCTIONS_CHARS)).replace(
    /<\/coworker_instructions>/gi,
    "</coworker_instructions​>",
  );
  return [
    "Your standing rules, kept in AGENTS.md in your own folder:",
    "<coworker_instructions>",
    safe,
    "</coworker_instructions>",
  ];
}

/** How a coworker is told to keep the file. */
export const INSTRUCTIONS_FORMAT_RULE =
  "Your standing rules live in AGENTS.md at the root of your own folder (CLAUDE.md counts when only that exists). When the owner asks you to remember a rule for the future, edit that file: short bullets under headings, and replace a rule instead of adding a second one that contradicts it. Keep it under a few hundred lines.";

async function assertInside(path: string, root: string): Promise<void> {
  const [realFile, realRoot] = await Promise.all([realpath(path), realpath(root)]);
  const prefix = resolve(realRoot) + sep;
  if (!resolve(realFile).startsWith(prefix)) {
    throw new Error("The instructions file points outside the coworker's folder.");
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT"
  );
}
