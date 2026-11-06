// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { argumentPaths, serverProblems } from "./checks";
import { diagnose } from "./diagnose";
import { findPlaceholder, placeholderHits } from "./placeholders";
import {
  expandWindowsVariables,
  freshPath,
  isStorePythonStub,
  lookupCommand,
  mergePathLists,
  parseRegQuery,
  refreshFreshPath,
  resetFreshPathForTests,
  serverEnvironment,
} from "./windows-env";

const folders: string[] = [];
afterEach(async () => {
  resetFreshPathForTests();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function temp(prefix = "sahkarmi-mcp-p1-"): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
}

describe("placeholders (MCP-1)", () => {
  it.each([
    ["/ABSOLUTE/PATH/TO/money-printer-turbo", "/ABSOLUTE/PATH/TO/money-printer-turbo"],
    ["/ABSOLUTE/PATH/TO/PARENT/FOLDER/weather", "/ABSOLUTE/PATH/TO/PARENT/FOLDER/weather"],
    ["<dir_to>/mcp-obsidian", "<dir_to>"],
    ["<your_api_key_here>", "<your_api_key_here>"],
    ["YOUR_API_KEY", "YOUR_API_KEY"],
    ["path/to/server.py", "path/to/server.py"],
    ["C:\\path\\to\\server", "\\path\\to\\server"],
    ["Bearer {smithery_api_key}", "{smithery_api_key}"],
    ["$" + "{GITHUB_TOKEN}", "$" + "{GITHUB_TOKEN}"],
    ["xxxxxxxx", "xxxxxxxx"],
    ["...", "..."],
  ])("flags %s", (value, token) => {
    expect(findPlaceholder(value)).toBe(token);
  });

  it.each([
    "npx",
    "-y",
    "@modelcontextprotocol/server-github",
    "C:\\Users\\Dhrubo\\mcp\\server.py",
    "--directory",
    "ghp_realLookingToken123",
    "https://api.example.com/mcp",
    "mcp-server-time@2026.1.26",
  ])("accepts real value %s", (value) => {
    expect(findPlaceholder(value)).toBeNull();
  });

  it("names the field and key of each template value", () => {
    expect(
      placeholderHits({
        command: "uv",
        args: ["--directory", "/ABSOLUTE/PATH/TO/money-printer-turbo", "run", "python", "main.py"],
        env: { API_KEY: "<your_api_key_here>", HOST: "127.0.0.1" },
      }),
    ).toEqual([
      { field: "args", token: "/ABSOLUTE/PATH/TO/money-printer-turbo" },
      { field: "env", key: "API_KEY", token: "<your_api_key_here>" },
    ]);
  });
});

describe("fresh Windows PATH (MCP-3)", () => {
  it("merges machine, user and process PATH without repeats", () => {
    expect(mergePathLists("C:\\Windows;C:\\Tools\\", "C:\\Users\\me\\bin;c:\\tools", "D:\\x")).toBe(
      "C:\\Windows;C:\\Tools\\;C:\\Users\\me\\bin;D:\\x",
    );
  });

  it("reads reg.exe output and expands %VARIABLES%", () => {
    const output =
      "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\x\r\n\r\n";
    expect(parseRegQuery(output, { USERPROFILE: "C:\\Users\\me" })).toBe(
      "C:\\Users\\me\\.local\\bin;C:\\x",
    );
    expect(expandWindowsVariables("%missing%\\a", {})).toBe("%missing%\\a");
  });

  it("finds a program installed after start once the registry is re-read", async () => {
    const before = await temp();
    const installed = await temp();
    await writeFile(join(installed, "uv.exe"), "");
    const original = process.env.PATH;
    process.env.PATH = before;
    try {
      await refreshFreshPath(async () => ({ machine: "", user: "" }));
      expect(lookupCommand("uv", { PATH: freshPath(), PATHEXT: ".EXE" }).path).toBeNull();
      // The installer added its folder to the user Path in the registry.
      await refreshFreshPath(async () => ({ machine: "", user: installed }));
      expect(lookupCommand("uv", { PATH: freshPath(), PATHEXT: ".EXE" }).path).toBe(
        join(installed, "uv.exe"),
      );
    } finally {
      process.env.PATH = original;
    }
  });

  it("builds a server env with PATH and Windows basics but no provider keys (MCP-16)", () => {
    const env = serverEnvironment(
      { GITHUB_TOKEN: "t", Path: "C:\\own" },
      {
        SystemRoot: "C:\\Windows",
        PATHEXT: ".EXE",
        TEMP: "C:\\Temp",
        USERPROFILE: "C:\\Users\\me",
        APPDATA: "A",
        LOCALAPPDATA: "L",
        OPENAI_API_KEY: "sk-secret",
        ANTHROPIC_API_KEY: "secret",
      },
      "C:\\fresh",
    );
    expect(env).toMatchObject({
      SystemRoot: "C:\\Windows",
      PATHEXT: ".EXE",
      TEMP: "C:\\Temp",
      USERPROFILE: "C:\\Users\\me",
      APPDATA: "A",
      LOCALAPPDATA: "L",
      GITHUB_TOKEN: "t",
      PATH: "C:\\own;C:\\fresh",
    });
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("Path");
  });
});

describe("Store python stub (MCP-9)", () => {
  it("skips WindowsApps python.exe unless a Store Python is installed", async () => {
    const local = await temp();
    const apps = join(local, "Microsoft", "WindowsApps");
    const real = await temp();
    await mkdir(apps, { recursive: true });
    await writeFile(join(apps, "python.exe"), "");
    const env = { LOCALAPPDATA: local, PATHEXT: ".EXE" };
    expect(isStorePythonStub(join(apps, "python.exe"), env)).toBe(true);
    expect(lookupCommand("python", { ...env, PATH: apps })).toEqual({
      path: null,
      storeStub: true,
    });
    await writeFile(join(real, "python.exe"), "");
    expect(lookupCommand("python", { ...env, PATH: `${apps};${real}` }).path).toBe(
      join(real, "python.exe"),
    );
    await mkdir(join(apps, "PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0"));
    expect(isStorePythonStub(join(apps, "python.exe"), env)).toBe(false);
  });
});

describe("arg path checks and per-case problems (MCP-5, MCP-6)", () => {
  it("finds --directory folders and script files", () => {
    expect(argumentPaths(["--directory", "C:\\srv", "run", "main.py"])).toEqual({
      folders: ["C:\\srv"],
      files: [join("C:\\srv", "main.py")],
    });
    expect(argumentPaths(["dist/index.js"], "C:\\app").files).toEqual([
      join("C:\\app", "dist/index.js"),
    ]);
    expect(argumentPaths(["-y", "@scope/pkg"]).files).toEqual([]);
  });

  it("reports the MoneyPrinterTurbo template as a template, not as a missing uv", () => {
    const problems = serverProblems(
      {
        transport: "stdio",
        command: "uv",
        args: ["--directory", "/ABSOLUTE/PATH/TO/money-printer-turbo", "run", "python", "main.py"],
        env: {},
        url: "",
        headers: {},
      },
      { PATH: "", PATHEXT: ".EXE" },
    );
    expect(problems.map((problem) => problem.kind)).toEqual(["placeholder"]);
  });

  it("says which command, folder or file is missing, with a link and fix", async () => {
    const root = await temp();
    await writeFile(join(root, "uv.exe"), "");
    const env = { PATH: root, PATHEXT: ".EXE" };
    const base = { transport: "stdio" as const, env: {}, url: "", headers: {} };
    expect(serverProblems({ ...base, command: "uvx", args: ["pkg"] }, env)).toEqual([
      {
        kind: "missing-command",
        subject: "uvx",
        link: "https://docs.astral.sh/uv/getting-started/installation/",
        fix: "install-uv",
      },
    ]);
    const missingFolder = join(root, "nope");
    expect(
      serverProblems(
        { ...base, command: "uv", args: ["--directory", missingFolder, "run", "x.py"] },
        env,
      ),
    ).toEqual([{ kind: "missing-folder", subject: missingFolder, fix: "edit" }]);
    expect(
      serverProblems({ ...base, command: "uv", args: ["run", "server.py"], cwd: root }, env),
    ).toEqual([{ kind: "missing-file", subject: join(root, "server.py"), fix: "edit" }]);
    await writeFile(join(root, "server.py"), "");
    expect(
      serverProblems({ ...base, command: "uv", args: ["run", "server.py"], cwd: root }, env),
    ).toEqual([]);
    expect(
      serverProblems(
        { ...base, command: "uv", args: [], requiredEnv: [{ name: "TOKEN", isRequired: true }] },
        env,
      ),
    ).toEqual([{ kind: "missing-env", subject: "TOKEN", fix: "edit" }]);
  });
});

describe("diagnosis table (§11.7)", () => {
  const base = {
    command: "node",
    error: "",
    stderrTail: "",
    exitCode: 1,
    timedOut: false,
    noReply: true,
    firstRun: false,
  };
  it.each([
    [{ error: "spawn uvx ENOENT", exitCode: null }, "command-not-found"],
    [{ command: "python", exitCode: 9009 }, "store-stub"],
    [
      {
        stderrTail:
          "Python was not found; run without arguments to install from the Microsoft Store",
      },
      "store-stub",
    ],
    [{ stderrTail: "ModuleNotFoundError: No module named 'mcp'" }, "module-missing"],
    [{ stderrTail: "Error: Cannot find module 'C:\\x\\dist\\index.js'" }, "module-missing"],
    [{ stderrTail: "INFO: Uvicorn running on http://0.0.0.0:8080", timedOut: true }, "not-mcp"],
    [{ timedOut: true }, "no-reply"],
    [{ command: "npx", timedOut: true, firstRun: true }, "first-run-timeout"],
    [{ stderrTail: "Error: listen EADDRINUSE: address already in use :::8080" }, "port-in-use"],
    [{ stderrTail: "HTTP 401 Unauthorized: Bad credentials" }, "auth"],
    [{ stderrTail: "error: Microsoft Visual C++ 14.0 or greater is required." }, "build-tools"],
    [
      {
        stderrTail:
          "error: Failed to spawn: `x`\n  Caused by: The system cannot find the path specified.",
      },
      "path-not-found",
    ],
    [{}, "exited"],
  ])("%o → %s", (patch, code) => {
    expect(diagnose({ ...base, ...patch }).code).toBe(code);
  });
});
