import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
  AgentProviderId,
  AgentProviderStatus,
  AgentStatus,
  ProviderSetupState,
} from "../../../shared/ipc";
import { PROVIDER_CATALOG, type ProviderCatalogEntry } from "../../../shared/provider-catalog";
import { t } from "../i18n";
import { GeminiAccounts } from "./GeminiAccounts";
import { ProviderLogo } from "./ProviderLogo";

const BUSY: ProviderSetupState["phase"][] = [
  "installing",
  "waiting",
  "needs-code",
  "checking",
  "terminal",
];

/** Agents whose key goes in the tool's own setting rather than a sign-in. */
const KEY_PLACEHOLDERS: Partial<Record<AgentProviderId, string>> = {
  antigravity: "Google AI Studio key (AIzaSy…)",
  codex: "OpenAI API key (sk-…)",
  claude: "Anthropic API key (sk-ant-…)",
  cursor: "Cursor API key",
  copilot: "GitHub token with Copilot access",
  cline: "Cline API key",
  grok: "xAI API key",
  droid: "Factory API key",
  qoder: "Qoder personal access token",
  vibe: "Mistral API key",
};

/**
 * Every AI provider with its own brand mark. Connected ones sit on top; the rest offer one
 * Connect button that installs the tool when needed and starts the provider's own sign-in.
 */
