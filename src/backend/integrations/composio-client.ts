import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../protocol";
import { COMPOSIO_CATALOG, COMPOSIO_LOGO_BASE } from "./composio-catalog";
import { describeTool, isActionSensitive } from "./composio-policy";
import type {
  ComposioAppMeta,
  ComposioConnection,
  ComposioConnectionInitiateResult,
  ComposioConnectionState,
  ComposioConnectionStatus,
  ComposioDynamicTool,
  ComposioExecuteResult,
  ComposioStatus,
  ComposioToolkitRecord,
  ComposioToolRecord,
} from "./types";

/**
 * Composio over plain HTTPS. Their v1 and v2 endpoints were removed (they answer 410);
 * v3.1 is the current API: https://backend.composio.dev/api/v3.1
 */
export const DEFAULT_COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3.1";
/** One owner per install. The API key is the tenant boundary; coworkers share the owner's connections. */
export const OWNER_USER_ID = "sahkarmi-owner";
/** Composio's Hobby plan: $0, no card, hard-capped at this many tool calls a month. */
export const HOBBY_PLAN_TOOL_CALLS = 100_000;
export const HOBBY_PLAN_NAME = "Hobby";
export const COMPOSIO_DASHBOARD_URL = "https://dashboard.composio.dev";

const KEY_FILE = "composio_api_key.txt";
const CATALOGUE_FILE = "composio_toolkits.json";
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;
const TOOLS_TTL_MS = 30 * 60 * 1000;
const CONNECTIONS_TTL_MS = 60 * 1000;
const CATALOGUE_PAGE = 1000;
const MAX_PAGES = 5;
const MAX_TOOLS_PER_TOOLKIT = 40;
const MAX_TOOLS_TOTAL = 200;
const MAX_IN_FLIGHT = 4;
const METADATA_TIMEOUT_MS = 15_000;
const EXECUTE_TIMEOUT_MS = 45_000;
const MAX_BACKOFF_MS = 8_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const BREAKER_TRIP_AFTER = 5;
const BREAKER_OPEN_MS = 60_000;
const DESCRIPTION_CHARS = 500;

/** Composio's own logo for a toolkit; works without a key. */
export function composioLogoUrl(slug: string): string {
  return `${COMPOSIO_LOGO_BASE}${encodeURIComponent(slug)}`;
}

/**
 * Every app Composio lists publicly, bundled so the Apps tab is complete before the owner has
 * added a key. The live catalogue from Composio's API replaces it once a key is saved.
 */
export const FALLBACK_TOOLKITS: ComposioToolkitRecord[] = COMPOSIO_CATALOG.map(
  ([slug, name, description, category, auth]) => ({
    slug,
    name,
    description,
    logo: composioLogoUrl(slug),
    categories: category ? [category] : [],
    toolsCount: null,
    authSchemes: auth === "oauth" ? ["OAUTH2"] : auth === "api-key" ? ["API_KEY"] : [],
    managedAuthSchemes: auth === "oauth" ? ["OAUTH2"] : [],
    noAuth: auth === "none",
  }),
);

export const CURATED_APPS: ComposioAppMeta[] = FALLBACK_TOOLKITS.map((toolkit) =>
  appFromToolkit(toolkit),
);

export interface ComposioClientOptions {
  userDataPath: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  baseRetryDelayMs?: number;
  now?: () => number;
}

interface CacheEntry<T> {
  at: number;
  value: T;
}

interface RequestOptions {
  key: string;
  timeoutMs: number;
  /** Retries for 5xx answers and network failures. 429s have their own budget. */
  retries: number;
}

interface CatalogueFile {
  version: 1;
  at: number;
  items: ComposioToolkitRecord[];
}

/**
 * Talks to Composio for the whole app: the owner's key, the toolkit catalogue, the owner's
 * connected accounts, the tools of each connected toolkit and tool execution. Built to sit
 * quietly inside a desktop app on many machines at once: every list is cached, identical
 * requests in flight are shared, at most four requests run at a time, 429 and 5xx answers back
 * off with jitter, every call has a deadline, and five failures in a row pause Composio calls
 * for a minute instead of piling up.
 */
export class ComposioClient {
  readonly #userDataPath: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  readonly #baseRetryDelayMs: number;
  readonly #now: () => number;
  #cachedKey: string | null = null;
  #keyLoaded = false;
  #circuit = { failures: 0, trippedUntil: 0 };
  #inFlight = 0;
  readonly #waiters: Array<() => void> = [];
  #catalogue: CacheEntry<ComposioToolkitRecord[]> | null = null;
  #catalogueLoad: Promise<ComposioToolkitRecord[]> | null = null;
  #catalogueError: string | null = null;
  #connections: CacheEntry<ComposioConnection[]> | null = null;
  #connectionsLoad: Promise<ComposioConnection[]> | null = null;
  readonly #tools = new Map<string, CacheEntry<ComposioToolRecord[]>>();
  readonly #toolsLoad = new Map<string, Promise<ComposioToolRecord[]>>();
  readonly #toolToolkit = new Map<string, string>();
  readonly #toolNames = new Map<string, string>();
  readonly #authConfigs = new Map<string, string>();

