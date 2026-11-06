import { createHash } from "node:crypto";
import type {
  McpCandidate,
  McpEnvRequirement,
  McpNotMcpKind,
  McpRepoAnalysis,
  McpRepoKind,
  McpServerInput,
} from "../../shared/ipc";
import type { RepoEntry, RepoLocation } from "../github-repo";
import { parseMcpJson } from "../mcp-servers";
import {
  fencedBlocks,
  type PackageJson,
  parseLooseJson,
  parsePackageJson,
  parsePyProject,
  parseRequirements,
  requirementName,
} from "./manifests";
import { placeholderHits } from "./placeholders";

/** Everything the rules look at, fetched beforehand (resolve.ts) so the rules stay pure. */
export interface RepoSnapshot {
  location: RepoLocation & { ref: string };
  files: RepoEntry[];
  /** Small text files by path (README, manifests, a few code files). */
  texts: Record<string, string>;
  /** MCP Registry entries whose repository is this repo (latest versions). */
  registry: unknown[];
  /** Package registry facts for names found in the manifests. */
  packages: {
    npm?: Record<string, { version: string; repository: string | null } | null>;
    pypi?: Record<string, { version: string; urls: string[] } | null>;
  };
  truncated?: boolean;
}

const MCP_NODE_DEPS = /^(@modelcontextprotocol\/(sdk|server)|fastmcp|mcp-framework|@mastra\/mcp)$/;
const MCP_PY_DEPS = /^(mcp|fastmcp|mcp-server|modelcontextprotocol)$/;
const MCP_CODE =
  /FastMCP\(|MCPServer\(|@mcp\.tool|McpServer\(|StdioServerTransport|stdio_server\(|from mcp\.server|from mcp import|@modelcontextprotocol\/sdk/;
const WEB_CODE =
  /uvicorn\.run\(|app\.run\(|\.listen\(\s*\d|streamlit\s+run|gr\.Interface|\.launch\(\s*(server_name|share)|express\(\)/;
const WEB_DEPS = /^(fastapi|flask|django|streamlit|gradio|uvicorn|express|next|aiohttp)$/;
const UI_DEPS = /^(streamlit|gradio|next|react-scripts)$/;
const HEAVY_DEPS =
  /^(torch|tensorflow|moviepy|faster-whisper|openai-whisper|whisper|transformers|diffusers|opencv-python|opencv-python-headless|onnxruntime|onnxruntime-gpu|paddlepaddle|streamlit|gradio|ctranslate2)$/;

const SECRET = /KEY|TOKEN|SECRET|PASSWORD|PAT\b|AUTH/i;

function within(location: RepoLocation, path: string): string {
  const prefix = location.subPath ? `${location.subPath.replace(/\/+$/, "")}/` : "";
  return prefix + path;
}

function repoUrl(location: RepoLocation): string {
  return `https://github.com/${location.owner}/${location.repo}`;
}

function mentionsRepo(text: string | null | undefined, location: RepoLocation): boolean {
  if (!text) return false;
  return text.toLowerCase().includes(`github.com/${location.owner}/${location.repo}`.toLowerCase());
}

function id(parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
}

function requirementOf(entry: unknown): McpEnvRequirement | null {
  if (!entry || typeof entry !== "object") return null;
  const value = entry as Record<string, unknown>;
  if (typeof value.name !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(value.name)) return null;
  return {
    name: value.name,
    description: typeof value.description === "string" ? value.description.slice(0, 300) : "",
    isRequired: value.isRequired === true,
    isSecret: value.isSecret === true,
  };
}

/** server.json argument lists → command-line words; `{token}` values become env names. */
function serverJsonArgs(
  list: unknown,
  env: McpEnvRequirement[],
): { args: string[]; templated: boolean } {
  const args: string[] = [];
  let templated = false;
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const value =
      typeof entry.value === "string"
        ? entry.value
        : typeof entry.default === "string"
          ? entry.default
          : "";
    if (entry.type === "named" && typeof entry.name === "string") {
      // docker -e NAME={token}: pass NAME through from the server's own env instead.
      const envMatch = /^([A-Za-z_][A-Za-z0-9_]*)=\{[^}]+\}$/.exec(value);
      if (entry.name === "-e" && envMatch?.[1]) {
        args.push("-e", envMatch[1]);
        if (!env.some((item) => item.name === envMatch[1])) {
          env.push({
            name: envMatch[1],
            description: typeof entry.description === "string" ? entry.description : "",
            isRequired: entry.isRequired === true,
            isSecret: true,
          });
        }
        continue;
      }
      args.push(entry.name);
      if (value) args.push(value);
    } else if (value) {
      args.push(value);
    }
    if (/\{[^}]+\}/.test(value)) templated = true;
  }
  return { args, templated };
}

/** MCP Registry / server.json entries → candidates (rules 1 and 2). */
function fromServerJson(
  server: unknown,
  origin: string,
  fallbackVersion: string | null,
): McpCandidate[] {
  if (!server || typeof server !== "object") return [];
  const value = server as Record<string, unknown>;
  const candidates: McpCandidate[] = [];
  const title =
    typeof value.title === "string"
      ? value.title
      : typeof value.name === "string"
        ? value.name
        : "server";
  for (const raw of Array.isArray(value.packages) ? value.packages : []) {
    if (!raw || typeof raw !== "object") continue;
    const pkg = raw as Record<string, unknown>;
    const registryType = String(pkg.registryType ?? "");
    let identifier = typeof pkg.identifier === "string" ? pkg.identifier : "";
    let version = typeof pkg.version === "string" ? pkg.version : "";
    const transport = (pkg.transport ?? {}) as Record<string, unknown>;
    if (transport.type && transport.type !== "stdio") continue;
    const env = (Array.isArray(pkg.environmentVariables) ? pkg.environmentVariables : [])
      .map(requirementOf)
      .filter((entry): entry is McpEnvRequirement => entry !== null);
    const evidence = [
      `${origin}: ${registryType} package ${identifier}${version ? ` ${version}` : ""}`,
    ];
    // A repo's own server.json often holds a ${VERSION} template that its release fills in.
    if (/\$\{VERSION\}/.test(version) || /\$\{VERSION\}/.test(identifier)) {
      if (!fallbackVersion) continue;
      version = version.replace(/\$\{VERSION\}/g, fallbackVersion);
      identifier = identifier.replace(/\$\{VERSION\}/g, fallbackVersion);
      evidence.push(`version ${fallbackVersion} from the MCP Registry`);
    }
    const runtimeArgs = serverJsonArgs(pkg.runtimeArguments, env);
    const packageArgs = serverJsonArgs(pkg.packageArguments, env);
    const extra = [...packageArgs.args];
    if (registryType === "npm" && identifier && version) {
      candidates.push({
        id: id([origin, "npm", identifier, version]),
        label: `${title} (npm ${identifier}@${version})`,
        runtime: "node",
        server: {
          name: "",
          transport: "stdio",
          command: "npx",
          args: ["-y", `${identifier}@${version}`, ...extra],
          env: {},
        },
        install: { type: "npm", package: identifier, version },
        evidence,
        requiredEnv: env,
        placeholders: [],
        needs: ["node"],
      });
    } else if (registryType === "pypi" && identifier && version) {
      candidates.push({
        id: id([origin, "pypi", identifier, version]),
        label: `${title} (PyPI ${identifier} ${version})`,
        runtime: "python",
        server: {
          name: "",
          transport: "stdio",
          command: "uvx",
          args: [`${identifier}@${version}`, ...extra],
          env: {},
        },
        install: { type: "pypi", package: identifier, version, script: identifier },
        evidence,
        requiredEnv: env,
        placeholders: [],
        needs: ["uv"],
      });
    } else if (registryType === "oci" && identifier) {
      const image = identifier.includes(":") || !version ? identifier : `${identifier}:${version}`;
      const before = runtimeArgs.args.filter(
        (arg) => arg !== "run" && arg !== "-i" && arg !== "--rm",
      );
      // The registry lists the image itself as a runtime argument for some servers.
      const runArgs = before.filter((arg) => arg !== image.split(":")[0] && arg !== image);
      candidates.push({
        id: id([origin, "oci", image]),
        label: `${title} (Docker ${image})`,
        runtime: "docker",
        server: {
          name: "",
          transport: "stdio",
          command: "docker",
          args: ["run", "-i", "--rm", ...runArgs, image, ...extra],
          env: {},
        },
        install: { type: "oci", image },
        evidence: [...evidence, "needs Docker Desktop, which Sahkarmi never installs for you"],
        requiredEnv: env,
        placeholders: [],
        needs: ["docker"],
      });
    }
  }
  for (const raw of Array.isArray(value.remotes) ? value.remotes : []) {
    if (!raw || typeof raw !== "object") continue;
    const remote = raw as Record<string, unknown>;
    if (typeof remote.url !== "string" || !/^https:\/\//i.test(remote.url)) continue;
    if (/\{[^}]+\}/.test(remote.url)) continue;
    const headers = (Array.isArray(remote.headers) ? remote.headers : [])
      .map(requirementOf)
      .filter((entry): entry is McpEnvRequirement => entry !== null);
    candidates.push({
      id: id([origin, "remote", remote.url]),
      label: `${title} (hosted at ${new URL(remote.url).host})`,
      runtime: "remote",
      server: { name: "", transport: "http", url: remote.url, headers: {} },
      install: null,
      evidence: [`${origin}: ${String(remote.type ?? "http")} address ${remote.url}`],
      requiredEnv: headers,
      placeholders: [],
      needs: [],
    });
  }
  return candidates;
}

/** README / .mcp.json servers → candidates, with template values flagged (rule 3). */
function fromMcpJson(text: string, origin: string): McpCandidate[] {
  let servers: McpServerInput[] = [];
  try {
    servers = parseMcpJson(JSON.stringify(parseLooseJson(text))).servers;
  } catch {
    return [];
  }
  return servers.map((server) => {
    const hits = placeholderHits(server);
    const command = server.command ?? "";
    const runtime = /^(npx|node|npm|bunx)/i.test(command)
      ? "node"
      : /^(uvx?|python|py|pip)/i.test(command)
        ? "python"
        : /^docker/i.test(command)
          ? "docker"
          : server.transport === "http"
            ? "remote"
            : "other";
    const needs =
      runtime === "node"
        ? ["node"]
        : /^uvx?$/i.test(command)
          ? ["uv"]
          : runtime === "python"
            ? ["python"]
            : runtime === "docker"
              ? ["docker"]
              : [];
    return {
      id: id([origin, server.name, command, ...(server.args ?? []), server.url ?? ""]),
      label: `${server.name} (${server.transport === "http" ? server.url : [command, ...(server.args ?? [])].join(" ")})`,
      runtime,
      server: { ...server, env: server.env ?? {} },
      install: null,
      evidence: [origin],
      requiredEnv: Object.keys(server.env ?? {}).map((name) => ({
        name,
        description: "",
        isRequired: true,
        isSecret: SECRET.test(name),
      })),
      placeholders: hits.map((hit) => hit.token),
      needs,
    } satisfies McpCandidate;
  });
}

/** Env names a README's example config lists, to ask for them with a package candidate. */
function readmeEnv(candidates: McpCandidate[]): McpEnvRequirement[] {
  const seen = new Map<string, McpEnvRequirement>();
  for (const candidate of candidates) {
    for (const entry of candidate.requiredEnv)
      if (!seen.has(entry.name)) seen.set(entry.name, entry);
  }
  return [...seen.values()];
}

/**
 * The deterministic part of "Connect from GitHub" (audit §11.5, rules 1-8): registry, server.json,
 * .mcp.json / README JSON, manifests, code signals, Docker and negative signals, cheapest first.
 * README text is data: nothing found in it is ever run; it only shapes settings the owner reviews.
 */
export function classifyRepo(snapshot: RepoSnapshot): McpRepoAnalysis {
  const { location, texts } = snapshot;
  const evidence: string[] = [];
  const warnings: string[] = [];
  const candidates: McpCandidate[] = [];
  const text = (path: string) => texts[within(location, path)] ?? null;
  const readmePath = ["README.md", "README-en.md", "README_EN.md", "readme.md", "README"].find(
    (path) => text(path),
  );
  const readme = readmePath ? (text(readmePath) ?? "") : "";
  const codeTexts = Object.entries(texts).filter(([path]) => /\.(py|ts|js|mjs|go|rs)$/i.test(path));

  // Rule 1: the official MCP Registry.
  let registryVersion: string | null = null;
  for (const entry of snapshot.registry) {
    const server = (entry as { server?: unknown }).server ?? entry;
    const version = (server as { version?: unknown }).version;
    if (typeof version === "string" && !registryVersion) registryVersion = version;
    candidates.push(...fromServerJson(server, "MCP Registry", null));
  }
  if (snapshot.registry.length > 0) evidence.push("Listed in the official MCP Registry.");

  // Rule 2: the repo's own server.json (skipped when the registry already gave the same).
  const serverJson = text("server.json");
  if (serverJson) {
    evidence.push("Has a server.json (MCP server description).");
    try {
      for (const candidate of fromServerJson(
        JSON.parse(serverJson),
        "server.json",
        registryVersion,
      )) {
        if (!candidates.some((existing) => existing.label === candidate.label))
          candidates.push(candidate);
      }
    } catch {
      warnings.push("server.json could not be read.");
    }
  }

  // Rule 3: .mcp.json and README JSON blocks.
  const mcpJson = text(".mcp.json");
  if (mcpJson) candidates.push(...fromMcpJson(mcpJson, ".mcp.json"));
  const readmeCandidates: McpCandidate[] = [];
  for (const block of fencedBlocks(readme)) {
    if (!/"(mcpServers|servers|command|url)"/.test(block.body)) continue;
    readmeCandidates.push(...fromMcpJson(block.body, `${readmePath} line ${block.line}`));
  }
  candidates.push(...readmeCandidates);
  const docEnv = readmeEnv(readmeCandidates);
  const readmeRuns = (command: RegExp, name: string) =>
    readmeCandidates.some(
      (candidate) =>
        command.test(candidate.server?.command ?? "") &&
        (candidate.server?.args ?? []).some((arg) => arg.split(/@(?=\d)|==/)[0] === name),
    );

  // Rule 4: a Node manifest (root, the linked folder, or packages/* in a monorepo).
  const manifests: { path: string; pkg: PackageJson }[] = [];
  for (const file of snapshot.files) {
    const relative = location.subPath ? file.path.slice(location.subPath.length + 1) : file.path;
    if (!/^(package\.json|packages\/[^/]+\/package\.json)$/.test(relative)) continue;
    const pkg = text(relative) ? parsePackageJson(text(relative) ?? "") : null;
    if (pkg) manifests.push({ path: relative, pkg });
  }
  let nodeMcp = false;
  for (const { path, pkg } of manifests) {
    const mcpDep = pkg.dependencies.find((dep) => MCP_NODE_DEPS.test(dep));
    if (!mcpDep) continue;
    nodeMcp = true;
    evidence.push(`${path} uses ${mcpDep}.`);
    const name = pkg.name;
    const published = name ? snapshot.packages.npm?.[name] : null;
    const documented = name
      ? new RegExp(`npx\\s+(-y\\s+)?${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`).test(readme)
      : false;
    const owned =
      published &&
      (mentionsRepo(published.repository, location) ||
        documented ||
        readmeRuns(/^npx$/i, name ?? ""));
    if (name && published && owned && !pkg.private) {
      if (
        !candidates.some(
          (candidate) => candidate.install?.type === "npm" && candidate.install.package === name,
        )
      ) {
        candidates.push({
          id: id(["npm", name, published.version]),
          label: `${name} ${published.version} (npm)`,
          runtime: "node",
          server: {
            name: "",
            transport: "stdio",
            command: "npx",
            args: ["-y", `${name}@${published.version}`],
            env: {},
          },
          install: { type: "npm", package: name, version: published.version },
          evidence: [`${path}: package ${name}`, `published on npm (latest ${published.version})`],
          requiredEnv: docEnv,
          placeholders: [],
          needs: ["node"],
        });
      }
    } else if (Object.keys(pkg.bin).length > 0 || pkg.main) {
      const bin = Object.values(pkg.bin)[0] ?? pkg.main ?? "index.js";
      candidates.push({
        id: id(["clone-node", path, snapshot.location.ref]),
        label: `${name ?? location.repo} from source (build with npm)`,
        runtime: "node",
        install: {
          type: "clone-node",
          repoUrl: repoUrl(location),
          commit: snapshot.location.ref,
          subPath: within(location, path.replace(/\/?package\.json$/, "")).replace(/\/$/, ""),
          bin,
          build: pkg.buildScript,
        },
        evidence: [
          `${path}: start file ${bin}`,
          "not found on npm under this repo, so it is built from the source",
        ],
        requiredEnv: docEnv,
        placeholders: [],
        needs: ["node", "git"],
      });
    }
  }

  // Rule 5: a Python manifest.
  const pyText = text("pyproject.toml");
  const py = pyText ? parsePyProject(pyText) : null;
  const pyDeps = [
    ...(py?.dependencies.map(requirementName) ?? []),
    ...parseRequirements(text("requirements.txt") ?? ""),
  ];
  const pyMcpDep = pyDeps.find((dep) => MCP_PY_DEPS.test(dep));
  const scripts = Object.keys(py?.scripts ?? {});
  const pypi = py?.name ? snapshot.packages.pypi?.[py.name] : null;
  const pyDocumented = py?.name
    ? new RegExp(
        `(uvx|pip install|pipx run)\\s+${py.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      ).test(readme)
    : false;
  const pyOwned = Boolean(
    pypi &&
      (pypi.urls.some((url) => mentionsRepo(url, location)) ||
        pyDocumented ||
        (py?.name ? readmeRuns(/^(uvx|pipx)$/i, py.name) : false)),
  );
  if (py?.name && pypi && !pyOwned) {
    warnings.push(
      `A PyPI package named "${py.name}" exists but does not point to this repo, so it is not used.`,
    );
  }
  let pythonMcp = false;
  if (pyMcpDep) {
    pythonMcp = true;
    evidence.push(`${pyText ? "pyproject.toml" : "requirements.txt"} depends on ${pyMcpDep}.`);
    const script = scripts[0] ?? null;
    if (py?.name && pypi && pyOwned && script) {
      const args =
        script === py.name
          ? [`${py.name}@${pypi.version}`]
          : ["--from", `${py.name}==${pypi.version}`, script];
      candidates.unshift({
        id: id(["pypi", py.name, pypi.version]),
        label: `${py.name} ${pypi.version} (PyPI)`,
        runtime: "python",
        server: { name: "", transport: "stdio", command: "uvx", args, env: {} },
        install: {
          type: "pypi",
          package: py.name,
          version: pypi.version,
          script,
          ...(py.requiresPython ? { requiresPython: py.requiresPython } : {}),
        },
        evidence: [
          `pyproject.toml: package ${py.name}, command ${script}`,
          `published on PyPI (latest ${pypi.version})`,
        ],
        requiredEnv: docEnv,
        placeholders: [],
        needs: ["uv"],
      });
    } else {
      const entry =
        codeTexts
          .find(([, body]) => MCP_CODE.test(body))?.[0]
          ?.slice(location.subPath ? location.subPath.length + 1 : 0) ?? null;
      candidates.push({
        id: id(["clone-python", location.subPath, snapshot.location.ref]),
        label: `${py?.name ?? location.repo} from source (Python)`,
        runtime: "python",
        install: {
          type: "clone-python",
          repoUrl: repoUrl(location),
          commit: snapshot.location.ref,
          subPath: location.subPath,
          script,
          entry,
          ...(py?.requiresPython ? { requiresPython: py.requiresPython } : {}),
        },
        evidence: [
          script ? `pyproject.toml: command ${script}` : `start file ${entry ?? "(not found)"}`,
          "not published on PyPI by this repo, so it runs from a copy of the source",
        ],
        requiredEnv: docEnv,
        placeholders: [],
        needs: ["uv", "git"],
      });
    }
  }

  // Rule 6: code signals, when the manifests are unclear.
  const codeMcp = codeTexts.find(([, body]) => MCP_CODE.test(body));
  if (codeMcp && !nodeMcp && !pythonMcp) evidence.push(`${codeMcp[0]} creates an MCP server.`);

  // Rule 7: Docker.
  const dockerfile = text("Dockerfile");
  const dockerRun =
    /docker run\s+(?:-i\s+--rm|--rm\s+-i|-i)\b[^\n`]*?\s((?:ghcr\.io|docker\.io|mcp)\/[a-z0-9._/-]+(?::[A-Za-z0-9._-]+)?)/.exec(
      readme,
    );
  if (dockerRun?.[1] && !candidates.some((candidate) => candidate.runtime === "docker")) {
    candidates.push({
      id: id(["docker", dockerRun[1]]),
      label: `Docker image ${dockerRun[1]}`,
      runtime: "docker",
      server: {
        name: "",
        transport: "stdio",
        command: "docker",
        args: ["run", "-i", "--rm", dockerRun[1]],
        env: {},
      },
      install: { type: "oci", image: dockerRun[1] },
      evidence: [
        `${readmePath}: docker run ${dockerRun[1]}`,
        "needs Docker Desktop, which Sahkarmi never installs for you",
      ],
      requiredEnv: docEnv,
      placeholders: [],
      needs: ["docker"],
    });
  }
  if (dockerfile && candidates.length === 0 && (nodeMcp || pythonMcp || codeMcp)) {
    warnings.push(
      "It has a Dockerfile but no published image; build it yourself if you use Docker.",
    );
  }

  // Rule 8: negative signals (a web app, API or CLI, not an MCP server).
  const isMcp =
    candidates.length > 0 || nodeMcp || pythonMcp || Boolean(codeMcp) || Boolean(serverJson);
  const allDeps = [...pyDeps, ...manifests.flatMap(({ pkg }) => pkg.dependencies)];
  const webCode = codeTexts.find(([, body]) => WEB_CODE.test(body));
  const webDep = allDeps.find((dep) => WEB_DEPS.test(dep));
  const uiDep =
    allDeps.find((dep) => UI_DEPS.test(dep)) ??
    (dockerfile && /streamlit\s*"?,?\s*"?run/.test(dockerfile) ? "streamlit" : undefined);
  const notMcp: McpNotMcpKind[] = [];
  let cli: McpRepoAnalysis["cli"] = null;
  if (!isMcp) {
    if (py?.name && scripts.length > 0 && pypi && pyOwned) {
      notMcp.push("cli");
      cli = {
        package: py.name,
        version: pypi.version,
        script: scripts[0] as string,
        ...(py.requiresPython ? { requiresPython: py.requiresPython } : {}),
      };
      evidence.push(
        `Ships a command-line program "${scripts[0]}" (pip package ${py.name} ${pypi.version}).`,
      );
    }
    if (webCode || webDep) {
      notMcp.push("http-api");
      evidence.push(
        webCode ? `${webCode[0]} starts a web server.` : `Depends on ${webDep} (a web server).`,
      );
    }
    if (uiDep) {
      notMcp.push("webapp");
      evidence.push(`Has a browser app (${uiDep}).`);
    }
    if (notMcp.length > 0)
      evidence.push("No MCP library, server.json, .mcp.json or MCP code was found.");
  }

  const heavyDep = allDeps.find((dep) => HEAVY_DEPS.test(dep));
  if (heavyDep) warnings.push(`It uses ${heavyDep}, which is large and slow to load.`);

  // The best candidates first: exact registry or package settings, then hosted, then source, then templates.
  const rank = (candidate: McpCandidate) =>
    (candidate.placeholders.length > 0 ? 100 : 0) +
    (candidate.install?.type === "clone-node" || candidate.install?.type === "clone-python"
      ? 20
      : 0) +
    (candidate.runtime === "docker" ? 10 : 0) +
    (candidate.runtime === "remote" ? 5 : 0) +
    (candidate.install ? 0 : 2);
  candidates.sort((a, b) => rank(a) - rank(b));
  // READMEs often show the same settings twice (e.g. Claude Desktop and Cursor); keep the first.
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const key = JSON.stringify([
      candidate.install,
      candidate.server?.command,
      candidate.server?.args,
      candidate.server?.url,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let kind: McpRepoKind;
  if (notMcp.length > 0) kind = "not-mcp";
  else if (
    candidates.some(
      (candidate) =>
        candidate.server && candidate.placeholders.length === 0 && candidate.runtime !== "remote",
    )
  )
    kind = "mcp-stdio";
  else if (candidates.some((candidate) => candidate.runtime === "remote")) kind = "mcp-http";
  else if (candidates.length > 0 || isMcp) kind = "mcp-needs-build";
  else kind = "unknown";

  return {
    id: id([location.owner, location.repo, location.ref, location.subPath]),
    repo: `${location.owner}/${location.repo}`,
    url: repoUrl(location) + (location.subPath ? `/tree/${location.ref}/${location.subPath}` : ""),
    commit: location.ref,
    subPath: location.subPath,
    kind,
    notMcp,
    evidence,
    candidates: unique.slice(0, 12),
    cli,
    heavy: Boolean(heavyDep),
    warnings,
    truncated: snapshot.truncated === true,
  };
}

/** The small files worth reading for the rules (cap ~12 files). */
export function filesToRead(files: RepoEntry[], location: RepoLocation): string[] {
  const prefix = location.subPath ? `${location.subPath.replace(/\/+$/, "")}/` : "";
  const local = files.filter((file) => file.path.startsWith(prefix) && file.size <= 200_000);
  const relative = (file: RepoEntry) => file.path.slice(prefix.length);
  const pick = (pattern: RegExp, limit: number) =>
    local
      .filter((file) => pattern.test(relative(file)))
      .slice(0, limit)
      .map((file) => file.path);
  const wanted = [
    ...pick(/^(README(-en|_EN)?\.md|readme\.md)$/i, 1),
    ...pick(/^\.mcp\.json$/, 1),
    ...pick(/^server\.json$/, 1),
    ...pick(/^package\.json$/, 1),
    ...pick(/^packages\/[^/]+\/package\.json$/, 3),
    ...pick(/^pyproject\.toml$/, 1),
    ...pick(/^requirements\.txt$/, 1),
    ...pick(/^Dockerfile$/, 1),
    ...pick(/^smithery\.yaml$/, 1),
    ...pick(/^[^/]+\.py$/, 2),
    ...pick(
      /^(main|server|app|index|__main__)\.(py|ts|js|mjs)$|^src\/(index|server|main)\.(ts|js|py)$|^src\/[^/]+\/(server|__init__|__main__)\.py$/,
      3,
    ),
  ];
  return [...new Set(wanted)].slice(0, 14);
}
