import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  OrchestratorTask,
  OrchestratorVerificationEvidence,
  OrchestratorVerificationVerdict,
} from "../shared/ipc";

const execFileAsync = promisify(execFile);

/** Asks the owner's permission rules whether a command may run (the same gate coworkers use). */
export type CheckAuthorizer = (input: {
  botId: string | null;
  command: string;
  cwd: string;
}) => Promise<{ allowed: boolean; reason: string }>;

export interface VerificationCheckOptions {
  /** The coworker's own folder: relative file names in its reply are looked up here first. */
  workspacePath: string;
  /** The Shared folder, for names like "Shared/report.pdf" or absolute paths inside it. */
  sharedRoot?: string | null;
  /** The coworker's final reply, where it says which files it made. */
  reply?: string | null;
  /** The owner's own check for this run (e.g. "npm test"), run only through the permission gate. */
  checkCommand?: string | null;
  /** Where the owner's check runs. */
  checkCwd?: string | null;
  botId?: string | null;
}

export interface VerificationResult {
  /** "failed" stops (or repairs) the task; "unverified" lets it finish, labelled honestly. */
  verdict: OrchestratorVerificationVerdict;
  passed: boolean;
  evidence: OrchestratorVerificationEvidence[];
}

const FILE_EXTENSIONS =
  "md|txt|pdf|docx?|xlsx?|csv|tsv|pptx?|json|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|ipynb|sql|png|jpe?g|gif|webp|svg|mp3|wav|mp4|mov|zip|log";
const PATH_TOKEN = new RegExp(
  // Bare names have no spaces; a name with spaces must be quoted or back-ticked.
  `(?:[A-Za-z]:[\\\\/]|\\.{1,2}[\\\\/]|[\\\\/])?(?:[\\w\\-.()&@+]+[\\\\/])*[\\w\\-.()&@+]+\\.(?:${FILE_EXTENSIONS})\\b`,
  "gi",
);
const QUOTED = /[`"“']([^`"“”'\n]{3,260})[`"”']/g;

/**
 * File names a reply claims to have made: quoted or back-ticked paths first, then bare names
 * with a known file extension. Web addresses are not files. At most 20.
 */
export function claimedFiles(reply: string | null | undefined): string[] {
  if (!reply) return [];
  const text = reply.replace(/\bhttps?:\/\/\S+/gi, " ");
  const found = new Set<string>();
  const add = (candidate: string) => {
    const trimmed = candidate.trim().replace(/[.,;:)]+$/, "");
    if (!trimmed || /^(?:e\.g|i\.e)\b/i.test(trimmed)) return;
    if (new RegExp(`\\.(?:${FILE_EXTENSIONS})$`, "i").test(trimmed)) found.add(trimmed);
  };
  for (const match of text.matchAll(QUOTED)) add(match[1] ?? "");
  for (const match of text.replace(QUOTED, " ").matchAll(PATH_TOKEN)) add(match[0]);
  return [...found].slice(0, 20);
}

