// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONNECTOR_LICENCES, CONNECTOR_PRESETS, connectorPreset } from "../../shared/mcp-presets";
import { FeatureRegistry } from "../feature-registry";
import { McpServerStore } from "../mcp-servers";
import { isSensitive } from "../permission-policy";
import {
  type ConnectorContext,
  connectorChecks,
  connectorIdOf,
  connectorInput,
  connectorMissing,
  connectorSource,
  connectorToolCategory,
  splitToolName,
} from "./connectors";
import { placeholderHits } from "./placeholders";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

async function setup(
  gallery = true,
): Promise<{ store: McpServerStore; context: ConnectorContext }> {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-connectors-"));
  const store = new McpServerStore(join(root, "user-data"));
  store.setFeatureCheck((id) =>
    id === "mcp-connector-gallery" ? gallery : id === "mcp-test-first",
  );
  await store.load();
  return {
    store,
    context: {
      sharedRoot: join(root, "Shared"),
      connectorRoot: join(root, "user-data", "mcp-connectors"),
    },
  };
}

const CONTEXT: ConnectorContext = {
  sharedRoot: "C:\\Users\\owner\\Sahkarmi\\Shared",
  connectorRoot: "C:\\Users\\owner\\AppData\\Roaming\\Sahkarmi\\mcp-connectors",
};

function preset(id: string) {
  const found = connectorPreset(id);
  if (!found) throw new Error(`no preset ${id}`);
  return found;
}

/** Values that satisfy every required field of a preset. */
function filled(id: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of preset(id).fields) {
    if (!field.required) continue;
    values[field.key] =
      field.kind === "accept"
        ? "true"
        : field.target === "command"
          ? "C:\\Tools\\tally\\bridge_mcp.exe"
          : "test-value";
  }
  return values;
}

