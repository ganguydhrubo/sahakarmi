import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ComposioAppMeta,
  ComposioConnectionInitiateResult,
  ComposioExecuteResult,
  ComposioStatus,
} from "./types";

const DEFAULT_COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v1";

export const CURATED_APPS: Omit<ComposioAppMeta, "isConnected" | "connectedAccountId">[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Manage repositories, pull requests, issues, commits and releases across your projects.",
    category: "developer",
    icon: "github",
    authScheme: "OAUTH2",
    popularActions: [
      {
        name: "GITHUB_CREATE_AN_ISSUE",
        displayName: "Create Issue",
        description: "Create an issue in a GitHub repository.",
        isSensitive: false,
        requiredParams: ["owner", "repo", "title"],
      },
      {
        name: "GITHUB_GET_AN_ISSUE",
        displayName: "Get Issue",
        description: "Retrieve details of a specific repository issue.",
        isSensitive: false,
        requiredParams: ["owner", "repo", "issue_number"],
      },
      {
        name: "GITHUB_CREATE_A_PULL_REQUEST",
        displayName: "Create Pull Request",
        description: "Open a pull request from a branch.",
        isSensitive: true,
        requiredParams: ["owner", "repo", "head", "base", "title"],
      },
      {
        name: "GITHUB_MERGE_A_PULL_REQUEST",
        displayName: "Merge Pull Request",
        description: "Merge a pull request into the target branch.",
        isSensitive: true,
        requiredParams: ["owner", "repo", "pull_number"],
      },
      {
        name: "GITHUB_LIST_REPOSITORY_ISSUES",
        displayName: "List Issues",
        description: "List issues in a specific repository.",
        isSensitive: false,
        requiredParams: ["owner", "repo"],
      },
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, update channel topics, and notify team members across public or private channels.",
    category: "communication",
    icon: "slack",
    authScheme: "OAUTH2",
    popularActions: [
      {
        name: "SLACK_CHAT_POST_MESSAGE",
        displayName: "Send Message",
        description: "Post a message to a Slack channel or direct message.",
        isSensitive: true,
        requiredParams: ["channel", "text"],
      },
      {
        name: "SLACK_CONVERSATIONS_LIST",
        displayName: "List Channels",
        description: "List channels in a Slack workspace.",
        isSensitive: false,
        requiredParams: [],
      },
      {
        name: "SLACK_CONVERSATIONS_HISTORY",
        displayName: "Channel History",
        description: "Fetch recent messages from a channel.",
        isSensitive: false,
        requiredParams: ["channel"],
      },
    ],
  },
  {
    id: "googlecalendar",
    name: "Google Calendar",
    description: "Schedule meetings, read upcoming events, and find free slots for you and your team.",
    category: "productivity",
    icon: "calendar",
    authScheme: "OAUTH2",
    popularActions: [
      {
        name: "GOOGLECALENDAR_CREATE_EVENT",
        displayName: "Schedule Event",
        description: "Create a calendar event with title, date, time and attendees.",
        isSensitive: false,
        requiredParams: ["calendarId", "summary", "start", "end"],
      },
      {
        name: "GOOGLECALENDAR_LIST_EVENTS",
        displayName: "List Events",
        description: "List events in a Google calendar within a date range.",
        isSensitive: false,
        requiredParams: ["calendarId"],
      },
      {
        name: "GOOGLECALENDAR_DELETE_EVENT",
        displayName: "Delete Event",
        description: "Remove an event from the calendar.",
        isSensitive: true,
        requiredParams: ["calendarId", "eventId"],
      },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Draft customer responses, search correspondence, and send business emails.",
    category: "communication",
    icon: "mail",
    authScheme: "OAUTH2",
    popularActions: [
      {
        name: "GMAIL_SEND_EMAIL",
        displayName: "Send Email",
        description: "Send an email to a recipient.",
        isSensitive: true,
        requiredParams: ["to", "subject", "body"],
      },
      {
        name: "GMAIL_CREATE_DRAFT",
        displayName: "Create Draft",
        description: "Create an email draft in Gmail without sending.",
        isSensitive: false,
        requiredParams: ["to", "subject", "body"],
      },
      {
        name: "GMAIL_LIST_MESSAGES",
        displayName: "Search Messages",
        description: "Search messages or threads using Gmail search queries.",
        isSensitive: false,
        requiredParams: ["query"],
      },
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read documents, query workspace databases, and append notes to existing project pages.",
    category: "productivity",
    icon: "document",
    authScheme: "OAUTH2",
    popularActions: [
      {
        name: "NOTION_SEARCH_NOTION_PAGE",
        displayName: "Search Pages",
        description: "Search for pages or databases in Notion by title.",
        isSensitive: false,
        requiredParams: ["query"],
      },
      {
        name: "NOTION_APPEND_BLOCK_CHILDREN",
        displayName: "Append Content",
        description: "Append paragraphs or blocks to a Notion page.",
        isSensitive: false,
        requiredParams: ["block_id", "children"],
      },
      {
        name: "NOTION_QUERY_DATABASE",
        displayName: "Query Database",
        description: "Query rows in a Notion database with filters.",
        isSensitive: false,
        requiredParams: ["database_id"],
      },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    description: "Track agile sprints, create tickets, and manage engineering workflows.",
    category: "project-management",
    icon: "jira",
    authScheme: "OAUTH2",
    popularActions: [
      {
        name: "JIRA_CREATE_ISSUE",
        displayName: "Create Ticket",
        description: "Create an issue or bug ticket in a Jira project.",
        isSensitive: false,
        requiredParams: ["projectKey", "summary", "issueType"],
      },
      {
        name: "JIRA_GET_ISSUE",
        displayName: "Get Ticket",
        description: "Get details and status of a Jira issue.",
        isSensitive: false,
        requiredParams: ["issueKey"],
      },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Sync tasks, manage cycles, and update development issues.",
    category: "developer",
    icon: "linear",
    authScheme: "OAUTH2",
    popularActions: [
      {
        name: "LINEAR_CREATE_ISSUE",
        displayName: "Create Issue",
        description: "Create an issue in Linear team.",
        isSensitive: false,
        requiredParams: ["teamId", "title"],
      },
      {
        name: "LINEAR_LIST_ISSUES",
        displayName: "List Issues",
        description: "List issues assigned or filtered in Linear.",
        isSensitive: false,
        requiredParams: [],
      },
    ],
  },
];

export interface ComposioClientOptions {
  userDataPath: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export class ComposioClient {
  readonly #userDataPath: string;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: string;
  #cachedKey: string | null = null;
  #keyLoaded = false;

  constructor(options: ComposioClientOptions) {
    this.#userDataPath = options.userDataPath;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#baseUrl = options.baseUrl ?? DEFAULT_COMPOSIO_BASE_URL;
  }

  get keyFilePath(): string {
    return join(this.#userDataPath, "composio_api_key.txt");
  }

  async getApiKey(): Promise<string | null> {
    if (this.#keyLoaded) return this.#cachedKey;

    if (process.env.COMPOSIO_API_KEY && process.env.COMPOSIO_API_KEY.trim()) {
      this.#cachedKey = process.env.COMPOSIO_API_KEY.trim();
      this.#keyLoaded = true;
      return this.#cachedKey;
    }

    try {
      const content = await readFile(this.keyFilePath, "utf8");
      const key = content.trim();
      if (key) {
        this.#cachedKey = key;
        process.env.COMPOSIO_API_KEY = key;
        this.#keyLoaded = true;
        return key;
      }
    } catch {
      // Key file not found or unreadable
    }

    this.#keyLoaded = true;
    return null;
  }

  async setApiKey(key: string): Promise<ComposioStatus> {
    const trimmed = key.trim();
    if (!trimmed) {
      this.#cachedKey = null;
      delete process.env.COMPOSIO_API_KEY;
      try {
        await writeFile(this.keyFilePath, "", { encoding: "utf8", mode: 0o600 });
      } catch {
        // ignore write error on empty
      }
    } else {
      this.#cachedKey = trimmed;
      process.env.COMPOSIO_API_KEY = trimmed;
      await writeFile(this.keyFilePath, `${trimmed}\n`, { encoding: "utf8", mode: 0o600 });
    }
    return this.getStatus();
  }

  async getStatus(): Promise<ComposioStatus> {
    const key = await this.getApiKey();
    if (!key) {
      return {
        configured: false,
        apiKeyMasked: null,
        connectedCount: 0,
        freeTierActive: true,
        monthlyQuota: 100_000,
      };
    }

    let connectedCount = 0;
    try {
      const connections = await this.listConnectedAccounts();
      connectedCount = connections.length;
    } catch {
      // network/auth check failure
    }

    const masked = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "••••••••";

    return {
      configured: true,
      apiKeyMasked: masked,
      connectedCount,
      freeTierActive: true,
      monthlyQuota: 100_000,
    };
  }

  async listConnectedAccounts(entityId?: string): Promise<Array<{ id: string; appName: string; status: string }>> {
    const key = await this.getApiKey();
    if (!key) return [];

    const url = new URL(`${this.#baseUrl}/connectedAccounts`);
    if (entityId) {
      url.searchParams.set("user_uuid", entityId);
    }

    const res = await this.#fetch(url.toString(), {
      method: "GET",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error("Invalid Composio API key.");
      }
      return [];
    }

    const data = (await res.json()) as { items?: Array<{ id: string; appName?: string; appUniqueId?: string; status?: string }> };
    const items = Array.isArray(data.items) ? data.items : [];
    return items.map((item) => ({
      id: item.id,
      appName: (item.appName ?? item.appUniqueId ?? "").toLowerCase(),
      status: item.status ?? "ACTIVE",
    }));
  }

  async listApps(entityId?: string): Promise<ComposioAppMeta[]> {
    const connections = await this.listConnectedAccounts(entityId).catch(() => []);
    const connectionMap = new Map<string, string>();
    for (const conn of connections) {
      connectionMap.set(conn.appName.toLowerCase(), conn.id);
    }

    return CURATED_APPS.map((app) => {
      const connId = connectionMap.get(app.id.toLowerCase());
      return {
        ...app,
        isConnected: Boolean(connId),
        connectedAccountId: connId,
      };
    });
  }

  async initiateConnection(appId: string, entityId?: string): Promise<ComposioConnectionInitiateResult> {
    const key = await this.getApiKey();
    if (!key) {
      throw new Error("Composio API key is not configured. Please set your key in Settings.");
    }

    const targetEntity = entityId ?? "default_sahkarmi_user";
    const res = await this.#fetch(`${this.#baseUrl}/connectedAccounts`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appName: appId.toLowerCase(),
        user_uuid: targetEntity,
        redirectUri: "https://backend.composio.dev/api/v1/auth/callback",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to initiate ${appId} connection: ${text || res.statusText}`);
    }

    const json = (await res.json()) as { id?: string; connectionId?: string; redirectUrl?: string; authUrl?: string };
    const connectionId = json.id ?? json.connectionId ?? `conn_${Date.now()}`;
    const redirectUrl = json.redirectUrl ?? json.authUrl;

    if (!redirectUrl) {
      throw new Error("Composio did not return an authorization URL.");
    }

    return { connectionId, redirectUrl };
  }

  async deleteConnection(connectionId: string): Promise<boolean> {
    const key = await this.getApiKey();
    if (!key) return false;

    const res = await this.#fetch(`${this.#baseUrl}/connectedAccounts/${encodeURIComponent(connectionId)}`, {
      method: "DELETE",
      headers: {
        "x-api-key": key,
      },
    });

    return res.ok;
  }

  async executeAction(
    actionName: string,
    args: Record<string, unknown>,
    entityId?: string,
  ): Promise<ComposioExecuteResult> {
    const key = await this.getApiKey();
    if (!key) {
      return {
        success: false,
        error: "Composio is not configured with an API key. Go to Settings > Integrations to add your key.",
      };
    }

    const url = `${this.#baseUrl}/actions/${encodeURIComponent(actionName)}/execute`;
    const body: Record<string, unknown> = {
      user_uuid: entityId ?? "default_sahkarmi_user",
      arguments: args,
    };

    try {
      const res = await this.#fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          success: false,
          error: `Composio action failed (${res.status}): ${errText || res.statusText}`,
        };
      }

      const json = await res.json();
      return {
        success: true,
        data: json,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getDynamicTools(entityId?: string): Promise<Array<{
    type: "function";
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  }>> {
    const apps = await this.listApps(entityId);
    const connectedApps = apps.filter((app) => app.isConnected);
    if (connectedApps.length === 0) return [];

    const tools: Array<{
      type: "function";
      name: string;
      description: string;
      inputSchema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    }> = [];

    for (const app of connectedApps) {
      for (const action of app.popularActions) {
        const properties: Record<string, unknown> = {};
        for (const param of action.requiredParams) {
          properties[param] = { type: "string", description: `Parameter for ${action.displayName}` };
        }

        tools.push({
          type: "function",
          name: action.name.toLowerCase(),
          description: `[${app.name}] ${action.description}`,
          inputSchema: {
            type: "object",
            properties,
            required: action.requiredParams.length > 0 ? action.requiredParams : undefined,
            additionalProperties: true,
          },
        });
      }
    }

    return tools;
  }
}
