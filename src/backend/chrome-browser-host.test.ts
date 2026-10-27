import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cdpKeyEvent } from "./browser-keys";

vi.mock("electron", () => ({ app: { getName: () => "Sahkarmi" }, WebContentsView: class {} }));

const {
  agentBrowserArguments,
  findInstalledBrowser,
  humanBrowserArguments,
  isBlockedSignInUrl,
  signInRetryUrl,
} = await import("./chrome-browser-host");

describe("findInstalledBrowser", () => {
  const env = {
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
    LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local",
  };

  it("prefers Chrome over Edge on Windows", () => {
    const chrome = join(
      "C:\\Users\\me\\AppData\\Local",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe",
    );
    const edge = join("C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe");
    const found = findInstalledBrowser("win32", env, (path) => path === chrome || path === edge);
    expect(found).toEqual({ name: "Chrome", executable: chrome });
  });

  it("falls back to Edge, which every Windows has", () => {
    const edge = join("C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe");
    expect(findInstalledBrowser("win32", env, (path) => path === edge)).toEqual({
      name: "Edge",
      executable: edge,
    });
  });

  it("returns null when neither is installed, so the built-in browser is used", () => {
    expect(findInstalledBrowser("win32", env, () => false)).toBeNull();
  });
});

describe("blocked Google sign-in", () => {
  it("recognises Google's rejected sign-in page only", () => {
    expect(
      isBlockedSignInUrl(
        "https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fmail.google.com%2Fmail",
      ),
    ).toBe(true);
    expect(isBlockedSignInUrl("https://accounts.google.com/v3/signin/identifier")).toBe(false);
    expect(isBlockedSignInUrl("https://example.com/signin/rejected")).toBe(false);
    expect(isBlockedSignInUrl("not a url")).toBe(false);
  });

  it("sends the owner back to sign in to the page they wanted", () => {
    expect(
      signInRetryUrl(
        "https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fmail.google.com%2Fmail",
      ),
    ).toBe(
      "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmail.google.com%2Fmail",
    );
    expect(signInRetryUrl("https://accounts.google.com/v3/signin/rejected")).toBe(
      "https://accounts.google.com/",
    );
    expect(
      signInRetryUrl("https://accounts.google.com/v3/signin/rejected?continue=javascript:alert(1)"),
    ).toBe("https://accounts.google.com/");
  });
});

describe("browser launch arguments", () => {
  it("attaches the coworkers through a pipe, never a network port", () => {
    const args = agentBrowserArguments("C:\\profile");
    expect(args).toContain("--remote-debugging-pipe");
    expect(args.some((arg) => arg.startsWith("--remote-debugging-port"))).toBe(false);
    expect(args).toContain("--user-data-dir=C:\\profile");
    expect(args).not.toContain("--enable-automation");
  });

  it("opens the owner's browser with nothing attached, in the same profile", () => {
    const args = humanBrowserArguments("C:\\profile", ["https://accounts.google.com/"]);
    expect(args.some((arg) => arg.startsWith("--remote-debugging"))).toBe(false);
    expect(args).toContain("--user-data-dir=C:\\profile");
    expect(args.at(-1)).toBe("https://accounts.google.com/");
  });
});

describe("cdpKeyEvent", () => {
  it("maps named keys", () => {
    expect(cdpKeyEvent("Enter")).toMatchObject({
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
      modifiers: 0,
    });
    expect(cdpKeyEvent("Tab")).toMatchObject({ key: "Tab", windowsVirtualKeyCode: 9 });
    expect(cdpKeyEvent("ArrowDown")).toMatchObject({ key: "ArrowDown", windowsVirtualKeyCode: 40 });
  });

  it("maps characters and shortcuts", () => {
    expect(cdpKeyEvent("a")).toMatchObject({ key: "a", code: "KeyA", text: "a" });
    expect(cdpKeyEvent("7")).toMatchObject({ code: "Digit7", text: "7" });
    const selectAll = cdpKeyEvent("Ctrl+a");
    expect(selectAll).toMatchObject({ code: "KeyA", modifiers: 2 });
    expect(selectAll.text).toBeUndefined();
  });

  it("rejects anything else", () => {
    expect(() => cdpKeyEvent("Hyper+a")).toThrow("Invalid browser key.");
    expect(() => cdpKeyEvent("<script>")).toThrow("Invalid browser key.");
  });
});
