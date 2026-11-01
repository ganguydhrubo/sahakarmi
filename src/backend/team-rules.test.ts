// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { ApprovalAuthorityGrant } from "../shared/ipc";
import { type BrowserToolTarget, isOwnTab, runBrowserTool } from "./browser-host";
import {
  accountLink,
  linkedinAccountFromRedirect,
  siteOfHost,
  socialPlatformForTool,
  socialPlatformForUrl,
} from "./publishing-accounts";
import { decideRefusal, deciderFor, messageRefusal, recallableBots } from "./team-rules";

const ceo = { id: "ceo", workspaceId: "w1" };
const finance = { id: "finance", workspaceId: "w1" };
const research = { id: "research", workspaceId: "w1" };
const outsider = { id: "outsider", workspaceId: "w2" };

function grant(botId: string, categories: ApprovalAuthorityGrant["categories"]) {
  return {
    id: `g-${botId}`,
    workspaceId: "w1",
    botId,
    categories,
    grantedBy: "owner",
    parentGrantId: botId === "ceo" ? null : "g-ceo",
    createdAt: "",
    expiresAt: "",
  } satisfies ApprovalAuthorityGrant;
}

const request = {
  botId: "research",
  category: "payment" as const,
  status: "pending" as const,
  kind: "action" as const,
};

describe("who may message whom", () => {
  it("keeps to the workspace, and goes through a CEO when there is one", () => {
    expect(messageRefusal(finance, outsider, null)).toContain("another workspace");
    expect(messageRefusal(finance, research, null)).toBeNull();
    expect(messageRefusal(finance, research, "ceo")).toContain("CEO");
    expect(messageRefusal(finance, ceo, "ceo")).toBeNull();
    expect(messageRefusal(ceo, finance, "ceo")).toBeNull();
  });
});

describe("whose past chats a coworker may search", () => {
  const everyone = [ceo, finance, research, outsider];
  it("is its own unless the team is asked for, and never another workspace", () => {
    expect(recallableBots(finance, everyone, undefined, null)).toEqual([finance]);
    expect(recallableBots(finance, everyone, "team", null)).toEqual([ceo, finance, research]);
    expect(recallableBots(finance, everyone, "team", "ceo")).toEqual([finance]);
    expect(recallableBots(ceo, everyone, "team", "ceo")).toEqual([ceo, finance, research]);
  });
});

describe("who may decide a request", () => {
  it("needs a grant for that kind, in the same workspace", () => {
    expect(decideRefusal(ceo, request, research, [grant("ceo", ["payment"])])).toBeNull();
    expect(decideRefusal(ceo, request, research, [grant("ceo", ["data"])])).toContain(
      "no authority",
    );
    expect(decideRefusal(ceo, request, research, [])).toContain("no authority");
    expect(decideRefusal(ceo, request, outsider, [grant("ceo", ["payment"])])).toContain(
      "another workspace",
    );
  });

  it("is never the one asking, and never for owner-only requests", () => {
    expect(decideRefusal(research, request, research, [grant("research", ["payment"])])).toContain(
      "their own",
    );
    expect(
      decideRefusal(ceo, { ...request, ownerOnly: true }, research, [grant("ceo", ["payment"])]),
    ).toContain("owner");
  });

  it("leaves paused shell-like tool calls with the owner, whatever was granted", () => {
    expect(
      decideRefusal(ceo, { ...request, kind: "permission", category: "other" }, research, [
        grant("ceo", ["other"]),
      ]),
    ).toContain("owner");
  });

  it("prefers the employee the work was passed to, then the CEO", () => {
    const grants = [grant("ceo", ["payment"]), grant("finance", ["payment"])];
    expect(deciderFor(request, research, [ceo, finance, research], grants)).toBe("finance");
    const own = { ...request, botId: "finance" };
    expect(deciderFor(own, finance, [ceo, finance, research], grants)).toBe("ceo");
    expect(deciderFor(request, research, [ceo, finance, research], [])).toBeNull();
  });
});

