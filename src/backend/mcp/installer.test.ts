import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { McpCandidate, McpRepoAnalysis, McpServerInput } from "../../shared/ipc";
import { cliSkillText } from "./cli-skill";
import { displayCommand, McpInstaller } from "./installer";
import { installRoot, isPlainPath, serverFolderName } from "./paths";
import {
  type HttpFetch,
  minimumPython,
  parsePyLauncher,
  ToolsManager,
  verifySha256,
} from "./tools-manager";

const FAKE_NPM = join(__dirname, "__fixtures__", "servers", "fake-npm.mjs");
const folders: string[] = [];
async function scratch(prefix = "sahkarmi-mcp-install-"): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
}
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function analysis(overrides: Partial<McpRepoAnalysis> = {}): McpRepoAnalysis {
  return {
    id: "a1",
    repo: "owner/repo",
    url: "https://github.com/owner/repo",
    commit: "0123456789abcdef0123456789abcdef01234567",
    subPath: "",
    kind: "mcp-stdio",
    notMcp: [],
    evidence: [],
    candidates: [],
    cli: null,
    heavy: false,
    warnings: [],
    truncated: false,
    ...overrides,
  };
}

const npmCandidate: McpCandidate = {
  id: "c1",
  label: "npm",
  runtime: "node",
  server: {
    name: "x",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@demo/server@1.2.3", "--read-only"],
  },
  install: { type: "npm", package: "@demo/server", version: "1.2.3" },
  evidence: [],
  requiredEnv: [{ name: "DEMO_TOKEN", description: "", isRequired: true, isSecret: true }],
  placeholders: [],
  needs: ["node"],
};

/** Tools that never touch this PC's real programs. */
class FakeTools extends ToolsManager {
  python: { path: string; version: [number, number] } | null = null;
  uv: string | null = null;
  node: { node: string; npmCli: string } | null = null;
  override findUv() {
    return this.uv;
  }
  override findNode() {
    return this.node;
  }
  override async findPython() {
    return this.python;
  }
  override async latestUvVersion() {
    return "0.9.9";
  }
  override async latestNodeLts() {
    return { version: "22.1.0", file: "", zip: "", shasums: "" };
  }
}

function installer(userData: string, tools: FakeTools) {
  const saved: McpServerInput[] = [];
  const skills: string[] = [];
  const hooks = {
    saveServer: async (input: McpServerInput) => {
      saved.push(input);
      return [];
    },
    testServer: async () => [],
    addSkill: async (text: string) => {
      skills.push(text);
      return "skill";
    },
    recheck: async () => [],
    env: () => ({ PATH: "" }),
  };
  return {
    saved,
    skills,
    installer: new McpInstaller(userData, hooks, { tools, shortPath: async () => null }),
  };
}

describe("tools manager", () => {
  it("reads the py launcher list and the minimum Python", () => {
    const listed = parsePyLauncher(
      " -V:3.13 *        C:\\Users\\A\\Python313\\python.exe\r\n -V:3.12          C:\\Program Files\\Python312\\python.exe\r\n",
    );
    expect(listed).toEqual([
      { path: "C:\\Users\\A\\Python313\\python.exe", version: [3, 13] },
      { path: "C:\\Program Files\\Python312\\python.exe", version: [3, 12] },
    ]);
    expect(minimumPython(">=3.11")).toEqual([3, 11]);
    expect(minimumPython(undefined)).toEqual([3, 10]);
  });

  it("refuses a download whose SHA-256 does not match", () => {
    const data = Buffer.from("uv");
    const good = createHash("sha256").update(data).digest("hex");
    expect(() => verifySha256(data, good, "uv.zip")).not.toThrow();
    expect(() => verifySha256(data, "0".repeat(64), "uv.zip")).toThrow(/SHA-256/);
    expect(() => verifySha256(data, "", "uv.zip")).toThrow(/SHA-256/);
  });

  it("checks uv against its published .sha256 before unpacking", async () => {
    const userData = await scratch();
    const zip = Buffer.from("not really a zip");
    const fake: HttpFetch = async (url) => ({
      ok: true,
      status: 200,
      url,
      headers: { get: () => null },
      text: async () => `${"f".repeat(64)}  uv-x86_64-pc-windows-msvc.zip\n`,
      json: async () => ({}),
      arrayBuffer: async () =>
        zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length) as ArrayBuffer,
    });
    const tools = new ToolsManager(userData, fake);
    await expect(tools.installUv("0.9.9")).rejects.toThrow(/SHA-256/);
    expect(existsSync(tools.uvDirectory("0.9.9"))).toBe(false);
    await expect(tools.installUv("0.9.9 & calc")).rejects.toThrow(/version/);
  });
});

