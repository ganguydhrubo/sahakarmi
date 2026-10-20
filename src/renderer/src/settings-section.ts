/** Shared with SettingsView, which reads it when it opens. */
export const SETTINGS_SECTION_KEY = "sahkarmi:settings-section";

/** Makes Settings open on a given section the next time it is shown. */
export function rememberSettingsSection(section: string): void {
  try {
    window.localStorage.setItem(SETTINGS_SECTION_KEY, section);
  } catch {
    // Remembering the section is a convenience only.
  }
}
