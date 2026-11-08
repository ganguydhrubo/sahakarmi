import type { PermissionCategory } from "./ipc";

/**
 * Ready-made connectors (Settings › MCP servers, feature "mcp-connector-gallery", off by default).
 * Each entry only pre-fills the owner's normal "add a server" flow: nothing is added, started or
 * downloaded until the owner presses Add, and the added server is saved switched off until its
 * test passes. Titles and summaries are Sahkarmi's own words; upstream names, links and licences
 * live in `credits`, which only the Open-source credits list shows.
 *
 * Every launch is pinned (exact npm version, exact PyPI version, a git commit or a checked release)
 * so the first run downloads exactly what was reviewed here.
 */

/** What has to be on this PC before the connector can start. */
export type ConnectorRequirement = "node" | "uv" | "git" | "chrome" | "program";

export type ConnectorPin =
  | { kind: "npm"; package: string; version: string; reason: string }
  | { kind: "pypi"; package: string; version: string; reason: string }
  | { kind: "git"; repo: string; commit: string; reason: string }
  | {
      kind: "release";
      repo: string;
      tag: string;
      commit: string;
      /** SHA-256 of the release file the owner downloads. */
      sha256: string;
      /** SHA-256 of the program inside it. */
      programSha256: string;
      reason: string;
    }
  | { kind: "remote"; url: string; checkedRelease: string; reason: string };

/** Something the owner types in before Add: a key, a path or an agreement. */
export interface ConnectorField {
  /** Env name, header name, or "command" for a program path. */
  key: string;
  target: "env" | "header" | "command";
  label: string;
  hint: string;
  secret: boolean;
  required: boolean;
  /** "accept": a tick box that writes "true"/"false". */
  kind?: "text" | "path" | "accept";
  /** Header values get this in front (e.g. "Bearer "). */
  prefix?: string;
  /** Where the owner gets the value (a setup step may name the service). */
  setupUrl?: string;
}

/**
 * How a tool call of this connector is checked by the permission policy. First match wins; a tool
 * no rule matches is asked like any other tool server's ("shell"). Sensitive categories
 * (messages, publication, business actions, payments) always ask.
 */
export interface ConnectorToolRule {
  /** Regular expression source, matched against the bare tool name. */
  tool: string;
  category: PermissionCategory;
  /** Input fields holding file paths, checked against the coworker's folders. */
  pathKeys?: string[];
  /** Input field holding a URI: file: URIs become file reads with that path, others research. */
  uriKey?: string;
}

export interface ConnectorCredits {
  project: string;
  url: string;
  /** SPDX expression; every part must be in CONNECTOR_LICENCES. */
  licence: string;
  copyright: string;
}

export interface ConnectorPreset {
  /** Stable id, saved on the server record. Never an upstream name. */
  id: string;
  title: string;
  summary: string;
  /** The server name the owner sees in the list (editable before Add). */
  serverName: string;
  runtime: "node" | "python" | "remote" | "program";
  transport: "stdio" | "http";
  command: string;
  /** `@@SHARED@@` = the Shared folder, `@@CONNECTOR_DIR@@` = this connector's own folder. */
  args: string[];
  env: Record<string, string>;
  url: string;
  headers: Record<string, string>;
  requirements: ConnectorRequirement[];
  /** Lowest Node.js major the package declares. */
  minNode?: number;
  fields: ConnectorField[];
  /** Safe defaults this connector starts with, in plain words. */
  safety: string[];
  toolRules: ConnectorToolRule[];
  pin: ConnectorPin;
  /** A config file written into the connector's folder on Add (name → text, may use @@ tokens). */
  files?: Record<string, string>;
  /** Imports heavy libraries: Settings suggests shared mode. */
  heavy?: boolean;
  credits: ConnectorCredits;
}

/** Licences a connector may carry (permissive or weak copyleft only). */
export const CONNECTOR_LICENCES = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "MPL-2.0"];

