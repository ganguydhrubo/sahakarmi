import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getName: () => "Sahkarmi" } }));

const { BrowserControlTracker, browserUserAgent, runBrowserTool } = await import("./browser-host");

const sessionAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Sahkarmi/0.7.5 Chrome/146.0.0.0 Electron/43.4.0 Safari/537.36";

describe("browserUserAgent", () => {
  it("drops the app and Electron tokens on ordinary sites", () => {
    expect(browserUserAgent(sessionAgent, "https://www.facebook.com/")).toBe(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    );
  });

  it("names the Electron engine honestly on Google's sign-in pages", () => {
    const agent = browserUserAgent(
      sessionAgent,
      "https://accounts.google.com/v3/signin/identifier",
    );
    expect(agent).toContain(`Chrome/146.0.0.0 Electron/${process.versions.electron}`);
    expect(agent).not.toContain("Sahkarmi");
  });
});

describe("act parsing", () => {
  async function actWith(action: Record<string, unknown>): Promise<unknown> {
    let received: unknown = null;
    const browser = {
      act: async (_tabId: string, _revision: number, parsed: unknown) => {
        received = parsed;
        return { revision: 1, title: "", url: "", text: "", elements: [] };
      },
    };
    const result = await runBrowserTool(
      browser as unknown as Parameters<typeof runBrowserTool>[0],
      new BrowserControlTracker(),
      {
        threadId: "t",
        turnId: "u",
        callId: "c",
        tool: "act",
        arguments: { tabId: "tab", revision: 0, action },
      } as Parameters<typeof runBrowserTool>[2],
    );
    if (!result.success) throw new Error(JSON.stringify(result.contentItems));
    return received;
  }

  it("types into the focused cell when ref is left out (Google Sheets)", async () => {
    expect(await actWith({ type: "type", text: "17-Oct\tFri" })).toEqual({
      type: "type",
      text: "17-Oct\tFri",
      submit: false,
    });
  });

  it("keeps the ref when one is given", async () => {
    expect(await actWith({ type: "type", ref: "3:1", text: "A91", submit: true })).toEqual({
      type: "type",
      ref: "3:1",
      text: "A91",
      submit: true,
    });
  });

  it("pastes given text, or the clipboard when text is left out", async () => {
    expect(await actWith({ type: "paste", text: "a\tb\nc\td" })).toEqual({
      type: "paste",
      text: "a\tb\nc\td",
    });
    expect(await actWith({ type: "paste" })).toEqual({ type: "paste" });
  });
});
