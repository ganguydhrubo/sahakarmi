import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerInput } from "../../shared/ipc";

/**
 * A thin MCP adapter for a project that is not an MCP server but runs a local web API (audit
 * §10.6 option B). Sahkarmi writes a small dependency-free script that speaks MCP on stdio and
 * forwards each tool call to the project's API on this PC only (127.0.0.1 / localhost). It runs on
 * Sahkarmi's own Node (Electron with ELECTRON_RUN_AS_NODE=1), so nothing else is installed.
 */

export interface AdapterTool {
  name: string;
  description: string;
  method: "GET" | "POST";
  /** Path with {param} parts filled from the arguments, e.g. /api/v1/tasks/{task_id}. */
  path: string;
  inputSchema: Record<string, unknown>;
}

export interface AdapterSpec {
  title: string;
  baseUrl: string;
  tools: AdapterTool[];
  /** Free text shown to the AI with the tools. */
  instructions: string;
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;

export function isLoopbackBase(url: string): boolean {
  return LOOPBACK.test(url.replace(/\/+$/, ""));
}

/** MoneyPrinterTurbo's own API (python main.py → http://127.0.0.1:8080, /api/v1). */
export function moneyPrinterTurboSpec(baseUrl = "http://127.0.0.1:8080"): AdapterSpec {
  return {
    title: "MoneyPrinterTurbo",
    baseUrl,
    instructions:
      "Needs MoneyPrinterTurbo's API running on this PC (python main.py in its folder). create_video starts a render and returns a task id; poll get_task until it finishes. Rendering takes minutes; start one at a time.",
    tools: [
      {
        name: "create_video",
        description:
          "Start making a short video about a subject. Returns a task id. Optional: video_script (exact narration), video_language (e.g. en-US), video_aspect (9:16 or 16:9), paragraph_number.",
        method: "POST",
        path: "/api/v1/videos",
        inputSchema: {
          type: "object",
          properties: {
            video_subject: { type: "string" },
            video_script: { type: "string" },
            video_language: { type: "string" },
            video_aspect: { type: "string", enum: ["9:16", "16:9", "1:1"] },
            paragraph_number: { type: "integer", minimum: 1, maximum: 10 },
          },
          required: ["video_subject"],
        },
      },
      {
        name: "get_task",
        description: "Progress and result files of a video task.",
        method: "GET",
        path: "/api/v1/tasks/{task_id}",
        inputSchema: {
          type: "object",
          properties: { task_id: { type: "string" } },
          required: ["task_id"],
        },
      },
    ],
  };
}

/** Any other local API: one careful tool that calls a path on the base address. */
export function genericApiSpec(title: string, baseUrl: string): AdapterSpec {
  return {
    title,
    baseUrl,
    instructions: `Calls ${title}'s web API on this PC. Start the project's API server first. Read its documentation (often /docs) before calling other paths.`,
    tools: [
      {
        name: "call_api",
        description: `Call ${title}'s local web API. path starts with / (for example /docs or /api/v1/...). body is JSON for POST.`,
        method: "POST",
        path: "",
        inputSchema: {
          type: "object",
          properties: {
            method: { type: "string", enum: ["GET", "POST"] },
            path: { type: "string" },
            body: { type: "object" },
          },
          required: ["method", "path"],
        },
      },
    ],
  };
}

/** The adapter script: plain JavaScript, no packages, newline-delimited JSON-RPC on stdio. */
export function adapterScript(spec: AdapterSpec): string {
  if (!isLoopbackBase(spec.baseUrl))
    throw new Error("The adapter only calls APIs on this PC (127.0.0.1).");
  const config = JSON.stringify({ ...spec, baseUrl: spec.baseUrl.replace(/\/+$/, "") });
  return `// Written by Sahkarmi: MCP adapter for ${spec.title.replace(/[^\w .-]/g, "")}'s local web API.
// It only calls the base address below (this PC), never the internet.
import { createInterface } from "node:readline";

const SPEC = ${config};
const BASE = process.env.API_BASE_URL && /^http:\\/\\/(127\\.0\\.0\\.1|localhost)(:\\d{1,5})?\\/?$/.test(process.env.API_BASE_URL)
  ? process.env.API_BASE_URL.replace(/\\/+$/, "")
  : SPEC.baseUrl;

const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const text = (value, isError = false) => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

async function call(tool, args) {
  let method = tool.method;
  let path = tool.path;
  let body = args;
  if (tool.name === "call_api" && !tool.path) {
    method = args.method === "POST" ? "POST" : "GET";
    path = String(args.path ?? "");
    body = args.body ?? {};
    if (!path.startsWith("/") || path.includes("//") || path.includes("://") || path.includes("..")) {
      return text("path must start with / and stay on this API.", true);
    }
  } else {
    body = { ...args };
    path = path.replace(/\\{(\\w+)\\}/g, (_, key) => {
      const value = body[key];
      delete body[key];
      return encodeURIComponent(String(value ?? ""));
    });
  }
  try {
    const response = await fetch(BASE + path, {
      method,
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      body: method === "POST" ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    const reply = (await response.text()).slice(0, 20000);
    return text(\`HTTP \${response.status}\\n\${reply}\`, !response.ok);
  } catch (error) {
    return text(\`Could not reach \${BASE}: \${error?.message ?? error}. Is the project's API running?\`, true);
  }
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined || message.id === null) return;
  const reply = (result) => send({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "sahkarmi-adapter", version: "1.0.0" },
        instructions: SPEC.instructions,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: SPEC.tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = SPEC.tools.find((entry) => entry.name === message.params?.name);
      if (!tool) return send({ jsonrpc: "2.0", id: message.id, error: { code: -32602, message: "Unknown tool" } });
      return reply(await call(tool, message.params?.arguments ?? {}));
    }
    default:
      return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  }
});
`;
}

/** Writes the adapter into `folder` and returns the server to save (switched off, then tested). */
export async function writeAdapter(
  folder: string,
  name: string,
  spec: AdapterSpec,
  nodeExecutable: string,
): Promise<McpServerInput> {
  const script = adapterScript(spec);
  await mkdir(folder, { recursive: true });
  const path = join(folder, "adapter.mjs");
  await writeFile(path, script, "utf8");
  return {
    name,
    transport: "stdio",
    command: nodeExecutable,
    args: [path],
    env: { ELECTRON_RUN_AS_NODE: "1", API_BASE_URL: spec.baseUrl },
  };
}
