import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  type AgentProviderId,
  PROVIDER_LABELS,
  type ProviderUsageSummary,
} from "../../../shared/ipc";
import { ProviderLogo } from "./ProviderLogo";

const NAMES: Partial<Record<AgentProviderId, string>> = {
  codex: "ChatGPT",
  claude: "Claude",
  antigravity: "Antigravity",
  opencode: "OpenCode",
};
const REFRESH_MS = 60_000;

/**
 * Small rings in the sidebar showing how much of each provider's real usage limit is used.
 * Only providers that report a limit are shown; nothing is estimated.
 */
export function UsageRings(props: { onOpenUsage: () => void }) {
  const [providers, setProviders] = createSignal<ProviderUsageSummary[]>([]);
  const [open, setOpen] = createSignal<AgentProviderId | null>(null);

  const load = async () => {
    try {
      const overview = await window.sahkarmi.usage.overview();
      setProviders(
        overview.providers.filter((provider) =>
          provider.limits.some((limit) => limit.usedPercent !== null),
        ),
      );
    } catch {
      // Usage is optional; the rings simply stay hidden.
    }
  };

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <Show when={providers().length > 0}>
      <div class="usage-rings">
        <For each={providers()}>
          {(provider) => {
            // A window past its reset time no longer describes now.
            const live = () =>
              provider.limits.filter(
                (limit) => !limit.resetsAt || Date.parse(limit.resetsAt) >= Date.now(),
              );
            const highest = () => Math.max(0, ...live().map((limit) => limit.usedPercent ?? 0));
            // The provider's own status counts too: Claude warns from 75 % of a window.
            const level = () =>
              highest() >= 95 || live().some((limit) => limit.status === "limited")
                ? "high"
                : highest() >= 80 || live().some((limit) => limit.status === "warning")
                  ? "mid"
                  : "ok";
            return (
              <div class="usage-ring-wrap">
                <button
                  type="button"
                  class={`usage-ring usage-ring-${level()}`}
                  aria-label={`${NAMES[provider.provider] ?? PROVIDER_LABELS[provider.provider]} ${Math.round(highest())}%`}
                  onClick={props.onOpenUsage}
                  onMouseEnter={() => setOpen(provider.provider)}
                  onMouseLeave={() => setOpen(null)}
                  onFocus={() => setOpen(provider.provider)}
                  onBlur={() => setOpen(null)}
                >
                  <svg viewBox="0 0 36 36" aria-hidden="true">
                    <circle cx="18" cy="18" r="15" class="usage-ring-track" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15"
                      class="usage-ring-value"
                      stroke-dasharray={`${(Math.min(100, highest()) / 100) * 94.25} 94.25`}
                    />
                  </svg>
                  <ProviderLogo provider={provider.provider} size={15} />
                </button>
                <Show when={open() === provider.provider}>
                  <div class="usage-ring-popover" role="tooltip">
                    <strong>
                      {NAMES[provider.provider] ?? PROVIDER_LABELS[provider.provider]}
                    </strong>
                    <For each={provider.limits.filter((limit) => limit.usedPercent !== null)}>
                      {(limit) => (
                        <div class="usage-ring-limit">
                          <span>{limit.label}</span>
                          <meter min="0" max="100" value={limit.usedPercent ?? 0} />
                          <b>{Math.round(limit.usedPercent ?? 0)}%</b>
                          <Show when={limit.resetsAt}>
                            {(resetsAt) => <small>{resetsIn(resetsAt())}</small>}
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}

/** "2h 05m", "6d 14h": time until the limit window resets. */
export function resetsIn(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
