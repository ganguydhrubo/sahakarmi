import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposioAppMeta, ComposioStatus, SahkarmiDesktopApi } from "../../../shared/ipc";
import { AppsPanel, appMatches } from "./AppsPanel";

type ComposioApi = SahkarmiDesktopApi["composio"];

function app(overrides: Partial<ComposioAppMeta> & { id: string; name: string }): ComposioAppMeta {
  return {
    description: "",
    logo: null,
    categories: [],
    toolsCount: null,
    auth: "oauth",
    oneClick: true,
    isConnected: false,
    connectedAccountId: null,
    connectionStatus: null,
    ...overrides,
  };
}

const NO_KEY: ComposioStatus = {
  configured: false,
  apiKeyMasked: null,
  connectedCount: 0,
  freeTierActive: true,
  monthlyQuota: 100_000,
  planName: "Hobby",
  catalogueSize: 7,
  catalogueError: null,
};
const WITH_KEY: ComposioStatus = {
  ...NO_KEY,
  configured: true,
  apiKeyMasked: "comp…cdef",
  connectedCount: 1,
  catalogueSize: 3,
};

const GITHUB = app({
  id: "github",
  name: "GitHub",
  description: "Repositories, issues and pull requests.",
  categories: ["Developer tools"],
  toolsCount: 120,
  logo: "https://logos.example/github.svg",
  isConnected: true,
  connectedAccountId: "ca_gh",
  connectionStatus: "ACTIVE",
});
const SLACK = app({
  id: "slack",
  name: "Slack",
  description: "Channels and messages.",
  categories: ["Communication"],
});
const CRM = app({
  id: "custom_crm",
  name: "Custom CRM",
  description: "Your own CRM.",
  auth: "api-key",
  oneClick: false,
});

