import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  McpCandidate,
  McpInstallJob,
  McpInstallPlan,
  McpInstallStepView,
  McpRepoAnalysis,
  McpServerInput,
  McpServerSummary,
} from "../../shared/ipc";
import { unzipBuffer } from "../antigravity-runtime";
import { cliSkillName, cliSkillText } from "./cli-skill";
import { diagnose } from "./diagnose";
import { killProcessTree } from "./handshake";
import { installRoot, type ShortPath, serverFolderName } from "./paths";
import { type HttpFetch, minimumPython, ToolsManager } from "./tools-manager";
import { lookupCommand } from "./windows-env";

const NAME = /^[A-Za-z0-9_-]{1,48}$/;
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,60}$/;
const IMAGE = /^[a-z0-9]+([._/-][a-z0-9]+)*(:[A-Za-z0-9._-]+)?(@sha256:[0-9a-f]{64})?$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SCRIPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const LOG_LIMIT = 12_000;
const STEP_TIMEOUT_MS = 30 * 60_000;

type Step =
  | { kind: "download-uv"; version: string }
  | { kind: "download-node"; version: string }
  | {
      kind: "exec";
      view: McpInstallStepView["kind"];
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
      expectOutput?: RegExp;
    }
  | {
      kind: "clone";
      owner: string;
      repo: string;
      commit: string;
      target: string;
      git: string | null;
    }
  | { kind: "skill"; text: string }
  | {
      kind: "save";
      server: McpServerInput;
      source: string;
      npmBin?: { folder: string; pkg: string };
    }
  | { kind: "test" }
  | { kind: "recheck" };

interface Plan {
  view: McpInstallPlan;
  steps: Step[];
}

interface Job {
  view: McpInstallJob;
  cancelled: boolean;
  pid: number | null;
}

export interface InstallerHooks {
  /** Saves a server (switched off until tested) and returns the new list. */
  saveServer: (input: McpServerInput, source: string) => Promise<McpServerSummary[]>;
  /** Tests the server called `name` and returns the list with its status. */
  testServer: (name: string) => Promise<McpServerSummary[]>;
  /** Writes a custom skill from SKILL.md text; returns its name. */
  addSkill: (text: string) => Promise<string>;
  /** Re-reads PATH after a tool was installed. */
  recheck: () => Promise<McpServerSummary[]>;
  /** The fresh environment (PATH) to look programs up in, and the base env for install steps. */
  env: () => Record<string, string>;
}

