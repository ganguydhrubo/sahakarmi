import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  acpMcpServers,
  claudeMcpServers,
  codexMcpConfig,
  McpServerStore,
  readCustomMcpServers,
} from "../mcp-servers";
import { type SharedLaunch, SharedMcpBridge } from "./shared-bridge";

const FIXTURE = join(__dirname, "__fixtures__", "servers", "fixture-server.mjs");
const GOOD: SharedLaunch = {
  command: process.execPath,
  args: [FIXTURE, "good"],
  env: { FIXTURE_TAG: "shared" },
};

const bridges: SharedMcpBridge[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function bridge(resolve: (id: string) => SharedLaunch | null, idleMs?: number) {
  const created = new SharedMcpBridge(resolve, idleMs === undefined ? {} : { idleMs });
  bridges.push(created);
  return created;
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("shared mode bridge (MCP-7)", () => {
  it("starts the server once on first use and serves every coworker through one copy", async () => {
    const subject = bridge((id) => (id === "srv" ? GOOD : null));
    expect(subject.urlFor("srv")).toBeNull();
    await subject.listen();
    const url = subject.urlFor("srv") as string;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/[0-9a-f]{48}\/srv$/);
    expect(subject.runningIds()).toEqual([]);

    const first = await connect(url);
    const second = await connect(url);
    const tools = await first.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["echo", "where"]);
    expect(tools.tools[1]?.description).toContain("tag=shared");
    const reply = await second.callTool({ name: "echo", arguments: { text: "hi" } });
    expect(reply.content).toEqual([{ type: "text", text: '{"text":"hi"}' }]);
    expect(subject.runningIds()).toEqual(["srv"]);
    await first.close();
    await second.close();
  });

  it("refuses a wrong token or an unknown server", async () => {
    const subject = bridge(() => GOOD);
    await subject.listen();
    const url = subject.urlFor("srv") as string;
    const wrong = url.replace(/[0-9a-f]{48}/, "0".repeat(48));
    expect((await fetch(wrong, { method: "POST", body: "{}" })).status).toBe(404);
    const none = bridge(() => null);
    await none.listen();
    expect((await fetch(none.urlFor("x") as string, { method: "POST", body: "{}" })).status).toBe(
      404,
    );
  });

  it("stops a server that has been idle", async () => {
    const subject = bridge(() => GOOD, 50);
    await subject.listen();
    const client = await connect(subject.urlFor("srv") as string);
    await client.listTools();
    expect(subject.runningIds()).toEqual(["srv"]);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(subject.runningIds()).toEqual([]);
    // The next call starts it again.
    await client.listTools();
    expect(subject.runningIds()).toEqual(["srv"]);
    await client.close();
  });
});

describe("shared mode in the store", () => {
  it("hands runtimes the bridge address instead of starting their own copy", async () => {
    const folder = await mkdtemp(join(tmpdir(), "sahkarmi-mcp-shared-"));
    folders.push(folder);
    const store = new McpServerStore(folder);
    store.setFeatureCheck((id) => id !== "mcp-test-first");
    await store.load();
    const [saved] = await store.save({
      name: "video",
      transport: "stdio",
      command: process.execPath,
      args: [FIXTURE],
    });
    const id = saved?.id as string;
    const subject = bridge((serverId) => store.sharedLaunch(serverId));
    store.setSharedBridge(subject);
    await subject.listen();

    expect(store.enabled()[0]?.sharedUrl).toBeUndefined();
    const list = await store.setShared(id, true);
    expect(list[0]?.shared).toBe(true);
    const wire = store.enabled();
    const url = subject.urlFor(id) as string;
    expect(wire[0]?.sharedUrl).toBe(url);
    // The address survives the trip to the runtime processes.
    expect(readCustomMcpServers({ customMcpServers: wire })[0]?.sharedUrl).toBe(url);
    expect(claudeMcpServers(wire).video).toEqual({ type: "http", url, headers: {} });
    expect(codexMcpConfig(wire)).toEqual({ mcp_servers: { video: { url } } });
    expect(acpMcpServers(wire, true)).toEqual([{ type: "http", name: "video", url, headers: [] }]);
    // An agent without HTTP support still gets its own copy.
    expect(acpMcpServers(wire, false)[0]).toMatchObject({
      name: "video",
      command: process.execPath,
    });
    expect(store.sharedLaunch(id)?.command).toBe(process.execPath);

    await store.setShared(id, false);
    expect(store.enabled()[0]?.sharedUrl).toBeUndefined();
    expect(store.sharedLaunch(id)).toBeNull();
    // Flag off: never shared.
    await store.setShared(id, true);
    store.setFeatureCheck(
      (feature) => feature !== "mcp-shared-mode" && feature !== "mcp-test-first",
    );
    expect(store.enabled()[0]?.sharedUrl).toBeUndefined();
  });
});
