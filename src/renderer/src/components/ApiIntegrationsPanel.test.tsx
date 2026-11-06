import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ApiIntegrationSummary,
  ApiIntegrationsDesktopApi,
  BotSummary,
} from "../../../shared/ipc";
import { ApiIntegrationsPanel, accessChosen, apiMatches } from "./ApiIntegrationsPanel";

function summary(overrides: Partial<ApiIntegrationSummary> = {}): ApiIntegrationSummary {
  return {
    id: "api_1",
    name: "OpenWeather",
    provider: "OpenWeather",
    baseUrl: "https://api.openweathermap.org",
    docsUrl: null,
    specUrl: null,
    auth: { kind: "query", name: "appid" },
    keyMasked: "••••••••abcd",
    operations: [
      {
        id: "weather",
        method: "get",
        path: "/data/2.5/weather",
        summary: "Current weather",
        params: [],
        risky: false,
      },
      {
        id: "alert",
        method: "post",
        path: "/alerts",
        summary: "Create an alert",
        params: [],
        risky: true,
      },
    ],
    operationTotal: 40,
    testRequest: "GET /data/2.5/weather?q=Kolkata",
    status: "ready-to-test",
    missing: [],
    notes: ["Found the documentation and read 40 endpoints."],
    tests: [],
    testedAt: null,
    access: { everyone: false, ceo: false, botIds: [], workspaceIds: [] },
    createdAt: "2026-11-06T10:00:00.000Z",
    activatedAt: null,
    calls: 0,
    errors: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

const BOTS = [
  { id: "bot_a", name: "Asha", workspaceId: "ws_1" },
  { id: "bot_b", name: "Bimal", workspaceId: "ws_1" },
] as unknown as BotSummary[];

function install(
  list: ApiIntegrationSummary[],
  overrides: Partial<ApiIntegrationsDesktopApi> = {},
) {
  const apis: ApiIntegrationsDesktopApi = {
    list: vi.fn(async () => list),
    discover: vi.fn(async () => summary()),
    update: vi.fn(async () => summary()),
    runTests: vi.fn(async () => summary()),
    activate: vi.fn(async () => summary({ status: "active" })),
    setEnabled: vi.fn(async (_id: string, enabled: boolean) =>
      summary({ status: enabled ? "active" : "disabled" }),
    ),
    setAccess: vi.fn(async (_id, access) => summary({ status: "tested", access })),
    activity: vi.fn(async () => []),
    revoke: vi.fn(async () => true),
    ...overrides,
  };
  Object.defineProperty(window, "sahkarmi", {
    value: {
      apis,
      agent: { listBots: vi.fn(async () => BOTS) },
      team: {
        listWorkspaces: vi.fn(async () => ({
          workspaces: [{ id: "ws_1", name: "My Business", createdAt: "2026-10-01" }],
          activeWorkspaceId: "ws_1",
        })),
      },
    },
    configurable: true,
    writable: true,
  });
  return apis;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("helpers", () => {
  it("matches search words and knows when nobody was chosen", () => {
    expect(apiMatches(summary(), ["openweathermap"])).toBe(true);
    expect(apiMatches(summary(), ["stripe"])).toBe(false);
    expect(accessChosen(summary().access)).toBe(false);
    expect(accessChosen({ ...summary().access, botIds: ["bot_a"] })).toBe(true);
  });
});

describe("ApiIntegrationsPanel", () => {
  it("discovers an API from a pasted key and optional links, showing a busy state", async () => {
    let finish: (value: ApiIntegrationSummary) => void = () => undefined;
    const apis = install([], {
      discover: vi.fn(
        () =>
          new Promise<ApiIntegrationSummary>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    render(() => <ApiIntegrationsPanel query="" />);
    expect(await screen.findByText(/No APIs yet/)).toBeVisible();

    const button = screen.getByRole("button", { name: "Find out how it works" });
    expect(button).toBeDisabled();
    fireEvent.input(screen.getByLabelText("Paste your API key"), {
      target: { value: " sk-secret-1234 " },
    });
    fireEvent.input(screen.getByLabelText("Documentation link"), {
      target: { value: "https://openweathermap.org/api" },
    });
    fireEvent.click(button);

    expect(await screen.findByRole("button", { name: "Finding out…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/half a minute/);
    expect(apis.discover).toHaveBeenCalledWith({
      apiKey: "sk-secret-1234",
      docsUrl: "https://openweathermap.org/api",
    });

    finish(summary());
    expect(await screen.findByRole("heading", { name: "OpenWeather" })).toBeVisible();
    expect(screen.getByText("••••••••abcd")).toBeVisible();
    expect(screen.queryByText(/sk-secret/)).toBeNull();
    expect(screen.getByLabelText("Paste your API key")).toHaveValue("");
    expect(screen.getByText("Ready to test")).toBeVisible();
  });

  it("shows the discovery error without the Electron wrapper", async () => {
    install([], {
      discover: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'apis:discover': Error: The key was refused.",
        );
      }),
    });
    render(() => <ApiIntegrationsPanel query="" />);
    await screen.findByText(/No APIs yet/);
    fireEvent.input(screen.getByLabelText("Paste your API key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Find out how it works" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^The key was refused\.$/);
  });

  it("asks only for the missing fields and sends only those", async () => {
    const apis = install([
      summary({ status: "needs-info", missing: ["baseUrl", "example"], baseUrl: null }),
    ]);
    render(() => <ApiIntegrationsPanel query="" />);
    await screen.findByText("Needs a detail from you");
    const form = screen.getByRole("form", { name: "Sahkarmi needs a little more to finish" });
    expect(within(form).queryByLabelText("Provider name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Run tests" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn on for coworkers" })).toBeNull();

    fireEvent.input(screen.getByLabelText("API address (base URL)"), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.input(screen.getByLabelText(/One example request/), {
      target: { value: "https://api.example.com/v1/weather?city=Kolkata" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() =>
      expect(apis.update).toHaveBeenCalledWith("api_1", {
        baseUrl: "https://api.example.com/v1",
        example: "https://api.example.com/v1/weather?city=Kolkata",
      }),
    );
  });

  it("shows exactly the outcomes the tests returned and no activation after a failure", async () => {
    const apis = install([summary()], {
      runTests: vi.fn(async () =>
        summary({
          status: "failed",
          testedAt: "2026-11-06T10:05:00.000Z",
          tests: [
            { id: "auth", outcome: "passed", detail: "The key was accepted." },
            { id: "request", outcome: "failed", detail: "The API answered 404." },
            { id: "errors", outcome: "skipped", detail: "Skipped after the failure." },
          ],
        }),
      ),
    });
    render(() => <ApiIntegrationsPanel query="" />);
    expect(await screen.findByText(/Not tested yet/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    await waitFor(() => expect(apis.runTests).toHaveBeenCalledWith("api_1"));

    const auth = (await screen.findByText("Key works")).closest("li") as HTMLElement;
    expect(auth).toHaveClass("apis-test-passed");
    expect(within(auth).getByText("Passed")).toBeVisible();
    const request = screen.getByText("Real request answered").closest("li") as HTMLElement;
    expect(request).toHaveClass("apis-test-failed");
    expect(within(request).getByText("The API answered 404.")).toBeVisible();
    const errors = screen.getByText("Handles errors, time-outs and limits").closest("li");
    expect(errors).toHaveClass("apis-test-skipped");
    expect(screen.queryByText("Reaches the API")).toBeNull();
    expect(screen.getAllByText("Passed")).toHaveLength(1);
    expect(screen.getByText("Tests failed")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Turn on for coworkers" })).toBeNull();
    expect(screen.getByRole("button", { name: "Run tests again" })).toBeVisible();
  });

  it("offers activation only once tested, and lists endpoints with risky ones flagged", async () => {
    const apis = install([summary({ status: "tested" })]);
    render(() => <ApiIntegrationsPanel query="" />);
    const button = await screen.findByRole("button", { name: "Turn on for coworkers" });
    expect(screen.getByText(/Nobody can use this API until you choose/)).toBeVisible();
    expect(screen.getByText("Endpoints (40)")).toBeInTheDocument();
    expect(screen.getByText("asks you first")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 40.")).toBeInTheDocument();

    fireEvent.click(button);
    await waitFor(() => expect(apis.activate).toHaveBeenCalledWith("api_1"));
    expect(await screen.findByText("On for coworkers")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Turn on for coworkers" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(apis.setEnabled).toHaveBeenCalledWith("api_1", false));
    expect(await screen.findByRole("button", { name: "Turn on again" })).toBeVisible();
  });

  it("saves who can use it", async () => {
    const apis = install([summary({ status: "tested" })]);
    render(() => <ApiIntegrationsPanel query="" />);
    const save = await screen.findByRole("button", { name: "Save who can use it" });
    expect(save).toBeDisabled();
    fireEvent.click(await screen.findByLabelText("Workspace CEO"));
    fireEvent.click(await screen.findByLabelText("Bimal"));
    fireEvent.click(await screen.findByLabelText("Everyone in My Business"));
    fireEvent.click(save);
    await waitFor(() =>
      expect(apis.setAccess).toHaveBeenCalledWith("api_1", {
        everyone: false,
        ceo: true,
        botIds: ["bot_b"],
        workspaceIds: ["ws_1"],
      }),
    );
    expect(await screen.findByText("Saved.")).toBeVisible();
    expect(screen.queryByText(/Nobody can use this API/)).toBeNull();
  });

  it("loads activity with coworker names when opened", async () => {
    const apis = install([summary({ status: "active", calls: 3, errors: 1 })], {
      activity: vi.fn(async () => [
        {
          at: "2026-11-06T11:00:00.000Z",
          botId: "bot_a",
          operation: "GET /data/2.5/weather",
          status: 200,
          ok: true,
          ms: 182,
          error: null,
        },
      ]),
    });
    render(() => <ApiIntegrationsPanel query="" />);
    await screen.findByText(/Used 3 times · 1 errors/);
    const details = screen.getByText("Activity").closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(apis.activity).toHaveBeenCalledWith("api_1"));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Asha")).toBeInTheDocument();
    expect(within(table).getByText("182 ms")).toBeInTheDocument();
  });

  it("removes an API only after confirming inside the card", async () => {
    const apis = install([summary()]);
    const confirm = vi.spyOn(window, "confirm");
    render(() => <ApiIntegrationsPanel query="" />);
    await screen.findByRole("heading", { name: "OpenWeather" });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(apis.revoke).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Remove OpenWeather\?/);
    fireEvent.click(within(alert).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(apis.revoke).toHaveBeenCalledWith("api_1"));
    expect(await screen.findByText(/No APIs yet/)).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
  });
});
