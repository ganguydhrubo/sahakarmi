import { describe, expect, it } from "vitest";
import { persistentBrowserUrl } from "./browser-state";

describe("persistentBrowserUrl", () => {
  it("strips inline credentials before tabs are persisted", () => {
    expect(persistentBrowserUrl("https://user:secret@gst.example.in/returns")).toBe(
      "https://gst.example.in/returns",
    );
  });

  it("keeps ordinary browser URLs and hashes", () => {
    expect(persistentBrowserUrl("https://example.com/app#/saved-view")).toBe(
      "https://example.com/app#/saved-view",
    );
  });
});
