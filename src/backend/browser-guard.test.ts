import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getName: () => "Sahkarmi" } }));

import {
  ActionMemory,
  configureBrowserGuards,
  describeElementScript,
  type ElementLocator,
  findElementScript,
  HIDDEN,
  hideSecretInFieldName,
  hideSecretsInReading,
  hideSecretsInText,
  locatorLabel,
  looksRandomSecret,
  pageKey,
  uniqueMatch,
} from "./browser-guard";
import {
  BrowserControlTracker,
  rememberableRef,
  resolveRememberedTarget,
  runBrowserTool,
} from "./browser-host";

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("hide secrets: true positives", () => {
  it.each([
    ["a JWT", `Bearer ${JWT}`],
    ["an OpenAI key", "key: sk-proj-4fG7hJ2kL9mN3pQ8rS1tU6vW0xY5zA"],
    ["an Anthropic key", "sk-ant-api03-AbCdEf0123456789GhIjKlMnOp"],
    ["a Stripe key", "sk_live_51HxYzAbCdEf0123456789"],
    ["a GitHub token", "ghp_1234567890abcdefghijABCDEFGHIJ123456"],
    ["a GitHub fine-grained token", `github_pat_${"A1b2C3d4E5".repeat(6)}`],
    ["a Slack token", "xoxb-123456789012-1234567890123-AbCdEfGhIjKl"],
    ["a Google API key", "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"],
    ["an AWS key id", "AKIAIOSFODNN7EXAMPLE"],
  ])("hides %s", (_label, text) => {
    const hidden = hideSecretsInText(text);
    expect(hidden).toContain(HIDDEN);
    expect(hidden).not.toBe(text);
  });

  it("hides secret address parameters but keeps the rest of the address", () => {
    expect(
      hideSecretsInText("https://x.test/cb?code=4%2F0AeanS0bXk9Lq2Zp7Rt3Wm5Yv8&state=abc"),
    ).toBe(`https://x.test/cb?code=${HIDDEN}&state=abc`);
    expect(hideSecretsInText("https://x.test/a?access_token=short&x=1")).toBe(
      `https://x.test/a?access_token=${HIDDEN}&x=1`,
    );
    expect(hideSecretsInText("https://x.test/#id_token=abc.def")).toBe(
      `https://x.test/#id_token=${HIDDEN}`,
    );
    expect(hideSecretsInText("https://maps.test/js?key=Q2xpZW50U2VjcmV0MTIzNDU2Nzg5")).toBe(
      `https://maps.test/js?key=${HIDDEN}`,
    );
  });

  it("hides a field whose value is one long random token", () => {
    expect(hideSecretInFieldName("input", "Zx9Lq2Zp7Rt3Wm5Yv8Kd1Hs4Bn6C")).toBe(HIDDEN);
    expect(hideSecretInFieldName("textarea", "0f1e2d3c4b5a69788796a5b4c3d2e1f0")).toBe(HIDDEN);
  });
});

describe("hide secrets: ordinary text stays exactly as it is", () => {
  it.each([
    "Welcome back! Your order #A1B2C3 ships tomorrow.",
    "Use promo code SAVE10 at checkout",
    "sk-learn and scikit-learn are Python libraries",
    "Task-list: ask-me-anything, desk-2026",
    "https://shop.test/p?code=IN&key=value&session=1&token=abc",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0",
    "https://blog.test/posts/summer-sale-2026?ref=newsletter-october",
    "Call +91 98765 43210 or email hello@example.com",
    "eyJ is how base64 JSON starts, see eyJhbGciOi",
  ])("keeps %s", (text) => {
    expect(hideSecretsInText(text)).toBe(text);
  });

  it("keeps ordinary field values and button names", () => {
    expect(hideSecretInFieldName("input", "Dhrubo Ganguly")).toBe("Dhrubo Ganguly");
    expect(hideSecretInFieldName("input", "order-12345-blue")).toBe("order-12345-blue");
    expect(hideSecretInFieldName("button", "Zx9Lq2Zp7Rt3Wm5Yv8Kd1Hs4Bn6C")).toBe(
      "Zx9Lq2Zp7Rt3Wm5Yv8Kd1Hs4Bn6C",
    );
    expect(looksRandomSecret("summer-sale-2026-limited")).toBe(false);
    expect(looksRandomSecret("abcdefghijklmnopqrst")).toBe(false);
  });

  it("returns the same objects for a normal page reading", () => {
    const reading = {
      tabId: "t",
      revision: 2,
      title: "Inbox",
      url: "https://mail.test/inbox?folder=all",
      text: "Hello there",
      elements: [{ ref: "2:0", tag: "button", role: null, name: "Send", disabled: false }],
    };
    const hidden = hideSecretsInReading(reading);
    expect(hidden).toEqual(reading);
    expect(hidden.elements[0]).toBe(reading.elements[0]);
  });
});

