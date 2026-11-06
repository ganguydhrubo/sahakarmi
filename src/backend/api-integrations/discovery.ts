import type { ApiAuth, ApiDiscoverInput, ApiMissingField, ApiOperation } from "../../shared/ipc";
import { isRecord } from "../protocol";
import { hintForKey, providerKey } from "./key-hints";
import { absoluteUrl, type ParsedSpec, parseSpec, slug } from "./openapi";

export interface FetchedText {
  status: number;
  url: string;
  contentType: string;
  text: string;
}

/** Reads a public page or file (never with the owner's key). Injected so tests stay offline. */
export type TextFetcher = (url: string, maxBytes: number) => Promise<FetchedText>;

export interface DiscoveryResult {
  name: string;
  provider: string | null;
  baseUrl: string | null;
  docsUrl: string | null;
  specUrl: string | null;
  auth: ApiAuth | null;
  operations: ApiOperation[];
  operationTotal: number;
  testRequest: string | null;
  missing: ApiMissingField[];
  notes: string[];
}

const SPEC_BYTES = 15 * 1024 * 1024;
const PAGE_BYTES = 3 * 1024 * 1024;
const WELL_KNOWN_SPECS = [
  "/openapi.json",
  "/openapi.yaml",
  "/swagger.json",
  "/v3/api-docs",
  "/swagger/v1/swagger.json",
  "/api-docs",
];
const KEY_PARAMS =
  /^(appid|app_?key|api_?key|apikey|key|token|access_?key|access_?token|auth_?token)$/i;
const KEY_PLACEHOLDER =
  /(\{[^}]*key[^}]*\}|<[^>]*key[^>]*>|your[_-]?(api[_-]?)?key|api[_-]?key[_-]?here|\$\{?[A-Z_]*KEY\}?)/i;
const DIRECTORY = "https://api.apis.guru/v2";

/**
 * Works out how an API is used from the least the owner can give: the key, and optionally a
 * name and links. Specifications come first (the given link, links on the documentation page,
 * the usual addresses, then the public APIs.guru directory); without one, example requests on
 * the documentation page. Everything found is untrusted text: it only fills in fields.
 */
