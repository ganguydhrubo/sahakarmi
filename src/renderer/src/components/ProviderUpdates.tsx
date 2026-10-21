import { createSignal, For, Show } from "solid-js";
import type {
  AgentModelOption,
  AgentProviderId,
  AgentStatus,
  AiRuntimeStatus,
  AiToolId,
  AiToolUpdate,
} from "../../../shared/ipc";
import { PROVIDER_LABELS, providerForModel } from "../../../shared/ipc";

export interface ProviderRefresh {
  checkedAt: string;
  addedModels: number;
}

function toolNeedsUpdate(tool: AiToolUpdate): boolean {
  if (!tool.latest) return false;
  if (!tool.installed) return tool.managed;
  return tool.latest !== tool.installed;
}

export function ProviderUpdates(props: {
  status: AgentStatus;
  models: AgentModelOption[];
  refreshes: Partial<Record<AgentProviderId, ProviderRefresh>>;
  onRefresh: () => Promise<void>;
  runtime?: AiRuntimeStatus;
  onUpdateTool?: (toolId: AiToolId) => Promise<void>;
}) {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal(false);
  const [updating, setUpdating] = createSignal<AiToolId | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const added = () =>
    Object.values(props.refreshes).reduce((sum, refresh) => sum + (refresh?.addedModels ?? 0), 0);
  const runtime = () => props.runtime;
  const tools = () => runtime()?.tools ?? [];
  return (
    <details class="provider-updates" onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>
        AI updates{" "}
        <Show when={added() > 0}>
          <span class="provider-update-badge">+{added()} models</span>
        </Show>
        <Show when={tools().some(toolNeedsUpdate)}>
          <span class="provider-update-badge">update available</span>
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
        <Show when={tools().length > 0}>
          <p class="provider-update-tools-title">AI tool versions</p>
          <For each={tools()}>
            {(tool) => (
              <div class="provider-update-row">
                <strong>{tool.label}</strong>
                <span>{tool.installed ? `v${tool.installed}` : "not installed"}</span>
                <small>
                  {tool.latest
                    ? toolNeedsUpdate(tool)
                      ? `update available: v${tool.latest}`
                      : `up to date (latest v${tool.latest})`
                    : "latest version unknown"}
                  <Show when={tool.note}> · {tool.note}</Show>
                </small>
                <Show when={toolNeedsUpdate(tool) && props.onUpdateTool}>
                  <button
                    type="button"
                    disabled={updating() !== null}
                    onClick={async () => {
                      if (!props.onUpdateTool) return;
                      setUpdating(tool.id);
                      try {
                        await props.onUpdateTool(tool.id);
                      } finally {
                        setUpdating(null);
                      }
                    }}
                  >
                    {updating() === tool.id ? "Updating…" : "Update now"}
                  </button>
                  <Show when={tool.command && !tool.managed}>
                    <small>or run: {tool.command}</small>
                  </Show>
                </Show>
              </div>
            )}
          </For>
          <Show when={runtime()?.message}>{(message) => <p role="status">{message()}</p>}</Show>
          <Show when={runtime()?.phase === "updating"}>
            <p role="status">Downloading… {runtime()?.progress ?? 0}%</p>
          </Show>
        </Show>
        <p>
          Sahkarmi updates its own OpenCode runtime. Your separately installed tools are only
          changed when you choose "Update now".
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