/** Shows a command the way the owner could type it. */
export function displayCommand(command: string, args: string[]): string {
  const quote = (word: string) =>
    /[\s"&|<>^]/.test(word) || word === "" ? `"${word.replace(/"/g, '\\"')}"` : word;
  return [command, ...args].map(quote).join(" ");
}

function view(step: Step): McpInstallStepView {
  switch (step.kind) {
    case "download-uv":
      return {
        kind: "download-uv",
        command: `https://github.com/astral-sh/uv/releases/download/${step.version}/uv-x86_64-pc-windows-msvc.zip (SHA-256 checked)`,
      };
    case "download-node":
      return {
        kind: "download-node",
        command: `https://nodejs.org/dist/v${step.version}/node-v${step.version}-win-x64.zip (SHA-256 checked)`,
      };
    case "exec":
      return { kind: step.view, command: displayCommand(step.command, step.args) };
    case "clone":
      return {
        kind: "clone",
        command: step.git
          ? `git clone https://github.com/${step.owner}/${step.repo} "${step.target}" && git checkout ${step.commit}`
          : `https://codeload.github.com/${step.owner}/${step.repo}/zip/${step.commit} → "${step.target}"`,
      };
    case "skill":
      return { kind: "skill", command: "Settings › Skills" };
    case "save":
      return {
        kind: "save",
        command:
          step.server.transport === "http"
            ? (step.server.url ?? "")
            : displayCommand(step.server.command ?? "", step.server.args ?? []),
      };
    case "test":
      return { kind: "test", command: "initialize + tools/list" };
    case "recheck":
      return { kind: "verify", command: "PATH" };
  }
}

/**
 * Guided install (audit §11.6, §11.8): every download and command is built here from the
 * structured analysis (never from README text), shown on an approval card, and run only after the
 * owner approves the plan. Each server gets its own folder, venv or node_modules.
 */
export class McpInstaller {
  readonly tools: ToolsManager;
  readonly #userData: string;
  readonly #hooks: InstallerHooks;
  readonly #extraEnv: Record<string, string>;
  readonly #shortPath: ShortPath | undefined;
  readonly #fetch: HttpFetch;
  readonly #plans = new Map<string, Plan>();
  readonly #jobs = new Map<string, Job>();

  constructor(
    userDataPath: string,
    hooks: InstallerHooks,
    options: {
      fetch?: HttpFetch;
      tools?: ToolsManager;
      /** Added to every install step (tests point caches at a scratch folder). */
      extraEnv?: Record<string, string>;
      shortPath?: ShortPath;
      /** Fixed install folder (dev scripts); normally chosen by installRoot. */
      root?: string;
      longPaths?: () => Promise<boolean>;
    } = {},
  ) {
    this.#userData = userDataPath;
    this.#hooks = hooks;
    this.#fetch = options.fetch ?? (fetch as unknown as HttpFetch);
    this.tools = options.tools ?? new ToolsManager(userDataPath, this.#fetch);
    this.#extraEnv = options.extraEnv ?? {};
    this.#shortPath = options.shortPath;
    this.#fixedRoot = options.root;
    this.#longPaths = options.longPaths;
  }

  readonly #fixedRoot: string | undefined;
  readonly #longPaths: (() => Promise<boolean>) | undefined;

  async #root(): Promise<string> {
    if (this.#fixedRoot) {
      await mkdir(this.#fixedRoot, { recursive: true });
      return this.#fixedRoot;
    }
    return installRoot(this.#userData, {
      ...(this.#shortPath ? { shortPath: this.#shortPath } : {}),
      ...(this.#longPaths ? { longPaths: this.#longPaths } : {}),
    });
  }

  #remember(plan: Plan): McpInstallPlan {
    this.#plans.set(plan.view.id, plan);
    for (const key of [...this.#plans.keys()].slice(0, Math.max(0, this.#plans.size - 20))) {
      this.#plans.delete(key);
    }
    return plan.view;
  }

  #stepEnv(): Record<string, string> {
    return {
      ...this.#hooks.env(),
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PIP_NO_INPUT: "1",
      PYTHONUTF8: "1",
      UV_PYTHON_INSTALL_DIR: this.tools.pythonDirectory,
      npm_config_update_notifier: "false",
      npm_config_fund: "false",
      ...this.#extraEnv,
    };
  }

  /** Steps that leave a venv at `venv` (real Python when present, else uv-managed Python). */
  async #venvSteps(
    venv: string,
    requires: string | undefined,
  ): Promise<{ steps: Step[]; pip: (spec: string) => Step; sizeMb: number }> {
    const env = this.#hooks.env();
    const minimum = minimumPython(requires);
    const venvPython = join(venv, "Scripts", "python.exe");
    const real = await this.tools.findPython(env, minimum);
    if (real) {
      return {
        steps: [{ kind: "exec", view: "venv", command: real.path, args: ["-m", "venv", venv] }],
        pip: (spec) => ({
          kind: "exec",
          view: "pip",
          command: venvPython,
          args: ["-m", "pip", "install", spec],
        }),
        sizeMb: 0,
      };
    }
    const steps: Step[] = [];
    let uv = this.tools.findUv(env);
    let sizeMb = 30;
    if (!uv) {
      const version = await this.tools.latestUvVersion();
      steps.push({ kind: "download-uv", version });
      uv = join(this.tools.uvDirectory(version), "uv.exe");
      sizeMb += 15;
    }
    const wanted = minimum[1] > 11 ? `${minimum[0]}.${minimum[1]}` : "3.11";
    steps.push({
      kind: "exec",
      view: "python-install",
      command: uv,
      args: ["python", "install", wanted],
    });
    steps.push({
      kind: "exec",
      view: "venv",
      command: uv,
      args: ["venv", "--python", wanted, venv],
    });
    const uvPath = uv;
    return {
      steps,
      pip: (spec) => ({
        kind: "exec",
        view: "pip",
        command: uvPath,
        args: ["pip", "install", "--python", venvPython, spec],
      }),
      sizeMb,
    };
  }

  async #nodeSteps(): Promise<{ steps: Step[]; node: string; npmCli: string; sizeMb: number }> {
    const found = this.tools.findNode(this.#hooks.env());
    if (found) return { steps: [], ...found, sizeMb: 0 };
    const latest = await this.tools.latestNodeLts();
    const node = this.tools.nodeExecutable(latest.version);
    return {
      steps: [{ kind: "download-node", version: latest.version }],
      node,
      npmCli: join(dirname(node), "node_modules", "npm", "bin", "npm-cli.js"),
      sizeMb: 30,
    };
  }

  /** The plan for one candidate of a repo analysis. */
  async planCandidate(
    analysis: McpRepoAnalysis,
    candidate: McpCandidate,
    name: string,
    values: Record<string, string>,
  ): Promise<McpInstallPlan> {
    if (!NAME.test(name) || /^sahkarmi/i.test(name)) {
      throw new Error("Name: letters, numbers, - and _ only (up to 48), like github or my-files.");
    }
    const install = candidate.install;
    if (!install) throw new Error("This one has nothing to install. Use Add instead.");
    const folder = join(await this.#root(), serverFolderName(name));
    const allowed = new Set(candidate.requiredEnv.map((entry) => entry.name));
    const env = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => allowed.has(key) && value.trim()),
    );
    const base: McpServerInput = {
      name,
      transport: "stdio",
      env,
      requiredEnv: candidate.requiredEnv,
      ...(analysis.heavy ? { heavy: true } : {}),
    };
    // Arguments the server itself takes, after the package spec (and script) of npx / uvx.
    const given = candidate.server?.args ?? [];
    const spec =
      "package" in install ? given.findIndex((arg) => arg.startsWith(install.package)) : -1;
    const extras = spec < 0 ? [] : given.slice(given[spec - 1] === "--from" ? spec + 2 : spec + 1);
    const steps: Step[] = [];
    let source: string;
    let sizeMb = { min: 5, max: 100 };
    const warnings: string[] = [...analysis.warnings];
    switch (install.type) {
      case "npm": {
        if (!NPM_NAME.test(install.package) || !VERSION.test(install.version))
          throw new Error("Unexpected npm package name.");
        const node = await this.#nodeSteps();
        steps.push(...node.steps, {
          kind: "exec",
          view: "npm",
          command: node.node,
          args: [
            node.npmCli,
            "install",
            "--prefix",
            folder,
            "--no-audit",
            "--no-fund",
            "--omit=dev",
            `${install.package}@${install.version}`,
          ],
        });
        source = `npm ${install.package}@${install.version}`;
        steps.push({
          kind: "save",
          server: { ...base, command: node.node, args: extras },
          source: `Installed from ${source}`,
          npmBin: { folder, pkg: install.package },
        });
        sizeMb = { min: 5 + node.sizeMb, max: 80 + node.sizeMb };
        break;
      }
      case "pypi": {
        if (
          !PYPI_NAME.test(install.package) ||
          !VERSION.test(install.version) ||
          !SCRIPT.test(install.script)
        ) {
          throw new Error("Unexpected PyPI package name.");
        }
        const venv = join(folder, ".venv");
        const python = await this.#venvSteps(venv, install.requiresPython);
        steps.push(...python.steps, python.pip(`${install.package}==${install.version}`));
        source = `PyPI ${install.package} ${install.version}`;
        steps.push({
          kind: "save",
          server: {
            ...base,
            command: join(venv, "Scripts", `${install.script}.exe`),
            args: extras,
          },
          source: `Installed from ${source}`,
        });
        sizeMb = analysis.heavy
          ? { min: 500, max: 3000 }
          : { min: 10 + python.sizeMb, max: 150 + python.sizeMb };
        break;
      }
      case "clone-python": {
        if (!COMMIT.test(install.commit)) throw new Error("The repo must be pinned to a commit.");
        const src = join(folder, "src");
        const project = install.subPath ? join(src, ...install.subPath.split("/")) : src;
        const venv = join(folder, ".venv");
        const python = await this.#venvSteps(venv, install.requiresPython);
        steps.push(
          this.#cloneStep(analysis, install.commit, src),
          ...python.steps,
          python.pip(project),
        );
        source = `github.com/${analysis.repo} at commit ${install.commit.slice(0, 7)}`;
        const server: McpServerInput =
          install.script && SCRIPT.test(install.script)
            ? {
                ...base,
                command: join(venv, "Scripts", `${install.script}.exe`),
                args: [],
                cwd: project,
              }
            : {
                ...base,
                command: join(venv, "Scripts", "python.exe"),
                args: [join(project, ...(install.entry ?? "server.py").split("/"))],
                cwd: project,
              };
        steps.push({ kind: "save", server, source: `Installed from ${source}` });
        sizeMb = analysis.heavy
          ? { min: 500, max: 3000 }
          : { min: 15 + python.sizeMb, max: 200 + python.sizeMb };
        break;
      }
      case "clone-node": {
        if (!COMMIT.test(install.commit)) throw new Error("The repo must be pinned to a commit.");
        const src = join(folder, "src");
        const project = install.subPath ? join(src, ...install.subPath.split("/")) : src;
        const node = await this.#nodeSteps();
        steps.push(this.#cloneStep(analysis, install.commit, src), ...node.steps, {
          kind: "exec",
          view: "npm",
          command: node.node,
          args: [node.npmCli, "install", "--no-audit", "--no-fund"],
          cwd: project,
        });
        if (install.build) {
          steps.push({
            kind: "exec",
            view: "build",
            command: node.node,
            args: [node.npmCli, "run", "build"],
            cwd: project,
          });
        }
        source = `github.com/${analysis.repo} at commit ${install.commit.slice(0, 7)}`;
        steps.push({
          kind: "save",
          server: {
            ...base,
            command: node.node,
            args: [join(project, ...install.bin.split("/"))],
            cwd: project,
          },
          source: `Installed from ${source}`,
        });
        sizeMb = { min: 20 + node.sizeMb, max: 300 + node.sizeMb };
        warnings.push(
          "Building from source can fail on Windows when a package needs C++ build tools.",
        );
        break;
      }
      case "oci": {
        if (!IMAGE.test(install.image)) throw new Error("Unexpected Docker image name.");
        const docker = lookupCommand("docker", this.#hooks.env()).path;
        if (!docker)
          throw new Error(
            "This one runs in Docker, and Docker Desktop is not installed. Sahkarmi does not install Docker for you.",
          );
        steps.push({
          kind: "exec",
          view: "docker-pull",
          command: docker,
          args: ["pull", install.image],
        });
        source = `Docker image ${install.image}`;
        steps.push({
          kind: "save",
          server: {
            ...base,
            command: "docker",
            args: candidate.server?.args ?? ["run", "-i", "--rm", install.image],
          },
          source: `Installed from ${source}`,
        });
        sizeMb = { min: 20, max: 500 };
        break;
      }
    }
    steps.push({ kind: "test" });
    return this.#remember({
      view: {
        id: randomUUID(),
        kind: "server",
        name,
        source,
        folder,
        sizeMb,
        heavy: analysis.heavy,
        steps: steps.map(view),
        warnings,
      },
      steps,
    });
  }

  #cloneStep(analysis: McpRepoAnalysis, commit: string, target: string): Step {
    const [owner = "", repo = ""] = analysis.repo.split("/");
    return {
      kind: "clone",
      owner,
      repo,
      commit,
      target,
      git: lookupCommand("git", this.#hooks.env()).path,
    };
  }

  /** "Use as a Skill (CLI)": venv + pip install the pinned package + check + Sahkarmi's own skill. */
  async planSkill(analysis: McpRepoAnalysis): Promise<McpInstallPlan> {
    const cli = analysis.cli;
    if (!cli) throw new Error("This repo has no command-line program on PyPI to use as a Skill.");
    if (!PYPI_NAME.test(cli.package) || !VERSION.test(cli.version) || !SCRIPT.test(cli.script)) {
      throw new Error("Unexpected PyPI package name.");
    }
    // The package name keeps the folder short (deep venv paths, Windows 260-character limit).
    const name = serverFolderName(cli.package);
    const folder = join(await this.#root(), name);
    const venv = join(folder, ".venv");
    const exe = join(venv, "Scripts", `${cli.script}.exe`);
    const python = await this.#venvSteps(venv, cli.requiresPython);
    const isMpt = cli.package === "mpt";
    const steps: Step[] = [
      ...python.steps,
      python.pip(`${cli.package}==${cli.version}`),
      {
        kind: "exec",
        view: "verify",
        command: exe,
        args: isMpt ? ["cli", "--help"] : ["--help"],
        ...(isMpt ? { expectOutput: /--video-subject/ } : {}),
      },
      {
        kind: "skill",
        text: cliSkillText({
          repo: analysis.repo,
          packageName: cli.package,
          version: cli.version,
          executable: exe,
        }),
      },
    ];
    return this.#remember({
      view: {
        id: randomUUID(),
        kind: "skill",
        name: cliSkillName({
          repo: analysis.repo,
          packageName: cli.package,
          version: cli.version,
          executable: exe,
        }),
        source: `PyPI ${cli.package} ${cli.version} (github.com/${analysis.repo})`,
        folder,
        sizeMb: analysis.heavy
          ? { min: 500, max: 2500 }
          : { min: 10 + python.sizeMb, max: 200 + python.sizeMb },
        heavy: analysis.heavy,
        steps: steps.map(view),
        warnings: analysis.warnings,
      },
      steps,
    });
  }

  /** One-click fixes: download uv, Node.js, or Python 3.11 (through uv) into Sahkarmi's tools folder. */
  async planTool(tool: "uv" | "python" | "node"): Promise<McpInstallPlan> {
    const steps: Step[] = [];
    let sizeMb = { min: 14, max: 20 };
    let source = "";
    if (tool === "node") {
      const latest = await this.tools.latestNodeLts();
      steps.push({ kind: "download-node", version: latest.version });
      source = `Node.js ${latest.version} (nodejs.org)`;
      sizeMb = { min: 25, max: 40 };
    } else {
      let uv = this.tools.findUv(this.#hooks.env());
      if (!uv || tool === "uv") {
        const version = await this.tools.latestUvVersion();
        steps.push({ kind: "download-uv", version });
        uv = join(this.tools.uvDirectory(version), "uv.exe");
        source = `uv ${version} (github.com/astral-sh/uv)`;
      }
      if (tool === "python") {
        steps.push({
          kind: "exec",
          view: "python-install",
          command: uv,
          args: ["python", "install", "3.11"],
        });
        source = `${source ? `${source}, ` : ""}Python 3.11 (python-build-standalone, through uv)`;
        sizeMb = { min: 30, max: 60 };
      }
    }
    steps.push({ kind: "recheck" });
    return this.#remember({
      view: {
        id: randomUUID(),
        kind: "tool",
        name: tool,
        source,
        folder: this.tools.root,
        sizeMb,
        heavy: false,
        steps: steps.map(view),
        warnings: [],
      },
      steps,
    });
  }

  /** Starts an approved plan; progress is read with `status`. */
  run(planId: string): McpInstallJob {
    const plan = this.#plans.get(planId);
    if (!plan) throw new Error("That plan has expired. Prepare it again.");
    this.#plans.delete(planId);
    const job: Job = {
      view: {
        id: randomUUID(),
        planId,
        state: "running",
        steps: plan.view.steps.map((step) => ({ kind: step.kind, state: "waiting" })),
        log: "",
        error: null,
        diagnosis: null,
      },
      cancelled: false,
      pid: null,
    };
    this.#jobs.set(job.view.id, job);
    void this.#execute(plan, job);
    return structuredClone(job.view);
  }

  status(jobId: string): McpInstallJob {
    const job = this.#jobs.get(jobId);
    if (!job) throw new Error("That install is no longer known.");
    return structuredClone(job.view);
  }

  async cancel(jobId: string): Promise<McpInstallJob> {
    const job = this.#jobs.get(jobId);
    if (!job) throw new Error("That install is no longer known.");
    job.cancelled = true;
    await killProcessTree(job.pid);
    return structuredClone(job.view);
  }

  /** Waits for a job to end (tests and scripts). */
  async wait(jobId: string, pollMs = 200): Promise<McpInstallJob> {
    for (;;) {
      const current = this.status(jobId);
      if (current.state !== "running") return current;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  #log(job: Job, text: string): void {
    const next = job.view.log + text;
    job.view.log = next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next;
  }

  async #execute(plan: Plan, job: Job): Promise<void> {
    let lastCommand = "";
    let exitCode: number | null = null;
    let timedOut = false;
    let savedName: string | null = null;
    for (const [index, step] of plan.steps.entries()) {
      const state = job.view.steps[index];
      if (!state) continue;
      if (job.cancelled) {
        job.view.state = "cancelled";
        return;
      }
      state.state = "running";
      try {
        switch (step.kind) {
          case "download-uv":
            lastCommand = "uv";
            await this.tools.installUv(step.version, (line) => this.#log(job, `${line}\n`));
            break;
          case "download-node":
            lastCommand = "node";
            await this.tools.installNode(step.version, (line) => this.#log(job, `${line}\n`));
            break;
          case "exec": {
            lastCommand = step.command;
            this.#log(job, `> ${displayCommand(step.command, step.args)}\n`);
            if (step.cwd) await mkdir(step.cwd, { recursive: true });
            const result = await this.#spawn(job, step);
            exitCode = result.code;
            timedOut = result.timedOut;
            if (result.code !== 0)
              throw new Error(`The command stopped with code ${result.code ?? "?"}.`);
            if (step.expectOutput && !step.expectOutput.test(result.output)) {
              throw new Error("The program started but did not show the expected help text.");
            }
            break;
          }
          case "clone":
            lastCommand = "git";
            await this.#clone(job, step);
            break;
          case "skill": {
            const name = await this.#hooks.addSkill(step.text);
            job.view.skillName = name;
            this.#log(job, `Skill "${name}" added.\n`);
            break;
          }
          case "save": {
            const server = { ...step.server };
            if (step.npmBin)
              server.args = [
                npmBinPath(step.npmBin.folder, step.npmBin.pkg),
                ...(server.args ?? []),
              ];
            if (
              server.transport !== "http" &&
              server.command &&
              /[\\/]/.test(server.command) &&
              !existsSync(server.command)
            ) {
              throw new Error(`The install finished, but ${server.command} is missing.`);
            }
            job.view.servers = await this.#hooks.saveServer(server, step.source);
            savedName = server.name;
            break;
          }
          case "test": {
            if (!savedName) break;
            job.view.servers = await this.#hooks.testServer(savedName);
            const status = job.view.servers.find((entry) => entry.name === savedName)?.status;
            this.#log(
              job,
              status?.ok
                ? `Test passed: ${status.toolCount} tools.\n`
                : `Test failed: ${status?.error ?? ""}\n`,
            );
            break;
          }
          case "recheck":
            await this.tools.refreshManagedPath();
            job.view.servers = await this.#hooks.recheck();
            break;
        }
        state.state = "done";
      } catch (error) {
        state.state = "failed";
        const message = error instanceof Error ? error.message : String(error);
        job.view.error = message;
        job.view.diagnosis = diagnose({
          command: lastCommand,
          error: message,
          stderrTail: job.view.log,
          exitCode,
          timedOut,
          noReply: false,
          firstRun: false,
        });
        job.view.state = job.cancelled ? "cancelled" : "failed";
        return;
      }
    }
    job.view.state = "done";
  }

  #spawn(
    job: Job,
    step: Extract<Step, { kind: "exec" }>,
  ): Promise<{ code: number | null; output: string; timedOut: boolean }> {
    return new Promise((resolve, reject) => {
      let output = "";
      let timedOut = false;
      const child = spawn(step.command, step.args, {
        cwd: step.cwd,
        env: { ...this.#stepEnv(), ...(step.env ?? {}) },
        windowsHide: true,
        shell: false,
      });
      job.pid = child.pid ?? null;
      const timer = setTimeout(() => {
        timedOut = true;
        void killProcessTree(child.pid);
      }, STEP_TIMEOUT_MS);
      const take = (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        output = (output + text).slice(-LOG_LIMIT);
        this.#log(job, text);
      };
      child.stdout?.on("data", take);
      child.stderr?.on("data", take);
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        job.pid = null;
        resolve({ code, output, timedOut });
      });
    });
  }

  async #clone(job: Job, step: Extract<Step, { kind: "clone" }>): Promise<void> {
    await rm(step.target, { recursive: true, force: true });
    await mkdir(dirname(step.target), { recursive: true });
    if (step.git) {
      for (const args of [
        [
          "-c",
          "core.longpaths=true",
          "clone",
          "--no-checkout",
          `https://github.com/${step.owner}/${step.repo}.git`,
          step.target,
        ],
        ["-c", "core.longpaths=true", "-C", step.target, "checkout", "--quiet", step.commit],
      ]) {
        this.#log(job, `> ${displayCommand("git", args)}\n`);
        const result = await this.#spawn(job, {
          kind: "exec",
          view: "clone",
          command: step.git,
          args,
        });
        if (result.code !== 0) throw new Error(`git stopped with code ${result.code ?? "?"}.`);
      }
      return;
    }
    // No git: GitHub's zip of exactly that commit (codeload, not the rate-limited API).
    const url = `https://codeload.github.com/${step.owner}/${step.repo}/zip/${step.commit}`;
    this.#log(job, `Downloading ${url}\n`);
    const response = await this.#fetch(url, { headers: { "User-Agent": "Sahkarmi" } });
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const temporary = `${step.target}.partial`;
    await rm(temporary, { recursive: true, force: true });
    await unzipBuffer(Buffer.from(await response.arrayBuffer()), temporary);
    const [inner] = await readdir(temporary);
    if (!inner) throw new Error("The download was empty.");
    await rename(join(temporary, inner), step.target);
    await rm(temporary, { recursive: true, force: true });
  }
}

/** The start file of an npm package installed with --prefix. */
export function npmBinPath(folder: string, pkg: string): string {
  const root = join(folder, "node_modules", ...pkg.split("/"));
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    bin?: unknown;
    main?: unknown;
  };
  const bin =
    typeof manifest.bin === "string"
      ? manifest.bin
      : manifest.bin && typeof manifest.bin === "object"
        ? Object.values(manifest.bin as Record<string, unknown>).find(
            (value): value is string => typeof value === "string",
          )
        : typeof manifest.main === "string"
          ? manifest.main
          : undefined;
  if (!bin) throw new Error(`${pkg} has no program to start.`);
  return join(root, ...bin.split("/"));
}
