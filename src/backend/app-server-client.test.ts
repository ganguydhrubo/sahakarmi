// @vitest-environment node

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAppServerClient, codexLaunch, npmNativeCodex } from "./app-server-client";

const temporaryRoots: string[] = [];
const clients: CodexAppServerClient[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.stop()));
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe("CodexAppServerClient", () => {
  it("matches responses and receives notifications over stdio", async () => {
    const executable = await createFakeCodex();
    const client = createClient(executable, 5_000);
    const notifications: string[] = [];
    client.on("notification", (notification) => notifications.push(notification.method));
    client.start();

    const result = await client.request<{ echoed: string }>("test/echo", { text: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result).toEqual({ echoed: "hello" });
    expect(notifications).toContain("test/notification");
  });

  it("rejects timed out requests", async () => {
    const executable = await createFakeCodex();
    const client = createClient(executable, 30);
    client.start();

    await expect(client.request("test/timeout", {})).rejects.toThrow("timed out");
  });

  it("surfaces RPC errors with their code", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    client.start();

    await expect(client.request("test/error", {})).rejects.toMatchObject({
      name: "AppServerError",
      code: 412,
      message: "Fake RPC failure",
    });
  });

  it("resets fragmented JSON state when restarted after a process crash", async () => {
    const client = createClient(await createFakeCodex(), 5_000);
    client.start();
    await expect(client.request("test/partial-exit", {})).rejects.toThrow("exited");

    client.start();
    await expect(client.request("test/echo", { text: "after restart" })).resolves.toEqual({
      echoed: "after restart",
    });
  });
});

describe("Codex launch without a shell", () => {
  it("starts from a folder with spaces and skips stray non-JSON lines", async () => {
    const executable = await createFakeCodex("Program Files (x86) & co");
    const client = createClient(executable, 5_000);
    const diagnostics: string[] = [];
    client.on("diagnostic", (message) => diagnostics.push(message));
    client.start();

    await expect(client.request("test/noise", {})).resolves.toEqual({ after: "noise" });
    expect(diagnostics.some((line) => line.includes("Skipped a non-JSON line"))).toBe(true);
    expect(client.running).toBe(true);
  });

  it.runIf(process.platform === "win32")(
    "ends the whole process tree on stop, ten times in a row",
    async () => {
      const executable = await createFakeCodex();
      for (let round = 0; round < 10; round += 1) {
        const client = createClient(executable, 5_000);
        client.start();
        const { pid } = await client.request<{ pid: number }>("test/spawn-child", {});
        expect(isAlive(pid)).toBe(true);
        await client.stop();
        await waitFor(() => !isAlive(pid));
        expect(isAlive(pid)).toBe(false);
      }
    },
    60_000,
  );

  it("starts the native codex.exe behind an npm shim directly", async () => {
    const root = await mkdtemp(join(tmpdir(), "sahkarmi npm shim "));
    temporaryRoots.push(root);
    const bin = join(
      root,
      "node_modules",
      "@openai",
      "codex",
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "bin",
    );
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "codex.exe"), "");
    const shim = join(root, "codex.cmd");

    expect(npmNativeCodex(shim, "x64")?.executable).toBe(join(bin, "codex.exe"));
    const launch = codexLaunch(shim, ["app-server"], "win32", {});
    expect(launch).toMatchObject({ command: join(bin, "codex.exe"), args: ["app-server"] });
    expect(launch.env.CODEX_MANAGED_BY_NPM).toBe("1");
  });

  it("quotes a script path for cmd.exe when no native exe is found", () => {
    const launch = codexLaunch("C:\\Tools dir\\codex.cmd", ["app-server"], "win32", {});
    expect(launch.command).toBe("cmd.exe");
    expect(launch.verbatim).toBe(true);
    expect(launch.args.at(-1)).toBe('""C:\\Tools dir\\codex.cmd" "app-server""');
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!check() && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function createClient(executable: string, timeout: number): CodexAppServerClient {
  const client = new CodexAppServerClient(executable, timeout);
  clients.push(client);
  return client;
}

async function createFakeCodex(subfolder = ""): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "sahkarmi-fake-codex-"));
  temporaryRoots.push(base);
  const root = subfolder ? join(base, subfolder) : base;
  await mkdir(root, { recursive: true });
  const scriptPath = join(root, "codex.js");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line) {
      const message = JSON.parse(line);
      if (message.method === "test/echo") {
        const response = JSON.stringify({ id: message.id, result: { echoed: message.params.text } }) + "\\n";
        const middle = Math.floor(response.length / 2);
        process.stdout.write(response.slice(0, middle));
        process.stdout.write(response.slice(middle));
        process.stdout.write(JSON.stringify({ method: "test/notification", params: {} }) + "\\n");
      } else if (message.method === "test/error") {
        process.stdout.write(JSON.stringify({ id: message.id, error: { code: 412, message: "Fake RPC failure" } }) + "\\n");
      } else if (message.method === "test/noise") {
        process.stdout.write("WARN codex: a log line on stdout\\n");
        process.stdout.write(JSON.stringify({ id: message.id, result: { after: "noise" } }) + "\\n");
      } else if (message.method === "test/spawn-child") {
        const child = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
        process.stdout.write(JSON.stringify({ id: message.id, result: { pid: child.pid } }) + "\\n");
      } else if (message.method === "test/partial-exit") {
        process.stdout.write('{"id":');
        process.exit(9);
      }
    }
    newline = buffer.indexOf("\\n");
  }
});
`,
    { mode: 0o700 },
  );
  if (process.platform === "win32") {
    const cmdPath = join(root, "codex.cmd");
    await writeFile(cmdPath, `@node "%~dp0codex.js" %*\r\n`);
    return cmdPath;
  }
  await chmod(scriptPath, 0o700);
  return scriptPath;
}
