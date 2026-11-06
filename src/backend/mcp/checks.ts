import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { McpProblem } from "../../shared/ipc";
import { placeholderHits } from "./placeholders";
import { lookupCommand } from "./windows-env";

/** Where to get a missing command, and the one-click fix Sahkarmi offers for it. */
export function installHint(command: string): Pick<McpProblem, "link" | "fix"> {
  const name = command
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
  if (name === "uv" || name === "uvx") {
    return { link: "https://docs.astral.sh/uv/getting-started/installation/", fix: "install-uv" };
  }
  if (name === "npx" || name === "node" || name === "npm") {
    return { link: "https://nodejs.org/en/download", fix: "install-node" };
  }
  if (name === "python" || name === "python3" || name === "py") {
    return { link: "https://www.python.org/downloads/windows/", fix: "install-python" };
  }
  if (name === "docker") return { link: "https://www.docker.com/products/docker-desktop/" };
  if (name === "git") return { link: "https://git-scm.com/download/win" };
  return {};
}

const SCRIPT = /\.(py|js|mjs|cjs|ts|jar)$/i;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Folders and files named in the arguments: `--directory X` (uv), `-C X`, `--project X` and script
 * files like server.py (MCP-5). Relative scripts are looked up in `cwd` or the --directory folder.
 */
export function argumentPaths(
  args: string[],
  cwd?: string,
): { folders: string[]; files: string[] } {
  const folders: string[] = [];
  const files: string[] = [];
  let base = cwd && isAbsolute(cwd) ? cwd : undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? "";
    const flag = /^(--directory|--project|--cwd|-C)$/.exec(arg);
    const inline = /^(--directory|--project|--cwd)=(.+)$/.exec(arg);
    const folder = flag ? args[index + 1] : inline?.[2];
    if (folder) {
      folders.push(folder);
      if (isAbsolute(folder)) base = folder;
      if (flag) index++;
      continue;
    }
    if (SCRIPT.test(arg) && !/^[-@]/.test(arg) && !/^https?:/i.test(arg)) {
      if (isAbsolute(arg)) files.push(arg);
      else if (base) files.push(join(base, arg));
    }
  }
  return { folders, files };
}

export interface CheckableServer {
  transport: "stdio" | "http";
  command: string;
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  cwd?: string;
  requiredEnv?: { name: string; isRequired?: boolean }[];
}

/**
 * Everything Settings can tell the owner before a coworker tries the server, one entry per
 * problem with its own advice (MCP-6): a template value, a missing command, the Store's Python
 * stub, a missing folder or file, or a required key not filled in.
 */
export function serverProblems(server: CheckableServer, env: NodeJS.ProcessEnv): McpProblem[] {
  const problems: McpProblem[] = [];
  for (const hit of placeholderHits(server)) {
    problems.push({
      kind: "placeholder",
      subject: hit.key ? `${hit.key}` : hit.token,
      detail: hit.token,
      fix: "edit",
    });
  }
  if (server.transport === "stdio") {
    const templated = problems.length > 0;
    const lookup = lookupCommand(server.command, env);
    if (!lookup.path && !templated) {
      problems.push(
        lookup.storeStub
          ? {
              kind: "store-stub",
              subject: server.command,
              fix: "install-python",
              link: "https://www.python.org/downloads/windows/",
            }
          : { kind: "missing-command", subject: server.command, ...installHint(server.command) },
      );
    }
    if (server.cwd && !templated && !isDirectory(server.cwd)) {
      problems.push({ kind: "missing-folder", subject: server.cwd, fix: "edit" });
    }
    const { folders, files } = templated
      ? { folders: [], files: [] }
      : argumentPaths(server.args, server.cwd);
    let folderMissing = false;
    for (const folder of folders) {
      const full = isAbsolute(folder) ? folder : server.cwd ? resolve(server.cwd, folder) : null;
      if (full && !isDirectory(full)) {
        folderMissing = true;
        problems.push({ kind: "missing-folder", subject: folder, fix: "edit" });
      }
    }
    // A script inside a missing folder is missing too; saying so twice only adds noise.
    for (const file of folderMissing ? [] : files) {
      if (!existsSync(file)) problems.push({ kind: "missing-file", subject: file, fix: "edit" });
    }
  }
  for (const required of server.requiredEnv ?? []) {
    if (!required.isRequired) continue;
    const value =
      server.transport === "http" ? server.headers[required.name] : server.env[required.name];
    if (!value) problems.push({ kind: "missing-env", subject: required.name, fix: "edit" });
  }
  return problems;
}
