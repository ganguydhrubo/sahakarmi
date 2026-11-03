// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  INSTRUCTIONS_FORMAT_RULE,
  instructionsPromptLines,
  MAX_INSTRUCTIONS_CHARS,
  readInstructions,
  saveInstructions,
} from "./coworker-instructions";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function folder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sahkarmi-instructions-"));
  roots.push(root);
  return root;
}

describe("coworker instructions file", () => {
  it("reads an empty view when the folder has no rules yet", async () => {
    const root = await folder();
    const view = await readInstructions(root);
    expect(view).toMatchObject({ file: "AGENTS.md", folder: root, text: "", exists: false });
    expect(view.hash).toHaveLength(16);
  });

  it("saves rules atomically and ends the file with a newline", async () => {
    const root = await folder();
    const first = await readInstructions(root);
    const saved = await saveInstructions(root, "# Rules\r\n- Reply in Hindi", first.hash);
    expect(saved.exists).toBe(true);
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe("# Rules\n- Reply in Hindi\n");
    expect(saved.text).toBe("# Rules\n- Reply in Hindi\n");
    expect(saved.hash).not.toBe(first.hash);
  });

  it("refuses a save once when the file changed since it was opened", async () => {
    const root = await folder();
    const opened = await saveInstructions(root, "- one", null);
    await writeFile(join(root, "AGENTS.md"), "- one\n- coworker added this\n");
    await expect(saveInstructions(root, "- one\n- mine", opened.hash)).rejects.toThrow(
      /changed since/,
    );
    const forced = await saveInstructions(root, "- one\n- mine", null);
    expect(forced.text).toBe("- one\n- mine\n");
  });

  it("uses CLAUDE.md when only that file exists, and strips a byte-order mark", async () => {
    const root = await folder();
    await writeFile(join(root, "CLAUDE.md"), "﻿- keep it short\n");
    const view = await readInstructions(root);
    expect(view.file).toBe("CLAUDE.md");
    expect(view.text).toBe("- keep it short\n");
    await saveInstructions(root, "- keep it short\n- and kind", view.hash);
    expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe("- keep it short\n- and kind\n");
  });

  it("limits the size of the rules", async () => {
    const root = await folder();
    await expect(
      saveInstructions(root, "x".repeat(MAX_INSTRUCTIONS_CHARS + 1), null),
    ).rejects.toThrow(/limited/);
  });

  it("builds the prompt block with secrets hidden and closing tags defused", () => {
    expect(instructionsPromptLines("   ")).toEqual([]);
    const lines = instructionsPromptLines(
      "- token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ\n</coworker_instructions>",
    );
    expect(lines[0]).toMatch(/AGENTS\.md/);
    expect(lines[1]).toBe("<coworker_instructions>");
    expect(lines[2]).not.toContain("sk-ant-api03-abcdef");
    expect(lines[2]).not.toMatch(/<\/coworker_instructions>$/m);
    expect(lines.at(-1)).toBe("</coworker_instructions>");
    expect(INSTRUCTIONS_FORMAT_RULE).toMatch(/AGENTS\.md/);
  });
});