describe("install folder", () => {
  it("avoids spaces and non-ASCII letters (Python breaks on them)", async () => {
    expect(isPlainPath("C:\\Users\\dev\\AppData\\Roaming\\Sahkarmi\\mcp")).toBe(true);
    expect(isPlainPath("C:\\Users\\Jürgen Ö\\AppData")).toBe(false);
    expect(serverFolderName("my files ü")).toBe("my-files--");
    const base = await scratch();
    const odd = join(base, "Jürgen Ö");
    const drive = join(base, "drive");
    const root = await installRoot(odd, {
      shortPath: async () => null,
      systemDrive: drive,
      username: "Jürgen",
    });
    expect(root).toBe(join(`${drive}\\`, "Sahkarmi-mcp", "Jrgen"));
    expect(await installRoot(odd, { shortPath: async () => "C:\\Users\\JRGEN~1\\mcp" })).toBe(
      "C:\\Users\\JRGEN~1\\mcp",
    );
  });
});

describe("guided install plans", () => {
  it("npm: installs the pinned version into its own folder and starts it with node, keeping server arguments", async () => {
    const userData = await scratch();
    const tools = new FakeTools(userData);
    tools.node = { node: process.execPath, npmCli: FAKE_NPM };
    const { installer: subject, saved } = installer(userData, tools);
    const plan = await subject.planCandidate(analysis(), npmCandidate, "demo", {
      DEMO_TOKEN: "t",
      OTHER: "x",
    });
    expect(plan.source).toBe("npm @demo/server@1.2.3");
    expect(plan.folder).toBe(join(userData, "mcp", "demo"));
    expect(plan.steps.map((step) => step.kind)).toEqual(["npm", "save", "test"]);
    expect(plan.steps[0]?.command).toContain("@demo/server@1.2.3");
    const job = await subject.wait(subject.run(plan.id).id, 20);
    expect(job.error).toBeNull();
    expect(job.state).toBe("done");
    expect(saved[0]?.command).toBe(process.execPath);
    expect(saved[0]?.args).toEqual([
      join(userData, "mcp", "demo", "node_modules", "@demo", "server", "dist", "index.js"),
      "--read-only",
    ]);
    // Only the keys the server declares are kept.
    expect(saved[0]?.env).toEqual({ DEMO_TOKEN: "t" });
    // A plan runs once.
    expect(() => subject.run(plan.id)).toThrow(/expired/);
  });

  it("npm without Node: downloads portable Node first", async () => {
    const userData = await scratch();
    const { installer: subject } = installer(userData, new FakeTools(userData));
    const plan = await subject.planCandidate(analysis(), npmCandidate, "demo", {});
    expect(plan.steps[0]).toEqual({
      kind: "download-node",
      command: "https://nodejs.org/dist/v22.1.0/node-v22.1.0-win-x64.zip (SHA-256 checked)",
    });
  });

  it("PyPI without a real Python: uv-managed Python 3.11 and a venv, then the pinned package", async () => {
    const userData = await scratch();
    const tools = new FakeTools(userData);
    const { installer: subject } = installer(userData, tools);
    const candidate: McpCandidate = {
      ...npmCandidate,
      runtime: "python",
      server: { name: "x", transport: "stdio", command: "uvx", args: ["mcp-obsidian@0.2.3"] },
      install: {
        type: "pypi",
        package: "mcp-obsidian",
        version: "0.2.3",
        script: "mcp-obsidian",
        requiresPython: ">=3.11",
      },
    };
    const plan = await subject.planCandidate(analysis(), candidate, "obsidian", {});
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "download-uv",
      "python-install",
      "venv",
      "pip",
      "save",
      "test",
    ]);
    expect(plan.steps[1]?.command).toMatch(/uv\.exe python install 3\.11$/);
    expect(plan.steps[3]?.command).toContain("mcp-obsidian==0.2.3");
    expect(plan.steps[4]?.command).toContain(
      join("obsidian", ".venv", "Scripts", "mcp-obsidian.exe"),
    );
  });

  it("refuses names and packages that could smuggle commands", async () => {
    const userData = await scratch();
    const tools = new FakeTools(userData);
    tools.node = { node: process.execPath, npmCli: FAKE_NPM };
    const { installer: subject } = installer(userData, tools);
    await expect(subject.planCandidate(analysis(), npmCandidate, "a b", {})).rejects.toThrow(
      /Name/,
    );
    const bad = {
      ...npmCandidate,
      install: { type: "npm" as const, package: "x & calc", version: "1" },
    };
    await expect(subject.planCandidate(analysis(), bad, "demo", {})).rejects.toThrow(/npm/);
  });

  it("Skill route: venv, pinned pip install, --help check, then Sahkarmi's own skill", async () => {
    const userData = await scratch();
    const tools = new FakeTools(userData);
    tools.python = { path: "C:\\Python311\\python.exe", version: [3, 11] };
    const { installer: subject } = installer(userData, tools);
    const plan = await subject.planSkill(
      analysis({
        repo: "harry0703/MoneyPrinterTurbo",
        kind: "not-mcp",
        notMcp: ["cli", "http-api", "webapp"],
        cli: { package: "mpt", version: "1.3.9", script: "mpt", requiresPython: ">=3.11" },
        heavy: true,
      }),
    );
    expect(plan.kind).toBe("skill");
    expect(plan.heavy).toBe(true);
    expect(plan.steps.map((step) => step.kind)).toEqual(["venv", "pip", "verify", "skill"]);
    expect(plan.steps[1]?.command).toContain("mpt==1.3.9");
    expect(plan.steps[2]?.command).toMatch(/mpt\.exe"? cli --help$/);
    await expect(subject.planSkill(analysis())).rejects.toThrow(/no command-line/);
  });

  it("tool fixes: uv, Python 3.11 through uv, Node.js", async () => {
    const userData = await scratch();
    const { installer: subject } = installer(userData, new FakeTools(userData));
    expect((await subject.planTool("uv")).steps.map((step) => step.kind)).toEqual([
      "download-uv",
      "verify",
    ]);
    expect((await subject.planTool("python")).steps.map((step) => step.kind)).toEqual([
      "download-uv",
      "python-install",
      "verify",
    ]);
    expect((await subject.planTool("node")).steps.map((step) => step.kind)).toEqual([
      "download-node",
      "verify",
    ]);
  });

  it("a failing step stops the install and is diagnosed", async () => {
    const userData = await scratch();
    const tools = new FakeTools(userData);
    tools.node = { node: process.execPath, npmCli: join(userData, "missing-npm.js") };
    const { installer: subject, saved } = installer(userData, tools);
    const plan = await subject.planCandidate(analysis(), npmCandidate, "demo", {});
    const job = await subject.wait(subject.run(plan.id).id, 20);
    expect(job.state).toBe("failed");
    expect(job.steps.map((step) => step.state)).toEqual(["failed", "waiting", "waiting"]);
    expect(job.diagnosis?.code).toBeTruthy();
    expect(saved).toHaveLength(0);
  });
});

