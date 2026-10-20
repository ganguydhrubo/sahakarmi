import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { applyStoredPreferences, setLanguage, setTheme } from "../preferences";
import { ThemeSelector } from "./ThemeSelector";

afterEach(() => {
  cleanup();
  setTheme("system");
});

describe("theme selection", () => {
  it("shows one selected badge, persists the choice, and synchronizes native appearance", async () => {
    const sync = vi.fn(async () => undefined);
    Object.defineProperty(window, "sahkarmi", { configurable: true, value: { setTheme: sync } });
    setLanguage("en");
    setTheme("system");
    const { container } = render(() => <ThemeSelector />);
    for (const [value, key] of [
      ["light", "themeLight"],
      ["dark", "themeDark"],
      ["system", "themeSystem"],
    ] as const) {
      const button = screen.getByRole("button", { name: t(key) });
      await fireEvent.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(button.querySelector(".theme-check-badge")).not.toBeNull();
      expect(container.querySelectorAll(".theme-check-badge")).toHaveLength(1);
      expect(window.localStorage.getItem("sahkarmi:theme")).toBe(value);
      expect(document.documentElement.dataset.theme).toBe(value === "system" ? undefined : value);
      expect(sync).toHaveBeenLastCalledWith(value);
    }
  });

  it("retains appearance across remounts and rapid switching", async () => {
    setLanguage("en");
    setTheme("dark");
    const first = render(() => <ThemeSelector />);
    expect(screen.getByRole("button", { name: t("themeDark") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    first.unmount();
    delete document.documentElement.dataset.theme;
    applyStoredPreferences();
    render(() => <ThemeSelector />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    for (let index = 0; index < 5; index += 1) {
      await fireEvent.click(screen.getByRole("button", { name: t("themeLight") }));
      await fireEvent.click(screen.getByRole("button", { name: t("themeDark") }));
    }
    expect(screen.getByRole("button", { name: t("themeDark") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
