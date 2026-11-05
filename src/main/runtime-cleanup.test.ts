import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanUpRuntimes } from "./runtime-cleanup";

describe("cleanUpRuntimes", () => {
  let root = "";
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("keeps the copy in use and removes older copies, legacy Codex and stale staging", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-cleanup-"));
    const userData = join(root, "userData");
    const temp = join(root, "temp");
    const runtime = join(userData, "runtime");
    for (const dir of [
      "claude/2.1.317",
      "claude/2.1.318",
      "claude/2.1.319.partial-1",
      "codex/0.165.0",
      "codex/0.166.0",
      "opencode/1.19.4",
      "opencode/1.19.5",
      "opencode/1.19.6",
      "antigravity/1.4.1",
    ])
      await mkdir(join(runtime, dir), { recursive: true });
    await writeFile(join(runtime, "opencode", "current.json"), '{"version":"1.19.5"}');
    await mkdir(join(userData, "tools", "codex"), { recursive: true });
    await mkdir(join(userData, "tools", "qwen"), { recursive: true });
    await mkdir(join(userData, "Partitions", "persist_bot"), { recursive: true });
    const staleSave = join(userData, "mailbox.json.42204.74ac6c8e-6426-49f6-b4ac-23a9f6bfcf1d.tmp");
    await writeFile(staleSave, "{");
    await writeFile(join(userData, "mailbox.json"), "{}");
    const hourAgo = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(staleSave, hourAgo, hourAgo);
    await mkdir(join(temp, "sahkarmi-runtime-old"), { recursive: true });
    await mkdir(join(temp, "sahkarmi-runtime-new"), { recursive: true });
    await mkdir(join(temp, "sahkarmi-export-old"), { recursive: true });
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await utimes(join(temp, "sahkarmi-runtime-old"), old, old);
    await utimes(join(temp, "sahkarmi-export-old"), old, old);

    await cleanUpRuntimes(userData, temp);

    const left = (path: string) => existsSync(join(runtime, path));
    expect(left("claude/2.1.318")).toBe(true);
    expect(left("claude/2.1.317")).toBe(false);
    expect(left("claude/2.1.319.partial-1")).toBe(false);
    expect(left("codex/0.166.0")).toBe(true);
    expect(left("codex/0.165.0")).toBe(false);
    // OpenCode runs the copy current.json names, even with a newer folder present.
    expect(left("opencode/1.19.5")).toBe(true);
    expect(left("opencode/1.19.4")).toBe(false);
    expect(left("opencode/1.19.6")).toBe(false);
    expect(left("antigravity/1.4.1")).toBe(true);
    expect(existsSync(join(userData, "tools", "codex"))).toBe(false);
    expect(existsSync(join(userData, "tools", "qwen"))).toBe(true);
    expect(existsSync(join(userData, "Partitions", "persist_bot"))).toBe(true);
    expect(existsSync(staleSave)).toBe(false);
    expect(existsSync(join(userData, "mailbox.json"))).toBe(true);
    expect(existsSync(join(temp, "sahkarmi-runtime-old"))).toBe(false);
    expect(existsSync(join(temp, "sahkarmi-runtime-new"))).toBe(true);
    expect(existsSync(join(temp, "sahkarmi-export-old"))).toBe(true);
  });

  it("leaves the legacy Codex download when it is the only copy", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-cleanup-"));
    const userData = join(root, "userData");
    await mkdir(join(userData, "tools", "codex"), { recursive: true });
    await cleanUpRuntimes(userData, join(root, "temp"));
    expect(existsSync(join(userData, "tools", "codex"))).toBe(true);
  });
});