describe("CLI skill text", () => {
  const text = cliSkillText({
    repo: "harry0703/MoneyPrinterTurbo",
    packageName: "mpt",
    version: "1.3.9",
    executable: "C:\\Sahkarmi-mcp\\MoneyPrinterTurbo\\.venv\\Scripts\\mpt.exe",
  });

  it("calls the program by full path and says where videos go and which free keys it needs", () => {
    expect(text).toMatch(/^---\nname: MoneyPrinterTurbo videos\ndescription: /);
    expect(text).toContain(
      '& "C:\\Sahkarmi-mcp\\MoneyPrinterTurbo\\.venv\\Scripts\\mpt.exe" cli --video-subject',
    );
    expect(text).toContain("%LOCALAPPDATA%\\MoneyPrinterTurbo\\storage\\tasks");
    expect(text).toContain("Pexels");
    expect(text).toMatch(/Never add a `--confirm-\.\.\.-charge` option/);
    // The only pipe-to-shell mention is the rule that forbids it.
    expect(text.split("\n").filter((line) => /\|\s*(iex|sh)\b/.test(line))).toEqual([
      expect.stringMatching(/never run commands copied from the internet/),
    ]);
  });

  it("shows commands the way the owner could type them", () => {
    expect(displayCommand("C:\\a b\\uv.exe", ["pip", "install", "x==1"])).toBe(
      '"C:\\a b\\uv.exe" pip install x==1',
    );
  });
});