describe("hide secrets switch in the browser tool", () => {
  afterEach(() => configureBrowserGuards({ hideSecrets: () => true }));

  async function snapshotText(): Promise<string> {
    const browser = {
      snapshot: async () => ({
        tabId: "t",
        revision: 1,
        title: "Keys",
        url: `https://dev.test/keys?api_key=abc123`,
        text: `Your new key: ghp_1234567890abcdefghijABCDEFGHIJ123456`,
        elements: [],
      }),
      listTabs: () => [],
    };
    const result = await runBrowserTool(
      browser as unknown as Parameters<typeof runBrowserTool>[0],
      new BrowserControlTracker(),
      {
        threadId: "t",
        turnId: "u",
        callId: "c",
        tool: "snapshot",
        arguments: { tabId: "t" },
      } as Parameters<typeof runBrowserTool>[2],
    );
    const item = result.contentItems[0];
    return item && "text" in item ? String(item.text) : "";
  }

  it("hides secrets when on (the default)", async () => {
    const text = await snapshotText();
    expect(text).not.toContain("ghp_");
    expect(text).not.toContain("abc123");
    expect(text).toContain(HIDDEN);
  });

  it("passes the page on unchanged when off", async () => {
    configureBrowserGuards({ hideSecrets: () => false });
    const text = await snapshotText();
    expect(text).toContain("ghp_1234567890abcdefghijABCDEFGHIJ123456");
    expect(text).toContain("api_key=abc123");
    expect(text).not.toContain(HIDDEN);
  });
});

// -----------------------------------------------------------------------------
// Remember clicked elements, run against a real (jsdom) page.

beforeAll(() => {
  // jsdom lays nothing out and has no innerText: every element gets a box and its text.
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get(this: HTMLElement) {
      return this.textContent ?? "";
    },
  });
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, width: 20, height: 10, right: 20, bottom: 10 }) as DOMRect;
});

const PAGE = "https://shop.test/cart?x=1";
// The page scripts are expressions; run them in this test page the way browser-isolation does.
const run = (script: string): Promise<unknown> =>
  Promise.resolve(new Function(`return ${script};`)());

function page(html: string): void {
  document.body.innerHTML = html;
}

async function describeRef(ref: string): Promise<ElementLocator> {
  return (await run(describeElementScript(ref))) as ElementLocator;
}

