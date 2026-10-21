import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
  AgentProviderId,
  AgentProviderStatus,
  AgentStatus,
  ProviderSetupState,
} from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

const PROVIDERS: Array<{ id: AgentProviderId; name: string; hint: MessageKey }> = [
  { id: "codex", name: "ChatGPT (Codex)", hint: "connectCodexHint" },
  { id: "claude", name: "Claude", hint: "connectClaudeHint" },
  { id: "gemini", name: "Gemini", hint: "connectGeminiHint" },
  { id: "opencode", name: "OpenCode (free)", hint: "connectOpenCodeHint" },
];

const BUSY: ProviderSetupState["phase"][] = ["installing", "waiting", "needs-code", "checking"];

/**
 * One row per AI provider with a real Connect button: it starts the provider's own sign-in in the
 * browser (downloading the tool first when needed) and switches to Connected when it is done.
 */
export function ProviderConnect(props: { agentStatus: AgentStatus }) {
  const [setup, setSetup] = createSignal<Record<string, ProviderSetupState>>({});
  const [codes, setCodes] = createSignal<Record<string, string>>({});
  const [apiKeys, setApiKeys] = createSignal<Record<string, string>>({});
  const [apiKeyOpen, setApiKeyOpen] = createSignal<Record<string, boolean>>({});
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

  return (
    <ul class="provider-connect">
      <For each={PROVIDERS}>
        {(provider) => {
          const state = () => setup()[provider.id];
          const connected = () => status(provider.id)?.state === "available";
          const busy = () => BUSY.includes(state()?.phase ?? "idle");
          const label = () => {
            if (connected()) return t("connectConnected");
            const current = status(provider.id)?.state;
            if (current === "checking" || current === "not-started") return t("connectNotYet");
            if (current === "not-installed") return t("connectNotInstalled");
            return t("connectSignIn");
          };
          return (
            <li class="provider-connect-row" classList={{ "provider-connect-ok": connected() }}>
              <div class="provider-connect-head">
                <span>
                  <strong>{provider.name}</strong>
                  <small>{status(provider.id)?.email ?? t(provider.hint)}</small>
                </span>
                <span class="provider-connect-state">{label()}</span>
                <Show
                  when={provider.id !== "opencode"}
                  fallback={
                    <button
                      type="button"
                      disabled={busy()}
                      onClick={() =>
                        void act(provider.id, () =>
                          window.sahkarmi.providerSetup.check(provider.id),
                        )
                      }
                    >
                      {t("connectCheck")}
                    </button>
                  }
                >
                  <button
                    type="button"
                    class={connected() ? "" : "button-primary"}
                    disabled={busy()}
                    onClick={() =>
                      void act(provider.id, () =>
                        window.sahkarmi.providerSetup.connect(provider.id),
                      )
                    }
                  >
                    {connected() ? t("connectReconnect") : t("connectButton")}
                  </button>
                </Show>
                <Show when={provider.id === "gemini" || provider.id === "codex" || provider.id === "claude"}>
                  <button
                    type="button"
                    class="link-button"
                    style="font-size: 12px; margin-left: 6px;"
                    title="Enter API Key directly"
                    onClick={() =>
                      setApiKeyOpen((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))
                    }
                  >
                    🔑 {apiKeyOpen()[provider.id] ? "Close Key" : "API Key"}
                  </button>
                </Show>
              </div>
              <Show when={apiKeyOpen()[provider.id]}>
                <div class="provider-connect-progress" style="margin-top: 8px;">
                  <form
                    class="provider-connect-code"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const key = apiKeys()[provider.id]?.trim();
                      if (!key) return;
                      void act(provider.id, () =>
                        window.sahkarmi.providerSetup.setApiKey(provider.id, key),
                      ).then(() =>
                        setApiKeyOpen((prev) => ({ ...prev, [provider.id]: false })),
                      );
                    }}
                  >
                    <input
                      type="password"
                      value={apiKeys()[provider.id] ?? ""}
                      placeholder={
                        provider.id === "gemini"
                          ? "Enter Gemini API Key (from Google AI Studio)"
                          : `Enter ${provider.name} API Key`
                      }
                      aria-label="API Key"
                      onInput={(event) => {
                        const value = event.currentTarget.value;
                        setApiKeys((current) => ({ ...current, [provider.id]: value }));
                      }}
                    />
                    <button type="submit" class="button-primary">
                      Save & Connect
                    </button>
                    <Show when={provider.id === "gemini"}>
                      <button
                        type="button"
                        class="link-button"
                        style="font-size: 12px; margin-left: 8px;"
                        onClick={() =>
                          void window.sahkarmi.openUrl("https://aistudio.google.com/app/apikey")
                        }
                      >
                        Get Free Key ↗
                      </button>
                    </Show>
                  </form>
                </div>
              </Show>
              <Show when={state() && state()?.phase !== "idle" && state()?.phase !== "connected"}>
                <div class="provider-connect-progress" role="status">
                  <Show when={state()?.message}>
                    <p>{state()?.message}</p>
                  </Show>
                  <Show when={state()?.phase === "installing" && state()?.progress !== null}>
                    <progress max="100" value={state()?.progress ?? 0} />
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
                        const code = codes()[provider.id] ?? "";
                        void act(provider.id, () =>
                          window.sahkarmi.providerSetup.submitCode(provider.id, code),
                        ).then(() => setCodes((current) => ({ ...current, [provider.id]: "" })));
                      }}
                    >
                      <input
                        value={codes()[provider.id] ?? ""}
                        placeholder={t("connectCodePlaceholder")}
                        aria-label={t("connectCodePlaceholder")}
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          setCodes((current) => ({ ...current, [provider.id]: value }));
                        }}
                      />
                      <button type="submit" class="button-primary">
                        {t("connectSubmitCode")}
                      </button>
                    </form>
                  </Show>
                  <Show when={state()?.phase === "needs-api-key"}>
                    <form
                      class="provider-connect-code"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const key = apiKeys()[provider.id]?.trim();
                        if (!key) return;
                        void act(provider.id, () =>
                          window.sahkarmi.providerSetup.setApiKey(provider.id, key),
                        );
                      }}
                    >
                      <input
                        type="password"
                        value={apiKeys()[provider.id] ?? ""}
                        placeholder="Paste your Gemini API key (AIzaSy...)"
                        aria-label="API Key"
                        onInput={(event) => {
                          const value = event.currentTarget.value;
                          setApiKeys((current) => ({ ...current, [provider.id]: value }));
                        }}
                      />
                      <button type="submit" class="button-primary">
                        Save & Connect
                      </button>
                    </form>
                  </Show>
                  <Show when={state()?.phase === "terminal" || state()?.phase === "failed"}>
                    <button
                      type="button"
                      onClick={() =>
                        void act(provider.id, () =>
                          window.sahkarmi.providerSetup.check(provider.id),
                        )
                      }
                    >
                      {t("connectCheck")}
                    </button>
                  </Show>
                </div>
              </Show>
              <Show when={errors()[provider.id]}>
                <p class="center-view-error" role="alert">
                  {errors()[provider.id]}
                </p>
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
