/**
 * Turns an error message into a stable "signature" so the same failure is recognised when it
 * comes back with a different file name, line number, id or time. Used to spot repeated
 * failures (and to stop retrying something that fails the same way every time).
 */

const MAX_INPUT = 2_000;
const MAX_SIGNATURE = 160;

/** Rules applied in order; later rules see the output of earlier ones. */
const RULES: Array<[RegExp, string]> = [
  [/\bhttps?:\/\/\S+/gi, "<url>"],
  // Windows and POSIX paths (with or without a drive letter).
  [/(?:[a-z]:)?(?:[\\/][\w.@()+-]+){2,}[\\/]?/gi, "<path>"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  [/\b[0-9a-f]{12,}\b/gi, "<hex>"],
  [/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?\b/gi, "<time>"],
  [/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds|minutes|min|kb|mb|gb|bytes)\b/gi, "<n><unit>"],
  [/\b(?:line|ln|col|column|port|pid|attempt)\s*[:#]?\s*\d+\b/gi, "$1 <n>"],
  [/\b\d+\b/g, "<n>"],
  [/(["'`])(?:(?!\1).){1,80}\1/g, "<q>"],
  [/\s+/g, " "],
];

export function errorSignature(message: string | null | undefined): string | null {
  const text = (message ?? "").trim();
  if (!text) return null;
  // The first line usually names the error; stack frames below it change with every build.
  const head =
    text
      .slice(0, MAX_INPUT)
      .split(/\r?\n/)
      .find((line) => line.trim()) ?? "";
  let signature = head.toLowerCase();
  for (const [pattern, replacement] of RULES) signature = signature.replace(pattern, replacement);
  signature = signature.trim();
  if (!signature) return null;
  return signature.length > MAX_SIGNATURE ? `${signature.slice(0, MAX_SIGNATURE - 1)}…` : signature;
}

/** Signals in a reply or log that something went wrong (counted, never trusted alone). */
const EXCEPTION_PATTERNS: Array<[string, RegExp]> = [
  ["python traceback", /traceback \(most recent call last\)/i],
  ["stack trace", /\n\s+at [\w$.<>]+ \(.+:\d+:\d+\)/],
  ["error line", /(?:^|\n)\s*(?:uncaught |unhandled )?(?:[A-Z]\w*)?(?:Error|Exception):\s+\S/],
  ["npm error", /\bnpm (?:ERR!|error)\b/i],
  ["missing file", /\bENOENT\b/],
  ["access denied", /\b(?:EACCES|EPERM|access is denied|permission denied)\b/i],
  [
    "command not found",
    /\b(?:command not found|is not recognized as an internal or external command)\b/i,
  ],
  ["exit code", /\bexit(?:ed)? (?:with )?code [1-9]\d*\b/i],
];

/** Plain-language admissions that the work was not done. */
const FAILURE_PHRASES: Array<[string, RegExp]> = [
  [
    "could not",
    /\b(?:i|we) (?:could not|couldn['’]t|was unable to|were unable to|am unable to|can['’]?not|can['’]t)\b/i,
  ],
  [
    "failed to",
    /\b(?:failed to|did not manage to|didn['’]t manage to|was not able to|wasn['’]t able to)\b/i,
  ],
  ["blocked", /\b(?:i am|i['’]m) (?:blocked|stuck)\b/i],
  ["not completed", /\b(?:not (?:been )?completed|incomplete|partially (?:done|completed))\b/i],
];

export interface ReplySignals {
  exceptions: string[];
  failurePhrases: string[];
}

export function replySignals(reply: string | null | undefined): ReplySignals {
  const text = (reply ?? "").slice(0, 20_000);
  return {
    exceptions: EXCEPTION_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
      ([name]) => name,
    ),
    failurePhrases: FAILURE_PHRASES.filter(([, pattern]) => pattern.test(text)).map(
      ([name]) => name,
    ),
  };
}

export interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  /** Which runner's summary line was read. */
  format: "vitest" | "jest" | "pytest" | "generic";
}

/**
 * Reads the summary line of common test runners. Only output Sahkarmi ran itself (the owner's
 * check command) is trusted; the same line inside a coworker's reply is only its claim.
 */
export function parseTestSummary(output: string | null | undefined): TestSummary | null {
  const text = output ?? "";
  // vitest: "Tests  2 failed | 40 passed (42)" or "Tests  42 passed (42)"
  const vitest = /^\s*Tests\s+((?:\d+\s+\w+\s*\|?\s*)+)\(\d+\)/m.exec(text);
  if (vitest) return counts(vitest[1] ?? "", "vitest");
  // jest: "Tests:       1 failed, 2 skipped, 12 passed, 15 total"
  const jest = /^\s*Tests:\s+(.+?)\s*,?\s*\d+\s+total/m.exec(text);
  if (jest) return counts(jest[1] ?? "", "jest");
  // pytest: "==== 3 failed, 10 passed, 1 skipped in 1.23s ===="
  const pytest =
    /=+\s*((?:\d+\s+(?:passed|failed|skipped|errors?|xfailed|xpassed),?\s*)+)\s+in\s+[\d.]+s/m.exec(
      text,
    );
  if (pytest) return counts(pytest[1] ?? "", "pytest");
  const generic = /\b(\d+)\s+passed\b(?:[^\n]*?\b(\d+)\s+failed\b)?/i.exec(text);
  if (generic) {
    return {
      passed: Number(generic[1] ?? 0),
      failed: Number(generic[2] ?? 0),
      skipped: 0,
      format: "generic",
    };
  }
  return null;
}

function counts(part: string, format: TestSummary["format"]): TestSummary {
  const read = (word: RegExp) => {
    const match = new RegExp(`(\\d+)\\s+${word.source}`, "i").exec(part);
    return match ? Number(match[1]) : 0;
  };
  return {
    passed: read(/passed/),
    failed: read(/failed/) + read(/errors?\b/),
    skipped: read(/skipped/) + read(/todo/),
    format,
  };
}
