import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  folderSize,
  removeBotPartition,
  removeOldLogs,
  removeOrphanGeminiHomes,
  removeOrphanPartitions,
  storageUsage,
} from "./storage-cleanup";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = "";
});

async function file(path: string, bytes = 10): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "x".repeat(bytes));
}

describe("storage cleanup", () => {
  it("removes only the browser folders of coworkers that no longer exist", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-storage-"));
    const partitions = join(root, "Partitions");
    await file(join(partitions, "sahkarmi-browser", "Cookies"));
    await file(join(partitions, "sahkarmi-browser-bot-live", "Cookies"));
    await file(join(partitions, "sahkarmi-browser-bot-gone", "Cookies"), 300);
    await file(join(partitions, "sahkarmi-browser-chief", "Cookies"));
    await file(join(partitions, "something-else", "Cookies"));

    const result = await removeOrphanPartitions(root, ["bot-live", "chief"]);
    expect(result.removed).toEqual([join(partitions, "sahkarmi-browser-bot-gone")]);
    expect(result.bytes).toBe(300);
    expect(existsSync(join(partitions, "sahkarmi-browser"))).toBe(true);
    expect(existsSync(join(partitions, "sahkarmi-browser-bot-live"))).toBe(true);
    expect(existsSync(join(partitions, "sahkarmi-browser-chief"))).toBe(true);
    expect(existsSync(join(partitions, "something-else"))).toBe(true);
  });

  it("never treats an empty coworker list as 'all deleted'", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-storage-"));
    await file(join(root, "Partitions", "sahkarmi-browser-bot-a", "Cookies"));
    expect((await removeOrphanPartitions(root, [])).removed).toEqual([]);
    expect(existsSync(join(root, "Partitions", "sahkarmi-browser-bot-a"))).toBe(true);
  });

  it("removes a deleted coworker's folder by id, refusing odd ids", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-storage-"));
    await file(join(root, "Partitions", "sahkarmi-browser-bot-x", "Cookies"));
    expect(await removeBotPartition(root, "../x")).toBe(false);
    expect(await removeBotPartition(root, "bot-x")).toBe(true);
    expect(existsSync(join(root, "Partitions", "sahkarmi-browser-bot-x"))).toBe(false);
  });

  it("removes Google account folders no saved account uses", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-storage-"));
    const homes = join(root, "gemini-accounts");
    await file(join(homes, "kept", ".gemini", "oauth.json"));
    await file(join(homes, "removed", ".gemini", "oauth.json"));
    // No list: nothing is known to be unused.
    expect((await removeOrphanGeminiHomes(root)).removed).toEqual([]);
    await writeFile(
      join(root, "gemini-accounts.json"),
      JSON.stringify({
        version: 1,
        activeId: "default",
        accounts: [
          { id: "default", home: null },
          { id: "kept", home: join(homes, "kept") },
        ],
      }),
    );
    expect((await removeOrphanGeminiHomes(root)).removed).toEqual([join(homes, "removed")]);
    expect(existsSync(join(homes, "kept"))).toBe(true);
  });

  it("keeps the current log and sizes every category", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-storage-"));
    await file(join(root, "logs", "sahkarmi.log"), 5);
    await file(join(root, "logs", "sahkarmi.log.1"), 7);
    await file(join(root, "runtime", "codex", "0.1.0", "bin", "codex.exe"), 40);
    await file(join(root, "mailbox-archive", "2026-01.jsonl"), 3);
    const transfers = join(root, "Shared", "Transfers");
    await file(join(transfers, "m1", "a.pdf"), 11);

    const usage = await storageUsage({ userData: root, transfersRoot: transfers });
    const bytes = Object.fromEntries(usage.categories.map((item) => [item.id, item.bytes]));
    expect(bytes).toMatchObject({ logs: 12, runtimes: 40, mailboxArchive: 3, attachments: 11 });

    expect((await removeOldLogs(root)).removed).toEqual([join(root, "logs", "sahkarmi.log.1")]);
    expect(existsSync(join(root, "logs", "sahkarmi.log"))).toBe(true);
    expect((await folderSize(join(root, "logs"))).bytes).toBe(5);
  });
});
