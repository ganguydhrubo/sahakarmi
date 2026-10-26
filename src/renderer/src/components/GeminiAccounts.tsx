import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { GeminiAccount, GeminiAccountsState } from "../../../shared/ipc";
import { t } from "../i18n";

/**
 * Extra Google accounts for Gemini, under the Gemini row in Settings. When the account in use
 * reaches Google's usage limit, Gemini moves to the next signed-in one by itself.
 */
export function GeminiAccounts(props: { busy: boolean }) {
  const [accounts, setAccounts] = createSignal<GeminiAccount[]>([]);
  const [error, setError] = createSignal("");

  const api = () => window.sahkarmi.geminiAccounts;

  async function run(action: () => Promise<GeminiAccountsState>) {
    setError("");
    try {
      setAccounts((await action()).accounts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  onMount(() => {
    const accountsApi = api();
    if (!accountsApi) return;
    void run(() => accountsApi.list());
    // A sign-in finishing (or failing) changes who is signed in.
    const stop = window.sahkarmi.providerSetup?.onEvent((state) => {
      if (state.provider !== "antigravity") return;
      if (state.phase === "connected" || state.phase === "failed" || state.phase === "idle") {
        void run(() => accountsApi.list());
      }
    });
    if (stop) onCleanup(stop);
  });

  const label = (account: GeminiAccount, index: number) =>
    account.email ?? t("geminiAccountNumber", { n: String(index + 1) });

  return (
    <Show when={api()}>
      {(accountsApi) => (
        <div class="gemini-accounts">
          <p class="settings-meta">{t("geminiAccountsHelp")}</p>
          <ul class="gemini-account-list">
            <For each={accounts()}>
              {(account, index) => (
                <li class="gemini-account-row">
                  <span class="gemini-account-name">
                    {label(account, index())}
                    <small>
                      {account.signedIn
                        ? (account.tier ?? t("geminiAccountSignedIn"))
                        : t("geminiAccountNotSignedIn")}
                    </small>
                  </span>
                  <Show
                    when={account.active}
                    fallback={
                      <Show
                        when={account.signedIn}
                        fallback={
                          <button
                            type="button"
                            disabled={props.busy}
                            onClick={() => void run(() => accountsApi().signIn(account.id))}
                          >
                            {t("geminiAccountSignIn")}
                          </button>
                        }
                      >
                        <button
                          type="button"
                          disabled={props.busy}
                          onClick={() => void run(() => accountsApi().use(account.id))}
                        >
                          {t("geminiAccountUse")}
                        </button>
                      </Show>
                    }
                  >
                    <span class="provider-badge provider-badge-free">
                      {t("geminiAccountInUse")}
                    </span>
                  </Show>
                  <Show when={account.id !== "default"}>
                    <button
                      type="button"
                      class="link-button"
                      disabled={props.busy}
                      onClick={() => {
                        if (!window.confirm(t("geminiAccountRemoveConfirm"))) return;
                        void run(() => accountsApi().remove(account.id));
                      }}
                    >
                      {t("geminiAccountRemove")}
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <button
            type="button"
            class="link-button"
            disabled={props.busy}
            onClick={() => void run(() => accountsApi().add())}
          >
            {t("geminiAccountAdd")}
          </button>
          <Show when={error()}>
            <p class="center-view-error" role="alert">
              {error()}
            </p>
          </Show>
        </div>
      )}
    </Show>
  );
}