describe("social accounts", () => {
  it("recognises the platforms, and nothing that only looks like them", () => {
    expect(socialPlatformForUrl("https://www.facebook.com/x")).toBe("facebook");
    expect(socialPlatformForUrl("https://m.facebook.com/")).toBe("facebook");
    expect(socialPlatformForUrl("https://www.instagram.com/")).toBe("instagram");
    expect(socialPlatformForUrl("https://in.linkedin.com/feed")).toBe("linkedin");
    expect(socialPlatformForUrl("https://facebook.com.evil.example/")).toBeNull();
    expect(socialPlatformForUrl("https://notfacebook.com/")).toBeNull();
    expect(socialPlatformForUrl("not a url")).toBeNull();
    expect(socialPlatformForTool("LINKEDIN_CREATE_POST")).toBe("linkedin");
    expect(socialPlatformForTool("GMAIL_SEND_EMAIL")).toBeNull();
    expect(accountLink("facebook", "5")).toContain("id=5");
  });

  it("reads the LinkedIn member from the /in/me redirect only", () => {
    expect(linkedinAccountFromRedirect("https://www.linkedin.com/in/asha-g/")).toBe("asha-g");
    expect(linkedinAccountFromRedirect("https://www.linkedin.com/in/me/")).toBeNull();
    expect(linkedinAccountFromRedirect("https://www.linkedin.com/login")).toBeNull();
    expect(linkedinAccountFromRedirect(null)).toBeNull();
  });

  it("groups hosts into sites for sharing sign-ins", () => {
    expect(siteOfHost(".www.facebook.com")).toBe("facebook.com");
    expect(siteOfHost("mail.example.co.in")).toBe("example.co.in");
    expect(siteOfHost("accounts.google.com")).toBe("google.com");
  });
});

describe("browser tabs belong to one coworker", () => {
  const tabs = [
    { id: "mine", url: "https://a/", title: "", ownerBotId: "a", ownerThreadId: "ta" },
    { id: "theirs", url: "https://b/", title: "", ownerBotId: "b", ownerThreadId: "tb" },
    { id: "old", url: "https://c/", title: "", ownerBotId: null, ownerThreadId: "ta" },
  ];
  const control = {
    begin: () => undefined,
    finish: () => undefined,
    updateTab: () => undefined,
  } as never;
  function target() {
    const touched: string[] = [];
    const opened: Array<string | null | undefined> = [];
    const browser = {
      activeTabId: "theirs",
      listTabs: () => tabs,
      open: async (_url: string, _thread?: string | null, bot?: string | null) => {
        opened.push(bot);
        return tabs[0];
      },
      snapshot: async (id: string) => {
        touched.push(id);
        return { text: "", elements: [] };
      },
      act: async (id: string) => {
        touched.push(id);
        return { text: "", elements: [] };
      },
      screenshot: async (id: string) => {
        touched.push(id);
        return "";
      },
      close: async (id: string) => {
        touched.push(id);
      },
    } as unknown as BrowserToolTarget;
    return { browser, touched, opened };
  }
  const call = (tool: string, args: unknown) => ({
    threadId: "ta",
    turnId: "t",
    callId: "c",
    namespace: "sahkarmi_browser",
    tool,
    arguments: args,
    botId: "a",
  });

  it("knows old tabs by their chat", () => {
    expect(isOwnTab(tabs[0] as never, { botId: "a", threadId: "ta" })).toBe(true);
    expect(isOwnTab(tabs[1] as never, { botId: "a", threadId: "ta" })).toBe(false);
    expect(isOwnTab(tabs[2] as never, { botId: "a", threadId: "ta" })).toBe(true);
    expect(isOwnTab(tabs[2] as never, { botId: "b", threadId: "tb" })).toBe(false);
  });

  it("lists only a coworker's own tabs and hides a colleague's shown tab", async () => {
    const { browser } = target();
    const result = await runBrowserTool(browser, control, call("list_tabs", {}));
    const text = (result.contentItems[0] as { text: string }).text;
    expect(text).toContain("mine");
    expect(text).not.toContain("theirs");
    expect(JSON.parse(text).activeTabId).toBeNull();
  });

  it.each([
    ["snapshot", { tabId: "theirs" }],
    ["act", { tabId: "theirs", revision: 1, action: { type: "key", key: "Enter" } }],
    ["screenshot", { tabId: "theirs" }],
    ["close_tab", { tabId: "theirs" }],
  ])("refuses %s on a colleague's tab", async (tool, args) => {
    const { browser, touched } = target();
    const result = await runBrowserTool(browser, control, call(tool, args));
    expect(result.success).toBe(false);
    expect((result.contentItems[0] as { text: string }).text).toContain("another coworker");
    expect(touched).toEqual([]);
  });

  it("uses its own tab, and opens new pages as itself", async () => {
    const { browser, touched, opened } = target();
    await runBrowserTool(browser, control, call("snapshot", { tabId: "mine" }));
    await runBrowserTool(browser, control, call("open", { url: "https://x/" }));
    expect(touched).toEqual(["mine"]);
    expect(opened).toEqual(["a"]);
  });
});
