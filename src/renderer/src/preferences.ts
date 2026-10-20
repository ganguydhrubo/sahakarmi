import { createSignal } from "solid-js";

export type ThemePreference = "system" | "light" | "dark";
export type LanguageCode = "en" | "hi" | "bn";

const THEME_KEY = "sahkarmi:theme";
const ACTIVITY_STYLE_KEY = "sahkarmi:activity-style";

/** masti: playful Hinglish while thinking (default) · seedha: plain factual lines only. */
export type ActivityStyle = "masti" | "seedha";
const LANGUAGE_KEY = "sahkarmi:language";

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences are a convenience; the UI still works with defaults.
  }
}

function parseTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

function parseLanguage(value: string | null): LanguageCode {
  return value === "hi" || value === "bn" ? value : "en";
}

const [theme, setThemeSignal] = createSignal<ThemePreference>(parseTheme(readStored(THEME_KEY)));
const [language, setLanguageSignal] = createSignal<LanguageCode>(
  parseLanguage(readStored(LANGUAGE_KEY)),
);

const [activityStyle, setActivityStyleSignal] = createSignal<ActivityStyle>(
  readStored(ACTIVITY_STYLE_KEY) === "seedha" ? "seedha" : "masti",
);

export { activityStyle, language, theme };

export function setActivityStyle(next: ActivityStyle): void {
  setActivityStyleSignal(next);
  writeStored(ACTIVITY_STYLE_KEY, next);
}

export function setTheme(next: ThemePreference): void {
  setThemeSignal(next);
  writeStored(THEME_KEY, next);
  applyTheme(next);
  void window.sahkarmi?.setTheme?.(next)?.catch(() => undefined);
}

export function setLanguage(next: LanguageCode): void {
  setLanguageSignal(next);
  writeStored(LANGUAGE_KEY, next);
  document.documentElement.lang = next;
}

function applyTheme(next: ThemePreference): void {
  if (next === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = next;
}

export function applyStoredPreferences(): void {
  applyTheme(theme());
  void window.sahkarmi?.setTheme?.(theme())?.catch(() => undefined);
  document.documentElement.lang = language();
}

/** BCP-47 tag used for voice input and date formatting. */
export function speechLocale(code: LanguageCode = language()): string {
  return code === "hi" ? "hi-IN" : code === "bn" ? "bn-IN" : "en-IN";
}
