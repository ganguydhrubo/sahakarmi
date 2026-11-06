import type { McpDiagnosis, McpDiagnosisCode, McpFixAction } from "../../shared/ipc";

/** What a failed "Test server" run left behind. */
export interface FailureEvidence {
  command: string;
  error: string;
  stderrTail: string;
  exitCode?: number | null;
  timedOut: boolean;
  /** No reply at all to `initialize` before the time ran out. */
  noReply: boolean;
  firstRun: boolean;
}

interface Rule {
  code: McpDiagnosisCode;
  fix?: McpFixAction;
  test: (evidence: FailureEvidence, text: string) => boolean;
}

const PYTHON = /(^|[\\/])(python[0-9.]*|py)(\.exe)?$/i;
const DOWNLOADER = /(^|[\\/])(npx|uvx|bunx|pnpx)(\.cmd|\.exe)?$/i;

/**
 * §11.7 of the audit: real error signatures → the cause in plain words and a fix. The first rule
 * that matches wins, so the more specific signatures come first.
 */
const RULES: Rule[] = [
  {
    code: "store-stub",
    fix: "install-python",
    test: (e, text) =>
      /Python was not found; run without arguments to install from the Microsoft Store/i.test(
        text,
      ) ||
      (e.exitCode === 9009 && PYTHON.test(e.command)),
  },
  {
    code: "build-tools",
    test: (_e, text) =>
      /Microsoft Visual C\+\+ 14\.0 or greater is required|linker `link\.exe` not found|gyp ERR!|error: can't find Rust compiler|CUDA_HOME/i.test(
        text,
      ),
  },
  {
    code: "python-version",
    fix: "install-python",
    test: (_e, text) =>
      /requires a different Python|Requires-Python|No interpreter found for Python|SyntaxError: .*match/i.test(
        text,
      ),
  },
  {
    code: "command-not-found",
    fix: "recheck",
    test: (e, text) =>
      /\bENOENT\b|is not recognized as an internal or external command|The system cannot find the file specified/i.test(
        `${e.error}\n${text}`,
      ) || e.exitCode === 9009,
  },
  {
    code: "long-path",
    fix: "reinstall",
    test: (_e, text) =>
      /Windows Long Path support|enable-long-paths|Filename too long|path too long|ENAMETOOLONG/i.test(
        text,
      ),
  },
  {
    code: "path-not-found",
    fix: "edit",
    test: (_e, text) =>
      /The system cannot find the path specified|No such file or directory|can't open file|failed to canonicalize|Directory not found/i.test(
        text,
      ),
  },
  {
    code: "module-missing",
    fix: "reinstall",
    test: (_e, text) =>
      /ModuleNotFoundError|No module named|Cannot find module|ERR_MODULE_NOT_FOUND|ImportError:/i.test(
        text,
      ),
  },
  {
    code: "port-in-use",
    fix: "shared-mode",
    test: (_e, text) =>
      /EADDRINUSE|address already in use|Only one usage of each socket address/i.test(text),
  },
  {
    code: "auth",
    fix: "edit",
    test: (_e, text) =>
      /\b(401|403)\b|Unauthorized|Forbidden|invalid (api )?(key|token)|Bad credentials|authentication failed|API key (is )?(missing|required|not set)/i.test(
        text,
      ),
  },
  {
    code: "stdout-noise",
    test: (_e, text) =>
      /Unexpected token .* in JSON|is not valid JSON|SyntaxError: JSON|Failed to parse JSON|invalid_union/i.test(
        text,
      ),
  },
  {
    code: "not-mcp",
    fix: "use-skill-route",
    test: (e, text) =>
      (e.noReply || e.timedOut) &&
      /Uvicorn running on|Running on http|Listening on|Local URL: http|You can now view your Streamlit app|server listening|Serving Flask app/i.test(
        text,
      ),
  },
  {
    code: "first-run-timeout",
    fix: "retry-long",
    test: (e) => e.timedOut && e.firstRun && DOWNLOADER.test(e.command),
  },
  {
    code: "no-reply",
    fix: "use-skill-route",
    test: (e) => e.timedOut && e.noReply,
  },
  {
    code: "exited",
    fix: "edit",
    test: (e) => !e.timedOut,
  },
];

export function diagnose(evidence: FailureEvidence): McpDiagnosis {
  const text = `${evidence.stderrTail}\n${evidence.error}`;
  for (const rule of RULES) {
    if (rule.test(evidence, text))
      return { code: rule.code, ...(rule.fix ? { fix: rule.fix } : {}) };
  }
  return { code: "unknown" };
}
