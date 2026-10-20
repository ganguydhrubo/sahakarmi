import { For, type JSX, Show } from "solid-js";
import { t } from "../i18n";
import { setTheme, type ThemePreference, theme } from "../preferences";

function SystemIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="theme-icon size-4 fill-none stroke-current"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="2.5" y="3.5" width="15" height="10" rx="2" />
      <path d="M7 17h6M10 13.5v3.5" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="theme-icon size-4 fill-none stroke-current"
      stroke-width="1.6"
      stroke-linecap="round"
    >
      <circle cx="10" cy="10" r="3.75" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.34 4.34l1.42 1.42M14.24 14.24l1.42 1.42M4.34 15.66l1.42-1.42M14.24 5.76l1.42-1.42" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="theme-icon size-4 fill-none stroke-current"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M17.29 13.27A8 8 0 1 1 6.73 2.71 6.5 6.5 0 0 0 17.29 13.27Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="theme-check-icon size-3 fill-none stroke-current"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="m4.5 10 3.5 3.5 7.5-7.5" />
    </svg>
  );
}

const THEMES: Array<{ value: ThemePreference; label: () => string; icon: () => JSX.Element }> = [
  { value: "system", label: () => t("themeSystem"), icon: SystemIcon },
  { value: "light", label: () => t("themeLight"), icon: SunIcon },
  { value: "dark", label: () => t("themeDark"), icon: MoonIcon },
];

export function ThemeSelector() {
  return (
    <fieldset class="theme-selector-fieldset">
      <legend class="sr-only">{t("appearance")}</legend>
      <div class="theme-selector-group">
        <For each={THEMES}>
          {(option) => {
            const isSelected = () => theme() === option.value;
            return (
              <button
                type="button"
                aria-pressed={isSelected()}
                classList={{
                  "theme-option": true,
                  "theme-option-selected": isSelected(),
                }}
                onClick={() => setTheme(option.value)}
              >
                <span class="theme-icon-wrap" aria-hidden="true">
                  {option.icon()}
                </span>
                <span class="theme-label">{option.label()}</span>
                <Show when={isSelected()}>
                  <span class="theme-check-badge" aria-hidden="true">
                    <CheckIcon />
                  </span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
    </fieldset>
  );
}
