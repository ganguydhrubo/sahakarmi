// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acpMcpServers,
  claudeMcpServers,
  codexMcpConfig,
  launchCommand,
  McpServerStore,
  parseMcpJson,
  readCustomMcpServers,
} from "./mcp-servers";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

async function store(): Promise<McpServerStore> {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-mcp-"));
  const result = new McpServerStore(root);
  await result.load();
  return result;
}

describe("parseMcpJson", () => {
  it("reads Claude-style JSON with local and web servers", () => {
    const { servers, skipped } = parseMcpJson(
      JSON.stringify({
        mcpServers: {
          github: { command: "npx", args: ["-y", "pkg"], env: { TOKEN: "x" } },
          notion: { type: "http", url: "https://mcp.notion.com/mcp", headers: { A: "b" } },
          old: { type: "sse", url: "https://x.test/sse" },
          broken: { foo: 1 },
        },
      }),
    );
    expect(servers).toEqual([
      {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["-y", "pkg"],
        env: { TOKEN: "x" },
      },
      { name: "notion", transport: "http", url: "https://mcp.notion.com/mcp", headers: { A: "b" } },
    ]);
    expect(skipped).toHaveLength(2);
  });

  it("accepts VS Code's servers key and refuses bad JSON clearly", () => {
    expect(parseMcpJson('{"servers":{"a":{"command":"uvx"}}}').servers[0]?.name).toBe("a");
    expect(() => parseMcpJson("{nope")).toThrow(/not valid JSON/);
  });
});

describe("McpServerStore", () => {
  it("saves servers, keeps secrets out of the list and keeps a blank value on edit", async () => {
    const mcp = await store();
    const [saved] = await mcp.save({
      name: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "pkg"],
      env: { TOKEN: "secret-1" },
    });
    expect(saved).toMatchObject({ name: "github", envKeys: ["TOKEN"], enabled: true });
    expect(JSON.stringify(mcp.list())).not.toContain("secret-1");

    await mcp.save({
      id: saved?.id,
      name: "github",
      transport: "stdio",
      command: "npx",
      env: { TOKEN: "" },
    });
    expect(mcp.enabled()[0]?.env).toEqual({ TOKEN: "secret-1" });

    const reloaded = new McpServerStore(root as string);
    await reloaded.load();
    expect(reloaded.enabled()[0]?.env).toEqual({ TOKEN: "secret-1" });
    expect(await readFile(join(root as string, "mcp-servers.json"), "utf8")).toContain("secret-1");
  });

  it("refuses reserved, duplicate and invalid servers", async () => {
    const mcp = await store();
    await expect(
      mcp.save({ name: "sahkarmi_x", transport: "stdio", command: "a" }),
    ).rejects.toThrow(/reserved/);
    await expect(mcp.save({ name: "has space", transport: "stdio", command: "a" })).rejects.toThrow(
      /Name/,
    );
    await expect(mcp.save({ name: "web", transport: "http", url: "ftp://x" })).rejects.toThrow(
      /https/,
    );
    await mcp.save({ name: "a", transport: "stdio", command: "a" });
    await expect(mcp.save({ name: "A", transport: "stdio", command: "b" })).rejects.toThrow(
      /already/,
    );
  });

  it("imports JSON, replaces a server with the same name, and hides disabled ones", async () => {
    const mcp = await store();
    const first = await mcp.importJson('{"mcpServers":{"fs":{"command":"npx","args":["one"]}}}');
    expect(first.added).toEqual(["fs"]);
    await mcp.importJson('{"mcpServers":{"fs":{"command":"npx","args":["two"]}}}');
    expect(mcp.list()).toHaveLength(1);
    expect(mcp.enabled()[0]?.args).toEqual(["two"]);
    await mcp.setEnabled(mcp.list()[0]?.id ?? "", false);
    expect(mcp.enabled()).toEqual([]);
  });

  it("collects a GitHub repo's .mcp.json files for review", async () => {
    root = await mkdtemp(join(tmpdir(), "sahkarmi-mcp-"));
    const responses: Record<string, unknown> = {
      "https://api.github.com/repos/o/r": { default_branch: "main" },
      "https://api.github.com/repos/o/r/git/trees/main?recursive=1": {
        tree: [
          { path: ".mcp.json", type: "blob", size: 50 },
          { path: "plugins/x/.mcp.json", type: "blob", size: 50 },
        ],
      },
      "https://raw.githubusercontent.com/o/r/main/.mcp.json":
        '{"mcpServers":{"a":{"command":"x"}}}',
      "https://raw.githubusercontent.com/o/r/main/plugins/x/.mcp.json":
        '{"b":{"url":"https://b.test"}}',
    };
    const fake = async (url: string) => ({
      ok: url in responses,
      status: url in responses ? 200 : 404,
      headers: { get: () => null },
      json: async () => responses[url],
      text: async () => String(responses[url]),
    });
    const mcp = new McpServerStore(root, fake);
    const text = await mcp.githubJson("https://github.com/o/r");
    expect(JSON.parse(text)).toEqual({
      mcpServers: { a: { command: "x" }, b: { url: "https://b.test" } },
    });
  });
});

describe("runtime formats", () => {
  const servers = readCustomMcpServers({
    customMcpServers: [
      { name: "gh", transport: "stdio", command: "npx", args: ["-y", "pkg"], env: { T: "1" } },
      { name: "web", transport: "http", url: "https://w.test/mcp", headers: { A: "b" } },
      { name: "bad name", transport: "stdio", command: "x" },
    ],
  });

  it("drops invalid entries from thread params", () => {
    expect(servers.map((server) => server.name)).toEqual(["gh", "web"]);
  });

  it("wraps npx in cmd /c on Windows only", () => {
    expect(launchCommand(servers[0] as never, "win32")).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", "pkg"],
    });
    expect(launchCommand(servers[0] as never, "linux")).toEqual({
      command: "npx",
      args: ["-y", "pkg"],
    });
  });

  it("builds Claude, ACP and Codex shapes", () => {
    const claude = claudeMcpServers(servers);
    expect(claude.web).toEqual({ type: "http", url: "https://w.test/mcp", headers: { A: "b" } });
    expect(claude.gh).toMatchObject({ type: "stdio", env: { T: "1" } });

    expect(acpMcpServers(servers, false)).toEqual([
      expect.objectContaining({ name: "gh", env: [{ name: "T", value: "1" }] }),
    ]);
    expect(acpMcpServers(servers, true)).toContainEqual({
      type: "http",
      name: "web",
      url: "https://w.test/mcp",
      headers: [{ name: "A", value: "b" }],
    });

    expect(codexMcpConfig([])).toBeUndefined();
    expect(codexMcpConfig(servers)).toMatchObject({
      mcp_servers: { web: { url: "https://w.test/mcp", http_headers: { A: "b" } } },
    });
  });
});
