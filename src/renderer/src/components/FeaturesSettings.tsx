import { createSignal, For, Show } from "solid-js";
import {
  FEATURE_CATEGORIES,
  type FeatureAvailability,
  type FeatureCategory,
  type FeatureManifestPreview,
} from "../../../shared/ipc";
import { applyFeatures, features } from "../features";
import { type MessageKey, t } from "../i18n";

const CATEGORY_KEYS: Record<FeatureCategory, MessageKey> = {
  core: "featCore",
  providers: "featProviders",
  workspace: "featWorkspace",
  business: "featBusiness",
  labs: "featLabs",
};
const AVAILABILITY_KEYS: Record<FeatureAvailability, MessageKey> = {
  available: "availAvailable",
  "needs-setup": "availSetup",
  unavailable: "availUnavailable",
  "coming-later": "availLater",
};

export function FeaturesSettings() {
  const [manifest, setManifest] = createSignal("");
  const [preview, setPreview] = createSignal<FeatureManifestPreview | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function chooseFile(event: Event & { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (file.size > 64 * 1024) {
      setError(t("manifestTooLarge"));
      return;
    }
    setManifest(await file.text());
    setPreview(null);
  }

  return (
    <div class="features-settings">
      <p class="settings-meta">{t("featuresIntro")}</p>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>
      <For each={FEATURE_CATEGORIES}>
        {(category) => (
          <Show when={features().some((feature) => feature.category === category)}>
            <h3>{t(CATEGORY_KEYS[category])}</h3>
            <ul class="feature-list">
              <For each={features().filter((feature) => feature.category === category)}>
                {(feature) => (
                  <li class="feature-row">
                    <div>
                      <strong>{feature.name}</strong>
                      <span
                        class={`feature-availability feature-availability-${feature.availability}`}
                      >
                        {t(AVAILABILITY_KEYS[feature.availability])}
                      </span>
                      <p>{feature.description}</p>
                      <Show when={feature.reason}>
                        <small>{feature.reason}</small>
                      </Show>
                    </div>
                    <Show
                      when={feature.canDisable}
                      fallback={
                        <span class="settings-meta">
                          {feature.origin === "catalogue"
                            ? t("featureNotInstalled")
                            : t("featureAlwaysOn")}
                        </span>
                      }
                    >
                      <button
                        type="button"
                        role="switch"
                        class="feature-switch"
                        aria-checked={feature.enabled}
                        aria-label={feature.name}
                        onClick={() =>
                          void run(async () =>
                            applyFeatures(
                              await window.sahkarmi.features.setEnabled(
                                feature.id,
                                !feature.enabled,
                              ),
                            ),
                          )
                        }
                      >
                        <span />
                      </button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        )}
      </For>

      <h3>{t("manifestTitle")}</h3>
      <p class="settings-meta">{t("manifestIntro")}</p>
      <div class="manifest-import">
        <label class="manifest-file">
          <span>{t("manifestChoose")}</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void chooseFile(event)}
          />
        </label>
        <textarea
          rows={5}
          spellcheck={false}
          aria-label={t("manifestTitle")}
          placeholder='{"schema":"sahkarmi.features/1","version":"2026.11","features":[…]}'
          value={manifest()}
          onInput={(event) => {
            setManifest(event.currentTarget.value);
            setPreview(null);
          }}
        />
        <div class="settings-buttons">
          <button
            type="button"
            disabled={!manifest().trim()}
            onClick={() =>
              void run(async () => {
                setPreview(await window.sahkarmi.features.previewManifest(manifest()));
              })
            }
          >
            {t("manifestPreview")}
          </button>
          <button
            type="button"
            class="button-primary"
            disabled={!preview()?.ok}
            onClick={() =>
              void run(async () => {
                applyFeatures(await window.sahkarmi.features.applyManifest(manifest()));
                setPreview(null);
                setManifest("");
              })
            }
          >
            {t("manifestApply")}
          </button>
          <button
            type="button"
            class="button-danger-quiet"
            onClick={() =>
              void run(async () => applyFeatures(await window.sahkarmi.features.resetCatalogue()))
            }
          >
            {t("manifestReset")}
          </button>
        </div>
        <Show when={preview()}>
          {(value) => (
            <div class="manifest-preview" role="status">
              <Show
                when={value().ok}
                fallback={
                  <ul class="manifest-errors">
                    <For each={value().errors}>{(message) => <li>{message}</li>}</For>
                  </ul>
                }
              >
                <p>{t("manifestVersion", { version: value().catalogueVersion ?? "—" })}</p>
                <ul>
                  <For each={value().changed}>
                    {(item) => (
                      <li>
                        {item.change}: <strong>{item.name}</strong>
                      </li>
                    )}
                  </For>
                  <For each={value().added}>
                    {(item) => (
                      <li>
                        {t("manifestAnnounced")}: <strong>{item.name}</strong>
                      </li>
                    )}
                  </For>
                  <For each={value().ignored}>
                    {(item) => (
                      <li class="settings-meta">
                        {item.id}: {item.reason}
                      </li>
                    )}
                  </For>
                </ul>
                <Show when={value().changed.length + value().added.length === 0}>
                  <p class="settings-meta">{t("manifestNoChanges")}</p>
                </Show>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
