import type { ApiAuth, ApiOperation, ApiParam } from "../../shared/ipc";
import { isRecord } from "../protocol";

/** Endpoints kept per API: enough for real work, small enough for a coworker to read. */
export const MAX_OPERATIONS = 300;

const METHODS = ["get", "post", "put", "patch", "delete", "head"] as const;
const SAFE_METHODS = new Set(["GET", "HEAD"]);
/** Word starts that mean a real-world effect, even on a "chat" or "search" path. */
const EFFECT_WORDS = [
  "send",
  "publish",
  "upload",
  "order",
  "purchase",
  "cancel",
  "subscribe",
  "invite",
  "book",
  "delete",
  "remove",
  "destroy",
  "pay",
  "charge",
  "refund",
  "transfer",
  "payout",
];
/** Word starts of calls that only compute or look something up. */
const READ_WORDS = [
  "search",
  "query",
  "lookup",
  "find",
  "completion",
  "chat",
  "generat",
  "embed",
  "translat",
  "transcri",
  "classif",
  "predict",
  "analy",
  "calculat",
  "convert",
  "validat",
  "estimat",
  "moderat",
  "summar",
  "detect",
  "recogni",
  "geocod",
  "forecast",
  "count",
  "infer",
];

/**
 * Whether a call changes something outside Sahkarmi and so asks the owner first. Reading
 * methods never ask. A POST that only computes or searches (chat completions, embeddings,
 * search) does not ask either, so normal work is never interrupted; any other write does.
 */
export function isRiskyOperation(method: string, path: string, words = ""): boolean {
  const upper = method.toUpperCase();
  if (SAFE_METHODS.has(upper)) return false;
  if (upper !== "POST") return true;
  const text = `${path} ${words}`;
  if (/post_?message/i.test(text)) return true;
  const tokens = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  const has = (list: string[]) =>
    tokens.some((token) => list.some((word) => token.startsWith(word)));
  if (has(EFFECT_WORDS)) return true;
  return !has(READ_WORDS);
}

export interface ParsedSpec {
  title: string | null;
  baseUrl: string | null;
  auth: ApiAuth | null;
  operations: ApiOperation[];
  total: number;
}

/** Reads an OpenAPI 3 or Swagger 2 document (JSON or YAML text). Null when it is neither. */
export async function parseSpec(
  text: string,
  sourceUrl: string | null,
): Promise<ParsedSpec | null> {
  const document = await readDocument(text);
  if (!isRecord(document)) return null;
  const isOpenApi = typeof document.openapi === "string";
  const isSwagger = typeof document.swagger === "string";
  if ((!isOpenApi && !isSwagger) || !isRecord(document.paths)) return null;

  const info = isRecord(document.info) ? document.info : {};
  const title = typeof info.title === "string" ? info.title.trim() || null : null;
  const operations: ApiOperation[] = [];
  let total = 0;
  for (const [path, item] of Object.entries(document.paths)) {
    if (!isRecord(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) continue;
      total += 1;
      operations.push(readOperation(document, path, method, operation, shared, isSwagger));
    }
  }
  // Reading endpoints first: they are what most questions need and never ask the owner.
  operations.sort((a, b) => Number(a.risky) - Number(b.risky));
  return {
    title,
    baseUrl: isOpenApi ? openApiBase(document, sourceUrl) : swaggerBase(document, sourceUrl),
    auth: readAuth(document, isSwagger),
    operations: uniqueIds(operations.slice(0, MAX_OPERATIONS)),
    total,
  };
}

async function readDocument(text: string): Promise<unknown> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!/^\s*(openapi|swagger)\s*:/m.test(trimmed)) return null;
  // Loaded only when a YAML specification is actually read.
  const { parse } = await import("yaml");
  try {
    return parse(trimmed, { maxAliasCount: 100 });
  } catch {
    return null;
  }
}

