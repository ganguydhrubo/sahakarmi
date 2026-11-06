// @vitest-environment node

import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { McpServerStore } from "../mcp-servers";
import { httpCandidates, testServer } from "./handshake";

const FIXTURE = fileURLToPath(
  new URL("./__fixtures__/servers/fixture-server.mjs", import.meta.url),
);
const NODE = process.execPath;

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function target(args: string[], extra: Partial<Parameters<typeof testServer>[0]> = {}) {
  return {
    transport: "stdio" as const,
    command: NODE,
    args: [FIXTURE, ...args],
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" },
    url: "",
    headers: {},
    ...extra,
  };
}

describe("Test server handshake (MCP-2)", () => {
  it("lists the tools of a good server", async () => {
    const result = await testServer(target(["good"]), { timeoutMs: 15_000, firstRun: false });
    expect(result).toMatchObject({
      ok: true,
      toolCount: 2,
      toolNames: ["echo", "where"],
      error: null,
    });
    expect(result.tools?.[0]).toEqual({ name: "echo", description: "Repeats the text" });
  });

  it("waits for a slow first run when the timeout allows it", async () => {
    const result = await testServer(target(["slow", "1500"]), {
      timeoutMs: 10_000,
      firstRun: true,
    });
    expect(result.ok).toBe(true);
  });

  it("times out a slow server and says it may be a first-run download", async () => {
    const result = await testServer(
      { ...target(["slow", "5000"]), displayCommand: "npx" },
      { timeoutMs: 700, firstRun: true },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnosis?.code).toBe("first-run-timeout");
  });

  it("tolerates a log line on stdout", async () => {
    const result = await testServer(target(["noisy"]), { timeoutMs: 15_000, firstRun: false });
    expect(result.ok).toBe(true);
  });

  it("explains a crash from its stderr tail", async () => {
    const result = await testServer(target(["crash"]), { timeoutMs: 15_000, firstRun: false });
    expect(result.ok).toBe(false);
    expect(result.stderrTail).toContain("ModuleNotFoundError");
    expect(result.diagnosis?.code).toBe("module-missing");
  });

  it("recognises a web app that never speaks MCP, and stops it", async () => {
    const result = await testServer(target(["http"]), { timeoutMs: 1500, firstRun: false });
    expect(result.ok).toBe(false);
    expect(result.diagnosis).toEqual({ code: "not-mcp", fix: "use-skill-route" });
  });

  it("reports a missing program", async () => {
    const result = await testServer(
      { ...target([]), command: "sahkarmi-no-such-program-xyz", args: [] },
      { timeoutMs: 5000, firstRun: false },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnosis?.code).toBe("command-not-found");
  });

  it("works from a folder with spaces and non-ASCII letters, in that folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi mcp ü "));
    folders.push(root);
    const script = join(root, "my server.mjs");
    await copyFile(FIXTURE, script);
    const result = await testServer(
      {
        ...target([]),
        args: [script, "good"],
        cwd: root,
        env: { ...target([]).env, FIXTURE_TAG: "ok" },
      },
      { timeoutMs: 15_000, firstRun: false },
    );
    expect(result.ok).toBe(true);
    const where = result.tools?.find((tool) => tool.name === "where")?.description ?? "";
    expect(where.toLowerCase()).toContain(`cwd=${root.toLowerCase()}`);
    expect(where).toContain("tag=ok");
  });

  it("tries Streamable HTTP at /mcp for an old /sse address (MCP-17)", () => {
    expect(httpCandidates("https://x.test/sse")).toEqual([
      "https://x.test/sse",
      "https://x.test/mcp",
    ]);
    expect(httpCandidates("https://x.test/mcp")).toEqual(["https://x.test/mcp"]);
  });
});

describe("store test, status and test-first rule (MCP-11, MCP-18)", () => {
  it("keeps a new server off until a passing test, then stores the status", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-mcp-store-"));
    folders.push(root);
    const store = new McpServerStore(root);
    await store.load();
    await store.save({
      name: "fixture",
      transport: "stdio",
      command: NODE,
      args: [FIXTURE, "good"],
    });
    const [added] = store.list();
    expect(added).toMatchObject({ enabled: false, needsTest: true, status: null });
    await expect(store.setEnabled(added?.id ?? "", true)).rejects.toThrow(/Test server/);
    const [tested] = await store.test(added?.id ?? "");
    expect(tested?.status).toMatchObject({ ok: true, toolCount: 2 });
    const [on] = await store.setEnabled(added?.id ?? "", true);
    expect(on?.enabled).toBe(true);
    // The status is saved with the server.
    const saved = JSON.parse(await readFile(join(root, "mcp-servers.json"), "utf8"));
    expect(saved.servers[0].status.toolNames).toEqual(["echo", "where"]);
    // The server env had a PATH and no provider key from Sahkarmi's own environment.
    process.env.OPENAI_API_KEY = "sk-test-not-for-servers";
    try {
      const [again] = await store.test(added?.id ?? "");
      const where = again?.status?.tools?.find((tool) => tool.name === "where")?.description;
      expect(where).toContain("path=yes");
      expect(where).toContain("key=none");
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("an upgraded mcp-servers.json keeps working unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi-mcp-upgrade-"));
    folders.push(root);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "mcp-servers.json"),
      JSON.stringify({
        version: 1,
        servers: [
          {
            id: "old-1",
            name: "github",
            enabled: true,
            transport: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-github"],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x" },
            url: "",
            headers: {},
            source: "pasted JSON",
            addedAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const store = new McpServerStore(root);
    await store.load();
    // Every coworker still gets it, with its env, and it can be switched off and on as before.
    expect(store.enabled("any-bot").map((server) => server.name)).toEqual(["github"]);
    expect(store.enabled("any-bot")[0]?.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_x");
    await store.setEnabled("old-1", false);
    await store.setEnabled("old-1", true);
    expect(store.list()[0]).toMatchObject({ enabled: true, coworkerIds: null });
  });
});