export async function discoverApi(
  input: ApiDiscoverInput,
  fetchText: TextFetcher,
): Promise<DiscoveryResult> {
  const notes: string[] = [];
  const key = input.apiKey.trim();
  const hint = hintForKey(key);
  let provider = input.name?.trim() || null;
  if (hint && !provider) {
    provider = hint.provider;
    notes.push(
      `The key looks like a ${hint.provider} key. This is only a guess until the tests confirm it.`,
    );
  } else if (!provider) {
    notes.push("The key alone does not say which service it is for.");
  }

  let docsUrl = absoluteUrl(input.docsUrl?.trim() ?? "", null) ?? hint?.docsUrl ?? null;
  let specUrl = absoluteUrl(input.specUrl?.trim() ?? "", null);
  const state: { spec: ParsedSpec | null } = { spec: null };
  let docsPage: FetchedText | null = null;

  const trySpec = async (url: string, label: string): Promise<boolean> => {
    try {
      const fetched = await fetchText(url, SPEC_BYTES);
      if (fetched.status >= 400) return false;
      const parsed = await parseSpec(fetched.text, fetched.url);
      if (!parsed || parsed.operations.length === 0) return false;
      state.spec = parsed;
      specUrl = fetched.url;
      notes.push(`Read the API description ${label}: ${parsed.total} endpoints.`);
      return true;
    } catch {
      return false;
    }
  };

  if (specUrl && !(await trySpec(specUrl, "from the link you gave"))) {
    notes.push("The OpenAPI/Swagger link could not be read as an API description.");
    specUrl = null;
  }
  if (!state.spec && docsUrl) {
    try {
      docsPage = await fetchText(docsUrl, PAGE_BYTES);
      if (docsPage.status >= 400) {
        notes.push(`The documentation page answered ${docsPage.status}.`);
        docsPage = null;
      } else if (!(await trySpec(docsPage.url, "from the documentation link"))) {
        for (const link of specLinks(docsPage.text, docsPage.url).slice(0, 6)) {
          if (await trySpec(link, "linked from the documentation")) break;
        }
      }
    } catch {
      notes.push("The documentation page could not be opened.");
    }
  }
  if (!state.spec && provider) {
    const listed = await directorySpec(provider, fetchText).catch(() => null);
    if (listed) await trySpec(listed, "from the public APIs.guru directory");
  }
  if (!state.spec) {
    const origins = new Set<string>();
    for (const url of [hint?.baseUrl, docsUrl]) {
      const origin = url ? safeOrigin(url) : null;
      if (origin) origins.add(origin);
    }
    search: for (const origin of origins) {
      for (const path of WELL_KNOWN_SPECS) {
        if (await trySpec(`${origin}${path}`, `at ${origin}${path}`)) break search;
      }
    }
  }

  const found = state.spec;
  let baseUrl = found?.baseUrl ?? null;
  let auth = found?.auth ?? null;
  let operations = found?.operations ?? [];
  let operationTotal = found?.total ?? 0;
  let testRequest: string | null = null;

  if (found) {
    const simple = operations.find(
      (operation) =>
        operation.method === "GET" &&
        !operation.path.includes("{") &&
        operation.params.every((param) => !param.required),
    );
    if (simple) testRequest = `GET ${simple.path}`;
  }
  if (!found && docsPage) {
    const examples = exampleRequests(docsPage.text, docsPage.url);
    if (examples) {
      baseUrl = examples.baseUrl;
      auth = auth ?? examples.auth;
      operations = examples.operations;
      operationTotal = examples.operations.length;
      testRequest = examples.testRequest;
      notes.push(
        `No API description was published, so Sahkarmi read ${examples.operations.length} example requests from the documentation page.`,
      );
    }
  }
  if (!found && !docsPage && !operations.length) {
    notes.push("No API description or documentation could be read yet.");
  }
  if (hint) {
    baseUrl = baseUrl ?? hint.baseUrl;
    auth = auth ?? hint.auth;
    testRequest = testRequest ?? (hint.testPath ? `GET ${hint.testPath}` : null);
  }
  if (auth) notes.push(`The key is sent ${describeAuth(auth)}.`);
  else if (baseUrl) notes.push("How the key is sent will be found by the tests.");

  docsUrl = docsPage?.url ?? docsUrl;
  const missing: ApiMissingField[] = [];
  if (!provider && !baseUrl) missing.push("provider");
  if (!baseUrl) missing.push("baseUrl");
  if (!testRequest) missing.push("example");
  return {
    name: input.name?.trim() || provider || found?.title || hostName(baseUrl) || "New API",
    provider: provider ?? found?.title ?? null,
    baseUrl,
    docsUrl,
    specUrl,
    auth,
    operations,
    operationTotal,
    testRequest,
    missing,
    notes,
  };
}

export function describeAuth(auth: ApiAuth): string {
  switch (auth.kind) {
    case "bearer":
      return "as a Bearer token in the Authorization header";
    case "header":
      return `in the ${auth.name} header`;
    case "query":
      return `as the "${auth.name}" query parameter`;
    case "basic":
      return "with basic sign-in (key as the user name)";
    default:
      return "nowhere (this API needs no key)";
  }
}

/** Links on a documentation page that look like an OpenAPI or Swagger file. */
export function specLinks(html: string, pageUrl: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/(?:href|src|url)\s*[=:]\s*["']([^"'\s]+)["']/gi)) {
    const raw = match[1] ?? "";
    if (!/(openapi|swagger|api-docs)[^"']*?(\.json|\.ya?ml)?$|\.(json|ya?ml)$/i.test(raw)) continue;
    if (!/(openapi|swagger|api-docs|spec)/i.test(raw)) continue;
    const absolute = absoluteUrl(raw, pageUrl);
    if (absolute) links.add(absolute);
  }
  return [...links];
}

/** The specification APIs.guru lists for a provider, matched by name or domain. */
async function directorySpec(provider: string, fetchText: TextFetcher): Promise<string | null> {
  const wanted = providerKey(provider);
  if (!wanted) return null;
  const providers = await fetchText(`${DIRECTORY}/providers.json`, PAGE_BYTES);
  const list = JSON.parse(providers.text) as unknown;
  const names = isRecord(list) && Array.isArray(list.data) ? list.data.map(String) : [];
  const match =
    names.find((name) => providerKey(name) === wanted) ??
    names.find((name) => providerKey(name).startsWith(wanted) && wanted.length >= 5);
  if (!match) return null;
  const apis = JSON.parse(
    (await fetchText(`${DIRECTORY}/${match}.json`, PAGE_BYTES)).text,
  ) as unknown;
  const entries = isRecord(apis) && isRecord(apis.apis) ? Object.values(apis.apis) : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !isRecord(entry.versions)) continue;
    const version = entry.versions[String(entry.preferred)] ?? Object.values(entry.versions)[0];
    if (!isRecord(version)) continue;
    const url = version.openapiUrl ?? version.swaggerUrl;
    if (typeof url === "string") return url;
  }
  return null;
}