export function ProviderConnect(props: { agentStatus: AgentStatus }) {
  const [setup, setSetup] = createSignal<Record<string, ProviderSetupState>>({});
  const [codes, setCodes] = createSignal<Record<string, string>>({});
  const [apiKeys, setApiKeys] = createSignal<Record<string, string>>({});
  const [keyOpen, setKeyOpen] = createSignal<AgentProviderId | null>(null);
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  const store = (state: ProviderSetupState) =>
    setSetup((current) => ({ ...current, [state.provider]: state }));

  onMount(() => {
    const api = window.sahkarmi.providerSetup;
    if (!api) return;
    void api
      .list()
      .then((states) => {
        for (const state of states) store(state);
      })
      .catch(() => undefined);
    onCleanup(api.onEvent(store));
  });

  const status = (id: AgentProviderId): AgentProviderStatus | undefined =>
    props.agentStatus.providers?.find((provider) => provider.id === id);
  const connected = (id: AgentProviderId) => status(id)?.state === "available";
  /** Installed on this computer but not signed in yet. */
  const found = (id: AgentProviderId) => status(id)?.state === "sign-in-required";

  const groups = createMemo(() => {
    const ready = PROVIDER_CATALOG.filter((entry) => connected(entry.id));
    const onComputer = PROVIDER_CATALOG.filter(
      (entry) => !connected(entry.id) && found(entry.id) && entry.kind === "agent",
    );
    const others = PROVIDER_CATALOG.filter(
      (entry) => !ready.includes(entry) && !onComputer.includes(entry),
    ).sort((left, right) => Number(right.free) - Number(left.free));
    return { ready, onComputer, others };
  });

  async function act(id: AgentProviderId, action: () => Promise<ProviderSetupState>) {
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      store(await action());
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [id]: cause instanceof Error ? cause.message : String(cause),
      }));
    }
  }

  const Row = (rowProps: { entry: ProviderCatalogEntry }) => {
    const id = rowProps.entry.id;
    const state = () => setup()[id];
    const busy = () => BUSY.includes(state()?.phase ?? "idle");
    const isOn = () => connected(id);
    const subtitle = () => {
      const email = status(id)?.email;
      if (isOn()) return email ?? t("connectConnectedHere");
      if (found(id)) return t("connectFoundHere");
      return rowProps.entry.tagline;
    };
    return (
      <li
        class="provider-row"
        classList={{ "provider-row-on": isOn(), "provider-row-busy": busy() }}
      >
        <div class="provider-row-main">
          <ProviderLogo provider={id} size={20} tile />
          <div class="provider-row-text">
            <span class="provider-row-name">
              <strong>{rowProps.entry.name}</strong>
              <Show when={rowProps.entry.free}>
                <span class="provider-badge provider-badge-free">{t("connectFreeBadge")}</span>
              </Show>
            </span>
            <small>{subtitle()}</small>
          </div>
          <div class="provider-row-actions">
            <Show
              when={!isOn()}
              fallback={
                <span class="provider-status-on">
                  <span class="provider-status-dot" aria-hidden="true" />
                  {t("connectConnected")}
                </span>
              }
            >
              <Show
                when={id !== "opencode"}
                fallback={
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() => void act(id, () => window.sahkarmi.providerSetup.check(id))}
                  >
                    {t("connectCheck")}
                  </button>
                }
              >
                <button
                  type="button"
                  class="button-primary provider-connect-button"
                  disabled={busy()}
                  aria-busy={busy()}
                  onClick={() => void act(id, () => window.sahkarmi.providerSetup.connect(id))}
                >
                  <Show when={busy()} fallback={t("connectButton")}>
                    <span class="provider-spinner" aria-hidden="true" />
                    {t("connectWorking")}
                  </Show>
                </button>
              </Show>
            </Show>
            <Show when={isOn() && id !== "opencode"}>
              <button
                type="button"
                class="link-button"
                disabled={busy()}
                onClick={() => void act(id, () => window.sahkarmi.providerSetup.connect(id))}
              >
                {t("connectReconnect")}
              </button>
            </Show>
          </div>
        </div>

        <Show when={id === "antigravity" && isOn()}>
          <GeminiAccounts busy={busy()} />
        </Show>

        <Show
          when={!isOn() && KEY_PLACEHOLDERS[id] && (rowProps.entry.kind !== "agent" || found(id))}
        >
          <Show
            when={keyOpen() === id}
            fallback={
              <button
                type="button"
                class="link-button provider-key-toggle"
                onClick={() => setKeyOpen(id)}
              >
                {t("connectUseKey")}
              </button>
            }
          >
            <form
              class="provider-connect-code"
              onSubmit={(event) => {
                event.preventDefault();
                const key = apiKeys()[id]?.trim();
                if (!key) return;
                void act(id, () => window.sahkarmi.providerSetup.setApiKey(id, key)).then(() => {
                  setApiKeys((current) => ({ ...current, [id]: "" }));
                  setKeyOpen(null);
                });
              }}
            >
              <input
                type="password"
                autocomplete="off"
                value={apiKeys()[id] ?? ""}
                placeholder={KEY_PLACEHOLDERS[id]}
                aria-label={t("connectKeyLabel", { name: rowProps.entry.name })}
                onInput={(event) => {
                  const value = event.currentTarget.value;
                  setApiKeys((current) => ({ ...current, [id]: value }));
                }}
              />
              <button type="submit" class="button-primary">
                {t("connectSaveKey")}
              </button>
              <button type="button" class="link-button" onClick={() => setKeyOpen(null)}>
                {t("cancel")}
              </button>
              <Show when={id === "antigravity"}>
                <button
                  type="button"
                  class="link-button"
                  onClick={() => void window.sahkarmi.openUrl(rowProps.entry.website)}
                >
                  {t("connectGetFreeKey")}
                </button>
              </Show>
            </form>
          </Show>
        </Show>

        <Show
          when={
            !isOn() &&
            !busy() &&
            status(id)?.message &&
            status(id)?.state !== "not-installed" &&
            status(id)?.state !== "sign-in-required"
          }
        >
          <p class="settings-meta provider-connect-reason">{status(id)?.message}</p>
        </Show>
        <Show when={state() && state()?.phase !== "idle" && state()?.phase !== "connected"}>
          <div class="provider-connect-progress" role="status">
            <Show when={state()?.message}>
              <p>{state()?.message}</p>
            </Show>
            <Show when={state()?.phase === "installing"}>
              <progress
                max="100"
                value={state()?.progress ?? undefined}
                aria-label={t("connectInstalling")}
              />
            </Show>
            <Show when={state()?.url}>
              {(url) => (
                <button
                  type="button"
                  class="link-button"
                  onClick={() => void window.sahkarmi.openUrl(url())}
                >
                  {t("connectOpenAgain")}
                </button>
              )}
            </Show>
            <Show when={state()?.phase === "needs-code"}>
              <form
                class="provider-connect-code"
                onSubmit={(event) => {
                  event.preventDefault();
                  const code = codes()[id] ?? "";
                  void act(id, () => window.sahkarmi.providerSetup.submitCode(id, code)).then(() =>
                    setCodes((current) => ({ ...current, [id]: "" })),
                  );
                }}
              >
                <input
                  value={codes()[id] ?? ""}
                  placeholder={t("connectCodePlaceholder")}
                  aria-label={t("connectCodePlaceholder")}
                  onInput={(event) => {
                    const value = event.currentTarget.value;
                    setCodes((current) => ({ ...current, [id]: value }));
                  }}
                />
                <button type="submit" class="button-primary">
                  {t("connectSubmitCode")}
                </button>
              </form>
            </Show>
            <Show when={state()?.phase === "needs-api-key"}>
              <button type="button" class="link-button" onClick={() => setKeyOpen(id)}>
                {t("connectUseKey")}
              </button>
            </Show>
            <Show when={state()?.phase === "terminal" || state()?.phase === "failed"}>
              <button
                type="button"
                onClick={() => void act(id, () => window.sahkarmi.providerSetup.check(id))}
              >
                {t("connectCheck")}
              </button>
            </Show>
          </div>
        </Show>
        <Show when={errors()[id]}>
          <p class="center-view-error" role="alert">
            {errors()[id]}
          </p>
        </Show>
      </li>
    );
  };

  return (
    <div class="provider-groups">
      <Show when={groups().ready.length}>
        <section class="provider-group" aria-label={t("connectGroupConnected")}>
          <h3>{t("connectGroupConnected")}</h3>
          <ul class="provider-list">
            <For each={groups().ready}>{(entry) => <Row entry={entry} />}</For>
          </ul>
        </section>
      </Show>
      <Show when={groups().onComputer.length}>
        <section class="provider-group" aria-label={t("connectGroupFound")}>
          <h3>{t("connectGroupFound")}</h3>
          <ul class="provider-list">
            <For each={groups().onComputer}>{(entry) => <Row entry={entry} />}</For>
          </ul>
        </section>
      </Show>
      <section class="provider-group" aria-label={t("connectGroupOthers")}>
        <h3>{t("connectGroupOthers")}</h3>
        <ul class="provider-list">
          <For each={groups().others}>{(entry) => <Row entry={entry} />}</For>
        </ul>
      </section>
    </div>
  );
}
