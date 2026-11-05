import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getName: () => "Sahkarmi" } }));

const {
  ANY_REVISION,
  BrowserControlTracker,
  SNAPSHOT_BUDGET,
  browserUserAgent,
  actStatusFrom,
  elementClip,
  elementLine,
  elementRectScript,
  fitInWindow,
  fitSnapshot,
  runBrowserTool,
  validateBounds,
} = await import("./browser-host");

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

describe("act arguments from runtimes that leave fields out", () => {
  async function call(args: Record<string, unknown>): Promise<[string, number]> {
    let received: [string, number] = ["", 0];
    const browser = {
      act: async (tabId: string, revision: number) => {
        received = [tabId, revision];
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
        arguments: args,
      } as Parameters<typeof runBrowserTool>[2],
    );
    if (!result.success) throw new Error(JSON.stringify(result.contentItems));
    return received;
  }

  it("takes pageId for tabId and the revision from the ref", async () => {
    expect(await call({ pageId: "tab-9", action: { type: "click", ref: "7:3" } })).toEqual([
      "tab-9",
      7,
    ]);
  });

  it("asks for a status, not a page, unless snapshot is true", async () => {
    const seen: unknown[] = [];
    const browser = {
      act: async (_tab: string, _revision: number, _action: unknown, options: unknown) => {
        seen.push(options);
        return { revision: 1, title: "", url: "", text: "", elements: [] };
      },
    };
    const call = (args: Record<string, unknown>) =>
      runBrowserTool(
        browser as unknown as Parameters<typeof runBrowserTool>[0],
        new BrowserControlTracker(),
        { threadId: "t", turnId: "u", callId: "c", tool: "act", arguments: args } as Parameters<
          typeof runBrowserTool
        >[2],
      );
    await call({ tabId: "tab-9", action: { type: "key", key: "Escape" } });
    await call({ tabId: "tab-9", snapshot: true, action: { type: "key", key: "Escape" } });
    expect(seen).toEqual([{ snapshot: false }, { snapshot: true }]);
  });

  it("lets a key press without ref or revision through", async () => {
    expect(await call({ tabId: "tab-9", action: { type: "key", key: "Escape" } })).toEqual([
      "tab-9",
      ANY_REVISION,
    ]);
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

describe("snapshots sent to a coworker", () => {
  const page = (text: string, names: string[]) => ({
    tabId: "tab",
    revision: 4,
    title: "Inbox",
    url: "https://www.instagram.com/direct/inbox/",
    text,
    elements: names.map((name, index) => ({
      ref: `4:${index}`,
      tag: "div",
      role: "button",
      name,
      disabled: false,
    })),
  });

  it("leaves a small page as it is, one line per element", () => {
    const small = page("Hello", ["Send"]);
    expect(fitSnapshot(small, 0)).toEqual({ ...small, elements: ["4:0 div[button] Send"] });
  });

  it("marks disabled controls and skips a role that repeats the tag", () => {
    expect(
      elementLine(
        { ref: "1:2", tag: "button", role: "button", name: "Pay", disabled: true },
        "Pay",
      ),
    ).toBe("1:2 button (disabled) Pay");
  });

  it("keeps every element and reads long text on in parts", () => {
    const text = "x".repeat(150_000);
    const big = page(
      text,
      Array.from({ length: 500 }, (_, index) => `Chat ${index} ${"y".repeat(400)}`),
    );
    const first = fitSnapshot(big, 0);
    expect(JSON.stringify(first).length).toBeLessThan(SNAPSHOT_BUDGET + 2_000);
    expect(first.elements).toHaveLength(500);
    expect(first.elements[499]?.startsWith("4:499 ")).toBe(true);
    expect(first.elements[0]?.length).toBeLessThanOrEqual(121 + "4:0 div[button] ".length);
    expect(first.text.length).toBeGreaterThanOrEqual(8_000);
    expect(first).toMatchObject({ textOffset: 0, textLength: 150_000 });

    let read = first.text.length;
    let next = first.nextOffset;
    while (next !== undefined) {
      const part = fitSnapshot(big, next);
      read += part.text.length;
      next = part.nextOffset;
    }
    expect(read).toBe(text.length);
  });
});

describe("the status an action returns", () => {
  const tab = () => ({ id: "tab", revision: 4, labels: new Map([["4:0", "Send"]]) });

  it("keeps the refs and the revision while the page keeps its stamps", () => {
    const current = tab();
    const status = actStatusFrom(
      current,
      {
        url: "https://a.test/inbox#x",
        title: "Inbox",
        loading: false,
        refs: 12,
        focus: "4:3 input To",
      },
      "https://a.test/inbox",
      "https://a.test/inbox",
      undefined,
    );
    expect(status).toMatchObject({
      revision: 4,
      refs: "valid",
      navigated: false,
      focus: "4:3 input To",
    });
    expect(current.revision).toBe(4);
  });

  it("makes old refs stale after a navigation that dropped the stamps", () => {
    const current = tab();
    const status = actStatusFrom(
      current,
      { url: "https://a.test/sent", title: "Sent", loading: true, refs: 0, focus: null },
      "https://a.test/inbox",
      "https://a.test/inbox",
      "Opened 1 tab.",
    );
    expect(status).toMatchObject({
      revision: 5,
      refs: "stale",
      navigated: true,
      loading: true,
      notice: "Opened 1 tab.",
    });
    expect(current.labels.size).toBe(0);
  });
});

describe("element screenshots", () => {
  it("clips to the element inside the viewport", () => {
    expect(elementClip({ x: -5.5, y: 10.2, width: 100.4, height: 20 })).toEqual({
      x: 0,
      y: 10,
      width: 95,
      height: 21,
    });
    expect(() => elementClip(null)).toThrow("no longer on the page");
    expect(() => elementRectScript("../x")).toThrow("ref must look like");
  });
});

describe("browser page bounds", () => {
  it("does not round float noise up into an extra pixel", () => {
    // The panel's right edge measured as 1236.0000122 in a 1236 wide window.
    expect(
      validateBounds({ x: 856.7999877, y: 73, width: 379.2000122, height: 690.2000122 }),
    ).toEqual({ x: 856, y: 73, width: 380, height: 691 });
    expect(validateBounds({ x: 10.5, y: 20.5, width: 100, height: 50 })).toEqual({
      x: 10,
      y: 20,
      width: 101,
      height: 51,
    });
  });

  it("keeps the page inside the window", () => {
    expect(fitInWindow({ x: 856, y: 73, width: 381, height: 691 }, [1236, 763])).toEqual({
      x: 856,
      y: 73,
      width: 380,
      height: 690,
    });
    expect(fitInWindow({ x: 0, y: 0, width: 50, height: 40 }, [1236, 763])).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 40,
    });
  });
});