/** Example requests shown on a documentation page, grouped under the address most use. */
export function exampleRequests(
  html: string,
  pageUrl: string,
): {
  baseUrl: string;
  auth: ApiAuth | null;
  operations: ApiOperation[];
  testRequest: string | null;
} | null {
  const text = decodeEntities(html.replace(/<[^>]+>/g, " "));
  const pageHost = safeHost(pageUrl);
  const byOrigin = new Map<string, URL[]>();
  for (const match of text.matchAll(/https?:\/\/[^\s"'`<>()\\]+/g)) {
    const raw = match[0].replace(/[.,;:]+$/, "");
    let url: URL;
    try {
      url = new URL(raw.replace(/\{/g, "%7B").replace(/\}/g, "%7D"));
    } catch {
      continue;
    }
    const apiLike =
      /^api\.|^api-/.test(url.hostname) ||
      /\/(api|v\d+(\.\d+)*)\//.test(`${url.pathname}/`) ||
      url.search.length > 1;
    if (
      !apiLike ||
      url.pathname.length < 2 ||
      /\.(png|jpe?g|svg|css|js|html?)$/i.test(url.pathname)
    )
      continue;
    if (url.hostname === pageHost && !/^api/.test(url.hostname) && !url.search) continue;
    const list = byOrigin.get(url.origin) ?? [];
    list.push(url);
    byOrigin.set(url.origin, list);
  }
  const [origin, urls] = [...byOrigin.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!origin || !urls) return null;

  let auth: ApiAuth | null = null;
  const operations = new Map<string, ApiOperation>();
  let testRequest: string | null = null;
  for (const url of urls) {
    const query: string[] = [];
    let realValues = true;
    for (const [name, value] of url.searchParams) {
      if (KEY_PARAMS.test(name) || KEY_PLACEHOLDER.test(decodeURIComponent(value))) {
        auth = auth ?? { kind: "query", name };
        continue;
      }
      if (/%7B|\{|<|YOUR|\.\.\./i.test(value) || !value) realValues = false;
      query.push(name);
    }
    const path = decodeURIComponent(url.pathname).replace(/\/+$/, "") || "/";
    if (/[{}<>]/.test(path)) realValues = false;
    const id = slug(`get${path}`);
    if (!operations.has(id)) {
      operations.set(id, {
        id,
        method: "GET",
        path,
        summary: "Example from the documentation",
        params: query.map((name) => ({
          name,
          in: "query",
          required: false,
          type: "string",
          description: "",
        })),
        risky: false,
      });
    }
    if (!testRequest && realValues) {
      const kept = [...url.searchParams].filter(
        ([name, value]) =>
          !KEY_PARAMS.test(name) && !KEY_PLACEHOLDER.test(decodeURIComponent(value)),
      );
      const search = new URLSearchParams(kept).toString();
      testRequest = `GET ${path}${search ? `?${search}` : ""}`;
    }
    if (operations.size >= 60) break;
  }
  if (!auth) {
    const header = text.match(/(X-[A-Za-z-]*(?:Key|Token)|Api-Key|apikey)\s*:\s*\S+/i);
    if (header?.[1]) auth = { kind: "header", name: header[1] };
    else if (/Authorization\s*:\s*Bearer/i.test(text)) auth = { kind: "bearer", name: null };
  }
  return { baseUrl: origin, auth, operations: [...operations.values()], testRequest };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function hostName(url: string | null): string | null {
  const host = url ? safeHost(url) : null;
  return host ? host.replace(/^(api|www)\./, "") : null;
}