  constructor(options: ComposioClientOptions) {
    this.#userDataPath = options.userDataPath;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#baseUrl = (options.baseUrl ?? DEFAULT_COMPOSIO_BASE_URL).replace(/\/+$/, "");
    this.#baseRetryDelayMs = options.baseRetryDelayMs ?? 500;
    this.#now = options.now ?? (() => Date.now());
  }

  get keyFilePath(): string {
    return join(this.#userDataPath, KEY_FILE);
  }

  get catalogueFilePath(): string {
    return join(this.#userDataPath, CATALOGUE_FILE);
  }

  get circuitState(): { isOpen: boolean; failures: number; trippedUntil: number } {
    return {
      isOpen: this.#now() < this.#circuit.trippedUntil,
      failures: this.#circuit.failures,
      trippedUntil: this.#circuit.trippedUntil,
    };
  }

  /** Forget every cached list. The key and the on-disk catalogue stay. */
  resetCaches(): void {
    this.#catalogue = null;
    this.#connections = null;
    this.#tools.clear();
    this.#toolToolkit.clear();
    this.#toolNames.clear();
    this.#authConfigs.clear();
  }

  // ----- API key -----------------------------------------------------------------------------

  /** The environment variable wins; otherwise the key file in userData. Never written back to the environment. */
  async getApiKey(): Promise<string | null> {
    if (this.#keyLoaded) return this.#cachedKey;
    const fromEnv = process.env.COMPOSIO_API_KEY?.trim();
    if (fromEnv) {
      this.#cachedKey = fromEnv;
      this.#keyLoaded = true;
      return fromEnv;
    }
    try {
      const key = (await readFile(this.keyFilePath, "utf8")).trim();
      this.#cachedKey = key || null;
    } catch {
      this.#cachedKey = null;
    }
    this.#keyLoaded = true;
    return this.#cachedKey;
  }

  /** Saves the key after Composio has accepted it once; an empty key removes the saved one. */
  async setApiKey(key: string, options: { verify?: boolean } = {}): Promise<ComposioStatus> {
    const trimmed = normalizeComposioKey(key);
    if (/^ck_/i.test(trimmed)) {
      throw new Error(
        "That is a Composio Connect key (it starts with ck_). Sahkarmi needs a Platform key, which starts with ak_: on dashboard.composio.dev choose Platform on the left, then Settings → API keys.",
      );
    }
    if (/^uak_/i.test(trimmed)) {
      throw new Error(
        "That is a Composio user key (it starts with uak_). Sahkarmi needs the Project API key, which starts with ak_: dashboard.composio.dev → Settings → API keys.",
      );
    }
    if (!trimmed) {
      this.#cachedKey = null;
      this.#keyLoaded = true;
      await writeFile(this.keyFilePath, "", { encoding: "utf8", mode: 0o600 }).catch(
        () => undefined,
      );
      this.resetCaches();
      return this.getStatus();
    }
    if (options.verify !== false) {
      const url = new URL(`${this.#baseUrl}/auth_configs`);
      url.searchParams.set("limit", "1");
      const res = await this.#request(
        url.toString(),
        { method: "GET" },
        { key: trimmed, timeoutMs: METADATA_TIMEOUT_MS, retries: 1 },
      );
      if (res.status === 401) {
        const reason = await composioReason(res);
        throw new Error(
          `Composio says this key is not valid${reason ? ` (${reason})` : ""}. Copy the Project API key again from dashboard.composio.dev → Settings → API keys; it starts with ak_.`,
        );
      }
      if (res.status === 403) {
        throw new Error(
          "This Composio key is limited and cannot manage app sign-ins. Create a full Project API key under dashboard.composio.dev → Settings → API keys and paste that one.",
        );
      }
      if (!res.ok) throw new Error(await this.#failure("check the key", res));
    }
    await writeFile(this.keyFilePath, `${trimmed}\n`, { encoding: "utf8", mode: 0o600 });
    this.#cachedKey = trimmed;
    this.#keyLoaded = true;
    this.resetCaches();
    return this.getStatus();
  }

  async getStatus(): Promise<ComposioStatus> {
    const key = await this.getApiKey();
    const base = {
      freeTierActive: true,
      monthlyQuota: HOBBY_PLAN_TOOL_CALLS,
      planName: HOBBY_PLAN_NAME,
      catalogueError: this.#catalogueError,
    };
    if (!key) {
      return {
        ...base,
        configured: false,
        apiKeyMasked: null,
        connectedCount: 0,
        catalogueSize: FALLBACK_TOOLKITS.length,
      };
    }
    let connectedCount = 0;
    try {
      connectedCount = activeConnections(await this.#connectionsGet(key)).size;
    } catch {
      // Offline or paused: the count stays at zero until the next refresh.
    }
    return {
      ...base,
      configured: true,
      apiKeyMasked: maskKey(key),
      connectedCount,
      catalogueSize: this.#catalogue?.value.length ?? FALLBACK_TOOLKITS.length,
    };
  }

  // ----- Apps and connections ----------------------------------------------------------------

  /** Every toolkit Composio offers, with the owner's connection where one exists. */
  async listApps(refresh = false): Promise<ComposioAppMeta[]> {
    const key = await this.getApiKey();
    if (!key) return FALLBACK_TOOLKITS.map((toolkit) => appFromToolkit(toolkit));
    const [catalogue, connections] = await Promise.all([
      this.#catalogueGet(key, refresh).catch(() => FALLBACK_TOOLKITS),
      this.#connectionsGet(key, refresh).catch(() => [] as ComposioConnection[]),
    ]);
    const active = activeConnections(connections);
    const apps = catalogue.map((toolkit) => appFromToolkit(toolkit, active.get(toolkit.slug)));
    for (const [slug, connection] of active) {
      if (catalogue.some((toolkit) => toolkit.slug === slug)) continue;
      apps.push(
        appFromToolkit(
          {
            slug,
            name: slug,
            description: "",
            logo: null,
            categories: [],
            toolsCount: null,
            authSchemes: [],
            managedAuthSchemes: [],
            noAuth: false,
          },
          connection,
        ),
      );
    }
    return apps;
  }

  /** Starts Composio's hosted sign-in for a toolkit and returns the page to open. */
  async initiateConnection(appId: string): Promise<ComposioConnectionInitiateResult> {
    const key = await this.getApiKey();
    if (!key) throw new Error("Add your Composio key first (Marketplace → Apps).");
    const slug = appId.trim().toLowerCase();
    if (!slug) throw new Error("Which app should be connected?");
    const catalogue = await this.#catalogueGet(key).catch(() => FALLBACK_TOOLKITS);
    const toolkit: ComposioToolkitRecord = catalogue.find((item) => item.slug === slug) ?? {
      slug,
      name: slug,
      description: "",
      logo: null,
      categories: [],
      toolsCount: null,
      authSchemes: [],
      managedAuthSchemes: ["OAUTH2"],
      noAuth: false,
    };
    const authConfigId = await this.#ensureAuthConfig(toolkit, key);
    const res = await this.#request(
      `${this.#baseUrl}/connected_accounts/link`,
      {
        method: "POST",
        body: JSON.stringify({ auth_config_id: authConfigId, user_id: OWNER_USER_ID }),
      },
      { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 1 },
    );
    if (!res.ok) throw new Error(await this.#failure(`connect ${toolkit.name}`, res));
    const json = await readJson(res);
    const redirectUrl =
      isRecord(json) && typeof json.redirect_url === "string" ? json.redirect_url : "";
    const connectionId =
      isRecord(json) && typeof json.connected_account_id === "string"
        ? json.connected_account_id
        : "";
    if (!redirectUrl) throw new Error("Composio did not return a sign-in link.");
    this.#connections = null;
    return { connectionId, redirectUrl };
  }

  async getConnectionStatus(connectionId: string): Promise<ComposioConnectionStatus> {
    const key = await this.getApiKey();
    if (!key || !connectionId) {
      return { connectionId, status: "UNKNOWN", state: "unknown" };
    }
    const res = await this.#request(
      `${this.#baseUrl}/connected_accounts/${encodeURIComponent(connectionId)}`,
      { method: "GET" },
      { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 1 },
    );
    if (res.status === 404) return { connectionId, status: "NOT_FOUND", state: "failed" };
    if (!res.ok) throw new Error(await this.#failure("check the connection", res));
    const json = await readJson(res);
    const status = isRecord(json) && typeof json.status === "string" ? json.status : "UNKNOWN";
    const state = connectionState(status);
    if (state === "connected") this.#connections = null;
    return { connectionId, status, state };
  }

  async deleteConnection(connectionId: string): Promise<boolean> {
    const key = await this.getApiKey();
    if (!key || !connectionId) return false;
    const res = await this.#request(
      `${this.#baseUrl}/connected_accounts/${encodeURIComponent(connectionId)}`,
      { method: "DELETE" },
      { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 1 },
    );
    this.#connections = null;
    this.#tools.clear();
    return res.ok || res.status === 404;
  }

  // ----- Tools for coworkers -----------------------------------------------------------------

  /** The important tools of every connected toolkit, with Composio's real input schemas. */
  async getDynamicTools(): Promise<ComposioDynamicTool[]> {
    const key = await this.getApiKey();
    if (!key) return [];
    const active = activeConnections(await this.#connectionsGet(key));
    const tools: ComposioDynamicTool[] = [];
    for (const slug of active.keys()) {
      if (tools.length >= MAX_TOOLS_TOTAL) break;
      let records: ComposioToolRecord[];
      try {
        records = await this.#toolkitTools(slug, key);
      } catch {
        continue; // One toolkit's listing failing must not take the others down.
      }
      for (const record of records) {
        if (tools.length >= MAX_TOOLS_TOTAL) break;
        tools.push(dynamicTool(record));
      }
    }
    return tools;
  }

  /** Human words for an approval card: which toolkit, which tool. Best effort, never throws. */
  describeAction(toolSlug: string): { toolkit: string; name: string } {
    const slug = toolSlug.toUpperCase().replace(/-/g, "_");
    const toolkitSlug = this.#toolToolkit.get(slug) ?? this.#guessToolkit(slug);
    const toolkit =
      (toolkitSlug &&
        (this.#catalogue?.value.find((item) => item.slug === toolkitSlug)?.name ??
          FALLBACK_TOOLKITS.find((item) => item.slug === toolkitSlug)?.name)) ||
      (toolkitSlug ? describeTool(toolkitSlug) : "Composio");
    const name = this.#toolNames.get(slug) ?? describeTool(slug, toolkitSlug ?? undefined);
    return { toolkit, name };
  }

  async executeAction(
    toolSlug: string,
    args: Record<string, unknown>,
  ): Promise<ComposioExecuteResult> {
    const slug = toolSlug.toUpperCase().replace(/-/g, "_");
    const key = await this.getApiKey();
    if (!key) {
      return {
        success: false,
        error:
          "Composio is not set up yet. Ask the owner to add their free Composio key in Marketplace → Apps.",
      };
    }
    try {
      const account = await this.#accountForTool(slug, key);
      const body = account
        ? { connected_account_id: account.id, arguments: args }
        : { user_id: OWNER_USER_ID, arguments: args };
      const res = await this.#request(
        `${this.#baseUrl}/tools/execute/${encodeURIComponent(slug)}`,
        { method: "POST", body: JSON.stringify(body) },
        {
          key,
          timeoutMs: EXECUTE_TIMEOUT_MS,
          // A send or a delete must not be repeated on a 5xx: it may already have happened.
          retries: isActionSensitive(slug) ? 0 : 2,
        },
      );
      if (!res.ok) return { success: false, error: await this.#failure(`run ${slug}`, res) };
      const json = await readJson(res);
      if (!isRecord(json)) return { success: true, data: json ?? null };
      if (json.successful === false) {
        return {
          success: false,
          data: json.data,
          error:
            typeof json.error === "string" && json.error
              ? json.error
              : "Composio reported that the action failed.",
        };
      }
      return { success: true, data: json.data ?? null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ----- Catalogue ---------------------------------------------------------------------------

  async #catalogueGet(key: string, refresh = false): Promise<ComposioToolkitRecord[]> {
    const now = this.#now();
    if (!refresh && this.#catalogue && now - this.#catalogue.at < CATALOGUE_TTL_MS) {
      return this.#catalogue.value;
    }
    if (!this.#catalogue) {
      const stored = await this.#readCatalogueFile();
      if (stored) this.#catalogue = stored;
      if (!refresh && stored && now - stored.at < CATALOGUE_TTL_MS) return stored.value;
    }
    if (this.#catalogueLoad) return this.#catalogueLoad;
    this.#catalogueLoad = this.#fetchCatalogue(key)
      .then(async (items) => {
        this.#catalogue = { at: this.#now(), value: items };
        this.#catalogueError = null;
        await this.#writeCatalogueFile(this.#catalogue).catch(() => undefined);
        return items;
      })
      .catch((error: unknown) => {
        this.#catalogueError = error instanceof Error ? error.message : String(error);
        if (this.#catalogue) return this.#catalogue.value;
        throw error;
      })
      .finally(() => {
        this.#catalogueLoad = null;
      });
    return this.#catalogueLoad;
  }

  async #fetchCatalogue(key: string): Promise<ComposioToolkitRecord[]> {
    const items: ComposioToolkitRecord[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`${this.#baseUrl}/toolkits`);
      url.searchParams.set("limit", String(CATALOGUE_PAGE));
      url.searchParams.set("sort_by", "usage");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await this.#request(
        url.toString(),
        { method: "GET" },
        { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 2 },
      );
      if (!res.ok) throw new Error(await this.#failure("load the app list", res));
      const json = await readJson(res);
      for (const item of itemsOf(json)) {
        const toolkit = toolkitFromApi(item);
        if (toolkit) items.push(toolkit);
      }
      cursor =
        isRecord(json) && typeof json.next_cursor === "string" && json.next_cursor
          ? json.next_cursor
          : null;
      if (!cursor) break;
    }
    if (items.length === 0) throw new Error("Composio returned an empty app list.");
    return items;
  }

  async #readCatalogueFile(): Promise<CacheEntry<ComposioToolkitRecord[]> | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.catalogueFilePath, "utf8"));
      if (
        !isRecord(parsed) ||
        parsed.version !== 1 ||
        typeof parsed.at !== "number" ||
        !Array.isArray(parsed.items)
      ) {
        return null;
      }
      const items = parsed.items.filter(isToolkitRecord);
      return items.length > 0 ? { at: parsed.at, value: items } : null;
    } catch {
      return null;
    }
  }

  async #writeCatalogueFile(entry: CacheEntry<ComposioToolkitRecord[]>): Promise<void> {
    const file: CatalogueFile = { version: 1, at: entry.at, items: entry.value };
    await writeFile(this.catalogueFilePath, JSON.stringify(file), "utf8");
  }

  // ----- Connections -------------------------------------------------------------------------

  async #connectionsGet(key: string, refresh = false): Promise<ComposioConnection[]> {
    const now = this.#now();
    if (!refresh && this.#connections && now - this.#connections.at < CONNECTIONS_TTL_MS) {
      return this.#connections.value;
    }
    if (this.#connectionsLoad) return this.#connectionsLoad;
    this.#connectionsLoad = this.#fetchConnections(key)
      .then((items) => {
        this.#connections = { at: this.#now(), value: items };
        return items;
      })
      .finally(() => {
        this.#connectionsLoad = null;
      });
    return this.#connectionsLoad;
  }

  async #fetchConnections(key: string): Promise<ComposioConnection[]> {
    const items: ComposioConnection[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`${this.#baseUrl}/connected_accounts`);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await this.#request(
        url.toString(),
        { method: "GET" },
        { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 2 },
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Composio no longer accepts the saved key. Add it again in Marketplace → Apps.",
        );
      }
      if (!res.ok) throw new Error(await this.#failure("list connected apps", res));
      const json = await readJson(res);
      for (const item of itemsOf(json)) {
        const connection = connectionFromApi(item);
        if (connection) items.push(connection);
      }
      cursor =
        isRecord(json) && typeof json.next_cursor === "string" && json.next_cursor
          ? json.next_cursor
          : null;
      if (!cursor) break;
    }
    return items;
  }

