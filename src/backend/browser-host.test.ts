import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getName: () => "Sahkarmi" } }));

const { browserUserAgent } = await import("./browser-host");

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
