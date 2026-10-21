import { createSignal, For, Show } from "solid-js";
import type { AgentModelOption, AgentProviderId, AgentStatus } from "../../../shared/ipc";
import { PROVIDER_LABELS, providerForModel } from "../../../shared/ipc";

export interface ProviderRefresh {
  checkedAt: string;
  addedModels: number;
}

export function ProviderUpdates(props: {
  status: AgentStatus;
  models: AgentModelOption[];
  refreshes: Partial<Record<AgentProviderId, ProviderRefresh>>;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const added = () =>
    Object.values(props.refreshes).reduce((sum, refresh) => sum + (refresh?.addedModels ?? 0), 0);
  return (
    <details class="provider-updates" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        AI updates{" "}
        <Show when={added() > 0}>
          <span class="provider-update-badge">+{added()} models</span>
        </Show>
      </summary>
      <Show when={expanded()}>
        <p>
          Models refresh automatically every 15 minutes. Installed AI tool versions are detected
          while idle.
        </p>
        <For each={props.status.providers ?? []}>
          {(provider) => (
            <div class="provider-update-row">
              <strong>{PROVIDER_LABELS[provider.id]}</strong>
              <span>
                {provider.version ? `v${provider.version}` : provider.state.replaceAll("-", " ")}
              </span>
              <small title={provider.message ?? undefined}>
                {provider.state === "available"
                  ? `${props.models.filter((model) => providerForModel(model.id) === provider.id).length} models`
                  : provider.state.replaceAll("-", " ")}
                <Show when={props.refreshes[provider.id]}>
                  {(refresh) => (
                    <>
                      {" "}
                      · Checked{" "}
                      {new Date(refresh().checkedAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <Show when={refresh().addedModels > 0}> · +{refresh().addedModels} new</Show>
                    </>
                  )}
                </Show>
              </small>
            </div>
          )}
        </For>
        <p>
          Bundled tools update with Sahkarmi. Your separately installed tools keep their own
          updater.
        </p>
        <button
          type="button"
          disabled={busy()}
          onClick={async () => {
            setBusy(true);
            setError(false);
            try {
              await props.onRefresh();
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy() ? "Refreshing models…" : "Refresh AI models"}
        </button>
        <Show when={error()}>
          <p role="status">Could not refresh. Check the provider connection and retry.</p>
        </Show>
      </Show>
    </details>
  );
}
