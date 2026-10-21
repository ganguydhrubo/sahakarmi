// @vitest-environment node

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readModelOptions, stripLeakedToolCalls } from "./acp-client";
import { geminiModelValue, openCodeModelValue, readGeminiAccount } from "./acp-providers";
import { AgentService } from "./agent-service";
import { ApprovalStore } from "./approval-store";
import { BotStore } from "./bot-store";
import type { BrowserHost } from "./browser-host";
import { MailboxStore } from "./mailbox-store";
import { PermissionService } from "./permission-service";

let root: string;
let service: AgentService | null = null;
const savedEnv = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-acp-test-"));
  process.env.SAHKARMI_CODEX_PATH = join(root, "missing-codex");
  process.env.SAHKARMI_CLAUDE_PATH = join(root, "missing-claude");
  process.env.SAHKARMI_GEMINI_PATH = join(root, "missing-gemini");
  process.env.SAHKARMI_OPENCODE_PATH = await createFakeAcpAgent(root);
  process.env.SAHKARMI_FAKE_ACP_LOG = join(root, "acp.jsonl");
});

afterEach(async () => {
  await service?.stop();
  service = null;
  process.env = { ...savedEnv };
  await rm(root, { recursive: true, force: true });
});

describe.sequential("ACP providers (bundled OpenCode)", () => {
  it("runs the default team on the bundled free model when no other AI is installed", async () => {
    const store = new BotStore(join(root, "user-data"), join(root, "home"));
    const mailbox = new MailboxStore(join(root, "user-data"), store.sharedRoot);
    const approvals = new ApprovalStore(join(root, "user-data"));
    service = new AgentService(store, mailbox, fakeBrowser(), null, 30_000, "codex", approvals);
    await service.initialize();

    expect(service.listModels()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "opencode:anthropic/x", name: "X" })]),
    );
    await service.updateBot({ botId: "asha-accounts", model: "opencode:anthropic/x" });
    const reloaded = new BotStore(join(root, "user-data"), join(root, "home"));
    await reloaded.initialize();
    expect(reloaded.list().find((bot) => bot.id === "asha-accounts")?.model).toBe(
      "opencode:anthropic/x",
    );
    await service.updateBot({ botId: "asha-accounts", model: "opencode-free" });
    const status = service.getStatus();
    expect(status.phase).toBe("ready");
    expect(status.auth).toEqual({ kind: "opencode", email: null });
    expect(status.providers?.find((provider) => provider.id === "opencode")).toMatchObject({
      state: "available",
      version: "1.19.3",
    });
    expect(status.providers?.find((provider) => provider.id === "codex")?.state).toBe(
      "not-installed",
    );
    // Untouched default coworkers moved to the free OpenCode model.
    expect(new Set(service.listBots().map((bot) => bot.model))).toEqual(new Set(["opencode-free"]));
    expect((await service.createBot()).model).toBe("opencode-free");

    await service.sendMessage({ botId: "asha-accounts", text: "Pay Sharma Traders, use tool" });

    await waitFor(async () => {
      const snapshot = await service?.readConversation("asha-accounts");
      return snapshot?.messages.some(
        (message) => message.author === "assistant" && message.text.includes("Namaste"),
      );
    });
    // The agent reached Sahkarmi's approval tool through the loopback MCP bridge.
    await waitFor(() => service?.listApprovals().length === 1);
    expect(service.listApprovals()[0]).toMatchObject({
      botId: "asha-accounts",
      title: "Pay Sharma Traders",
      category: "payment",
    });
    await waitFor(async () =>
      (await service?.readConversation("asha-accounts"))?.messages.some(
        (message) => message.tool?.status === "completed",
      ),
    );
    const snapshot = await service.readConversation("asha-accounts");
    expect(snapshot.messages.find((message) => message.tool)?.tool).toMatchObject({
      name: "Read invoices.csv",
      status: "completed",
      output: "3 invoices",
    });

    // The free model was selected and the standing instructions were sent once.
    const log = await readLog();
    expect(log).toContainEqual(
      expect.objectContaining({
        method: "session/set_config_option",
        params: expect.objectContaining({ configId: "model", value: "opencode/big-pickle" }),
      }),
    );
    const prompt = log.find((entry) => entry.method === "session/prompt");
    expect(JSON.stringify(prompt)).toContain("sahkarmi_coworker_instructions");
    // Sahkarmi answers each call itself and never hands the agent a standing "always allow".
    expect(log).toContainEqual({ method: "permission-answered", optionId: "once" });
  });

  it("declines an ACP tool call that the owner's permission policy denies", async () => {
    const store = new BotStore(join(root, "user-data"), join(root, "home"));
    const mailbox = new MailboxStore(join(root, "user-data"), store.sharedRoot);
    const approvals = new ApprovalStore(join(root, "user-data"));
    const permissions = new PermissionService(join(root, "user-data"));
    await permissions.initialize();
    await permissions.setLevel("file_read", "deny");
    service = new AgentService(
      store,
      mailbox,
      fakeBrowser(),
      null,
      30_000,
      "codex",
      approvals,
      permissions,
    );
    await service.initialize();
    await service.sendMessage({ botId: "asha-accounts", text: "Pay Sharma Traders, use tool" });
    await waitFor(async () =>
      (await readLog()).some((entry) => entry.method === "permission-answered"),
    );
    expect(await readLog()).toContainEqual({ method: "permission-answered", optionId: "deny" });
    expect(permissions.audit()[0]).toMatchObject({
      provider: "opencode",
      category: "file_read",
      decision: "denied",
      botId: "asha-accounts",
    });
  });

  it("moves the never-run team to the provider chosen in setup even when another AI is connected", async () => {
    // Gemini CLI (same fake ACP agent, API-key login) and OpenCode are both connected.
    process.env.SAHKARMI_GEMINI_PATH = process.env.SAHKARMI_OPENCODE_PATH;
    process.env.GEMINI_API_KEY = "test-key";
    const store = new BotStore(join(root, "user-data"), join(root, "home"));
    const mailbox = new MailboxStore(join(root, "user-data"), store.sharedRoot);
    service = new AgentService(store, mailbox, fakeBrowser(), null, 30_000, "codex");
    await service.initialize();
    expect(service.getStatus().phase).toBe("ready");
    expect(service.getStatus().providers?.find((p) => p.id === "gemini")?.state).toBe("available");
    // Codex (the stale preference) is missing, so the team landed on the first connected AI.
    expect(new Set(service.listBots().map((bot) => bot.model))).toEqual(new Set(["gemini-auto"]));

    // The owner picks "OpenCode (free, built in)" on the setup screen.
    await service.setPreferredProvider("opencode");
    expect(new Set(service.listBots().map((bot) => bot.model))).toEqual(new Set(["opencode-free"]));
    expect(service.getStatus().auth).toEqual({ kind: "opencode", email: null });
    expect((await service.createBot()).model).toBe("opencode-free");

    // A coworker the owner already pointed somewhere else, or that has run, is left alone.
    await service.updateBot({ botId: "asha-accounts", model: "gemini-flash" });
    await service.setPreferredProvider("gemini");
    await service.setPreferredProvider("opencode");
    expect(service.listBots().find((bot) => bot.id === "asha-accounts")?.model).toBe(
      "opencode-free",
    );
  });

  it("keeps the conversation after a restart from Sahkarmi's own transcript", async () => {
    const store = new BotStore(join(root, "user-data"), join(root, "home"));
    const mailbox = new MailboxStore(join(root, "user-data"), store.sharedRoot);
    service = new AgentService(store, mailbox, fakeBrowser(), null, 30_000, "opencode");
    await service.initialize();
    await service.sendMessage({ botId: "meera-support", text: "Hello" });
    await waitFor(async () =>
      (await service?.readConversation("meera-support"))?.messages.some((message) =>
        message.text.includes("Namaste"),
      ),
    );
    await waitFor(() =>
      service
        ?.listQueue("meera-support")
        .deliveries.every((delivery) => delivery.status === "completed"),
    );
    await service.stop();

    const restoredStore = new BotStore(join(root, "user-data"), join(root, "home"));
    const restoredMailbox = new MailboxStore(join(root, "user-data"), restoredStore.sharedRoot);
    service = new AgentService(
      restoredStore,
      restoredMailbox,
      fakeBrowser(),
      null,
      30_000,
      "opencode",
    );
    await service.initialize();
    const messages = (await service.readConversation("meera-support")).messages;
    // The user message, the tool card and the reply all survive a restart.
    expect(messages.map((message) => (message.tool ? "tool" : message.author))).toEqual([
      "user",
      "tool",
      "assistant",
    ]);
    expect(messages[2]?.text).toBe("Namaste! Done.");
  });
});

