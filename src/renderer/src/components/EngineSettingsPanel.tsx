import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  ENGINE_SETTINGS_LIMITS,
  type EngineSettings,
  MIN_MEMORY_LIMIT_MB,
  type ResourceStatus,
} from "../../../shared/ipc";
import { t } from "../i18n";

function gb(mb: number): string {
  const value = mb / 1024;
  return `${value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} GB`;
}

/**
 * Settings > Features: how many coworkers may work at once, the no-progress watchdog, the most
 * steps per Claude turn, and the owner's memory limit with live use, a forecast and a suggestion.
 */
export function EngineSettingsPanel() {
  const [settings, setSettings] = createSignal<EngineSettings | null>(null);
  const [resources, setResources] = createSignal<ResourceStatus | null>(null);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function refreshResources() {
    void window.sahkarmi?.orchestrator
      ?.resourceStatus?.()
      .then(setResources)
      .catch(() => undefined);
  }

  onMount(() => {
    void window.sahkarmi?.orchestrator
      ?.getEngineSettings?.()
      .then(setSettings)
      .catch((cause: unknown) => setError(String(cause)));
    refreshResources();
    // Live while the panel is open; the app measures only while someone looks or a limit is set.
    const timer = setInterval(refreshResources, 10_000);
    onCleanup(() => clearInterval(timer));
  });

  async function save(patch: Partial<EngineSettings>) {
    try {
      setSettings(await window.sahkarmi.orchestrator.setEngineSettings(patch));
      if ("memoryLimitMb" in patch || "memoryWarnPercent" in patch) refreshResources();
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
          <label class="engine-setting">
            <span>{t("maxStepsLabel")}</span>
            <input
              type="number"
              min={ENGINE_SETTINGS_LIMITS.maxStepsPerTurn.min}
              max={ENGINE_SETTINGS_LIMITS.maxStepsPerTurn.max}
              step={10}
              value={current().maxStepsPerTurn}
              onChange={(event) => {
                const value = numberFrom(event);
                if (value !== null) void save({ maxStepsPerTurn: value });
              }}
            />
            <small class="settings-meta">{t("maxStepsHint")}</small>
          </label>
          <MemoryLimit settings={current()} status={resources()} onSave={save} />
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

function MemoryLimit(props: {
  settings: EngineSettings;
  status: ResourceStatus | null;
  onSave: (patch: Partial<EngineSettings>) => void;
}) {
  const limit = () => props.settings.memoryLimitMb;
  const usedShare = () => {
    const status = props.status;
    if (!status || status.appUsedMb === null) return 0;
    const of = limit() > 0 ? limit() : status.totalMb;
    return Math.min(100, Math.round((status.appUsedMb / of) * 100));
  };
  const levelText = () => {
    const level = props.status?.level ?? "ok";
    if (level === "over") return t("memoryLevelOver");
    if (level === "warn") return t("memoryLevelWarn");
    return t("memoryLevelOk");
  };
  return (
    <section class="memory-limit" aria-label={t("memoryTitle")}>
      <h4>{t("memoryTitle")}</h4>
      <p class="settings-meta">{t("memoryIntro")}</p>
      <div class="memory-presets">
        <button
          type="button"
          aria-pressed={limit() === 0}
          onClick={() => props.onSave({ memoryLimitMb: 0 })}
        >
          {t("memoryAutomatic")}
        </button>
        <For each={props.status?.presetsMb ?? []}>
          {(mb) => (
            <button
              type="button"
              aria-pressed={limit() === mb}
              onClick={() => props.onSave({ memoryLimitMb: mb })}
            >
              {gb(mb)}
            </button>
          )}
        </For>
      </div>
      <label class="engine-setting">
        <span>{t("memoryCustomLabel")}</span>
        <input
          type="number"
          min={MIN_MEMORY_LIMIT_MB / 1024}
          max={props.status ? Math.floor(props.status.totalMb / 1024) : 64}
          step={0.5}
          value={limit() > 0 ? limit() / 1024 : ""}
          placeholder={t("memoryAutomatic")}
          onChange={(event) => {
            const text = event.currentTarget.value.trim();
            const value = Number(text);
            if (!text) props.onSave({ memoryLimitMb: 0 });
            else if (Number.isFinite(value))
              props.onSave({ memoryLimitMb: Math.round(value * 1024) });
          }}
        />
        <small class="settings-meta">
          {limit() === 0 ? t("memoryAutomaticHint") : levelText()}
        </small>
      </label>
      <Show when={limit() > 0}>
        <label class="engine-setting">
          <span>{t("memoryWarnLabel")}</span>
          <input
            type="number"
            min={ENGINE_SETTINGS_LIMITS.memoryWarnPercent.min}
            max={ENGINE_SETTINGS_LIMITS.memoryWarnPercent.max}
            step={5}
            value={props.settings.memoryWarnPercent}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) props.onSave({ memoryWarnPercent: value });
            }}
          />
          <small class="settings-meta">{t("memoryWarnHint")}</small>
        </label>
      </Show>
      <Show when={props.status} fallback={<p class="settings-meta">{t("memoryMeasuring")}</p>}>
        {(status) => (
          <div class="memory-status" data-level={status().level}>
            {/* The line below says the same in words; the bar is only a picture of it. */}
            <div class="memory-meter" aria-hidden="true">
              <span style={{ width: `${usedShare()}%` }} />
              <Show when={limit() > 0}>
                <i style={{ left: `${props.settings.memoryWarnPercent}%` }} />
              </Show>
            </div>
            <p class="memory-line">
              <Show when={status().appUsedMb !== null} fallback={t("memoryMeasuring")}>
                {limit() > 0
                  ? t("memoryUsing", { used: gb(status().appUsedMb ?? 0), limit: gb(limit()) })
                  : t("memoryUsingNoLimit", {
                      used: gb(status().appUsedMb ?? 0),
                      free: gb(status().freeMb),
                      total: gb(status().totalMb),
                    })}
              </Show>
            </p>
            <Show when={status().systemPressure !== "ok"}>
              <p class="memory-line memory-alert">{t("memoryPcLow")}</p>
            </Show>
            <Show when={status().minutesToLimit !== null}>
              <p class="memory-line memory-alert">
                {t("memoryForecast", {
                  rate: String(status().trendMbPerMin ?? 0),
                  minutes: String(status().minutesToLimit ?? 0),
                })}
              </p>
            </Show>
            <div class="memory-suggest">
              <span>
                <strong>
                  {t("memoryRecommended", { limit: gb(status().recommendation.limitMb) })}
                </strong>
                <small class="settings-meta">{status().recommendation.reason}</small>
              </span>
              <Show when={limit() !== status().recommendation.limitMb}>
                <button
                  type="button"
                  onClick={() => props.onSave({ memoryLimitMb: status().recommendation.limitMb })}
                >
                  {t("memoryUseSuggestion")}
                </button>
              </Show>
            </div>
            <Show when={status().groups.length > 0}>
              <details class="memory-groups">
                <summary>{t("memoryWhere")}</summary>
                <ul>
                  <For each={status().groups}>
                    {(group) => (
                      <li>
                        <span>{group.label}</span>
                        <span>
                          {gb(group.mb)} ·{" "}
                          {t("memoryProcesses", { count: String(group.processes) })}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </details>
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
}
