// A tiny MCP stdio server for tests. Its behaviour comes from the first argument:
//   good   answers initialize and tools/list
//   slow   waits (second argument, ms) before answering
//   noisy  prints a log line on stdout first (a common server mistake)
//   crash  prints a Python-style import error and exits 1
//   http   behaves like a web app: logs a URL, opens a port, never answers
import { createServer } from "node:http";
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "good";
const delay = Number(process.argv[3] ?? "0");

if (mode === "crash") {
  process.stderr.write(
    "Traceback (most recent call last):\nModuleNotFoundError: No module named 'mcp'\n",
  );
  process.exit(1);
}

if (mode === "http") {
  const server = createServer((_request, response) => response.end("ok"));
  server.listen(0, "127.0.0.1", () => {
    process.stderr.write(
      `INFO:     Uvicorn running on http://127.0.0.1:${server.address().port}\n`,
    );
  });
} else {
  if (mode === "noisy") process.stdout.write("Starting weather server...\n");
  const tools = [
    { name: "echo", description: "Repeats the text", inputSchema: { type: "object" } },
    {
      name: "where",
      description: `cwd=${process.cwd()} tag=${process.env.FIXTURE_TAG ?? ""} path=${process.env.PATH ? "yes" : "no"} key=${process.env.OPENAI_API_KEY ? "leaked" : "none"}`,
      inputSchema: { type: "object" },
    },
  ];
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined) return;
    const reply = () => {
      if (message.method === "initialize") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fixture", version: "1.0.0" },
          },
        });
      } else if (message.method === "tools/list") {
        send({ jsonrpc: "2.0", id: message.id, result: { tools } });
      } else if (message.method === "tools/call") {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            content: [{ type: "text", text: JSON.stringify(message.params?.arguments ?? {}) }],
          },
        });
      } else {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
      }
    };
    if (mode === "slow" && message.method === "initialize") setTimeout(reply, delay);
    else reply();
  });
}