describe("provider helpers", () => {
  it("reads grouped ACP models without dropping provider IDs", () => {
    expect(
      readModelOptions({
        configOptions: [
          {
            id: "model",
            options: [
              { group: "Free", options: [{ value: "opencode/beam-free", name: "Beam Free" }] },
              { value: "anthropic/paid", name: "Account model" },
            ],
          },
        ],
      }),
    ).toEqual([
      { value: "opencode/beam-free", name: "Beam Free" },
      { value: "anthropic/paid", name: "Account model" },
    ]);
  });
  it("strips a tool call that a free model echoed as text", () => {
    const leaked =
      "I'll request approval first. ​type=tool_call tool=functions.sahkarmi_request_approval<|func_arg_name|>title<|func_arg_value|>Pay ₹10<|func_arg_name|>category<|func_arg_value|>payment<|func_arg_end|>";
    expect(stripLeakedToolCalls(leaked)).toBe("I'll request approval first.");
    expect(stripLeakedToolCalls("Plain reply with <b>html</b>")).toBe(
      "Plain reply with <b>html</b>",
    );
  });

  it("maps Sahkarmi model ids onto the agent's model list", () => {
    const options = [
      { value: "opencode/big-pickle", name: "Big Pickle" },
      { value: "opencode/glm-free", name: "GLM" },
    ];
    expect(openCodeModelValue("opencode-free", options)).toBe("opencode/big-pickle");
    expect(openCodeModelValue("opencode-free", [options[1] ?? options[0]])).toBe(
      "opencode/glm-free",
    );
    expect(openCodeModelValue("opencode-default", options)).toBeNull();
    expect(openCodeModelValue("opencode:opencode/glm-free", options)).toBe("opencode/glm-free");
    const gemini = [
      { value: "auto", name: "Auto" },
      { value: "gemini-3-pro", name: "Pro" },
      { value: "gemini-3-flash-lite", name: "Lite" },
      { value: "gemini-3-flash", name: "Flash" },
    ];
    expect(geminiModelValue("gemini:gemini-3-flash", gemini)).toBe("gemini-3-flash");
    expect(geminiModelValue("gemini-auto", gemini)).toBe("auto");
    expect(geminiModelValue("gemini-pro", gemini)).toBe("gemini-3-pro");
    expect(geminiModelValue("gemini-flash", gemini)).toBe("gemini-3-flash");
  });

  it("detects an existing Gemini CLI login without copying it", async () => {
    const home = join(root, "gemini-home");
    expect((await readGeminiAccount(home, {})).account).toBeNull();
    expect((await readGeminiAccount(home, { GEMINI_API_KEY: "x" })).account).toEqual({
      type: "gemini",
      email: null,
    });
    await import("node:fs/promises").then(async ({ mkdir }) => {
      await mkdir(join(home, ".gemini"), { recursive: true });
      await writeFile(join(home, ".gemini", "oauth_creds.json"), "{}");
      await writeFile(
        join(home, ".gemini", "google_accounts.json"),
        JSON.stringify({ active: "owner@example.in" }),
      );
    });
    expect((await readGeminiAccount(home, {})).account).toEqual({
      type: "gemini",
      email: "owner@example.in",
    });
  });
});