  async #ensureAuthConfig(toolkit: ComposioToolkitRecord, key: string): Promise<string> {
    const cached = this.#authConfigs.get(toolkit.slug);
    if (cached) return cached;
    const url = new URL(`${this.#baseUrl}/auth_configs`);
    url.searchParams.set("toolkit_slug", toolkit.slug);
    url.searchParams.set("limit", "50");
    const res = await this.#request(
      url.toString(),
      { method: "GET" },
      { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 1 },
    );
    if (!res.ok) throw new Error(await this.#failure("read the app's sign-in settings", res));
    const usable = itemsOf(await readJson(res)).filter((item) => {
      if (typeof item.id !== "string") return false;
      if (item.status !== undefined && item.status !== "ENABLED") return false;
      const slug = isRecord(item.toolkit) ? item.toolkit.slug : undefined;
      return typeof slug !== "string" || slug.toLowerCase() === toolkit.slug;
    });
    const existing = usable.find((item) => item.is_composio_managed === true) ?? usable[0];
    if (existing && typeof existing.id === "string") {
      this.#authConfigs.set(toolkit.slug, existing.id);
      return existing.id;
    }
    if (toolkit.managedAuthSchemes.length === 0 && !toolkit.noAuth) {
      throw new Error(
        `${toolkit.name} needs a one-time setup in Composio: open dashboard.composio.dev → Auth configs → Create, pick ${toolkit.name}, then press Connect here again.`,
      );
    }
    const created = await this.#request(
      `${this.#baseUrl}/auth_configs`,
      {
        method: "POST",
        body: JSON.stringify({
          toolkit: { slug: toolkit.slug },
          auth_config: { type: "use_composio_managed_auth", name: `Sahkarmi ${toolkit.name}` },
        }),
      },
      { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 1 },
    );
    if (created.status === 403) {
      // A key made with "Read only" for auth configs can list sign-ins but not add one.
      throw new Error(
        `Your Composio key can only read, so it cannot set up ${toolkit.name}. Make a new key with Full access (step 3 in the key card) and paste it here, or set up ${toolkit.name} yourself at dashboard.composio.dev → Auth configs → Create.`,
      );
    }
    if (!created.ok) {
      throw new Error(await this.#failure(`prepare ${toolkit.name} for sign-in`, created));
    }
    const json = await readJson(created);
    const id =
      isRecord(json) && isRecord(json.auth_config) && typeof json.auth_config.id === "string"
        ? json.auth_config.id
        : isRecord(json) && typeof json.id === "string"
          ? json.id
          : "";
    if (!id) throw new Error("Composio did not return an auth config id.");
    this.#authConfigs.set(toolkit.slug, id);
    return id;
  }

  async #accountForTool(toolSlug: string, key: string): Promise<ComposioConnection | null> {
    const active = activeConnections(await this.#connectionsGet(key));
    const known = this.#toolToolkit.get(toolSlug);
    if (known && active.has(known)) return active.get(known) ?? null;
    const guessed = this.#guessToolkit(toolSlug, [...active.keys()]);
    return guessed ? (active.get(guessed) ?? null) : null;
  }

  /** The longest toolkit slug that prefixes the tool slug ("GOOGLE_MAPS_..." → google_maps). */
  #guessToolkit(toolSlug: string, candidates?: string[]): string | null {
    const pool =
      candidates ?? (this.#catalogue?.value ?? FALLBACK_TOOLKITS).map((toolkit) => toolkit.slug);
    let best: string | null = null;
    for (const slug of pool) {
      const prefix = `${slug.toUpperCase().replace(/-/g, "_")}_`;
      if (toolSlug.startsWith(prefix) && (!best || slug.length > best.length)) best = slug;
    }
    return best;
  }

  // ----- Tools -------------------------------------------------------------------------------

  async #toolkitTools(toolkitSlug: string, key: string): Promise<ComposioToolRecord[]> {
    const cached = this.#tools.get(toolkitSlug);
    if (cached && this.#now() - cached.at < TOOLS_TTL_MS) return cached.value;
    const pending = this.#toolsLoad.get(toolkitSlug);
    if (pending) return pending;
    const load = this.#fetchTools(toolkitSlug, key)
      .then((records) => {
        this.#tools.set(toolkitSlug, { at: this.#now(), value: records });
        for (const record of records) {
          this.#toolToolkit.set(record.slug, toolkitSlug);
          this.#toolNames.set(record.slug, record.name);
        }
        return records;
      })
      .finally(() => {
        this.#toolsLoad.delete(toolkitSlug);
      });
    this.#toolsLoad.set(toolkitSlug, load);
    return load;
  }

  async #fetchTools(toolkitSlug: string, key: string): Promise<ComposioToolRecord[]> {
    const important = await this.#toolsPage(toolkitSlug, key, true);
    const records =
      important.length > 0 ? important : await this.#toolsPage(toolkitSlug, key, false);
    return records.slice(0, MAX_TOOLS_PER_TOOLKIT);
  }

  async #toolsPage(
    toolkitSlug: string,
    key: string,
    important: boolean,
  ): Promise<ComposioToolRecord[]> {
    const url = new URL(`${this.#baseUrl}/tools`);
    url.searchParams.set("toolkit_slug", toolkitSlug);
    url.searchParams.set("limit", String(MAX_TOOLS_PER_TOOLKIT));
    if (important) url.searchParams.set("important", "true");
    const res = await this.#request(
      url.toString(),
      { method: "GET" },
      { key, timeoutMs: METADATA_TIMEOUT_MS, retries: 2 },
    );
    if (!res.ok) throw new Error(await this.#failure(`list ${toolkitSlug} tools`, res));
    const toolkitName =
      this.#catalogue?.value.find((toolkit) => toolkit.slug === toolkitSlug)?.name ??
      FALLBACK_TOOLKITS.find((toolkit) => toolkit.slug === toolkitSlug)?.name ??
      describeTool(toolkitSlug);
    const records: ComposioToolRecord[] = [];
    for (const item of itemsOf(await readJson(res))) {
      const record = toolFromApi(item, toolkitSlug, toolkitName);
      if (record) records.push(record);
    }
    return records;
  }

  // ----- Transport ---------------------------------------------------------------------------

  async #request(url: string, init: RequestInit, options: RequestOptions): Promise<Response> {
    this.#checkCircuit();
    await this.#acquire();
    try {
      return await this.#send(url, init, options);
    } finally {
      this.#release();
    }
  }

  async #send(url: string, init: RequestInit, options: RequestOptions): Promise<Response> {
    const headers = {
      "x-api-key": options.key,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    let attempt = 0;
    let rateLimited = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.#fetch(url, {
          ...init,
          headers,
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        if (attempt >= options.retries) {
          this.#recordFailure();
          throw new Error(describeNetworkError(error, options.timeoutMs));
        }
        await sleep(this.#backoff(attempt));
        attempt += 1;
        continue;
      }
      if (res.status === 429) {
        if (rateLimited < MAX_RATE_LIMIT_RETRIES) {
          await sleep(retryAfterMs(res) ?? this.#backoff(rateLimited));
          rateLimited += 1;
          continue;
        }
        return res;
      }
      if (res.status >= 500 && res.status <= 504) {
        if (attempt < options.retries) {
          await sleep(this.#backoff(attempt));
          attempt += 1;
          continue;
        }
        this.#recordFailure();
        return res;
      }
      if (res.ok) this.#recordSuccess();
      return res;
    }
  }

  /** Full jitter: a random wait between zero and min(8 s, base × 2^attempt). */
  #backoff(attempt: number): number {
    return Math.random() * Math.min(MAX_BACKOFF_MS, this.#baseRetryDelayMs * 2 ** attempt);
  }

  #checkCircuit(): void {
    const remaining = this.#circuit.trippedUntil - this.#now();
    if (remaining > 0) {
      throw new Error(
        `Composio is paused for ${Math.ceil(remaining / 1000)} s after repeated failures. Try again shortly.`,
      );
    }
  }

  #recordSuccess(): void {
    this.#circuit = { failures: 0, trippedUntil: 0 };
  }

  #recordFailure(): void {
    this.#circuit.failures += 1;
    if (this.#circuit.failures >= BREAKER_TRIP_AFTER) {
      this.#circuit.trippedUntil = this.#now() + BREAKER_OPEN_MS;
    }
  }

  async #acquire(): Promise<void> {
    if (this.#inFlight < MAX_IN_FLIGHT) {
      this.#inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiters.push(resolve));
    this.#inFlight += 1;
  }

  #release(): void {
    this.#inFlight -= 1;
    this.#waiters.shift()?.();
  }

  async #failure(action: string, res: Response): Promise<string> {
    let detail = "";
    try {
      const json: unknown = await res.clone().json();
      if (isRecord(json)) {
        const error = json.error;
        if (isRecord(error) && typeof error.message === "string") detail = error.message;
        else if (typeof error === "string") detail = error;
        else if (typeof json.message === "string") detail = json.message;
      }
    } catch {
      try {
        detail = (await res.text()).trim();
      } catch {
        detail = "";
      }
    }
    const hint =
      res.status === 403 && /permission|access/i.test(detail)
        ? " The key is limited: make a new Composio key with Full access and paste it in Marketplace → Apps."
        : res.status === 401 || res.status === 403
          ? " Check the Composio key in Marketplace → Apps."
          : res.status === 402
            ? " The Composio plan's monthly limit may be used up."
            : "";
    const shown = detail ? ` (${clip(detail, 200)})` : "";
    return `Could not ${action}: Composio answered ${res.status}${shown}.${hint}`;
  }
}

