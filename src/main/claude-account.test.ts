import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLAUDE_ACCOUNT_DIR, useOwnClaudeAccount } from "./claude-account";

describe("useOwnClaudeAccount", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("points Claude at Sahkarmi's own folder and moves only coworker transcripts", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-claude-account-"));
    const home = join(root, "home");
    const userData = join(root, "userData");
    const projects = join(home, ".claude", "projects");
    const coworker = join(projects, "C--Users-Dhrubo-Sahkarmi-Coworkers-bot-1");
    const own = join(projects, "C--Users-Dhrubo-projects-app");
    await mkdir(coworker, { recursive: true });
    await mkdir(own, { recursive: true });
    await writeFile(join(coworker, "s.jsonl"), "{}\n");
    await writeFile(join(home, ".claude", ".credentials.json"), "{}");
    const env: NodeJS.ProcessEnv = {};

    const dir = await useOwnClaudeAccount(userData, home, env);

    expect(dir).toBe(join(userData, CLAUDE_ACCOUNT_DIR));
    expect(env.CLAUDE_CONFIG_DIR).toBe(dir);
    expect(await readdir(join(dir, "projects"))).toEqual([
      "C--Users-Dhrubo-Sahkarmi-Coworkers-bot-1",
    ]);
    expect(
      await readdir(join(dir, "projects", "C--Users-Dhrubo-Sahkarmi-Coworkers-bot-1")),
    ).toEqual(["s.jsonl"]);
    // The owner's own Claude Code projects and sign-in stay where they are.
    expect(await readdir(projects)).toEqual(["C--Users-Dhrubo-projects-app"]);
    expect(await readdir(join(home, ".claude"))).toContain(".credentials.json");
    expect(await readdir(dir)).not.toContain(".credentials.json");
  });

  it("keeps a CLAUDE_CONFIG_DIR the owner set", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-claude-account-"));
    const env: NodeJS.ProcessEnv = { CLAUDE_CONFIG_DIR: "D:\\claude" };
    expect(await useOwnClaudeAccount(join(root, "u"), join(root, "h"), env)).toBe("D:\\claude");
    expect(env.CLAUDE_CONFIG_DIR).toBe("D:\\claude");
  });

  it("does not move a transcript twice", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-claude-account-"));
    const home = join(root, "home");
    const userData = join(root, "userData");
    const name = "C--Users-Dhrubo-Sahkarmi-Coworkers-bot-2";
    await mkdir(join(home, ".claude", "projects", name), { recursive: true });
    await mkdir(join(userData, CLAUDE_ACCOUNT_DIR, "projects", name), { recursive: true });
    await writeFile(join(userData, CLAUDE_ACCOUNT_DIR, "projects", name, "new.jsonl"), "{}\n");
    await useOwnClaudeAccount(userData, home, {});
    expect(await readdir(join(userData, CLAUDE_ACCOUNT_DIR, "projects", name))).toEqual([
      "new.jsonl",
    ]);
  });
});
