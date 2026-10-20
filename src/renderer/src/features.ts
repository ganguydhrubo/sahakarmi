import { createSignal } from "solid-js";
import type { FeatureState } from "../../shared/ipc";

const [features, setFeatures] = createSignal<FeatureState[]>([]);

export { features };

/** Loaded once at start-up and after every change in Settings → Features. */
export async function loadFeatures(): Promise<void> {
  try {
    setFeatures(await window.sahkarmi.features.list());
  } catch {
    // Older preload or a failed read: keep defaults (everything built-in on).
  }
}

export function applyFeatures(next: FeatureState[]): void {
  setFeatures(next);
}

/** Built-in features are on unless the owner switched them off. */
export function featureOn(id: string): boolean {
  const feature = features().find((candidate) => candidate.id === id);
  return feature ? feature.enabled : !["live-dictation", "model-suggestions"].includes(id);
}