function readOperation(
  document: Record<string, unknown>,
  path: string,
  method: string,
  operation: Record<string, unknown>,
  shared: unknown[],
  isSwagger: boolean,
): ApiOperation {
  const upper = method.toUpperCase();
  const params: ApiParam[] = [];
  const seen = new Set<string>();
  for (const raw of [
    ...(Array.isArray(operation.parameters) ? operation.parameters : []),
    ...shared,
  ]) {
    const param = resolve(document, raw);
    if (!isRecord(param) || typeof param.name !== "string") continue;
    const where = param.in;
    if (where === "body") {
      params.push({
        name: "body",
        in: "body",
        required: param.required === true,
        type: "object",
        description: text(param.description),
      });
      continue;
    }
    if (where !== "path" && where !== "query" && where !== "header") continue;
    const key = `${where}:${param.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const schema = isRecord(param.schema) ? resolve(document, param.schema) : param;
    params.push({
      name: param.name,
      in: where,
      required: where === "path" || param.required === true,
      type: isRecord(schema) && typeof schema.type === "string" ? schema.type : "string",
      description: text(param.description),
      ...exampleOf(param, isRecord(schema) ? schema : null),
    });
  }
  if (!isSwagger && isRecord(resolve(document, operation.requestBody))) {
    const body = resolve(document, operation.requestBody) as Record<string, unknown>;
    params.push({
      name: "body",
      in: "body",
      required: body.required === true,
      type: "object",
      description: text(body.description),
    });
  }
  const summary = text(operation.summary) || text(operation.description).slice(0, 160);
  const rawId =
    typeof operation.operationId === "string" ? operation.operationId : `${method}_${path}`;
  return {
    id: slug(rawId),
    method: upper,
    path,
    summary,
    params,
    risky: isRiskyOperation(upper, path, `${rawId} ${summary}`),
  };
}

function openApiBase(document: Record<string, unknown>, sourceUrl: string | null): string | null {
  const servers = Array.isArray(document.servers) ? document.servers.filter(isRecord) : [];
  for (const server of servers) {
    if (typeof server.url !== "string") continue;
    let url = server.url;
    const variables = isRecord(server.variables) ? server.variables : {};
    url = url.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const variable = variables[name];
      return isRecord(variable) && typeof variable.default === "string" ? variable.default : "";
    });
    const absolute = absoluteUrl(url, sourceUrl);
    if (absolute) return absolute;
  }
  return sourceUrl ? new URL(sourceUrl).origin : null;
}

function swaggerBase(document: Record<string, unknown>, sourceUrl: string | null): string | null {
  const schemes = Array.isArray(document.schemes) ? document.schemes : [];
  const scheme = schemes.includes("https")
    ? "https"
    : typeof schemes[0] === "string"
      ? schemes[0]
      : "https";
  const basePath = typeof document.basePath === "string" ? document.basePath : "";
  if (typeof document.host === "string" && document.host) {
    return absoluteUrl(`${scheme}://${document.host}${basePath}`, null);
  }
  return sourceUrl ? absoluteUrl(basePath || "/", sourceUrl) : null;
}

function readAuth(document: Record<string, unknown>, isSwagger: boolean): ApiAuth | null {
  const components = isRecord(document.components) ? document.components : {};
  const schemes = isSwagger ? document.securityDefinitions : components.securitySchemes;
  if (!isRecord(schemes)) return null;
  const found: ApiAuth[] = [];
  for (const raw of Object.values(schemes)) {
    const scheme = resolve(document, raw);
    if (!isRecord(scheme)) continue;
    if (scheme.type === "apiKey" && typeof scheme.name === "string") {
      if (scheme.in === "header") {
        found.push(
          /^authorization$/i.test(scheme.name)
            ? { kind: "bearer", name: null }
            : { kind: "header", name: scheme.name },
        );
      } else if (scheme.in === "query") found.push({ kind: "query", name: scheme.name });
    } else if (scheme.type === "http" && typeof scheme.scheme === "string") {
      if (/^bearer$/i.test(scheme.scheme)) found.push({ kind: "bearer", name: null });
      else if (/^basic$/i.test(scheme.scheme)) found.push({ kind: "basic", name: null });
    } else if (scheme.type === "basic") {
      found.push({ kind: "basic", name: null });
    } else if (scheme.type === "oauth2" || scheme.type === "openIdConnect") {
      // A pasted token is sent the same way an OAuth access token is.
      found.push({ kind: "bearer", name: null });
    }
  }
  // An API key scheme is the most likely match for a pasted key.
  return found.find((auth) => auth.kind === "header" || auth.kind === "query") ?? found[0] ?? null;
}

function resolve(document: Record<string, unknown>, value: unknown, depth = 0): unknown {
  if (!isRecord(value) || typeof value.$ref !== "string" || depth > 8) return value;
  const ref = value.$ref;
  if (!ref.startsWith("#/")) return value;
  let current: unknown = document;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return resolve(document, current, depth + 1);
}

function uniqueIds(operations: ApiOperation[]): ApiOperation[] {
  const used = new Map<string, number>();
  return operations.map((operation) => {
    const count = used.get(operation.id) ?? 0;
    used.set(operation.id, count + 1);
    return count === 0 ? operation : { ...operation, id: `${operation.id}_${count + 1}` };
  });
}

function exampleOf(
  param: Record<string, unknown>,
  schema: Record<string, unknown> | null,
): { example?: string } {
  const items = schema && isRecord(schema.items) ? schema.items : null;
  for (const value of [
    param.example,
    schema?.default,
    schema?.example,
    Array.isArray(schema?.enum) ? schema.enum[0] : undefined,
    items && Array.isArray(items.enum) ? items.enum[0] : undefined,
    param.default,
    Array.isArray(param.enum) ? param.enum[0] : undefined,
  ]) {
    if (typeof value === "string" && value) return { example: value.slice(0, 200) };
    if (typeof value === "number" || typeof value === "boolean") return { example: String(value) };
  }
  return {};
}

/**
 * A reading request built only from what the specification says: no path values to invent,
 * and every required query value given by the specification. Null when that is not possible.
 */
export function sampleRequest(operation: ApiOperation): string | null {
  if (operation.method !== "GET" || operation.path.includes("{")) return null;
  const query = new URLSearchParams();
  for (const param of operation.params) {
    if (!param.required) continue;
    if (param.in !== "query" || param.example === undefined) return null;
    query.set(param.name, param.example);
  }
  const search = query.toString();
  return `GET ${operation.path}${search ? `?${search}` : ""}`;
}

export function absoluteUrl(url: string, base: string | null): string | null {
  try {
    const parsed = base ? new URL(url, base) : new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function slug(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "operation"
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 300) : "";
}
