import { createSignal } from "solid-js";

export type ThemePreference = "system" | "light" | "dark";
export type LanguageCode =
  | "en"
  | "hi"
  | "bn"
  | "mr"
  | "te"
  | "ta"
  | "gu"
  | "kn"
  | "ml"
  | "pa"
  | "or"
  | "as";

export const SUPPORTED_LANGUAGES: LanguageCode[] = [
  "en",
  "hi",
  "bn",
  "mr",
  "te",
  "ta",
  "gu",
  "kn",
  "ml",
  "pa",
  "or",
  "as",
];

const THEME_KEY = "sahkarmi:theme";
const ACTIVITY_STYLE_KEY = "sahkarmi:activity-style";

/**
 * masti: playful Hinglish while thinking · seedha: plain Hinglish · english: plain English.
 * With nothing chosen, activity follows the app language (English unless the app is not).
 */
export type ActivityStyle = "masti" | "seedha" | "english";
const LANGUAGE_KEY = "sahkarmi:language";
const UI_SIZE_KEY = "sahkarmi:ui-size";
const SEND_KEY_KEY = "sahkarmi:send-key";

export type UiSize = "compact" | "normal" | "large";
/** enter: Enter sends, Ctrl/Cmd+Enter adds a line · ctrl-enter: the other way round. */
export type SendKey = "enter" | "ctrl-enter";
const UI_ZOOM: Record<UiSize, string> = { compact: "0.9", normal: "", large: "1.12" };

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
  return value && SUPPORTED_LANGUAGES.includes(value as LanguageCode)
    ? (value as LanguageCode)
    : "en";
}

const [theme, setThemeSignal] = createSignal<ThemePreference>(parseTheme(readStored(THEME_KEY)));
const [language, setLanguageSignal] = createSignal<LanguageCode>(
  parseLanguage(readStored(LANGUAGE_KEY)),
);

const [activityStyle, setActivityStyleSignal] = createSignal<ActivityStyle>(
  parseActivityStyle(readStored(ACTIVITY_STYLE_KEY), language()),
);

function parseActivityStyle(value: string | null, appLanguage: LanguageCode): ActivityStyle {
  if (value === "masti" || value === "seedha" || value === "english") return value;
  return appLanguage === "en" ? "english" : "seedha";
}

const [uiSize, setUiSizeSignal] = createSignal<UiSize>(parseUiSize(readStored(UI_SIZE_KEY)));
const [sendKey, setSendKeySignal] = createSignal<SendKey>(
  readStored(SEND_KEY_KEY) === "ctrl-enter" ? "ctrl-enter" : "enter",
);

function parseUiSize(value: string | null): UiSize {
  return value === "compact" || value === "large" ? value : "normal";
}

export { activityStyle, language, sendKey, theme, uiSize };

export function setUiSize(next: UiSize): void {
  setUiSizeSignal(next);
  writeStored(UI_SIZE_KEY, next);
  applyUiSize(next);
}

export function setSendKey(next: SendKey): void {
  setSendKeySignal(next);
  writeStored(SEND_KEY_KEY, next);
}

function applyUiSize(next: UiSize): void {
  (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = UI_ZOOM[next];
}

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
  applyUiSize(uiSize());
  void window.sahkarmi?.setTheme?.(theme())?.catch(() => undefined);
  document.documentElement.lang = language();
}

/** BCP-47 tag used for voice input and date formatting. */
export function speechLocale(code: LanguageCode = language()): string {
  switch (code) {
    case "hi":
      return "hi-IN";
    case "bn":
      return "bn-IN";
    case "mr":
      return "mr-IN";
    case "te":
      return "te-IN";
    case "ta":
      return "ta-IN";
    case "gu":
      return "gu-IN";
    case "kn":
      return "kn-IN";
    case "ml":
      return "ml-IN";
    case "pa":
      return "pa-IN";
    case "or":
      return "or-IN";
    case "as":
      return "as-IN";
    default:
      return "en-IN";
  }
}
