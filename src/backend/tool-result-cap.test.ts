// @vitest-environment node

import { describe, expect, it } from "vitest";
import { capContentItems, capToolText } from "./tool-result-cap";

describe("tool result cap", () => {
  it("leaves normal results alone", () => {
    expect(capToolText("short")).toBe("short");
  });

  it("cuts a huge result and says how to get the rest", () => {
    const text = capToolText("x".repeat(50_000));
    expect(text.startsWith("x".repeat(40_000))).toBe(true);
    expect(text).toContain("40,000 of 50,000 characters");
    expect(text.length).toBeLessThan(40_300);
  });

  it("shares one budget across several text items and keeps the rest of the result", () => {
    const capped = capContentItems(
      {
        success: true,
        contentItems: [
          { type: "inputText", text: "a".repeat(30) },
          { type: "inputText", text: "b".repeat(30) },
          { type: "inputText", text: "c".repeat(30) },
        ],
      },
      50,
    );
    expect(capped.success).toBe(true);
    expect(capped.contentItems).toHaveLength(2);
    expect(capped.contentItems[1]?.text).toContain("b".repeat(20));
    expect(capped.contentItems[1]?.text).toContain("Sahkarmi cut this result");
  });
});
