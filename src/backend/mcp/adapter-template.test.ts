import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  adapterScript,
  genericApiSpec,
  isLoopbackBase,
  moneyPrinterTurboSpec,
  writeAdapter,
} from "./adapter-template";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** A stand-in for MoneyPrinterTurbo's API. */
async function fakeApi(): Promise<{ base: string; seen: string[] }> {
  const seen: string[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      seen.push(`${request.method} ${request.url} ${body}`);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: 200, data: { task_id: "t-1" } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

async function start(spec: Parameters<typeof writeAdapter>[2]): Promise<Client> {
  const folder = await mkdtemp(join(tmpdir(), "sahkarmi-adapter-"));
  cleanup.push(() => rm(folder, { recursive: true, force: true }));
  const server = await writeAdapter(folder, "mpt", spec, process.execPath);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: server.command ?? "",
      args: server.args ?? [],
      env: server.env ?? {},
    }),
  );
  cleanup.push(() => client.close());
  return client;
}

describe("HTTP API adapter template", () => {
  it("only talks to this PC", () => {
    expect(isLoopbackBase("http://127.0.0.1:8080")).toBe(true);
    expect(isLoopbackBase("http://localhost:8501/")).toBe(true);
    expect(isLoopbackBase("https://api.example.com")).toBe(false);
    expect(isLoopbackBase("http://127.0.0.1.evil.test")).toBe(false);
    expect(() => adapterScript(moneyPrinterTurboSpec("http://10.0.0.5:8080"))).toThrow(/this PC/);
  });

  it("MoneyPrinterTurbo preset: lists its tools and forwards a call to the local API", async () => {
    const api = await fakeApi();
    const client = await start(moneyPrinterTurboSpec(api.base));
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["create_video", "get_task"]);
    const created = await client.callTool({
      name: "create_video",
      arguments: { video_subject: "rain" },
    });
    expect(JSON.stringify(created.content)).toContain("t-1");
    await client.callTool({ name: "get_task", arguments: { task_id: "t 1" } });
    expect(api.seen).toEqual([
      'POST /api/v1/videos {"video_subject":"rain"}',
      "GET /api/v1/tasks/t%201 ",
    ]);
  });

  it("generic preset refuses paths that leave the API", async () => {
    const api = await fakeApi();
    const client = await start(genericApiSpec("demo", api.base));
    const bad = await client.callTool({
      name: "call_api",
      arguments: { method: "GET", path: "http://x.test/" },
    });
    expect(bad.isError).toBe(true);
    const ok = await client.callTool({
      name: "call_api",
      arguments: { method: "GET", path: "/docs" },
    });
    expect(ok.isError).toBeFalsy();
    expect(api.seen).toEqual(["GET /docs "]);
  });
});
