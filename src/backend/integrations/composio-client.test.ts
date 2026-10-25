import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComposioClient,
  connectionState,
  DEFAULT_COMPOSIO_BASE_URL,
  HOBBY_PLAN_TOOL_CALLS,
  OWNER_USER_ID,
} from "./composio-client";

interface Call {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

interface FakeOptions {
  toolkits?: unknown[];
  connections?: unknown[];
  authConfigs?: unknown[];
  tools?: Record<string, unknown[]>;
  connectionStatus?: string;
  execute?: (slug: string, body: Record<string, unknown> | null, attempt: number) => FakeResponse;
  authCheck?: number;
}

type FakeResponse = Response;

const TOOLKITS = [
  {
    slug: "github",
    name: "GitHub",
    meta: {
      description: "Repositories, issues and pull requests",
      logo: "https://logos.example/github.svg",
      categories: [{ id: "developer-tools", name: "Developer tools" }],
      tools_count: 120,
    },
    auth_schemes: ["OAUTH2"],
    composio_managed_auth_schemes: ["OAUTH2"],
    no_auth: false,
  },
  {
    slug: "gmail",
    name: "Gmail",
    meta: {
      description: "Email",
      logo: "https://logos.example/gmail.svg",
      categories: ["Communication"],
      tools_count: 30,
    },
    auth_schemes: ["OAUTH2"],
    composio_managed_auth_schemes: ["OAUTH2"],
    no_auth: false,
  },
  {
    slug: "custom_crm",
    name: "Custom CRM",
    meta: { description: "Your own CRM", logo: "", categories: [], tools_count: 4 },
    auth_schemes: ["API_KEY"],
    composio_managed_auth_schemes: [],
    no_auth: false,
  },
];

const GITHUB_TOOLS = [
  {
    slug: "GITHUB_GET_AN_ISSUE",
    name: "Get an issue",
    description: "Reads one issue.",
    important: true,
    input_parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "Owner" },
        repo: { type: "string" },
        issue_number: { type: "integer" },
      },
      required: ["owner", "repo", "issue_number"],
    },
    toolkit: { slug: "github", name: "GitHub" },
  },
  {
    slug: "GITHUB_CREATE_AN_ISSUE",
    name: "Create an issue",
    description: "Opens a new issue.",
    important: true,
    input_parameters: {
      type: "object",
      properties: {
        owner: { type: "string" },
        repo: { type: "string" },
        title: { type: "string" },
      },
      required: ["owner", "repo", "title"],
    },
    toolkit: { slug: "github", name: "GitHub" },
  },
  {
    slug: "GITHUB_LIST_COMMITS",
    name: "List commits",
    description: "Rarely needed.",
    important: false,
    input_parameters: { type: "object", properties: {} },
    toolkit: { slug: "github", name: "GitHub" },
  },
];

