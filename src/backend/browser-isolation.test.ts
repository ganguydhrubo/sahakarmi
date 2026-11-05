import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getName: () => "Sahkarmi" } }));

const {
  browserPartition,
  keptSessionCookie,
  KEPT_SESSION_COOKIE_DAYS,
  sameSiteTabIds,
  secureFieldScript,
  signInKeepers,
  tabForViewer,
} = await import("./browser-host");

const tab = (
  id: string,
  ownerBotId: string | null,
  lastUsed = 0,
  ownerThreadId: string | null = null,
) => ({ id, ownerBotId, ownerThreadId, lastUsed });

describe("each coworker's own browser", () => {
  it("keeps one persistent partition per coworker", () => {
    expect(browserPartition("bot-a")).toBe("persist:sahkarmi-browser-bot-a");
    expect(browserPartition("bot-a")).not.toBe(browserPartition("bot-b"));
  });

  it("never shows a colleague's page on a coworker's panel", () => {
    const tabs = [tab("a1", "bot-a", 5), tab("b1", "bot-b", 1), tab("b2", "bot-b", 9)];
    // Agent A's page is selected; the owner opens Agent B's browser: B's latest page shows.
    expect(tabForViewer(tabs, "a1", { botId: "bot-b", threadId: null })).toBe("b2");
    expect(tabForViewer(tabs, "b1", { botId: "bot-b", threadId: null })).toBe("b1");
    // A coworker with no pages yet gets an empty panel, not Agent A's window.
    expect(tabForViewer(tabs, "a1", { botId: "bot-c", threadId: null })).toBeNull();
    // Nobody in particular is looking: unchanged.
    expect(tabForViewer(tabs, "a1", undefined)).toBe("a1");
  });

  it("shows the owner's own pages of a chat that has no coworker recorded", () => {
    const tabs = [tab("old", null, 1, "thread-1"), tab("a1", "bot-a", 2)];
    expect(tabForViewer(tabs, "a1", { botId: "bot-x", threadId: "thread-1" })).toBe("old");
  });

  it("marks only the same coworker's pages of a site out of date", () => {
    const tabs = [
      { id: "acted", url: "https://www.facebook.com/a", ownerBotId: "bot-a" },
      { id: "mine", url: "https://www.facebook.com/b", ownerBotId: "bot-a" },
      { id: "colleague", url: "https://www.facebook.com/c", ownerBotId: "bot-b" },
    ];
    expect(sameSiteTabIds(tabs, "acted", "https://www.facebook.com/a", "bot-a")).toEqual(["mine"]);
  });
});

describe("splitting the old shared sign-ins", () => {
  it("gives each site's sign-in to exactly one coworker", () => {
    const keepers = signInKeepers(
      [
        { botId: "outreach", url: "https://www.facebook.com/groups/1" },
        { botId: "outreach", url: "https://www.facebook.com/" },
        { botId: "upload", url: "https://www.facebook.com/reels/create" },
        { botId: "upload", url: "https://studio.youtube.com/" },
      ],
      [{ botId: "upload", url: "https://www.facebook.com/x" }],
    );
    expect(keepers.get("facebook.com")).toBe("outreach");
    expect(keepers.get("youtube.com")).toBe("upload");
  });
});

describe("sign-ins survive a restart", () => {
  const base = {
    name: "xs",
    value: "v",
    domain: ".facebook.com",
    hostOnly: false,
    path: "/",
    secure: true,
    httpOnly: true,
    sameSite: "no_restriction" as const,
  };

  it("stores a session cookie with an expiry, unchanged otherwise", () => {
    const now = Date.UTC(2026, 10, 5);
    expect(keptSessionCookie({ ...base, session: true }, now)).toEqual({
      url: "https://facebook.com/",
      name: "xs",
      value: "v",
      domain: ".facebook.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "no_restriction",
      expirationDate: now / 1000 + KEPT_SESSION_COOKIE_DAYS * 86_400,
    });
  });

  it("leaves persistent cookies alone and keeps host-only cookies host-only", () => {
    expect(keptSessionCookie({ ...base, session: false }, 0)).toBeNull();
    const hostOnly = keptSessionCookie(
      { ...base, domain: "www.facebook.com", hostOnly: true, session: true },
      0,
    );
    expect(hostOnly?.url).toBe("https://www.facebook.com/");
    expect(hostOnly).not.toHaveProperty("domain");
  });
});

describe("finding the sign-in field again", () => {
  function run(html: string, ref: string, kind: "password" | "otp" | "other", origin?: string) {
    document.body.innerHTML = html;
    const script = secureFieldScript(ref, kind, origin ?? location.origin, "secure-1");
    // The page script, run in this test's document as the browser would run it.
    return new Function(`return ${script};`)() as { ref?: string; error?: string };
  }

  it("uses the coworker's field while it is still there", () => {
    expect(run('<input type="password" data-sahkarmi-ref="3:61">', "3:61", "password")).toEqual({
      ref: "3:61",
    });
  });

  it("re-finds the password field after the site redrew its form", () => {
    const result = run(
      '<input type="text" name="email"><input type="password" name="pass">',
      "3:61",
      "password",
    );
    expect(result).toEqual({ ref: "secure-1" });
    expect(document.querySelector('[data-sahkarmi-ref="secure-1"]')?.getAttribute("name")).toBe(
      "pass",
    );
  });

  it("refuses another origin, an ambiguous page and a vanished plain field", () => {
    expect(
      run('<input type="password">', "1:1", "password", "https://evil.example").error,
    ).toContain("no longer on https://evil.example");
    expect(
      run('<input type="password"><input type="password">', "1:1", "password").error,
    ).toContain("More than one field");
    expect(run('<input type="text">', "1:1", "other").error).toContain("no longer on the page");
  });

  it("finds a one-time-code field, not the search box", () => {
    const result = run(
      '<input type="search" name="q"><input type="text" autocomplete="one-time-code" name="c">',
      "2:3",
      "otp",
    );
    expect(result).toEqual({ ref: "secure-1" });
    expect(document.querySelector('[data-sahkarmi-ref="secure-1"]')?.getAttribute("name")).toBe(
      "c",
    );
  });
});