describe("remember clicked elements", () => {
  it("only covers clicks and typing into a field", () => {
    expect(rememberableRef({ type: "click", ref: "3:1" })).toBe("3:1");
    expect(rememberableRef({ type: "type", ref: "3:2", text: "x" })).toBe("3:2");
    expect(rememberableRef({ type: "type", text: "x" })).toBeNull();
    expect(rememberableRef({ type: "key", key: "Enter" })).toBeNull();
    expect(rememberableRef({ type: "upload", ref: "3:4", paths: [] })).toBeNull();
  });

  it("finds the same element again when it is the only exact match", async () => {
    page(`<div><span>Total ₹499</span><button data-sahkarmi-ref="3:7">Pay now</button></div>`);
    const locator = await describeRef("3:7");
    expect(locator).toMatchObject({ tag: "button", name: "Pay now", nearby: "Total ₹499Pay now" });
    const memory = new ActionMemory();
    memory.remember("tab", "3:7", PAGE, locator);
    // The page re-rendered and was read again: the old stamp is gone.
    page(
      `<div><span>Total ₹499</span><button data-sahkarmi-ref="5:2">Pay now</button></div><a data-sahkarmi-ref="5:3" href="/help">Help</a>`,
    );
    const found = await resolveRememberedTarget({
      memory,
      tabId: "tab",
      revision: 5,
      ref: "3:7",
      url: PAGE,
      evaluate: run,
    });
    expect(found).toEqual({ ref: "5:2", locator });
    expect(locatorLabel(locator)).toBe("Pay now button");
  });

  it("stamps a found element that has no reference yet with the old one", async () => {
    page(`<form><input name="q" placeholder="Search" data-sahkarmi-ref="2:0"></form>`);
    const memory = new ActionMemory();
    memory.remember("tab", "2:0", PAGE, await describeRef("2:0"));
    page(`<form><input name="q" placeholder="Search"></form>`);
    const found = await resolveRememberedTarget({
      memory,
      tabId: "tab",
      revision: 4,
      ref: "2:0",
      url: PAGE,
      evaluate: run,
    });
    expect(found?.ref).toBe("2:0");
    expect(document.querySelector("input")?.getAttribute("data-sahkarmi-ref")).toBe("2:0");
  });

  it("fails (null) when two elements match", async () => {
    page(`<ul><li><button data-sahkarmi-ref="3:1">Delete</button></li></ul>`);
    const memory = new ActionMemory();
    memory.remember("tab", "3:1", PAGE, await describeRef("3:1"));
    page(`<ul><li><button>Delete</button></li><li><button>Delete</button></li></ul>`);
    const found = await resolveRememberedTarget({
      memory,
      tabId: "tab",
      revision: 4,
      ref: "3:1",
      url: PAGE,
      evaluate: run,
    });
    expect(found).toBeNull();
    expect(document.querySelector("[data-sahkarmi-ref]")).toBeNull();
  });

  it("fails when nothing matches every detail", async () => {
    page(`<p><button data-sahkarmi-ref="3:1" type="submit">Save</button></p>`);
    const memory = new ActionMemory();
    memory.remember("tab", "3:1", PAGE, await describeRef("3:1"));
    page(`<p><button type="button">Save</button></p>`);
    expect(
      await resolveRememberedTarget({
        memory,
        tabId: "tab",
        revision: 4,
        ref: "3:1",
        url: PAGE,
        evaluate: run,
      }),
    ).toBeNull();
  });

  it("never uses a memory from another page", async () => {
    page(`<button data-sahkarmi-ref="3:1">Next</button>`);
    const memory = new ActionMemory();
    memory.remember("tab", "3:1", "https://shop.test/cart", await describeRef("3:1"));
    page(`<button>Next</button>`);
    expect(
      await resolveRememberedTarget({
        memory,
        tabId: "tab",
        revision: 4,
        ref: "3:1",
        url: "https://shop.test/checkout",
        evaluate: run,
      }),
    ).toBeNull();
    expect(memory.recall("other-tab", "3:1", "https://shop.test/cart")).toBeNull();
  });

  it("refuses an old reference still on the page that no longer matches its memory", async () => {
    page(`<div><button data-sahkarmi-ref="3:1">Archive</button></div>`);
    const memory = new ActionMemory();
    memory.remember("tab", "3:1", PAGE, await describeRef("3:1"));
    // The page reused the same node for another button.
    page(`<div><button data-sahkarmi-ref="3:1">Delete forever</button></div>`);
    expect(
      await resolveRememberedTarget({
        memory,
        tabId: "tab",
        revision: 4,
        ref: "3:1",
        url: PAGE,
        evaluate: run,
      }),
    ).toBeNull();
  });

  it("never swaps a reference that is still on the page but hidden or nameless", async () => {
    page(`<div><button data-sahkarmi-ref="3:1">Send</button></div>`);
    const memory = new ActionMemory();
    memory.remember("tab", "3:1", PAGE, await describeRef("3:1"));
    page(
      `<div><button data-sahkarmi-ref="3:1" style="display:none">Send</button></div><div><button>Send</button></div>`,
    );
    expect(
      await resolveRememberedTarget({
        memory,
        tabId: "tab",
        revision: 3,
        ref: "3:1",
        url: PAGE,
        evaluate: run,
      }),
    ).toBeNull();
  });

  it("uses a current reference as it is and describes it", async () => {
    page(`<button data-sahkarmi-ref="6:0">Continue</button>`);
    const found = await resolveRememberedTarget({
      memory: new ActionMemory(),
      tabId: "tab",
      revision: 6,
      ref: "6:0",
      url: PAGE,
      evaluate: run,
    });
    expect(found?.ref).toBe("6:0");
    expect(found?.locator.name).toBe("Continue");
  });

  it("never describes a password field", async () => {
    page(`<input type="password" aria-label="Password" data-sahkarmi-ref="1:0">`);
    expect(await run(describeElementScript("1:0"))).toBeNull();
  });

  it("reads only an exact single match from a find result", () => {
    expect(uniqueMatch({ count: 1, ref: "4:2" })).toBe("4:2");
    expect(uniqueMatch({ count: 2 })).toBeNull();
    expect(uniqueMatch({ count: 0 })).toBeNull();
    expect(uniqueMatch(null)).toBeNull();
    expect(findElementScript({} as ElementLocator, "1:1")).toContain("matches.length !== 1");
  });

  it("keys memories by page, ignoring the query and #part", () => {
    expect(pageKey("https://shop.test/cart/?a=1#top")).toBe("https://shop.test/cart");
    expect(pageKey("about:blank")).toBeNull();
  });

  it("is off by default", async () => {
    const { actionMemoryEnabled, hideSecretsEnabled } = await import("./browser-guard");
    expect(actionMemoryEnabled()).toBe(false);
    expect(hideSecretsEnabled()).toBe(true);
  });
});
