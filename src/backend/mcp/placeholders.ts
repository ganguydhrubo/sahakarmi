/**
 * Template values copied from READMEs ("/ABSOLUTE/PATH/TO/...", "<your_api_key>", "YOUR_TOKEN").
 * A server holding one can never start, so it is flagged on save and import and kept off until
 * the owner replaces it (MCP-1).
 */

export type PlaceholderField = "command" | "args" | "env" | "url" | "headers" | "cwd";

export interface PlaceholderHit {
  field: PlaceholderField;
  /** The env or header name, for those fields. */
  key?: string;
  /** The template part found, e.g. "/ABSOLUTE/PATH/TO" or "<dir_to>". */
  token: string;
}

const PATTERNS: RegExp[] = [
  /\/ABSOLUTE\/PATH\/TO[^\s"']*/i,
  /(?:^|[\s"'=])(?:\/|~\/)?(?:full\/)?path\/to\/[^\s"']*/i,
  /\\path\\to\\[^\s"']*/i,
  /<[A-Za-z][A-Za-z0-9 _./-]{0,60}>/,
  /\$\{[A-Za-z_][A-Za-z0-9_]*\}/,
  /\{\{?[A-Za-z_][A-Za-z0-9_]{0,40}\}?\}/,
  /\bYOUR[_-][A-Z0-9_-]+\b/,
  /\byour[_-][a-z0-9_-]+(?:[_-](?:here|key|token))\b/i,
  /^(?:x{3,}|\.{3}|\*{3,}|changeme|replace[_-]?me|todo|tbd|insert[_-].*|enter[_-].*)$/i,
];

/** The first template token in `value`, or null. */
export function findPlaceholder(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0].trim().replace(/^["'=]/, "");
  }
  return null;
}

/** Every template value in a server's settings. */
export function placeholderHits(server: {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  cwd?: string;
}): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  const check = (field: PlaceholderField, value: string | undefined, key?: string) => {
    const token = value ? findPlaceholder(value) : null;
    if (token) hits.push({ field, token, ...(key ? { key } : {}) });
  };
  check("command", server.command);
  for (const arg of server.args ?? []) check("args", arg);
  for (const [key, value] of Object.entries(server.env ?? {})) check("env", value, key);
  check("url", server.url);
  for (const [key, value] of Object.entries(server.headers ?? {})) check("headers", value, key);
  check("cwd", server.cwd);
  return hits;
}