// ----- helpers ---------------------------------------------------------------------------------

function appFromToolkit(
  toolkit: ComposioToolkitRecord,
  connection?: ComposioConnection,
): ComposioAppMeta {
  const schemes = toolkit.authSchemes.map((scheme) => scheme.toUpperCase());
  const auth = toolkit.noAuth
    ? "none"
    : schemes.some((scheme) => scheme.startsWith("OAUTH"))
      ? "oauth"
      : schemes.some((scheme) =>
            ["API_KEY", "BEARER_TOKEN", "BASIC", "BASIC_WITH_JWT"].includes(scheme),
          )
        ? "api-key"
        : "other";
  return {
    id: toolkit.slug,
    name: toolkit.name,
    description: toolkit.description,
    logo: toolkit.logo,
    categories: toolkit.categories,
    toolsCount: toolkit.toolsCount,
    auth,
    oneClick: toolkit.noAuth || toolkit.managedAuthSchemes.length > 0,
    isConnected: Boolean(connection),
    connectedAccountId: connection?.id ?? null,
    connectionStatus: connection?.status ?? null,
  };
}

function activeConnections(connections: ComposioConnection[]): Map<string, ComposioConnection> {
  const active = new Map<string, ComposioConnection>();
  for (const connection of connections) {
    if (connectionState(connection.status) !== "connected") continue;
    if (!active.has(connection.toolkitSlug)) active.set(connection.toolkitSlug, connection);
  }
  return active;
}

