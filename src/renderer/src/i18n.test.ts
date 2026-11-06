import { afterEach, describe, expect, it } from "vitest";
import { loadLanguage, t } from "./i18n";
import { setLanguage } from "./preferences";

describe("language packs", () => {
  afterEach(() => setLanguage("en"));

  it("shows English until a pack loads, then the chosen language", async () => {
    setLanguage("hi");
    expect(t("settings")).toBe("Settings");
    await loadLanguage("hi");
    expect(t("settings")).toBe("सेटिंग्स");
    // Area strings come with the pack.
    expect(t("copyPlain")).toBe("सादा टेक्स्ट कॉपी करें");
  });

  it("loads the other Indian languages on demand and falls back to English for missing keys", async () => {
    await loadLanguage("mr");
    setLanguage("mr");
    expect(t("settings")).toBe("सेटिंग्ज");
    expect(t("copyPlain")).toBe("Copy as plain text");
    await loadLanguage("bn");
    setLanguage("bn");
    expect(t("copyPlain")).toBe("সাধারণ লেখা কপি করুন");
  });
});
