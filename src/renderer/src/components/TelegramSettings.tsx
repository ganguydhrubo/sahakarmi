import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { TelegramStatus } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { t } from "../i18n";

/** While waiting for the owner to send the code from their phone, check every few seconds. */
const PAIRING_POLL_MS = 3_000;

export function TelegramSettings(props: { bots: BotProfile[] }) {
  const [status, setStatus] = createSignal<TelegramStatus | null>(null);
  const [token, setToken] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function run(action: () => Promise<TelegramStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => {
    void run(() => window.sahkarmi.telegram.status());
    const timer = window.setInterval(() => {
      const current = status();
      if (current?.configured && !current.paired) {
        void window.sahkarmi.telegram
          .status()
          .then(setStatus)
          .catch(() => {});
      }
    }, PAIRING_POLL_MS);
    onCleanup(() => window.clearInterval(timer));
  });

  const link = () => {
    const name = status()?.botUsername;
    return name ? `https://t.me/${name}` : null;
  };

  return (
    <>
      <p class="settings-meta">{t("telegramIntro")}</p>
      <Show
        when={status()?.configured}
        fallback={
          <>
            <ol>
              <li>{t("telegramStepBotFather")}</li>
              <li>{t("telegramStepPaste")}</li>
            </ol>
            <label class="voice-field">
              <span>{t("telegramToken")}</span>
              <input
                type="password"
                autocomplete="off"
                value={token()}
                onInput={(event) => setToken(event.currentTarget.value)}
              />
            </label>
            <div class="settings-buttons">
              <button
                type="button"
                disabled={busy() || !token().trim()}
                onClick={() =>
                  void run(async () => {
                    const next = await window.sahkarmi.telegram.setToken(token());
                    setToken("");
                    return next;
                  })
                }
              >
                {t("telegramConnect")}
              </button>
            </div>
          </>
        }
      >
        <p>
          {t("telegramConnectedAs", {
            name: status()?.botUsername ? `@${status()?.botUsername}` : "",
          })}
        </p>
        <Show
          when={status()?.paired}
          fallback={
            <p>
              {t("telegramPairStep")}{" "}
              <Show when={link()}>
                {(href) => (
                  <a
                    href={href()}
                    onClick={(event) => {
                      event.preventDefault();
                      void window.sahkarmi.openUrl(href()).catch(() => undefined);
                    }}
                  >
                    {href()}
                  </a>
                )}
              </Show>{" "}
              <code>/start {status()?.pairingCode}</code>
            </p>
          }
        >
          <p>{t("telegramPairedWith", { name: status()?.chatName ?? "" })}</p>
        </Show>
        <label class="voice-field">
          <span>{t("telegramCoworker")}</span>
          <select
            value={status()?.coworkerId ?? ""}
            disabled={busy() || props.bots.length === 0}
            onChange={(event) => {
              const botId = event.currentTarget.value;
              void run(() => window.sahkarmi.telegram.setCoworker(botId));
            }}
          >
            <For each={props.bots}>{(bot) => <option value={bot.id}>{bot.name}</option>}</For>
          </select>
        </label>
        <div class="settings-buttons">
          <Show when={status()?.paired}>
            <button
              type="button"
              disabled={busy()}
              onClick={() => void run(() => window.sahkarmi.telegram.unpair())}
            >
              {t("telegramUnpair")}
            </button>
          </Show>
          <button
            type="button"
            disabled={busy()}
            onClick={() => void run(() => window.sahkarmi.telegram.setToken(""))}
          >
            {t("telegramDisconnect")}
          </button>
        </div>
        <p class="settings-meta">{t("telegramKeepOpen")}</p>
      </Show>
      <Show when={error() ?? status()?.error}>
        {(message) => (
          <p class="center-view-error" role="alert">
            {message()}
          </p>
        )}
      </Show>
    </>
  );
}