function fakeBrowser(): BrowserHost {
  return {
    onChanged: () => () => undefined,
    onControlChanged: () => () => undefined,
    clearControls: () => undefined,
    endControl: () => undefined,
    handleDynamicTool: async () => ({ success: true, contentItems: [] }),
  } as unknown as BrowserHost;
}

async function readLog(): Promise<Array<Record<string, unknown>>> {
  const { readFile } = await import("node:fs/promises");
  try {
    return (await readFile(process.env.SAHKARMI_FAKE_ACP_LOG ?? "", "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function waitFor(check: () => unknown): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the fake ACP agent.");
}

/** A minimal ACP agent that behaves like OpenCode, including calling Sahkarmi's MCP tools. */
async function createFakeAcpAgent(directory: string): Promise<string> {
  const scriptPath = join(directory, "opencode.js");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
if (process.argv.includes("--version")) { process.stdout.write("1.19.3\\n"); process.exit(0); }
const log = (entry) => fs.appendFileSync(process.env.SAHKARMI_FAKE_ACP_LOG, JSON.stringify(entry) + "\\n");
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
let buffer = "";
let mcp = null;
let nextId = 1000;
const waiting = new Map();
const update = (sessionId, update) => write({ method: "session/update", params: { sessionId, update } });
async function mcpCall(method, params) {
  const response = await fetch(mcp.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) });
  return response.json();
}
async function handle(message) {
  log(message);
  if (message.id !== undefined && !message.method) { const resolve = waiting.get(message.id); waiting.delete(message.id); resolve?.(message); return; }
  const { id, method, params } = message;
  if (method === "initialize") return write({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, mcpCapabilities: { http: true } } } });
  if (method === "session/new") {
    mcp = params.mcpServers.find((server) => server.name === "sahkarmi") ?? null;
    return write({ id, result: { sessionId: "ses_" + Date.now(), configOptions: [{ id: "model", category: "model", type: "select", currentValue: "anthropic/x", options: [{ value: "opencode/big-pickle", name: "Big Pickle" }, { value: "anthropic/x", name: "X" }] }] } });
  }
  if (method === "session/set_config_option") return write({ id, result: {} });
  if (method === "session/cancel") return;
  if (method === "session/prompt") {
    const text = params.prompt.map((part) => part.text || "").join(" ");
    const sessionId = params.sessionId;
    update(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking about it" } });
    update(sessionId, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read invoices.csv", kind: "read", status: "pending", rawInput: { path: "invoices.csv" } });
    const permission = await new Promise((resolve) => { const reqId = nextId++; waiting.set(reqId, resolve); write({ id: reqId, method: "session/request_permission", params: { sessionId, toolCall: { toolCallId: "t1", kind: "read", title: "Read invoices.csv", locations: [{ path: "invoices.csv" }] }, options: [{ optionId: "deny", kind: "reject_once", name: "No" }, { optionId: "once", kind: "allow_once", name: "Yes" }, { optionId: "always", kind: "allow_always", name: "Always" }] } }); });
    log({ method: "permission-answered", optionId: permission.result?.outcome?.optionId });
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: { type: "text", text: "3 invoices" } }] });
    if (text.includes("use tool") && mcp) {
      await mcpCall("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "fake" } });
      const tools = await mcpCall("tools/list", {});
      log({ method: "mcp-tools", tools: tools.result.tools.map((tool) => tool.name) });
      const result = await mcpCall("tools/call", { name: "request_approval", arguments: { title: "Pay Sharma Traders", details: "INV-482", category: "payment", amount: "₹18,500" } });
      log({ method: "mcp-result", result });
    }
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Namaste! " } });
    update(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } });
    return write({ id, result: { stopReason: "end_turn" } });
  }
  if (id !== undefined) write({ id, error: { code: -32601, message: "unknown " + method } });
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (line) void handle(JSON.parse(line));
  }
});
`,
  );
  if (process.platform === "win32") {
    const cmdPath = join(directory, "opencode.cmd");
    await writeFile(cmdPath, `@node "%~dp0opencode.js" %*\r\n`);
    return cmdPath;
  }
  await chmod(scriptPath, 0o755);
  return scriptPath;
}
