import { createSignal, Show } from "solid-js";
import type { UpdateStatus } from "../../../shared/ipc";
import { t } from "../i18n";

export function UpdateControl(props: { status: UpdateStatus; onAction: () => Promise<void> }) {
  const [error, setError] = createSignal<string | null>(null);
  const busy = () => ["checking", "downloading", "installing"].includes(props.status.phase);
  const label = () => {
    switch (props.status.phase) {
      case "checking":
        return t("updateChecking");
      case "downloading":
        return `${t("updateDownloading")} ${props.status.progress ?? 0}%`;
      case "ready":
        return t("updateRestart");
      case "installing":
        return t("updateInstalling");
      case "available":
        return t("updateDownload");
      case "error":
        return t("updateRetry");
      default:
        return t("checkUpdates");
    }
  };
  return (
    <div class="update-control">
      <button
        type="button"
        disabled={busy()}
        onClick={() => {
          setError(null);
          void props.onAction().catch(() => setError(t("updateActionFailed")));
        }}
      >
        {label()}
      </button>
      <Show when={props.status.phase === "downloading"}>
        <progress
          max="100"
          value={props.status.progress ?? 0}
          aria-label={t("updateDownloading")}
        />
      </Show>
      <Show when={props.status.availableVersion}>
        <span class="settings-meta">v{props.status.availableVersion}</span>
      </Show>
      <Show when={props.status.phase === "up-to-date"}>
        <p class="settings-meta" role="status">
          {t("updateCurrent")}
        </p>
      </Show>
      <Show when={props.status.message || error()}>
        <p class="settings-meta" role="status">
          {error() ?? props.status.message}
        </p>
      </Show>
    </div>
  );
}
