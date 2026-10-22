import { execFile } from "node:child_process";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ToolExecutionContext {
  instanceId: string;
  botId: string;
  role: string;
  workspacePath: string;
  toolPermissions: string[];
}

export interface ToolExecutionResult {
  tool: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

export class ToolRegistry {
  readonly #registeredTools = new Set<string>([
    "read_file",
    "write_file",
    "list_files",
    "execute_command",
    "run_tests",
    "check_types",
    "run_lint",
  ]);

  isToolRegistered(name: string): boolean {
    return this.#registeredTools.has(name);
  }

  isPermitted(toolName: string, permissions: string[]): boolean {
    if (permissions.includes("*") || permissions.includes("all")) {
      return true;
    }
    return permissions.includes(toolName);
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    if (!this.#registeredTools.has(toolName)) {
      return {
        tool: toolName,
        success: false,
        output: "",
        error: `Unknown tool: "${toolName}"`,
        durationMs: Date.now() - startTime,
      };
    }

    if (!this.isPermitted(toolName, context.toolPermissions)) {
      return {
        tool: toolName,
        success: false,
        output: "",
        error: `Permission denied: instance "${context.instanceId}" cannot invoke "${toolName}"`,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      let rawOutput = "";
      switch (toolName) {
        case "read_file": {
          const filePath = this.#resolveSafePath(String(args.path ?? ""), context.workspacePath);
          const stats = await stat(filePath);
          if (stats.size > 2 * 1024 * 1024) {
            throw new Error(`File is too large (${stats.size} bytes). Limit is 2MB.`);
          }
          rawOutput = await readFile(filePath, "utf8");
          break;
        }
        case "write_file": {
          const filePath = this.#resolveSafePath(String(args.path ?? ""), context.workspacePath);
          const content = String(args.content ?? "");
          await writeFile(filePath, content, "utf8");
          rawOutput = `Successfully wrote ${content.length} characters to ${filePath}`;
          break;
        }
        case "list_files": {
          const dirPath = this.#resolveSafePath(String(args.path ?? "."), context.workspacePath);
          const entries = await readdir(dirPath, { withFileTypes: true });
          const listing = entries.map((e) => `${e.isDirectory() ? "[DIR]" : "[FILE]"} ${e.name}`);
          rawOutput = listing.join("\n");
          break;
        }
        case "execute_command": {
          const command = String(args.command ?? "").trim();
          if (!command) throw new Error("No command provided.");
          rawOutput = await this.#runProcess(command, context.workspacePath);
          break;
        }
        case "run_tests": {
          rawOutput = await this.#runProcess("bun test", context.workspacePath);
          break;
        }
        case "check_types": {
          rawOutput = await this.#runProcess("bun x tsc --noEmit", context.workspacePath);
          break;
        }
        case "run_lint": {
          rawOutput = await this.#runProcess("bun x biome check .", context.workspacePath);
          break;
        }
      }

      return {
        tool: toolName,
        success: true,
        output: this.#redactSecrets(rawOutput),
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        tool: toolName,
        success: false,
        output: "",
        error: this.#redactSecrets(message),
        durationMs: Date.now() - startTime,
      };
    }
  }

  #resolveSafePath(targetPath: string, workspaceRoot: string): string {
    const normalizedWorkspace = resolve(workspaceRoot);
    const resolvedPath = isAbsolute(targetPath)
      ? resolve(targetPath)
      : resolve(normalizedWorkspace, targetPath);

    const rel = relative(normalizedWorkspace, resolvedPath);
    if (rel.startsWith("..") && !resolvedPath.startsWith(normalizedWorkspace)) {
      throw new Error(`Access outside workspace boundary rejected: ${targetPath}`);
    }
    return resolvedPath;
  }

  async #runProcess(commandLine: string, cwd: string): Promise<string> {
    const isWindows = process.platform === "win32";
    const shell = isWindows ? "cmd.exe" : "/bin/sh";
    const flag = isWindows ? "/c" : "-c";

    const { stdout, stderr } = await execFileAsync(shell, [flag, commandLine], {
      cwd,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      windowsVerbatimArguments: isWindows,
    });

    return `${stdout || ""}\n${stderr || ""}`.trim();
  }

  #redactSecrets(content: string): string {
    if (!content) return content;
    // Redact standard API keys, tokens, bearer headers
    return content
      .replace(/(AIza[0-9A-Za-z-_]{35})/g, "AIza[REDACTED_API_KEY]")
      .replace(/(sk-ant-[0-9A-Za-z-_]{32,})/g, "sk-ant-[REDACTED_ANTHROPIC_KEY]")
      .replace(/(sk-[0-9A-Za-z]{32,})/g, "sk-[REDACTED_OPENAI_KEY]")
      .replace(/(bearer\s+)([a-zA-Z0-9_\-.]{16,})/gi, "$1[REDACTED_BEARER_TOKEN]")
      .replace(/(ghp_[0-9A-Za-z]{36})/g, "ghp_[REDACTED_GITHUB_TOKEN]");
  }
}