describe("connector list", () => {
  it("has unique ids and server names, and twelve connectors", () => {
    expect(CONNECTOR_PRESETS).toHaveLength(12);
    expect(new Set(CONNECTOR_PRESETS.map((entry) => entry.id)).size).toBe(12);
    expect(new Set(CONNECTOR_PRESETS.map((entry) => entry.serverName)).size).toBe(12);
    for (const entry of CONNECTOR_PRESETS) {
      expect(entry.serverName).toMatch(/^[A-Za-z0-9_-]{1,48}$/);
      expect(entry.serverName).not.toMatch(/^sahkarmi/i);
    }
  });

  it("pins every launch to an exact version, commit or checked release", () => {
    for (const entry of CONNECTOR_PRESETS) {
      const launch = [entry.command, ...entry.args, entry.url].join(" ");
      expect(launch, entry.id).not.toMatch(/@latest|@next|\^|~/);
      expect(entry.pin.reason.length, entry.id).toBeGreaterThan(10);
      switch (entry.pin.kind) {
        case "npm":
          expect(entry.pin.version).toMatch(/^\d+\.\d+\.\d+$/);
          expect(entry.args).toContain(`${entry.pin.package}@${entry.pin.version}`);
          break;
        case "pypi":
          expect(entry.pin.version).toMatch(/^\d+(\.\d+)*([ab]\d+)?$/);
          expect(entry.args).toContain(`${entry.pin.package}==${entry.pin.version}`);
          break;
        case "git":
          expect(entry.pin.commit).toMatch(/^[0-9a-f]{40}$/);
          expect(
            entry.args.some((arg) =>
              arg.endsWith(`@${entry.pin.kind === "git" ? entry.pin.commit : ""}`),
            ),
          ).toBe(true);
          break;
        case "release":
          expect(entry.pin.commit).toMatch(/^[0-9a-f]{40}$/);
          expect(entry.pin.sha256).toMatch(/^[0-9a-f]{64}$/);
          expect(entry.pin.programSha256).toMatch(/^[0-9a-f]{64}$/);
          expect(entry.pin.tag).toBeTruthy();
          break;
        case "remote":
          expect(entry.pin.url).toBe(entry.url);
          expect(entry.pin.checkedRelease).toMatch(/^v\d+\.\d+\.\d+$/);
          break;
      }
    }
  });

  it("only carries allowed licences, with credits for the Open-source credits list", () => {
    for (const entry of CONNECTOR_PRESETS) {
      const parts = entry.credits.licence.split(/\s+(?:AND|OR)\s+/);
      for (const part of parts) expect(CONNECTOR_LICENCES, entry.id).toContain(part);
      expect(entry.credits.url).toMatch(/^https:\/\/github\.com\//);
      expect(entry.credits.copyright).toMatch(/Copyright/);
      expect(entry.credits.project).toBeTruthy();
    }
  });

  it("shows only Sahkarmi wording on cards (upstream names stay in credits and setup steps)", () => {
    const upstream =
      /modelcontextprotocol|anthropic|bytebase|dbhub|resend|wilsdon|india.?stack|complyeaze|bridge|markitdown|microsoft|devtools|github|copilot|tallyprime solutions/i;
    for (const entry of CONNECTOR_PRESETS) {
      const card = [entry.id, entry.title, entry.serverName, entry.summary, ...entry.safety].join(
        " ",
      );
      expect(card, entry.id).not.toMatch(upstream);
    }
  });

  it("is off by default and never starts anything on app launch", async () => {
    const { store, context } = await setup(false);
    const registry = new FeatureRegistry(join(root ?? "", "features"));
    await registry.initialize();
    expect(registry.isEnabled("mcp-connector-gallery")).toBe(false);
    // The existing MCP switches keep their defaults.
    expect(registry.isEnabled("mcp-test-first")).toBe(true);

    expect(await store.connectorChecks()).toEqual([]);
    await expect(store.addConnector("time", "time", {}, context)).rejects.toThrow(/Turn on/);
    expect(store.list()).toEqual([]);
    expect(store.enabled()).toEqual([]);
  });
});

describe("adding a connector", () => {
  it("saves the same shape as a manual add, switched off, with nothing a coworker would start", async () => {
    const { store, context } = await setup();
    const servers = await store.addConnector("time", "", {}, context);
    expect(servers).toHaveLength(1);
    const added = store.get(servers[0]?.id ?? "");
    expect(added?.enabled).toBe(false);
    expect(added?.source).toBe(connectorSource("time"));
    expect(store.enabled()).toEqual([]);

    const manual = await store.save({
      ...connectorInput(preset("time"), {}, context),
      name: "time-by-hand",
    });
    const byHand = store.get(manual.find((entry) => entry.name === "time-by-hand")?.id ?? "");
    expect(Object.keys(byHand ?? {}).sort()).toEqual(Object.keys(added ?? {}).sort());
    const strip = (value: typeof added) => {
      const {
        id: _id,
        addedAt: _at,
        source: _source,
        name: _name,
        ...rest
      } = value ?? ({} as never);
      return rest;
    };
    expect(strip(byHand)).toEqual(strip(added));
  });

  it("fills in the Shared folder and the connector folder, and leaves no template values", () => {
    for (const entry of CONNECTOR_PRESETS) {
      const input = connectorInput(entry, filled(entry.id), CONTEXT);
      expect(JSON.stringify(input), entry.id).not.toContain("@@");
      expect(placeholderHits(input), entry.id).toEqual([]);
      expect(input.enabled).toBe(false);
    }
    const files = connectorInput(preset("files"), {}, CONTEXT);
    expect(files.args?.at(-1)).toBe(CONTEXT.sharedRoot);
    expect(files.args).toContain("--confine-roots");
  });

  it("asks for required keys and agreements up front", () => {
    expect(() => connectorInput(preset("code-hosting"), {}, CONTEXT)).toThrow(/GitHub token/);
    expect(() =>
      connectorInput(preset("tally-accounts"), { command: "C:\\Tools\\bridge_mcp.exe" }, CONTEXT),
    ).toThrow(/Tick/);
    expect(() =>
      connectorInput(
        preset("tally-accounts"),
        { command: "bridge_mcp.exe", BRIDGE_TERMS_ACCEPTED: "true" },
        CONTEXT,
      ),
    ).toThrow(/full path/);
    const hosting = connectorInput(
      preset("code-hosting"),
      { Authorization: "github_pat_x" },
      CONTEXT,
    );
    expect(hosting.headers).toEqual({
      "X-MCP-Readonly": "true",
      Authorization: "Bearer github_pat_x",
    });
  });

  it("refuses a second server with the same name", async () => {
    const { store, context } = await setup();
    await store.addConnector("time", "", {}, context);
    await expect(store.addConnector("time", "", {}, context)).rejects.toThrow(/already/);
  });
});

describe("safe defaults", () => {
  it("website debugging always has usage statistics off and an isolated profile", async () => {
    const entry = preset("website-debugging");
    const input = connectorInput(entry, {}, CONTEXT);
    expect(input.args).toEqual(
      expect.arrayContaining(["--no-usage-statistics", "--isolated", "--no-performance-crux"]),
    );
    expect(input.env?.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS).toBe("1");
    const { store, context } = await setup();
    const [saved] = await store.addConnector("website-debugging", "", {}, context);
    const config = store.get(saved?.id ?? "");
    expect(config?.args).toContain("--no-usage-statistics");
    expect(config?.args).toContain("--isolated");
    expect(config?.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS).toBe("1");
  });

  it("databases start read-only, with the address only in the encrypted setting", async () => {
    const { store, context } = await setup();
    const [saved] = await store.addConnector(
      "databases",
      "",
      { SAHKARMI_DB_DSN: "sqlite:///C:/data/shop.db" },
      context,
    );
    const config = store.get(saved?.id ?? "");
    expect(config?.args).not.toContain("--dsn");
    const at = config?.args.indexOf("--config") ?? -1;
    const file = config?.args[at + 1] ?? "";
    expect(file).toBe(join(context.connectorRoot, "databases", "connection.toml"));
    const toml = await readFile(file, "utf8");
    expect(toml).toMatch(/name = "execute_sql"\r?\nsource = "main"\r?\nreadonly = true/);
    expect(toml).not.toContain("sqlite:");
    expect(config?.env.SAHKARMI_DB_DSN).toBe("sqlite:///C:/data/shop.db");
  });

  it("Tally starts with posting off and its write tools always ask", async () => {
    const entry = preset("tally-accounts");
    expect(entry.env.BRIDGE_AGENT_ENABLE_WRITES).toBe("false");
    expect(entry.env.BRIDGE_AGENT_ENABLE_TAX_AUDIT).toBe("false");
    expect(entry.env).not.toHaveProperty("BRIDGE_AGENT_ENABLE_MASTER_WRITES");
    for (const tool of [
      "post_import",
      "post_ledger_creates",
      "prepare_ledger_creates",
      "acknowledge_post_review",
    ]) {
      const rule = connectorToolCategory(entry, tool, {});
      expect(rule, tool).not.toBeNull();
      expect(isSensitive(rule?.category ?? "research"), tool).toBe(true);
    }
    expect(connectorToolCategory(entry, "post_import", {})?.category).toBe("payments");
    expect(connectorToolCategory(entry, "trial_balance", {})?.category).toBe("research");
    // Not every tool is guessed: an unknown one keeps the usual ask.
    expect(connectorToolCategory(entry, "build_import_xml", {})).toBeNull();

    const { store, context } = await setup();
    await store.addConnector("tally-accounts", "", filled("tally-accounts"), context);
    expect(store.connectorToolCategory("mcp__tally__post_import", {})?.category).toBe("payments");
    expect(store.get(store.list()[0]?.id ?? "")?.env.BRIDGE_AGENT_ENABLE_WRITES).toBe("false");
  });

  it("sends, posts and account changes are sensitive; reads are not", () => {
    const sensitive: Array<[string, string]> = [
      ["email-sending", "send-email"],
      ["email-sending", "send-broadcast"],
      ["email-sending", "remove-domain"],
      ["code-hosting", "create_issue"],
      ["code-hosting", "merge_pull_request"],
      ["google-workspace", "send_gmail_message"],
      ["google-workspace", "create_event"],
    ];
    for (const [id, tool] of sensitive) {
      const category = connectorToolCategory(preset(id), tool, {})?.category ?? "research";
      expect(isSensitive(category), `${id} ${tool}`).toBe(true);
    }
    const reads: Array<[string, string]> = [
      ["email-sending", "list-emails"],
      ["code-hosting", "get_file_contents"],
      ["code-hosting", "issue_read"],
      ["google-workspace", "search_gmail_messages"],
      ["india-lookups", "validate_gstin"],
      ["time", "get_current_time"],
      ["web-reader", "fetch"],
    ];
    for (const [id, tool] of reads) {
      expect(connectorToolCategory(preset(id), tool, {})?.category, `${id} ${tool}`).toBe(
        "research",
      );
    }
  });

  it("file tools carry their paths so the folder rules apply", () => {
    const files = preset("files");
    expect(connectorToolCategory(files, "write_file", { path: "C:\\S\\a.txt" })).toEqual({
      category: "file_create",
      paths: ["C:\\S\\a.txt"],
    });
    expect(
      connectorToolCategory(files, "move_file", { source: "C:\\S\\a", destination: "C:\\S\\b" }),
    ).toEqual({ category: "file_modify", paths: ["C:\\S\\a", "C:\\S\\b"] });
    const converter = preset("document-converter");
    expect(
      connectorToolCategory(converter, "convert_to_markdown", { uri: "file:///C:/S/report.pdf" }),
    ).toEqual({ category: "file_read", paths: ["C:\\S\\report.pdf"] });
    expect(
      connectorToolCategory(converter, "convert_to_markdown", { uri: "https://example.com" })
        ?.category,
    ).toBe("research");
    expect(connectorToolCategory(converter, "convert_to_markdown", { uri: "ftp://x" })).toBeNull();
  });

  it("leaves servers the owner added by hand alone, even with a connector's name", async () => {
    const { store } = await setup();
    await store.save({ name: "tally", transport: "stdio", command: "C:\\x\\tally.exe" });
    expect(store.connectorToolCategory("mcp__tally__post_import", {})).toBeNull();
    expect(connectorIdOf("added by hand")).toBeNull();
    expect(connectorIdOf(connectorSource("not-a-connector"))).toBeNull();
    expect(splitToolName("mcp__email-sending__send-email")).toEqual({
      server: "email-sending",
      tool: "send-email",
    });
  });
});

describe("requirements", () => {
  const everything = { has: () => true, nodeMajor: 24, chrome: true };

  it("is ready when the runtimes are here", () => {
    const checks = connectorChecks(everything, () => null);
    expect(checks.every((check) => check.ready)).toBe(true);
  });

  it("gives a plain install link for what is missing and never installs it", () => {
    const none = { has: () => false, nodeMajor: null, chrome: false };
    expect(connectorMissing(preset("time"), none)).toEqual([
      { requirement: "uv", link: "https://docs.astral.sh/uv/getting-started/installation/" },
    ]);
    expect(connectorMissing(preset("git"), none).map((entry) => entry.requirement)).toEqual([
      "uv",
      "git",
    ]);
    expect(
      connectorMissing(preset("website-debugging"), none).map((entry) => entry.requirement),
    ).toEqual(["node", "chrome"]);
    // Remote and program connectors need nothing installed by a runtime.
    expect(connectorMissing(preset("code-hosting"), none)).toEqual([]);
    expect(connectorMissing(preset("tally-accounts"), none)).toEqual([]);
  });

  it("says when Node.js is too old for a connector", () => {
    const old = { has: () => true, nodeMajor: 22, chrome: true };
    expect(connectorMissing(preset("files"), old)).toEqual([
      {
        requirement: "node",
        link: "https://nodejs.org/en/download",
        minVersion: 24,
        foundVersion: 22,
      },
    ]);
    expect(connectorMissing(preset("databases"), old)).toEqual([]);
  });

  it("reports which connector is already added", () => {
    const checks = connectorChecks(everything, (id) => (id === "time" ? "my-time" : null));
    expect(checks.find((check) => check.id === "time")?.addedAs).toBe("my-time");
  });
});