function inside(path: string, root: string | null | undefined): boolean {
  if (!root) return false;
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Where a claimed file may be: absolute inside the coworker's folder or Shared, or relative. */
function candidatePaths(name: string, options: VerificationCheckOptions): string[] | null {
  const cleaned = normalize(name.replace(/^["'`]|["'`]$/g, ""));
  if (isAbsolute(cleaned)) {
    return inside(cleaned, options.workspacePath) || inside(cleaned, options.sharedRoot)
      ? [cleaned]
      : null;
  }
  const paths = [join(options.workspacePath, cleaned)];
  const shared = /^shared[\\/](.+)$/i.exec(cleaned);
  if (options.sharedRoot) {
    paths.push(
      shared ? join(options.sharedRoot, shared[1] ?? "") : join(options.sharedRoot, cleaned),
    );
  }
  return paths.filter(
    (path) => inside(path, options.workspacePath) || inside(path, options.sharedRoot),
  );
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

function evidence(
  type: OrchestratorVerificationEvidence["type"],
  verdict: OrchestratorVerificationVerdict,
  summary: string,
  output?: string,
): OrchestratorVerificationEvidence {
  return {
    type,
    passed: verdict !== "failed",
    verdict,
    summary,
    ...(output ? { output } : {}),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Checks a finished task against outside evidence only, never the coworker's own opinion: the
 * files it says it made must exist and not be empty, and the owner's own check command (when
 * the owner set one) must pass. With nothing to check, the task is "unverified", not "passed".
 */
export class VerificationRepairEngine {
  readonly #maxAttempts = 3;
  readonly #authorize: CheckAuthorizer | null;
  readonly #checkTimeoutMs: number;

  constructor(authorize: CheckAuthorizer | null = null, checkTimeoutMs = 5 * 60_000) {
    this.#authorize = authorize;
    this.#checkTimeoutMs = checkTimeoutMs;
  }

  async verifyTask(
    task: OrchestratorTask,
    options: VerificationCheckOptions,
  ): Promise<VerificationResult> {
    const evidenceList: OrchestratorVerificationEvidence[] = [];
    const files = await this.#verifyFiles(task, options);
    if (files) evidenceList.push(files);
    if (files?.verdict !== "failed" && options.checkCommand?.trim()) {
      evidenceList.push(await this.#runOwnerCheck(options));
    }
    const verdict: OrchestratorVerificationVerdict = evidenceList.some(
      (item) => item.verdict === "failed",
    )
      ? "failed"
      : evidenceList.some((item) => item.verdict === "passed")
        ? "passed"
        : "unverified";
    if (evidenceList.length === 0) {
      evidenceList.push(
        evidence(
          "review",
          "unverified",
          "Not verified: the reply names no files to check and this run has no check command.",
        ),
      );
    }
    return { verdict, passed: verdict !== "failed", evidence: evidenceList };
  }

  handleVerificationResult(
    task: OrchestratorTask,
    passed: boolean,
    newEvidence: OrchestratorVerificationEvidence[],
  ): OrchestratorTask {
    const updated = { ...task };
    updated.evidence = [...updated.evidence, ...newEvidence];

    if (passed) {
      updated.status = "completed";
      updated.error = null;
      updated.verification = newEvidence.some((e) => e.verdict === "passed")
        ? "verified"
        : "unverified";
    } else {
      updated.attemptCount += 1;
      const failedEvidence = newEvidence.find((e) => !e.passed);
      const failureReason = failedEvidence
        ? `Verification failed (${failedEvidence.type}): ${failedEvidence.summary}`
        : "Verification checks failed";

      if (updated.attemptCount < (updated.maxAttempts || this.#maxAttempts)) {
        updated.status = "repairing";
        updated.error = `${failureReason}. Initiating repair cycle ${updated.attemptCount}/${updated.maxAttempts}.`;
      } else {
        updated.status = "failed";
        updated.error = `${failureReason}. Max repair attempts reached (${updated.attemptCount}/${updated.maxAttempts}).`;
      }
    }

    return updated;
  }

  /** Every file the task or reply names must exist and have content. Null: nothing named. */
  async #verifyFiles(
    task: OrchestratorTask,
    options: VerificationCheckOptions,
  ): Promise<OrchestratorVerificationEvidence | null> {
    const named = [
      ...task.deliverables.flatMap((item) => (item.path ? [item.path] : [])),
      ...claimedFiles(options.reply),
    ];
    const unique = [...new Set(named)];
    if (unique.length === 0) return null;
    const missing: string[] = [];
    const empty: string[] = [];
    const outside: string[] = [];
    const found: string[] = [];
    for (const name of unique) {
      const candidates = candidatePaths(name, options);
      if (!candidates) {
        outside.push(name);
        continue;
      }
      let size: number | null = null;
      for (const path of candidates) {
        size = await fileSize(path);
        if (size !== null) break;
      }
      if (size === null) missing.push(name);
      else if (size === 0) empty.push(name);
      else found.push(name);
    }
    const problems = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      empty.length ? `empty: ${empty.join(", ")}` : "",
    ].filter(Boolean);
    if (problems.length > 0) {
      return evidence(
        "files",
        "failed",
        `Files the coworker named are not there (${problems.join("; ")}).`,
      );
    }
    if (found.length === 0) {
      return evidence(
        "files",
        "unverified",
        `Not verified: the named files are outside this coworker's folder and the Shared folder (${outside.join(", ")}).`,
      );
    }
    return evidence(
      "files",
      "passed",
      `Found ${found.length} file(s) with content: ${found.join(", ")}.${outside.length ? ` Not checked (outside the coworker's folders): ${outside.join(", ")}.` : ""}`,
    );
  }

  /** The owner's own check, only when the permission rules allow it (or the owner approves). */
  async #runOwnerCheck(
    options: VerificationCheckOptions,
  ): Promise<OrchestratorVerificationEvidence> {
    const command = options.checkCommand?.trim() ?? "";
    const cwd = options.checkCwd || options.workspacePath;
    if (!this.#authorize) {
      return evidence("check", "unverified", `Not run: no permission gate for "${command}".`);
    }
    const permission = await this.#authorize({ botId: options.botId ?? null, command, cwd }).catch(
      (error: unknown) => ({ allowed: false, reason: String(error) }),
    );
    if (!permission.allowed) {
      return evidence("check", "unverified", `Not run: ${permission.reason}`);
    }
    const isWindows = process.platform === "win32";
    try {
      const { stdout, stderr } = await execFileAsync(
        isWindows ? "cmd.exe" : "/bin/sh",
        [isWindows ? "/d /s /c" : "-c", isWindows ? `"${command}"` : command],
        { cwd, timeout: this.#checkTimeoutMs, windowsVerbatimArguments: isWindows },
      );
      return evidence(
        "check",
        "passed",
        `${command} passed.`,
        `${stdout || ""}\n${stderr || ""}`.trim().slice(-3000),
      );
    } catch (error) {
      const execErr = error as { stdout?: string; stderr?: string; message?: string };
      const output =
        `${execErr.stdout || ""}\n${execErr.stderr || ""}\n${execErr.message || ""}`.trim();
      return evidence("check", "failed", `${command} failed.`, output.slice(-3000));
    }
  }
}