function install(
  overrides: Partial<ComposioApi> = {},
  status: ComposioStatus = WITH_KEY,
  apps: ComposioAppMeta[] = [GITHUB, SLACK, CRM],
) {
  const composio: ComposioApi = {
    getStatus: vi.fn(async () => status),
    setKey: vi.fn(async () => WITH_KEY),
    listApps: vi.fn(async () => apps),
    connect: vi.fn(async () => ({
      connectionId: "ca_new",
      redirectUrl: "https://connect.composio.dev/link/lt_1",
    })),
    connectionStatus: vi.fn(async () => ({
      connectionId: "ca_new",
      status: "ACTIVE",
      state: "connected" as const,
    })),
    disconnect: vi.fn(async () => true),
    ...overrides,
  };
  const openUrl = vi.fn(async () => undefined);
  Object.defineProperty(window, "sahkarmi", {
    value: { composio, openUrl },
    configurable: true,
    writable: true,
  });
  return { composio, openUrl };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("appMatches", () => {
  it("matches every word against name, slug, description and categories", () => {
    expect(appMatches(GITHUB, [])).toBe(true);
    expect(appMatches(GITHUB, ["pull", "developer"])).toBe(true);
    expect(appMatches(GITHUB, ["custom_crm"])).toBe(false);
    expect(appMatches(CRM, ["custom_crm"])).toBe(true);
  });
});

describe("AppsPanel", () => {
  it("shows every app before a key exists and asks for the key only on Connect", async () => {
    install({}, NO_KEY, [SLACK, CRM]);
    render(() => <AppsPanel query="" />);
    await screen.findByRole("heading", { name: "Slack" });
    expect(screen.getByText(/Composio Hobby plan/)).toHaveTextContent(/tool calls a month/);
    expect(screen.getByText(/Browse all 2 apps now/)).toBeVisible();
    expect(screen.getByText(/waits for your approval first/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Add your free Composio key" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your apps" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Connect" })[0]);
    expect(
      await screen.findByRole("heading", { name: "Add your free Composio key" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "To connect Slack, add your free Composio key first.",
    );
    expect(screen.getByText(/One key covers every app and every coworker/)).toBeVisible();
    expect(window.sahkarmi.composio.connect).not.toHaveBeenCalled();
  });

  it("shows connected apps first and the rest with a Connect button", async () => {
    install();
    render(() => <AppsPanel query="" />);
    const yours = (await screen.findByRole("heading", { name: "Your apps" })).closest("section");
    expect(yours).not.toBeNull();
    if (!yours) return;
    expect(within(yours).getByRole("heading", { name: "GitHub" })).toBeVisible();
    expect(within(yours).getByText(/Connected/)).toBeVisible();
    expect(within(yours).getByText("120 tools")).toBeVisible();
    expect(within(yours).getByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(yours.querySelector("img.apps-logo")).toHaveAttribute(
      "src",
      "https://logos.example/github.svg",
    );

    const more = screen.getByRole("heading", { name: "More apps" }).closest("section");
    expect(more).not.toBeNull();
    if (!more) return;
    expect(within(more).getByText("2 apps")).toBeVisible();
    expect(within(more).getAllByRole("button", { name: "Connect" })).toHaveLength(2);
    expect(within(more).getByText("Communication")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Add your free Composio key" })).toBeNull();
  });

  it("filters the list with the Marketplace search", async () => {
    install();
    render(() => <AppsPanel query="slack" />);
    await screen.findByRole("heading", { name: "Slack" });
    expect(screen.queryByRole("heading", { name: "GitHub" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Your apps" })).toBeNull();
  });

  it("says when nothing matches", async () => {
    install();
    render(() => <AppsPanel query="zzz" />);
    expect(await screen.findByText("No apps match “zzz”.")).toBeVisible();
  });

  it("saves the key after Composio accepts it and loads the full list", async () => {
    let status = NO_KEY;
    let apps: ComposioAppMeta[] = [SLACK];
    const { composio } = install({
      getStatus: vi.fn(async () => status),
      listApps: vi.fn(async () => apps),
      setKey: vi.fn(async () => {
        status = WITH_KEY;
        apps = [GITHUB, SLACK, CRM];
        return WITH_KEY;
      }),
    });
    render(() => <AppsPanel query="" />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Add key" }))[0]);
    const input = await screen.findByLabelText("Paste your Composio API key");
    const save = screen.getByRole("button", { name: "Save key" });
    expect(save).toBeDisabled();
    fireEvent.input(input, { target: { value: "  comp_live_key_1234  " } });
    expect(save).toBeEnabled();
    fireEvent.submit(save.closest("form") as HTMLFormElement);
    await waitFor(() => expect(composio.setKey).toHaveBeenCalledWith("comp_live_key_1234"));
    await screen.findByRole("heading", { name: "Your apps" });
    expect(screen.queryByRole("heading", { name: "Add your free Composio key" })).toBeNull();
    expect(composio.listApps).toHaveBeenLastCalledWith(true);
  });

  it("opens Composio's sign-in page and moves the app up once the account is active", async () => {
    let apps: ComposioAppMeta[] = [GITHUB, SLACK];
    const { composio, openUrl } = install({
      listApps: vi.fn(async () => apps),
      connectionStatus: vi.fn(async () => {
        apps = [GITHUB, { ...SLACK, isConnected: true, connectedAccountId: "ca_new" }];
        return { connectionId: "ca_new", status: "ACTIVE", state: "connected" as const };
      }),
    });
    render(() => <AppsPanel query="" pollEveryMs={10} />);
    const connect = await screen.findByRole("button", { name: "Connect" });
    fireEvent.click(connect);
    await waitFor(() => expect(composio.connect).toHaveBeenCalledWith("slack"));
    await waitFor(() =>
      expect(openUrl).toHaveBeenCalledWith("https://connect.composio.dev/link/lt_1"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/sign-in page for Slack/);
    await waitFor(() => expect(composio.connectionStatus).toHaveBeenCalledWith("ca_new"));
    const yours = (await screen.findByRole("heading", { name: "Your apps" })).closest("section");
    await waitFor(() => {
      expect(yours && within(yours).queryByRole("heading", { name: "Slack" })).not.toBeNull();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
  });

  it("disconnects only after the owner confirms", async () => {
    const { composio } = install();
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(() => <AppsPanel query="" />);
    const button = await screen.findByRole("button", { name: "Disconnect" });
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Disconnect GitHub?"));
    expect(composio.disconnect).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(composio.disconnect).toHaveBeenCalledWith("ca_gh"));
  });

  it("shows Composio's own words when a connection cannot start", async () => {
    install({
      connect: vi.fn(async () => {
        throw new Error("Custom CRM needs your own developer app keys.");
      }),
    });
    render(() => <AppsPanel query="crm" />);
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/needs your own developer app keys/);
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });
});
