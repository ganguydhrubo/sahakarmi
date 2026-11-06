import type { ApiAuth } from "../../shared/ipc";

export const REQUEST_TIMEOUT_MS = 20_000;
export const MAX_RETRIES = 2;
/** Requests per minute per API, so a looping coworker cannot burn the owner's quota. */
export const RATE_LIMIT_PER_MINUTE = 60;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_RETRY_WAIT_MS = 10_000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export interface ApiRequest {
  method: string;
  /** A path on the API's address, with its query, e.g. "/data/2.5/weather?q=Kolkata". */
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number | null;
  ok: boolean;
  ms: number;
  text: string;
  contentType: string;
  /** Rate-limit headers the API sent, e.g. "x-ratelimit-remaining: 59". */
  limits: string[];
  error: string | null;
  attempts: number;
}

export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The full URL for a request, or an error. The request can only reach the API's own address:
 * a full URL to another host, or a path that climbs out of the base path, is refused.
 */
export function requestUrl(baseUrl: string, request: ApiRequest): URL {
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const raw = request.path.trim();
  let url: URL;
  if (/^https?:\/\//i.test(raw)) {
    url = new URL(raw);
    if (url.origin !== base.origin)
      throw new Error(`Only ${base.origin} can be called with this API.`);
  } else {
    if (/(^|\/)\.\.(\/|$)/.test(raw.split("?")[0] ?? ""))
      throw new Error("The path may not contain '..'.");
    url = new URL(raw.replace(/^\/+/, ""), base);
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname.replace(/\/$/, ""))) {
    throw new Error(`Only addresses under ${baseUrl} can be called with this API.`);
  }
  for (const [name, value] of Object.entries(request.query ?? {}))
    url.searchParams.set(name, value);
  return url;
}

/** Adds the key the way the API expects it. */
export function applyAuth(url: URL, headers: Headers, auth: ApiAuth, key: string): void {
  switch (auth.kind) {
    case "bearer":
      headers.set("Authorization", `Bearer ${key}`);
      return;
    case "header":
      headers.set(auth.name || "X-API-Key", key);
      return;
    case "query":
      url.searchParams.set(auth.name || "api_key", key);
      return;
    case "basic":
      headers.set("Authorization", `Basic ${Buffer.from(`${key}:`).toString("base64")}`);
      return;
    default:
      return;
  }
}

/** Removes the key (and its encodings) from any text that leaves this module. */
export function redactKey(text: string, key: string): string {
  if (!key || key.length < 4) return text;
  let result = text;
  for (const form of new Set([
    key,
    encodeURIComponent(key),
    Buffer.from(`${key}:`).toString("base64"),
  ])) {
    result = result.split(form).join("[key hidden]");
  }
  return result;
}

/** A sliding one-minute window per API. */
export class RateLimiter {
  readonly #calls = new Map<string, number[]>();
  readonly #limit: number;
  readonly #now: () => number;

  constructor(limit = RATE_LIMIT_PER_MINUTE, now: () => number = Date.now) {
    this.#limit = limit;
    this.#now = now;
  }

  /** Null when the call may go ahead (and it is counted), else seconds to wait. */
  take(id: string): number | null {
    const now = this.#now();
    const recent = (this.#calls.get(id) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= this.#limit) {
      this.#calls.set(id, recent);
      return Math.ceil((60_000 - (now - (recent[0] ?? now))) / 1000);
    }
    recent.push(now);
    this.#calls.set(id, recent);
    return null;
  }
}

export interface SendOptions {
  baseUrl: string;
  auth: ApiAuth;
  key: string;
  request: ApiRequest;
  fetch?: HttpFetch;
  timeoutMs?: number;
  /** Waits between retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sends one request on demand: no connection or process stays open afterwards. Reading
 * requests are retried on network errors and 429/502/503/504; anything that changes data is
 * retried only on 429, when the API says it did nothing.
 */
export async function sendApiRequest(options: SendOptions): Promise<ApiResponse> {
  const started = Date.now();
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const method = options.request.method.toUpperCase();
  const safe = method === "GET" || method === "HEAD";
  let url: URL;
  try {
    url = requestUrl(options.baseUrl, options.request);
  } catch (error) {
    return failure(started, error instanceof Error ? error.message : String(error), 0);
  }
  const headers = new Headers({ Accept: "application/json, text/plain;q=0.9, */*;q=0.5" });
  headers.set("User-Agent", "Sahkarmi");
  for (const [name, value] of Object.entries(options.request.headers ?? {})) {
    if (!/^(authorization|cookie|host|content-length)$/i.test(name)) headers.set(name, value);
  }
  applyAuth(url, headers, options.auth, options.key);
  let body: string | undefined;
  if (options.request.body !== undefined && !safe) {
    body =
      typeof options.request.body === "string"
        ? options.request.body
        : JSON.stringify(options.request.body);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  }

  let attempts = 0;
  for (;;) {
    attempts += 1;
    try {
      const response = await doFetch(url.toString(), {
        method,
        headers,
        body,
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
      const retryable = response.status === 429 || (safe && RETRY_STATUSES.has(response.status));
      if (retryable && attempts <= MAX_RETRIES) {
        await response.body?.cancel().catch(() => undefined);
        await sleep(retryWait(response.headers.get("retry-after"), attempts));
        continue;
      }
      const text = redactKey(await readCapped(response), options.key);
      return {
        status: response.status,
        ok: response.ok,
        ms: Date.now() - started,
        text,
        contentType: response.headers.get("content-type") ?? "",
        limits: [...response.headers.entries()]
          .filter(([name]) => /ratelimit|rate-limit|retry-after/i.test(name))
          .map(([name, value]) => `${name}: ${value}`)
          .slice(0, 6),
        error: response.ok ? null : `The API answered ${response.status}.`,
        attempts,
      };
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      if (safe && attempts <= MAX_RETRIES) {
        await sleep(retryWait(null, attempts));
        continue;
      }
      const message = timedOut
        ? `The API did not answer within ${Math.round((options.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000)} s.`
        : `Could not reach the API: ${error instanceof Error ? error.message : String(error)}`;
      return failure(started, redactKey(message, options.key), attempts);
    }
  }
}

function retryWait(header: string | null, attempt: number): number {
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  const date = header ? Date.parse(header) : Number.NaN;
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_WAIT_MS);
  return 1000 * attempt;
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.byteLength;
    if (size >= MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

function failure(started: number, error: string, attempts: number): ApiResponse {
  return {
    status: null,
    ok: false,
    ms: Date.now() - started,
    text: "",
    contentType: "",
    limits: [],
    error,
    attempts,
  };
}