const MCP_REFERENCE: Omit<ConnectorCredits, "project" | "url"> = {
  // The reference servers are moving from MIT to Apache-2.0; older parts stay MIT.
  licence: "Apache-2.0 AND MIT",
  copyright: "Copyright (c) 2024-2025 Model Context Protocol a Series of LF Projects, LLC.",
};

const READ_ONLY = "research" as const;

export const CONNECTOR_PRESETS: readonly ConnectorPreset[] = [
  {
    id: "web-reader",
    title: "Web page reader",
    summary: "Opens a web page and gives coworkers its text as clean Markdown.",
    serverName: "web-reader",
    runtime: "python",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch==2026.11.4"],
    env: {},
    url: "",
    headers: {},
    requirements: ["uv"],
    fields: [],
    safety: ["Reads public pages only; it cannot sign in or fill forms."],
    toolRules: [{ tool: "^fetch$", category: READ_ONLY }],
    pin: {
      kind: "pypi",
      package: "mcp-server-fetch",
      version: "2026.11.4",
      reason: "Latest PyPI release on 8 Nov 2026, built from the reference servers' main branch.",
    },
    credits: {
      project: "modelcontextprotocol/servers (fetch)",
      url: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
      ...MCP_REFERENCE,
    },
  },
  {
    id: "files",
    title: "Files",
    summary: "Reads, searches and edits files in your Shared folder.",
    serverName: "files",
    runtime: "node",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem@2.2.0", "--confine-roots", "@@SHARED@@"],
    env: {},
    url: "",
    headers: {},
    requirements: ["node"],
    minNode: 24,
    fields: [],
    safety: [
      "Only the Shared folder; add more folders later with Edit.",
      "A chat can narrow the folder list but never widen it.",
      "Edits outside the coworker's folders are asked first.",
    ],
    toolRules: [
      {
        tool: "^(read_|list_|search_|directory_tree$|get_file_info$)",
        category: "file_read",
        pathKeys: ["path", "paths"],
      },
      { tool: "^(write_file|create_directory)$", category: "file_create", pathKeys: ["path"] },
      {
        tool: "^(edit_file|append_file|move_file|copy_file)$",
        category: "file_modify",
        pathKeys: ["path", "source", "destination"],
      },
    ],
    pin: {
      kind: "npm",
      package: "@modelcontextprotocol/server-filesystem",
      version: "2.2.0",
      reason:
        "Latest npm release on 8 Nov 2026; has --confine-roots so the Shared folder stays the limit. Needs Node.js 24 or newer.",
    },
    credits: {
      project: "modelcontextprotocol/servers (filesystem)",
      url: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
      ...MCP_REFERENCE,
    },
  },
  {
    id: "git",
    title: "Git",
    summary: "Shows history, changes and branches of a project folder, and can commit.",
    serverName: "git",
    runtime: "python",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git==2026.11.4"],
    env: {},
    url: "",
    headers: {},
    requirements: ["uv", "git"],
    fields: [],
    safety: ["Commits, adds, resets and branch changes are checked like file edits."],
    toolRules: [
      {
        tool: "^git_(status|diff|diff_staged|diff_unstaged|log|show|branch)$",
        category: "file_read",
        pathKeys: ["repo_path"],
      },
      {
        tool: "^git_(commit|add|reset|create_branch|checkout|merge)$",
        category: "file_modify",
        pathKeys: ["repo_path"],
      },
    ],
    pin: {
      kind: "pypi",
      package: "mcp-server-git",
      version: "2026.11.4",
      reason: "Latest PyPI release on 8 Nov 2026.",
    },
    credits: {
      project: "modelcontextprotocol/servers (git)",
      url: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
      ...MCP_REFERENCE,
    },
  },
  {
    id: "time",
    title: "Time",
    summary: "Current time anywhere and time-zone conversions, set to India time.",
    serverName: "time",
    runtime: "python",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time==2026.11.4", "--local-timezone", "Asia/Kolkata"],
    env: {},
    url: "",
    headers: {},
    requirements: ["uv"],
    fields: [],
    safety: ["Works offline; reads nothing on your PC."],
    toolRules: [{ tool: ".*", category: READ_ONLY }],
    pin: {
      kind: "pypi",
      package: "mcp-server-time",
      version: "2026.11.4",
      reason: "Latest PyPI release on 8 Nov 2026.",
    },
    credits: {
      project: "modelcontextprotocol/servers (time)",
      url: "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
      ...MCP_REFERENCE,
    },
  },
  {
    id: "code-hosting",
    title: "Code hosting",
    summary: "Repositories, issues, pull requests and code search on your online code account.",
    serverName: "code-hosting",
    runtime: "remote",
    transport: "http",
    command: "",
    args: [],
    env: {},
    url: "https://api.githubcopilot.com/mcp/",
    headers: { "X-MCP-Readonly": "true" },
    requirements: [],
    fields: [
      {
        key: "Authorization",
        target: "header",
        prefix: "Bearer ",
        label: "Your GitHub token",
        hint: "Create a fine-grained personal access token on GitHub with only the repositories and permissions you want coworkers to have, and paste it here.",
        secret: true,
        required: true,
        setupUrl: "https://github.com/settings/personal-access-tokens/new",
      },
    ],
    safety: [
      "Starts read-only: coworkers can look but not change anything.",
      "If you remove the read-only header, every change is asked first.",
      "Nothing runs on this PC; it connects over the internet.",
    ],
    toolRules: [
      { tool: "^(get_|list_|search_)|_read$", category: READ_ONLY },
      { tool: ".*", category: "publication" },
    ],
    pin: {
      kind: "remote",
      url: "https://api.githubcopilot.com/mcp/",
      checkedRelease: "v2.1.0",
      reason:
        "Hosted endpoint, so no local download to pin; read-only header checked against release v2.1.0 (commit 99d6d65).",
    },
    credits: {
      project: "github/github-mcp-server",
      url: "https://github.com/github/github-mcp-server",
      licence: "MIT",
      copyright: "Copyright (c) 2025 GitHub",
    },
  },
  {
    id: "databases",
    title: "Databases (read-only)",
    summary:
      "Looks up tables and runs read-only SQL on PostgreSQL, MySQL, SQL Server, SQLite and more.",
    serverName: "databases",
    runtime: "node",
    transport: "stdio",
    command: "npx",
    args: [
      "-y",
      "@bytebase/dbhub@1.6.0",
      "--transport",
      "stdio",
      "--config",
      "@@CONNECTOR_DIR@@\\connection.toml",
    ],
    env: {},
    url: "",
    headers: {},
    requirements: ["node"],
    minNode: 22,
    fields: [
      {
        key: "SAHKARMI_DB_DSN",
        target: "env",
        label: "Database address",
        hint: "Like postgres://user:password@localhost:5432/shop or sqlite:///C:/data/shop.db. Saved encrypted.",
        secret: true,
        required: true,
      },
    ],
    safety: [
      "Read-only: the SQL tool refuses anything that changes data (checked by the connector and by the database's own read-only mode).",
      "At most 1,000 rows per answer.",
    ],
    files: {
      "connection.toml": [
        "# Written by Sahkarmi. The address comes from the encrypted setting, not this file.",
        "[[sources]]",
        'id = "main"',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the connector expands ${...} from its env.
        'dsn = "${SAHKARMI_DB_DSN}"',
        "",
        "[[tools]]",
        'name = "execute_sql"',
        'source = "main"',
        "readonly = true",
        "max_rows = 1000",
        "",
        "[[tools]]",
        'name = "search_objects"',
        'source = "main"',
        "",
      ].join("\n"),
    },
    toolRules: [{ tool: "^search_objects$", category: READ_ONLY }],
    pin: {
      kind: "npm",
      package: "@bytebase/dbhub",
      version: "1.6.0",
      reason:
        "Latest npm release on 8 Nov 2026. Read-only is set per tool in its config file (the old --readonly flag was removed).",
    },
    credits: {
      project: "bytebase/dbhub",
      url: "https://github.com/bytebase/dbhub",
      licence: "MIT",
      copyright: "Copyright (c) 2025 Bytebase",
    },
  },
  {
    id: "email-sending",
    title: "Email sending",
    summary: "Sends email from your own domain and reads delivery status.",
    serverName: "email-sending",
    runtime: "node",
    transport: "stdio",
    command: "npx",
    args: ["-y", "resend-mcp@2.28.0"],
    env: { MCP_ALLOWED_FILE_DIRS: "@@SHARED@@" },
    url: "",
    headers: {},
    requirements: ["node"],
    minNode: 22,
    fields: [
      {
        key: "RESEND_API_KEY",
        target: "env",
        label: "Your Resend API key",
        hint: "Create a free API key in your Resend account (and verify your domain there), then paste it here.",
        secret: true,
        required: true,
        setupUrl: "https://resend.com/api-keys",
      },
      {
        key: "SENDER_EMAIL_ADDRESS",
        target: "env",
        label: "Send from (optional)",
        hint: "An address on your verified domain, like hello@yourshop.in.",
        secret: false,
        required: false,
      },
    ],
    safety: [
      "Every send, reply, broadcast or account change asks you first.",
      "Attachments can come only from the Shared folder.",
    ],
    toolRules: [
      { tool: "^(get|list|search)-", category: READ_ONLY },
      { tool: "^(send|reply|forward|share)-|broadcast", category: "external_messages" },
      { tool: ".*", category: "business_actions" },
    ],
    pin: {
      kind: "npm",
      package: "resend-mcp",
      version: "2.28.0",
      reason: "Latest npm release on 8 Nov 2026 (136 tools in source at commit 313a42e).",
    },
    credits: {
      project: "resend/resend-mcp",
      url: "https://github.com/resend/resend-mcp",
      licence: "MIT",
      copyright: "Copyright 2026 Plus Five Five, Inc",
    },
  },
  {
    id: "google-workspace",
    title: "Google Workspace",
    summary: "Gmail, Drive, Calendar, Docs and Sheets on your own Google account.",
    serverName: "google-workspace",
    runtime: "python",
    transport: "stdio",
    command: "uvx",
    args: ["workspace-mcp==2.3.0", "--tool-tier", "core", "--read-only"],
    env: {},
    url: "",
    headers: {},
    requirements: ["uv"],
    fields: [
      {
        key: "GOOGLE_OAUTH_CLIENT_ID",
        target: "env",
        label: "Google OAuth client ID",
        hint: "In Google Cloud Console create a free OAuth client (Desktop app) and enable the APIs you want; paste its client ID.",
        secret: false,
        required: true,
        setupUrl: "https://console.cloud.google.com/apis/credentials",
      },
      {
        key: "GOOGLE_OAUTH_CLIENT_SECRET",
        target: "env",
        label: "Google OAuth client secret",
        hint: "From the same OAuth client. Saved encrypted.",
        secret: true,
        required: true,
      },
      {
        key: "USER_GOOGLE_EMAIL",
        target: "env",
        label: "Your Google email (optional)",
        hint: "The account to use. The first use opens Google's sign-in page in your browser.",
        secret: false,
        required: false,
      },
    ],
    safety: [
      "Starts read-only (core tools only).",
      "If you remove --read-only, every send or change asks you first.",
      "You sign in to Google yourself; Sahkarmi never sees your password.",
    ],
    toolRules: [
      { tool: "^(get|list|search|read|query|check|inspect)_", category: READ_ONLY },
      { tool: "^(send|reply|forward|share)_|_send$", category: "external_messages" },
      { tool: ".*", category: "business_actions" },
    ],
    pin: {
      kind: "pypi",
      package: "workspace-mcp",
      version: "2.3.0",
      reason: "Latest PyPI release on 8 Nov 2026 (release v2.3.0).",
    },
    credits: {
      project: "taylorwilsdon/google_workspace_mcp",
      url: "https://github.com/taylorwilsdon/google_workspace_mcp",
      licence: "MIT",
      copyright: "Copyright (c) 2025 Taylor Wilsdon",
    },
  },
  {
    id: "india-lookups",
    title: "India GST & bank lookups",
    summary:
      "Checks GSTIN, PAN, IFSC, UPI IDs and pincodes, looks up HSN/SAC codes and works out GST and income tax.",
    serverName: "india-lookups",
    runtime: "python",
    transport: "stdio",
    command: "uvx",
    args: [
      "--from",
      "git+https://github.com/rehan1020/MCP-India-Stack@b1c5fd576b97a4a653201a2e0b2548922f541bb5",
      "mcp-india-stack",
    ],
    env: { MCP_INDIA_STACK_CACHE_DIR: "@@CONNECTOR_DIR@@\\cache" },
    url: "",
    headers: {},
    requirements: ["uv", "git"],
    fields: [],
    safety: [
      "No account or key; most checks run offline on this PC.",
      "Format checks only: a valid GSTIN or PAN is not proof the business is active.",
    ],
    toolRules: [{ tool: ".*", category: READ_ONLY }],
    heavy: true,
    pin: {
      kind: "git",
      repo: "rehan1020/MCP-India-Stack",
      commit: "b1c5fd576b97a4a653201a2e0b2548922f541bb5",
      reason:
        "Head of main on 8 Nov 2026 (version 0.8.0); pinned to the commit because the project moves fast.",
    },
    credits: {
      project: "rehan1020/MCP-India-Stack",
      url: "https://github.com/rehan1020/MCP-India-Stack",
      licence: "MIT",
      copyright: "Copyright (c) 2026 mcp-india-stack maintainers",
    },
  },
  {
    id: "tally-accounts",
    title: "Tally accounts",
    summary:
      "Reads the TallyPrime books on this PC: trial balance, ledgers, vouchers, GST registers, outstanding amounts and stock.",
    serverName: "tally",
    runtime: "program",
    transport: "stdio",
    command: "",
    args: [],
    env: {
      BRIDGE_TALLY_HOST: "localhost",
      BRIDGE_TALLY_PORT: "9000",
      BRIDGE_AGENT_REDACTION: "none",
      BRIDGE_AGENT_ENABLE_IMPORT: "true",
      // Posting into Tally stays off; voucher writes need the owner to turn this on by hand.
      BRIDGE_AGENT_ENABLE_WRITES: "false",
      BRIDGE_AGENT_ENABLE_TAX_AUDIT: "false",
    },
    url: "",
    headers: {},
    requirements: ["program"],
    fields: [
      {
        key: "command",
        target: "command",
        kind: "path",
        label: "Where the Tally connector program is",
        hint: "Download the Windows file of release mcp-v0.7.0, check its SHA-256, unzip it, and pick bin\\x86_64-pc-windows-msvc\\bridge_mcp.exe.",
        secret: false,
        required: true,
        setupUrl: "https://github.com/ComplyEaze/bridge/releases/tag/mcp-v0.7.0",
      },
      {
        key: "BRIDGE_TERMS_ACCEPTED",
        target: "env",
        kind: "accept",
        label: "I have read and accept the Tally connector's Terms of Use",
        hint: "It refuses every request until you accept them.",
        secret: false,
        required: true,
        setupUrl: "https://bridge.complyeaze.com/terms",
      },
    ],
    safety: [
      "Posting into Tally is OFF. Coworkers can read and prepare voucher files only.",
      "If you ever turn posting on, every voucher post asks you in Sahkarmi first (as a money action) and again in the connector's own window.",
      "Tally must be open with its port (9000) enabled.",
    ],
    toolRules: [
      { tool: "^(post_import|post_ledger_creates)$", category: "payments" },
      { tool: "^(acknowledge_post_review|prepare_ledger_creates)$", category: "business_actions" },
      {
        tool: "^(tally_status|list_companies|company_features|ledger_masters|masters|trial_balance|balance_sheet|profit_and_loss|cash_flow|ledger_movement|vouchers|voucher_presence|voucher_read_cost|voucher_schema|month_register|sales_register|purchase_register|stock_summary|negative_stock|negative_ledgers|gst_status|gst_uncertain_vouchers|gst_by_counter_ledger|validate_masters|verify_import|local_data_report|outstanding_[a-z_]+)$",
        category: READ_ONLY,
      },
    ],
    pin: {
      kind: "release",
      repo: "ComplyEaze/bridge",
      tag: "mcp-v0.7.0",
      commit: "fcfb5ff6958a60af3d713420bf1b488089d35cdb",
      sha256: "291a4ed95c758fad9fa04cd21a66be889e90a2fd03960fbceeec2c2a7242d4ec",
      programSha256: "48d2f7430b26da0d8f670eb74a27df46b99b7d45e05e102504482ddf24c8ba2d",
      reason:
        "Latest release on 8 Nov 2026; a Rust program, so the checked release file is pinned by its SHA-256.",
    },
    credits: {
      project: "ComplyEaze/bridge",
      url: "https://github.com/ComplyEaze/bridge",
      licence: "Apache-2.0",
      copyright: "Copyright 2026 ComplyEaze contributors",
    },
  },
  {
    id: "document-converter",
    title: "Document converter",
    summary:
      "Turns PDF, Word, Excel, PowerPoint, images and web pages into Markdown coworkers can read.",
    serverName: "document-converter",
    runtime: "python",
    transport: "stdio",
    command: "uvx",
    args: ["markitdown-mcp==0.0.1a8"],
    env: {},
    url: "",
    headers: {},
    requirements: ["uv"],
    fields: [],
    safety: [
      "Reading a file on this PC is checked like any file read (protected files are refused).",
    ],
    toolRules: [{ tool: "^convert_to_markdown$", category: READ_ONLY, uriKey: "uri" }],
    heavy: true,
    pin: {
      kind: "pypi",
      package: "markitdown-mcp",
      version: "0.0.1a8",
      reason: "Only published release on 8 Nov 2026 (an alpha); uses markitdown 0.1.x.",
    },
    credits: {
      project: "microsoft/markitdown (markitdown-mcp)",
      url: "https://github.com/microsoft/markitdown/tree/main/packages/markitdown-mcp",
      licence: "MIT",
      copyright: "Copyright (c) Microsoft Corporation",
    },
  },
  {
    id: "website-debugging",
    title: "Website debugging",
    summary:
      "Opens your website in a separate, empty Chrome window to check errors, network calls, speed and layout.",
    serverName: "website-debugging",
    runtime: "node",
    transport: "stdio",
    command: "npx",
    args: [
      "-y",
      "chrome-devtools-mcp@1.12.0",
      "--no-usage-statistics",
      "--no-performance-crux",
      "--isolated",
    ],
    env: {
      CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
      CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: "1",
    },
    url: "",
    headers: {},
    requirements: ["node", "chrome"],
    minNode: 20,
    fields: [],
    safety: [
      "Usage statistics are off and page addresses are not sent anywhere for speed data.",
      "Uses a fresh, empty Chrome profile each time: none of your sign-ins.",
      "Running page scripts, typing into forms and uploading files ask first.",
    ],
    toolRules: [
      {
        tool: "^(evaluate_script|fill|fill_form|type_text|upload_file|install_|uninstall_|execute_webmcp_tool)",
        category: "shell",
      },
      {
        tool: "^(click|click_at|drag|hover|press_key|handle_dialog|select_page|close_page|resize_page|emulate)$",
        category: "browser_interaction",
      },
      { tool: ".*", category: "browser_navigation" },
    ],
    pin: {
      kind: "npm",
      package: "chrome-devtools-mcp",
      version: "1.12.0",
      reason: "Latest npm release on 8 Nov 2026 (tag chrome-devtools-mcp-v1.12.0).",
    },
    credits: {
      project: "ChromeDevTools/chrome-devtools-mcp",
      url: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
      licence: "Apache-2.0",
      copyright: "Copyright 2025 Google LLC",
    },
  },
];

export function connectorPreset(id: string): ConnectorPreset | undefined {
  return CONNECTOR_PRESETS.find((preset) => preset.id === id);
}

/** For the Open-source credits view: one line per connector, upstream names kept. */
export function connectorCredits(): Array<ConnectorCredits & { connector: string }> {
  return CONNECTOR_PRESETS.map((preset) => ({ connector: preset.title, ...preset.credits }));
}
