import { createSignal, onMount, Show } from "solid-js";
import { ENGINE_SETTINGS_LIMITS, type EngineSettings } from "../../../shared/ipc";
import { t } from "../i18n";

/** Settings > Features: how many coworkers may work at once, and the no-progress watchdog. */
export function EngineSettingsPanel() {
  const [settings, setSettings] = createSignal<EngineSettings | null>(null);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    void window.sahkarmi?.orchestrator
      ?.getEngineSettings?.()
      .then(setSettings)
      .catch((cause: unknown) => setError(String(cause)));
  });

  async function save(patch: Partial<EngineSettings>) {
    try {
      setSettings(await window.sahkarmi.orchestrator.setEngineSettings(patch));
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function numberFrom(event: Event & { currentTarget: HTMLInputElement }): number | null {
    const value = Number(event.currentTarget.value);
    return Number.isFinite(value) ? value : null;
  }

  return (
    <Show when={settings()}>
      {(current) => (
        <section class="engine-settings" aria-label={t("engineSettingsTitle")}>
          <h3>{t("engineSettingsTitle")}</h3>
          <label class="engine-setting">
            <span>{t("engineMaxTurnsLabel")}</span>
            <input
              type="number"
              min={ENGINE_SETTINGS_LIMITS.maxConcurrentTurns.min}
              max={ENGINE_SETTINGS_LIMITS.maxConcurrentTurns.max}
              value={current().maxConcurrentTurns}
              onChange={(event) => {
                const value = numberFrom(event);
                if (value !== null) void save({ maxConcurrentTurns: value });
              }}
            />
            <small class="settings-meta">{t("engineMaxTurnsHint")}</small>
          </label>
          <label class="engine-setting">
            <span>{t("engineWatchdogLabel")}</span>
            <input
              type="number"
              min={ENGINE_SETTINGS_LIMITS.watchdogMinutes.min}
              max={ENGINE_SETTINGS_LIMITS.watchdogMinutes.max}
              value={current().watchdogMinutes}
              onChange={(event) => {
                const value = numberFrom(event);
                if (value !== null) void save({ watchdogMinutes: value });
              }}
            />
            <small class="settings-meta">{t("engineWatchdogHint")}</small>
          </label>
          <Show when={saved()}>
            <p class="settings-meta" role="status">
              {t("engineSaved")}
            </p>
          </Show>
          <Show when={error()}>
            <p class="center-view-error" role="alert">
              {error()}
            </p>
          </Show>
        </section>
      )}
    </Show>
  );
}
