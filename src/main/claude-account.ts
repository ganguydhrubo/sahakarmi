import { cp, mkdir, readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Sahkarmi's own Claude sign-in lives here, apart from the owner's Claude Code sign-in. */
export const CLAUDE_ACCOUNT_DIR = "claude-account";

/** Claude keeps a session's transcript under projects/<cwd with separators as dashes>. */
const SAHKARMI_PROJECT = /-Sahkarmi-Coworkers-/i;

/**
 * Gives every Claude process Sahkarmi starts (sign-in, sign-in check, coworker sessions, model
 * list) its own config folder through CLAUDE_CONFIG_DIR. Sharing ~/.claude with Claude Code
 * meant one .credentials.json for two accounts: whichever signed in or refreshed last won, so
 * Sahkarmi kept flipping to "sign-in required" and queued every message to a Claude coworker.
 *
 * Existing coworker transcripts move into the new folder once, so their chats still resume.
 * An owner-set CLAUDE_CONFIG_DIR is kept as it is.
 */
export async function useOwnClaudeAccount(
  userData: string,
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const preset = env.CLAUDE_CONFIG_DIR?.trim();
  if (preset) return preset;
  const dir = join(userData, CLAUDE_ACCOUNT_DIR);
  const projects = join(dir, "projects");
  await mkdir(projects, { recursive: true });
  const oldProjects = join(home, ".claude", "projects");
  const moved = new Set(await readdir(projects).catch(() => [] as string[]));
  for (const name of await readdir(oldProjects).catch(() => [] as string[])) {
    if (!SAHKARMI_PROJECT.test(name) || moved.has(name)) continue;
    const from = join(oldProjects, name);
    const to = join(projects, name);
    // Same drive, so a rename is instant; a locked file (Claude still running) falls back to a copy.
    await rename(from, to).catch(() =>
      cp(from, to, { recursive: true, errorOnExist: false }).catch(() => undefined),
    );
  }
  env.CLAUDE_CONFIG_DIR = dir;
  return dir;
}