function json(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** A stand-in for backend.composio.dev/api/v3.1 that records every call. */
function fakeComposio(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const executions = new Map<string, number>();
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    );
    calls.push({ method, url, body, headers });
    const path = url.pathname.replace("/api/v3.1", "");
    if (path === "/auth_configs" && method === "GET" && url.searchParams.get("limit") === "1") {
      return json(options.authCheck ?? 200, { items: [] });
    }
    if (path === "/toolkits")
      return json(200, { items: options.toolkits ?? TOOLKITS, next_cursor: null });
    if (path === "/connected_accounts" && method === "GET") {
      return json(200, { items: options.connections ?? [], next_cursor: null });
    }
    if (path === "/connected_accounts/link" && method === "POST") {
      return json(201, {
        link_token: "lt_1",
        redirect_url: "https://connect.composio.dev/link/lt_1",
        expires_at: "2099-01-01T00:00:00Z",
        connected_account_id: "ca_new",
      });
    }
    if (path.startsWith("/connected_accounts/") && method === "GET") {
      return json(200, {
        id: path.split("/").pop(),
        status: options.connectionStatus ?? "ACTIVE",
        toolkit: { slug: "github" },
      });
    }
    if (path.startsWith("/connected_accounts/") && method === "DELETE") return json(200, {});
    if (path === "/auth_configs" && method === "GET") {
      return json(200, { items: options.authConfigs ?? [], next_cursor: null });
    }
    if (path === "/auth_configs" && method === "POST") {
      return json(201, {
        auth_config: { id: "ac_created", auth_scheme: "OAUTH2", is_composio_managed: true },
        toolkit: { slug: (body?.toolkit as { slug?: string } | undefined)?.slug ?? "" },
      });
    }
    if (path === "/tools" && method === "GET") {
      const slug = url.searchParams.get("toolkit_slug") ?? "";
      const list = (options.tools ?? { github: GITHUB_TOOLS })[slug] ?? [];
      const important = url.searchParams.get("important") === "true";
      return json(200, {
        items: important
          ? list.filter((tool) => (tool as { important?: boolean }).important)
          : list,
        next_cursor: null,
      });
    }
    if (path.startsWith("/tools/execute/") && method === "POST") {
      const slug = decodeURIComponent(path.split("/").pop() ?? "");
      const attempt = (executions.get(slug) ?? 0) + 1;
      executions.set(slug, attempt);
      if (options.execute) return options.execute(slug, body, attempt);
      return json(200, {
        successful: true,
        data: { ok: true, slug },
        error: null,
        log_id: "log_1",
      });
    }
    return json(404, { error: { message: `no route for ${method} ${path}` } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, executions };
}

describe("ComposioClient", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "composio-test-"));
    delete process.env.COMPOSIO_API_KEY;
  });

  afterEach(async () => {
    delete process.env.COMPOSIO_API_KEY;
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3 });
  });

  function client(
    fake: ReturnType<typeof fakeComposio>,
    extra: Partial<ConstructorParameters<typeof ComposioClient>[0]> = {},
  ) {
    return new ComposioClient({
      userDataPath: tempDir,
      fetchImpl: fake.fetchImpl,
      baseRetryDelayMs: 1,
      ...extra,
    });
  }

  it("talks to the current API, not the removed v1 one", () => {
    expect(DEFAULT_COMPOSIO_BASE_URL).toBe("https://backend.composio.dev/api/v3.1");
  });

  it("reports the Hobby plan and a starter list before a key is added", async () => {
    const fake = fakeComposio();
    const composio = client(fake);
    const status = await composio.getStatus();
    expect(status.configured).toBe(false);
    expect(status.apiKeyMasked).toBeNull();
    expect(status.monthlyQuota).toBe(HOBBY_PLAN_TOOL_CALLS);
    expect(status.planName).toBe("Hobby");
    const apps = await composio.listApps();
    expect(apps.length).toBeGreaterThanOrEqual(6);
    expect(apps.find((app) => app.id === "github")?.isConnected).toBe(false);
    expect(fake.calls).toHaveLength(0);
  });

  it("checks a key with Composio, stores it with its mode, masks it and keeps it out of the environment", async () => {
    const fake = fakeComposio();
    const composio = client(fake);
    const status = await composio.setApiKey("comp_live_secret1234567890abcdef");
    expect(status.configured).toBe(true);
    expect(status.apiKeyMasked).toBe("comp…cdef");
    const check = fake.calls[0];
    expect(check.method).toBe("GET");
    expect(check.url.pathname).toBe("/api/v3.1/auth_configs");
    expect(check.headers["x-api-key"]).toBe("comp_live_secret1234567890abcdef");
    expect(process.env.COMPOSIO_API_KEY).toBeUndefined();
    expect((await readFile(composio.keyFilePath, "utf8")).trim()).toBe(
      "comp_live_secret1234567890abcdef",
    );
    const reloaded = client(fakeComposio());
    expect(await reloaded.getApiKey()).toBe("comp_live_secret1234567890abcdef");
  });

  it("refuses a key Composio rejects and saves nothing", async () => {
    const fake = fakeComposio({ authCheck: 401 });
    const composio = client(fake);
    await expect(composio.setApiKey("bad_key_0000000000")).rejects.toThrow(/did not accept/);
    expect(await composio.getApiKey()).toBeNull();
    await expect(readFile(composio.keyFilePath, "utf8")).rejects.toThrow();
  });

  it("lists every toolkit with the owner's active connections, and caches the catalogue on disk", async () => {
    const fake = fakeComposio({
      connections: [
        { id: "ca_old", status: "INITIATED", toolkit: { slug: "gmail" } },
        { id: "ca_gh", status: "ACTIVE", toolkit: { slug: "github" }, user_id: OWNER_USER_ID },
      ],
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const apps = await composio.listApps();
    expect(apps.map((app) => app.id)).toEqual(["github", "gmail", "custom_crm"]);
    const github = apps[0];
    expect(github).toMatchObject({
      name: "GitHub",
      isConnected: true,
      connectedAccountId: "ca_gh",
      logo: "https://logos.example/github.svg",
      categories: ["Developer tools"],
      toolsCount: 120,
      auth: "oauth",
      oneClick: true,
    });
    expect(apps[1]).toMatchObject({ isConnected: false, connectedAccountId: null });
    expect(apps[2]).toMatchObject({ auth: "api-key", oneClick: false, logo: null });
    const toolkitCalls = () => fake.calls.filter((call) => call.url.pathname.endsWith("/toolkits"));
    expect(toolkitCalls()).toHaveLength(1);
    expect(toolkitCalls()[0].url.searchParams.get("sort_by")).toBe("usage");

    await composio.listApps();
    expect(toolkitCalls()).toHaveLength(1);

    const offline = client(fakeComposio({ toolkits: [] }));
    const fromDisk = await offline.listApps();
    expect(fromDisk.map((app) => app.id)).toEqual(["github", "gmail", "custom_crm"]);
  });

  it("connects through Composio's hosted link flow, creating a managed auth config once", async () => {
    const fake = fakeComposio();
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const result = await composio.initiateConnection("github");
    expect(result).toEqual({
      connectionId: "ca_new",
      redirectUrl: "https://connect.composio.dev/link/lt_1",
    });
    const created = fake.calls.find(
      (call) => call.method === "POST" && call.url.pathname.endsWith("/auth_configs"),
    );
    expect(created?.body).toEqual({
      toolkit: { slug: "github" },
      auth_config: { type: "use_composio_managed_auth", name: "Sahkarmi GitHub" },
    });
    const link = fake.calls.find((call) => call.url.pathname.endsWith("/connected_accounts/link"));
    expect(link?.body).toEqual({ auth_config_id: "ac_created", user_id: OWNER_USER_ID });

    await composio.initiateConnection("github");
    const creations = fake.calls.filter(
      (call) => call.method === "POST" && call.url.pathname.endsWith("/auth_configs"),
    );
    expect(creations).toHaveLength(1);
  });

  it("reuses an auth config the owner already has, preferring the Composio-managed one", async () => {
    const fake = fakeComposio({
      authConfigs: [
        {
          id: "ac_custom",
          status: "ENABLED",
          is_composio_managed: false,
          toolkit: { slug: "github" },
        },
        {
          id: "ac_managed",
          status: "ENABLED",
          is_composio_managed: true,
          toolkit: { slug: "github" },
        },
        {
          id: "ac_off",
          status: "DISABLED",
          is_composio_managed: true,
          toolkit: { slug: "github" },
        },
      ],
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    await composio.initiateConnection("github");
    const link = fake.calls.find((call) => call.url.pathname.endsWith("/connected_accounts/link"));
    expect(link?.body).toMatchObject({ auth_config_id: "ac_managed" });
    expect(
      fake.calls.some(
        (call) => call.method === "POST" && call.url.pathname.endsWith("/auth_configs"),
      ),
    ).toBe(false);
  });

  it("explains what to do for a toolkit that needs the owner's own app keys", async () => {
    const fake = fakeComposio();
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    await expect(composio.initiateConnection("custom_crm")).rejects.toThrow(/app\.composio\.dev/);
  });

  it("maps connection statuses to states the UI can show", async () => {
    expect(connectionState("ACTIVE")).toBe("connected");
    expect(connectionState("INITIATED")).toBe("connecting");
    expect(connectionState("FAILED")).toBe("failed");
    expect(connectionState("EXPIRED")).toBe("failed");
    const fake = fakeComposio({ connectionStatus: "INITIATED" });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    expect(await composio.getConnectionStatus("ca_new")).toEqual({
      connectionId: "ca_new",
      status: "INITIATED",
      state: "connecting",
    });
  });

  it("hands coworkers the important tools of connected toolkits with Composio's own schemas", async () => {
    const fake = fakeComposio({
      connections: [{ id: "ca_gh", status: "ACTIVE", toolkit: { slug: "github" } }],
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const tools = await composio.getDynamicTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "github_get_an_issue",
      "github_create_an_issue",
    ]);
    const read = tools[0];
    expect(read.description).toBe("[GitHub] Reads one issue.");
    expect(read.inputSchema.required).toEqual(["owner", "repo", "issue_number"]);
    expect(read.inputSchema.properties.owner).toEqual({ type: "string", description: "Owner" });
    expect(read.inputSchema.properties.approval_id).toBeUndefined();
    const write = tools[1];
    expect(write.description).toMatch(/Pauses for the owner's approval/);
    expect(write.inputSchema.properties.approval_id).toBeDefined();
    const listing = fake.calls.find((call) => call.url.pathname.endsWith("/tools"));
    expect(listing?.url.searchParams.get("toolkit_slug")).toBe("github");
    expect(listing?.url.searchParams.get("important")).toBe("true");

    await composio.getDynamicTools();
    expect(fake.calls.filter((call) => call.url.pathname.endsWith("/tools"))).toHaveLength(1);
  });

  it("falls back to the full tool list when a toolkit marks nothing important", async () => {
    const fake = fakeComposio({
      connections: [{ id: "ca_gm", status: "ACTIVE", toolkit: { slug: "gmail" } }],
      tools: {
        gmail: [
          {
            slug: "GMAIL_FETCH_EMAILS",
            name: "Fetch emails",
            description: "Reads mail.",
            input_parameters: { type: "object", properties: { query: { type: "string" } } },
          },
        ],
      },
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const tools = await composio.getDynamicTools();
    expect(tools.map((tool) => tool.name)).toEqual(["gmail_fetch_emails"]);
    const listings = fake.calls.filter((call) => call.url.pathname.endsWith("/tools"));
    expect(listings.map((call) => call.url.searchParams.get("important"))).toEqual(["true", null]);
  });

  it("executes a tool on the owner's connected account and reads Composio's verdict", async () => {
    const fake = fakeComposio({
      connections: [{ id: "ca_gh", status: "ACTIVE", toolkit: { slug: "github" } }],
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const result = await composio.executeAction("github_get_an_issue", { owner: "a", repo: "b" });
    expect(result).toEqual({ success: true, data: { ok: true, slug: "GITHUB_GET_AN_ISSUE" } });
    const call = fake.calls.find((entry) => entry.url.pathname.includes("/tools/execute/"));
    expect(call?.url.pathname).toBe("/api/v3.1/tools/execute/GITHUB_GET_AN_ISSUE");
    expect(call?.body).toEqual({
      connected_account_id: "ca_gh",
      arguments: { owner: "a", repo: "b" },
    });
  });

  it("reports a failed execution in Composio's words", async () => {
    const fake = fakeComposio({
      connections: [{ id: "ca_gh", status: "ACTIVE", toolkit: { slug: "github" } }],
      execute: () => json(200, { successful: false, data: null, error: "Issue 9 was not found" }),
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const result = await composio.executeAction("GITHUB_GET_AN_ISSUE", {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Issue 9 was not found");
  });

  it("waits out a 429 (honouring Retry-After) and retries a 5xx for read-only tools", async () => {
    const fake = fakeComposio({
      execute: (_slug, _body, attempt) =>
        attempt === 1
          ? json(429, { error: { message: "slow down" } }, { "retry-after": "0" })
          : attempt === 2
            ? json(503, { error: { message: "busy" } })
            : json(200, { successful: true, data: { attempt } }),
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const result = await composio.executeAction("GITHUB_GET_AN_ISSUE", {});
    expect(result).toEqual({ success: true, data: { attempt: 3 } });
    expect(fake.executions.get("GITHUB_GET_AN_ISSUE")).toBe(3);
  });

  it("never repeats a sending or deleting tool after a 5xx, but still waits out a 429", async () => {
    const fake = fakeComposio({
      execute: (_slug, _body, attempt) =>
        attempt === 1
          ? json(429, {}, { "retry-after": "0" })
          : json(502, { error: { message: "gateway" } }),
    });
    const composio = client(fake);
    await composio.setApiKey("key_1234567890", { verify: false });
    const result = await composio.executeAction("GMAIL_SEND_EMAIL", { to: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/502/);
    expect(fake.executions.get("GMAIL_SEND_EMAIL")).toBe(2);
  });

  it("pauses all calls for a minute after five failures in a row, then tries again", async () => {
    let now = 1_000_000;
    const fake = fakeComposio({ execute: () => json(503, { error: { message: "down" } }) });
    const composio = client(fake, { now: () => now });
    await composio.setApiKey("key_1234567890", { verify: false });
    for (let i = 0; i < 5; i++) {
      const result = await composio.executeAction("GITHUB_GET_AN_ISSUE", {});
      expect(result.success).toBe(false);
    }
    expect(composio.circuitState.isOpen).toBe(true);
    const before = fake.calls.length;
    const blocked = await composio.executeAction("GITHUB_GET_AN_ISSUE", {});
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/paused for \d+ s/);
    expect(fake.calls.length).toBe(before);

    now += 61_000;
    await composio.executeAction("GITHUB_GET_AN_ISSUE", {});
    expect(fake.calls.length).toBeGreaterThan(before);
  });

  it("turns a timeout into a plain sentence", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (new URL(String(input)).pathname.endsWith("/connected_accounts")) {
        return json(200, { items: [] });
      }
      throw timeout;
    }) as unknown as typeof fetch;
    const composio = new ComposioClient({ userDataPath: tempDir, fetchImpl, baseRetryDelayMs: 1 });
    await composio.setApiKey("key_1234567890", { verify: false });
    const result = await composio.executeAction("GITHUB_GET_AN_ISSUE", {});
    expect(result.success).toBe(false);
    expect(result.error).toBe("Composio did not answer within 45 s.");
  });

  it("runs at most four requests at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/connected_accounts")) return json(200, { items: [] });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return json(200, { successful: true, data: {} });
    }) as unknown as typeof fetch;
    const composio = new ComposioClient({ userDataPath: tempDir, fetchImpl, baseRetryDelayMs: 1 });
    await composio.setApiKey("key_1234567890", { verify: false });
    await Promise.all(
      Array.from({ length: 10 }, () => composio.executeAction("GITHUB_GET_AN_ISSUE", {})),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
