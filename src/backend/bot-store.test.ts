// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BotStore, DEFAULT_COWORKERS, DEFAULT_WORKSPACE_ID } from "./bot-store";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("BotStore", () => {
  it("starts a new user with the default Indian team in one workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const store = new BotStore(join(root, "user-data"), join(root, "home"));

    await store.initialize();

    expect(store.list().map((bot) => `${bot.name} (${bot.role})`)).toEqual([
      "Mitra (Orchestrator)",
      "Asha (Accounts)",
      "Vikram (Sales)",
      "Meera (Support)",
      "Arjun (Research)",
      "Kavya (Content)",
      "Dev (Code)",
      "Tara (Ops)",
      "Kabir (Security)",
    ]);
    expect(store.list().every((bot) => bot.workspaceId === DEFAULT_WORKSPACE_ID)).toBe(true);
    expect(store.workspaces()).toMatchObject({
      activeWorkspaceId: DEFAULT_WORKSPACE_ID,
      workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: "My Business" }],
    });
  });

  it("creates coworkers in the active workspace and keeps workspaces across restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new BotStore(userData, join(root, "home"));
    await store.initialize();

    const state = await store.createWorkspace("Kolkata Showroom");
    const showroom = state.activeWorkspaceId;
    expect(showroom).not.toBe(DEFAULT_WORKSPACE_ID);
    const bot = await store.createBot();
    expect(bot.workspaceId).toBe(showroom);
    await store.renameWorkspace(showroom, "Kolkata Store");

    const restored = new BotStore(userData, join(root, "home"));
    await restored.initialize();
    expect(restored.workspaces().activeWorkspaceId).toBe(showroom);
    expect(restored.workspaces().workspaces.map((workspace) => workspace.name)).toEqual([
      "My Business",
      "Kolkata Store",
    ]);
    expect(restored.list().filter((candidate) => candidate.workspaceId === showroom)).toHaveLength(
      1,
    );
    await expect(restored.setActiveWorkspace("missing")).rejects.toThrow("Unknown workspace");
  });

  it("upgrades version 1 state files into the first workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const seed = new BotStore(userData, join(root, "home"));
    await seed.initialize();
    const legacy = JSON.parse(await readFile(join(userData, "bots.json"), "utf8"));
    const v1 = {
      version: 1,
      examplesInitialized: true,
      bots: legacy.bots.map(({ workspaceId: _w, ...bot }: Record<string, unknown>) => bot),
    };
    await writeFile(join(userData, "bots.json"), JSON.stringify(v1));

    const store = new BotStore(userData, join(root, "home"));
    await store.initialize();
    expect(store.list()).toHaveLength(DEFAULT_COWORKERS.length);
    expect(store.list().every((bot) => bot.workspaceId === DEFAULT_WORKSPACE_ID)).toBe(true);
  });

  it("creates separate bot workspaces and a shared directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const home = join(root, "home");
    const store = new BotStore(userData, home);

    await store.initialize();
    const chief = await store.getOrCreate("chief");
    const sales = await store.getOrCreate("sales-outbound");

    expect(chief.workspacePath).toBe(join(home, "Sahkarmi", "Coworkers", "chief"));
    expect(chief.description).toBe("");
    expect(chief.preview).toBe("No messages yet");
    expect(chief.model).toBe("gpt-5.6-luna");
    expect(chief.reasoningEffort).toBe("medium");
    expect(sales.workspacePath).toBe(join(home, "Sahkarmi", "Coworkers", "sales-outbound"));
    expect(store.sharedRoot).toBe(join(home, "Sahkarmi", "Shared"));
    expect(chief.workspacePath).not.toBe(sales.workspacePath);
  });

  it("persists thread ids with a complete JSON state file", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new BotStore(userData, join(root, "home"));
    await store.initialize();

    await store.getOrCreate("chief");
    await store.setThreadId("chief", "thread-123");
    const parsed = JSON.parse(await readFile(join(userData, "bots.json"), "utf8"));

    expect(parsed.version).toBe(2);
    expect(parsed.bots.find((bot: { id: string }) => bot.id === "chief").threadId).toBe(
      "thread-123",
    );
  });

  it("creates unique new agents at the top of the persistent list", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new BotStore(userData, join(root, "home"));
    await store.initialize();

    const first = await store.createBot();
    const second = await store.createBot();

    expect(first.id).not.toBe(second.id);
    expect(first.name).toBe("New coworker");
    expect(second.name).toBe("New coworker");
    expect(
      store
        .list()
        .slice(0, 2)
        .map((bot) => bot.id),
    ).toEqual([second.id, first.id]);

    const reloaded = new BotStore(userData, join(root, "home"));
    await reloaded.initialize();
    expect(
      reloaded
        .list()
        .slice(0, 2)
        .map((bot) => bot.id),
    ).toEqual([second.id, first.id]);
  });

  it("rejects path traversal bot ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const store = new BotStore(join(root, "data"), join(root, "home"));
    await store.initialize();

    await expect(store.getOrCreate("../outside")).rejects.toThrow("Invalid bot id");
  });

  it("fails closed instead of overwriting agent state from a newer version", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const statePath = join(userData, "bots.json");
    const unsupported = '{"version":999,"examplesInitialized":true,"bots":[]}\n';
    await mkdir(userData, { recursive: true });
    await writeFile(statePath, unsupported);

    const store = new BotStore(userData, join(root, "home"));
    await expect(store.initialize()).rejects.toThrow("refusing to overwrite");
    await expect(readFile(statePath, "utf8")).resolves.toBe(unsupported);
  });

  it("persists editable agent settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const store = new BotStore(userData, join(root, "home"));
    await store.initialize();

    await store.getOrCreate("chief");
    await store.updateBot({
      botId: "chief",
      name: "Coordinator",
      role: "Operations lead",
      description: "Keeps the team aligned",
      notifications: false,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
    const restored = new BotStore(userData, join(root, "home"));
    await restored.initialize();
    expect(restored.list().find((bot) => bot.id === "chief")).toMatchObject({
      name: "Coordinator",
      role: "Operations lead",
      description: "Keeps the team aligned",
      notifications: false,
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
  });

  it("starts a new thread when the model changes provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const store = new BotStore(join(root, "user-data"), join(root, "home"));
    await store.initialize();
    await store.getOrCreate("chief");
    await store.setThreadId("chief", "codex-thread");

    const claude = await store.updateBot({ botId: "chief", model: "claude-sonnet-5" });
    expect(claude.threadId).toBeNull();
    await store.setThreadId("chief", "claude-thread");

    const opus = await store.updateBot({ botId: "chief", model: "claude-opus-5" });
    expect(opus.threadId).toBe("claude-thread");
  });

  it("deletes coworkers persistently without reseeding the default team", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-store-"));
    temporaryRoots.push(root);
    const userData = join(root, "user-data");
    const home = join(root, "home");
    const store = new BotStore(userData, home);
    await store.initialize();

    await store.createBot();
    for (const bot of store.list()) await store.deleteBot(bot.id);
    expect(store.list()).toEqual([]);

    const restored = new BotStore(userData, home);
    await restored.initialize();
    expect(restored.list()).toEqual([]);
  });
});