export function connectionState(status: string): ComposioConnectionState {
  const upper = status.toUpperCase();
  if (upper === "ACTIVE") return "connected";
  if (upper === "INITIALIZING" || upper === "INITIATED" || upper === "PENDING") return "connecting";
  if (
    ["FAILED", "EXPIRED", "INACTIVE", "REVOKED", "DELETED", "ERROR", "NOT_FOUND"].includes(upper)
  ) {
    return "failed";
  }
  return "unknown";
}

function dynamicTool(record: ComposioToolRecord): ComposioDynamicTool {
  const sensitive = isActionSensitive(record.slug);
  const schema = record.inputParameters;
  const properties: Record<string, unknown> = isRecord(schema.properties)
    ? { ...schema.properties }
    : {};
  if (sensitive) {
    properties.approval_id = {
      type: "string",
      description:
        "Only after the owner approved this exact action: the approval id from the approval message.",
    };
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  return {
    type: "function",
    name: record.slug.toLowerCase(),
    description: `[${record.toolkitName}] ${clip(record.description, DESCRIPTION_CHARS)}${
      sensitive ? " Pauses for the owner's approval before it runs." : ""
    }`,
    inputSchema: {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: true,
    },
  };
}

function toolkitFromApi(item: Record<string, unknown>): ComposioToolkitRecord | null {
  if (typeof item.slug !== "string" || !item.slug) return null;
  const meta = isRecord(item.meta) ? item.meta : {};
  const categories = Array.isArray(meta.categories)
    ? meta.categories
        .map((category) =>
          typeof category === "string"
            ? category
            : isRecord(category) && typeof category.name === "string"
              ? category.name
              : null,
        )
        .filter((name): name is string => Boolean(name))
    : [];
  return {
    slug: item.slug.toLowerCase(),
    name: typeof item.name === "string" && item.name ? item.name : item.slug,
    description: typeof meta.description === "string" ? meta.description : "",
    logo:
      typeof meta.logo === "string" && meta.logo
        ? meta.logo
        : composioLogoUrl(item.slug.toLowerCase()),
    categories,
    toolsCount: typeof meta.tools_count === "number" ? meta.tools_count : null,
    authSchemes: stringArray(item.auth_schemes),
    managedAuthSchemes: stringArray(item.composio_managed_auth_schemes),
    noAuth: item.no_auth === true,
  };
}

function isToolkitRecord(value: unknown): value is ComposioToolkitRecord {
  return (
    isRecord(value) &&
    typeof value.slug === "string" &&
    typeof value.name === "string" &&
    typeof value.description === "string" &&
    Array.isArray(value.categories) &&
    Array.isArray(value.authSchemes) &&
    Array.isArray(value.managedAuthSchemes)
  );
}

function connectionFromApi(item: Record<string, unknown>): ComposioConnection | null {
  if (typeof item.id !== "string") return null;
  const toolkitSlug =
    isRecord(item.toolkit) && typeof item.toolkit.slug === "string"
      ? item.toolkit.slug.toLowerCase()
      : "";
  if (!toolkitSlug) return null;
  return {
    id: item.id,
    toolkitSlug,
    status: typeof item.status === "string" ? item.status : "UNKNOWN",
    userId: typeof item.user_id === "string" ? item.user_id : null,
  };
}

function toolFromApi(
  item: Record<string, unknown>,
  toolkitSlug: string,
  toolkitName: string,
): ComposioToolRecord | null {
  if (typeof item.slug !== "string" || !item.slug) return null;
  if (item.is_deprecated === true) return null;
  const toolkit = isRecord(item.toolkit) ? item.toolkit : {};
  return {
    slug: item.slug.toUpperCase(),
    name:
      typeof item.name === "string" && item.name ? item.name : describeTool(item.slug, toolkitSlug),
    description: typeof item.description === "string" ? item.description : "",
    toolkitSlug,
    toolkitName: typeof toolkit.name === "string" && toolkit.name ? toolkit.name : toolkitName,
    inputParameters: isRecord(item.input_parameters) ? item.input_parameters : {},
  };
}

function itemsOf(json: unknown): Record<string, unknown>[] {
  if (!isRecord(json) || !Array.isArray(json.items)) return [];
  return json.items.filter(isRecord);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••••••";
}

function clip(text: string, max: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function retryAfterMs(res: Response): number | null {
  const header = typeof res.headers?.get === "function" ? res.headers.get("retry-after") : null;
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(MAX_BACKOFF_MS, Math.max(0, seconds * 1000));
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.min(MAX_BACKOFF_MS, Math.max(0, at - Date.now())) : null;
}

function describeNetworkError(error: unknown, timeoutMs: number): string {
  const name = isRecord(error) && typeof error.name === "string" ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return `Composio did not answer within ${Math.round(timeoutMs / 1000)} s.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Could not reach Composio: ${message}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The key as Composio expects it. People paste it with quotes, a label such as
 * "COMPOSIO_API_KEY=" or "x-api-key:", line breaks or invisible characters from a web page.
 */
export function normalizeComposioKey(raw: string): string {
  let key = raw.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ").trim();
  key = key.replace(/^(?:export\s+)?(?:COMPOSIO_API_KEY|x-api-key)\s*[:=]\s*/i, "");
  key = key.replace(/^["'`]+|["'`]+$/g, "");
  return key.replace(/\s+/g, "");
}

/** Composio's own words for a refused key, e.g. "Invalid API key". Never includes the key. */
async function composioReason(res: Response): Promise<string> {
  try {
    const body: unknown = await res.clone().json();
    const error =
      typeof body === "object" && body !== null ? (body as { error?: unknown }).error : null;
    const slug =
      typeof error === "object" && error !== null ? (error as { slug?: unknown }).slug : null;
    if (slug === "APIKey_InvalidAPIKey") return "invalid API key";
    return typeof slug === "string" ? slug.replace(/_/g, " ") : "";
  } catch {
    return "";
  }
}
