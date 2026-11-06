// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acpMcpServers,
  claudeMcpServers,
  codexMcpConfig,
  commandExists,
  launchCommand,
  McpServerStore,
  type McpServerWire,
  parseMcpJson,
  readCustomMcpServers,
  withoutCwd,
} from "./mcp-servers";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

/** The older behaviour (both MCP switches off) unless `features` is true. */
async function store(features = false): Promise<McpServerStore> {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-mcp-"));
  const result = new McpServerStore(root);
  if (!features) result.setFeatureCheck(() => false);
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
    reloaded.setFeatureCheck(() => false);
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
    await mcp.importJson('{"mcpServers":{"fs":{"command":"npx","args":["two"]}}}', "pasted", [
      "fs",
    ]);
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

describe("McpServerStore with test-first and per-coworker servers", () => {
  it("asks before an import replaces a same-name server (MCP-14)", async () => {
    const mcp = await store(true);
    await mcp.importJson('{"mcpServers":{"fs":{"command":"npx","args":["one"]}}}');
    const second = await mcp.importJson(
      '{"mcpServers":{"fs":{"command":"npx","args":["two"]},"web":{"url":"https://w.test/mcp"}}}',
    );
    expect(second).toMatchObject({ added: ["web"], conflicts: ["fs"] });
    expect(mcp.list().find((server) => server.name === "fs")?.args).toEqual(["one"]);
    const confirmed = await mcp.importJson(
      '{"mcpServers":{"fs":{"command":"npx","args":["two"]}}}',
      "pasted JSON",
      ["fs"],
    );
    expect(confirmed).toMatchObject({ added: ["fs"], conflicts: [] });
    expect(mcp.list().find((server) => server.name === "fs")?.args).toEqual(["two"]);
  });

  it("saves imports switched off until tested (MCP-11) and keeps templates off (MCP-1)", async () => {
    const mcp = await store(true);
    const result = await mcp.importJson(
      JSON.stringify({
        mcpServers: {
          "money-printer-turbo": {
            command: "uv",
            args: [
              "--directory",
              "/ABSOLUTE/PATH/TO/money-printer-turbo",
              "run",
              "python",
              "main.py",
            ],
          },
        },
      }),
    );
    const [server] = result.servers;
    expect(server).toMatchObject({ enabled: false, needsTest: true });
    expect(server?.problems[0]).toMatchObject({ kind: "placeholder" });
    await expect(mcp.setEnabled(server?.id ?? "", true)).rejects.toThrow(/template/);
    await expect(mcp.test(server?.id ?? "")).rejects.toThrow(/template/);
    expect(mcp.enabled()).toEqual([]);
  });

  it("gives a limited server only to the chosen coworkers (MCP-12)", async () => {
    const mcp = await store();
    const [server] = await mcp.save({ name: "fs", transport: "stdio", command: "npx" });
    expect(mcp.enabled("bot-a")).toHaveLength(1);
    await mcp.setCoworkers(server?.id ?? "", ["bot-b"]);
    expect(mcp.enabled("bot-a")).toEqual([]);
    expect(mcp.enabled("bot-b").map((entry) => entry.name)).toEqual(["fs"]);
    await mcp.setCoworkers(server?.id ?? "", null);
    expect(mcp.enabled("bot-a")).toHaveLength(1);
  });

  it("stores a folder and refuses a relative one (MCP-4)", async () => {
    const mcp = await store();
    await expect(
      mcp.save({ name: "py", transport: "stdio", command: "python", cwd: "relative" }),
    ).rejects.toThrow(/full path/);
    const [saved] = await mcp.save({
      name: "py",
      transport: "stdio",
      command: "python",
      args: ["server.py"],
      cwd: "C:\\srv",
    });
    expect(saved?.cwd).toBe("C:\\srv");
    expect(mcp.enabled()[0]?.cwd).toBe("C:\\srv");
  });
});

describe("commandExists", () => {
  it("finds a command on PATH with a Windows ending and spots a missing one", async () => {
    const bin = await mkdtemp(join(tmpdir(), "sahkarmi-mcp-bin-"));
    try {
      await mkdir(join(bin, "tools"));
      await writeFile(join(bin, "npx.cmd"), "@echo off");
      await writeFile(join(bin, "tools", "server.exe"), "");
      const env = { PATH: bin, PATHEXT: ".EXE;.CMD" };
      expect(commandExists("npx", env)).toBe(true);
      expect(commandExists("uvx", env)).toBe(false);
      expect(commandExists(join(bin, "tools", "server.exe"), env)).toBe(true);
      expect(commandExists(join(bin, "tools", "server"), env)).toBe(true);
      expect(commandExists(join(bin, "missing", "server.exe"), env)).toBe(false);
    } finally {
      await rm(bin, { recursive: true, force: true });
    }
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
      mcp_servers: { gh: { startup_timeout_sec: 20 } },
    });
    expect(codexMcpConfig([{ ...(servers[0] as McpServerWire), firstRun: true }])).toMatchObject({
      mcp_servers: { gh: { startup_timeout_sec: 60 } },
    });
    expect(codexMcpConfig(servers)).toMatchObject({
      mcp_servers: { web: { url: "https://w.test/mcp", http_headers: { A: "b" } } },
    });
  });
});

describe("cwd per runtime (MCP-4)", () => {
  const python = {
    name: "py",
    transport: "stdio" as const,
    command: "python",
    args: ["server.py"],
    env: {},
    url: "",
    headers: {},
    cwd: "C:\\srv",
  };

  it("passes cwd to Codex and makes paths absolute for Claude and ACP", () => {
    expect(codexMcpConfig([python])).toMatchObject({ mcp_servers: { py: { cwd: "C:\\srv" } } });
    expect(claudeMcpServers([python]).py).toMatchObject({
      args: [join("C:\\srv", "server.py")],
    });
    expect(claudeMcpServers([python]).py).not.toHaveProperty("cwd");
    expect(acpMcpServers([python], false)).toEqual([
      expect.objectContaining({ args: [join("C:\\srv", "server.py")] }),
    ]);
  });

  it("gives uv a --directory and python -m a PYTHONPATH", () => {
    expect(withoutCwd({ ...python, command: "uv", args: ["run", "weather"] }).args).toEqual([
      "--directory",
      "C:\\srv",
      "run",
      "weather",
    ]);
    expect(withoutCwd({ ...python, args: ["-m", "my_server"] }).env.PYTHONPATH).toBe("C:\\srv");
  });

  it("carries cwd and first-run through thread params", () => {
    expect(
      readCustomMcpServers({ customMcpServers: [{ ...python, firstRun: true }] })[0],
    ).toMatchObject({ cwd: "C:\\srv", firstRun: true });
  });
});
