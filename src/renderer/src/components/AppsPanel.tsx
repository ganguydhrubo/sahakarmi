import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import type { ComposioAppMeta, ComposioStatus } from "../../../shared/ipc";
import { t } from "../i18n";
import { speechLocale } from "../preferences";

const PAGE_SIZE = 24;
const POLL_EVERY_MS = 3_000;
const POLL_FOR_MS = 3 * 60_000;
const COMPOSIO_URL = "https://app.composio.dev";

type Busy = { id: string; kind: "connect" | "disconnect" } | null;

/** Search over name, slug, description and categories; every word must match. */
export function appMatches(app: ComposioAppMeta, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = `${app.name} ${app.id} ${app.description} ${app.categories.join(" ")}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * Marketplace → Apps: every app Composio offers, with the owner's connected ones first.
 * Runs on Composio's free Hobby plan; the owner pastes their own key once.
 */
export function AppsPanel(props: { query: string; pollEveryMs?: number }) {
  const [status, setStatus] = createSignal<ComposioStatus | null>(null);
  const [apps, setApps] = createSignal<ComposioAppMeta[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [keyOpen, setKeyOpen] = createSignal(false);
  const [keyInput, setKeyInput] = createSignal("");
  const [savingKey, setSavingKey] = createSignal(false);
  const [busy, setBusy] = createSignal<Busy>(null);
  const [limit, setLimit] = createSignal(PAGE_SIZE);
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  async function refresh(force = false): Promise<void> {
    try {
      const [next, list] = await Promise.all([
        window.sahkarmi.composio.getStatus(),
        window.sahkarmi.composio.listApps(force),
      ]);
      if (disposed) return;
      setStatus(next);
      setApps(list);
      setError(null);
    } catch (cause) {
      if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!disposed) setLoading(false);
    }
  }

  onMount(() => void refresh());
  onCleanup(() => {
    disposed = true;
    clearTimeout(pollTimer);
  });

  const words = createMemo(() => props.query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  createEffect(on(words, () => setLimit(PAGE_SIZE), { defer: true }));
  const matching = createMemo(() => apps().filter((app) => appMatches(app, words())));
  const yours = createMemo(() => matching().filter((app) => app.isConnected));
  const more = createMemo(() => matching().filter((app) => !app.isConnected));
  const configured = () => status()?.configured === true;
  const quota = () =>
    new Intl.NumberFormat(speechLocale()).format(status()?.monthlyQuota ?? 100_000);

  async function saveKey(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const key = keyInput().trim();
    if (!key) return;
    setSavingKey(true);
    setError(null);
    try {
      setStatus(await window.sahkarmi.composio.setKey(key));
      setKeyInput("");
      setKeyOpen(false);
      setLoading(true);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingKey(false);
    }
  }

  async function connect(app: ComposioAppMeta): Promise<void> {
    setBusy({ id: app.id, kind: "connect" });
    setError(null);
    setNotice(null);
    try {
      const { connectionId, redirectUrl } = await window.sahkarmi.composio.connect(app.id);
      await window.sahkarmi.openUrl(redirectUrl);
      setNotice(t("appsSignInOpened", { name: app.name }));
      await waitForConnection(app.id, connectionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  /** Polls until Composio reports the account active, the sign-in failed, or three minutes pass. */
  function waitForConnection(appId: string, connectionId: string): Promise<void> {
    const deadline = Date.now() + POLL_FOR_MS;
    return new Promise((resolve) => {
      const finish = async (failed: boolean) => {
        setNotice(null);
        if (failed) setError(t("appsConnectFailed"));
        await refresh(true);
        resolve();
      };
      const tick = async () => {
        if (disposed) return resolve();
        try {
          if (connectionId) {
            const result = await window.sahkarmi.composio.connectionStatus(connectionId);
            if (result.state === "connected") return finish(false);
            if (result.state === "failed") return finish(true);
          } else {
            const list = await window.sahkarmi.composio.listApps(true);
            if (list.find((app) => app.id === appId)?.isConnected) return finish(false);
          }
        } catch {
          // Offline for a moment: try again on the next tick.
        }
        if (Date.now() >= deadline) return finish(false);
        pollTimer = setTimeout(() => void tick(), props.pollEveryMs ?? POLL_EVERY_MS);
      };
      pollTimer = setTimeout(() => void tick(), props.pollEveryMs ?? POLL_EVERY_MS);
    });
  }

  async function disconnect(app: ComposioAppMeta): Promise<void> {
    if (!app.connectedAccountId) return;
    if (!window.confirm(t("appsDisconnectConfirm", { name: app.name }))) return;
    setBusy({ id: app.id, kind: "disconnect" });
    setError(null);
    try {
      await window.sahkarmi.composio.disconnect(app.connectedAccountId);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="apps-panel">
      <div class="apps-plan">
        <span class="apps-plan-dot" aria-hidden="true" />
        <span>{t("appsPlan", { quota: quota() })}</span>
        <Show when={configured()}>
          <button type="button" class="marketplace-link" onClick={() => void refresh(true)}>
            {t("appsRefresh")}
          </button>
          <button
            type="button"
            class="marketplace-link"
            onClick={() => setKeyOpen((current) => !current)}
          >
            {t("appsKeyChange")}
          </button>
        </Show>
      </div>

      <Show when={!configured() || keyOpen()}>
        <form class="settings-card apps-key-card" onSubmit={(event) => void saveKey(event)}>
          <h2>{t("appsKeyTitle")}</h2>
          <p>{t("appsKeyIntro")}</p>
          <div class="apps-key-form">
            <input
              type="password"
              autocomplete="off"
              placeholder={t("appsKeyPlaceholder")}
              aria-label={t("appsKeyPlaceholder")}
              value={keyInput()}
              onInput={(event) => setKeyInput(event.currentTarget.value)}
            />
            <button
              type="submit"
              class="marketplace-action marketplace-action-primary"
              disabled={savingKey() || !keyInput().trim()}
            >
              {savingKey() ? t("appsKeySaving") : t("appsKeySave")}
            </button>
            <button
              type="button"
              class="marketplace-action marketplace-action-quiet"
              onClick={() => void window.sahkarmi.openUrl(COMPOSIO_URL)}
            >
              {t("appsOpenComposio")}
            </button>
          </div>
          <Show when={status()?.apiKeyMasked}>
            <small>{t("appsKeySaved", { key: status()?.apiKeyMasked ?? "" })}</small>
          </Show>
        </form>
      </Show>

      <p class="apps-note">{t("appsApprovalNote")}</p>

      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={notice()}>
        <p class="apps-notice" role="status">
          {notice()}
        </p>
      </Show>
      <Show when={configured() && status()?.catalogueError}>
        <p class="apps-note">{t("appsCatalogueOffline")}</p>
      </Show>

      <Show when={!loading()} fallback={<p class="center-view-empty">{t("appsLoading")}</p>}>
        <Show
          when={matching().length > 0}
          fallback={
            <p class="center-view-empty">
              {props.query.trim()
                ? t("appsNoResults", { query: props.query.trim() })
                : t("noMatches")}
            </p>
          }
        >
          <Show when={yours().length > 0}>
            <section class="marketplace-section" aria-label={t("appsYours")}>
              <header class="marketplace-section-head">
                <h2>{t("appsYours")}</h2>
              </header>
              <ul class="marketplace-grid">
                <For each={yours()}>
                  {(app) => (
                    <AppCard
                      app={app}
                      busy={busy()}
                      onConnect={() => void connect(app)}
                      onDisconnect={() => void disconnect(app)}
                    />
                  )}
                </For>
              </ul>
            </section>
          </Show>
          <Show when={more().length > 0}>
            <section class="marketplace-section" aria-label={t("appsMore")}>
              <header class="marketplace-section-head">
                <h2>{t("appsMore")}</h2>
                <span class="marketplace-count">
                  {t("appsCount", { count: String(more().length) })}
                </span>
              </header>
              <ul class="marketplace-grid">
                <For each={more().slice(0, limit())}>
                  {(app) => (
                    <AppCard
                      app={app}
                      busy={busy()}
                      onConnect={() => void connect(app)}
                      onDisconnect={() => void disconnect(app)}
                    />
                  )}
                </For>
              </ul>
              <Show when={more().length > limit()}>
                <button
                  type="button"
                  class="marketplace-more"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                >
                  {t("marketShowMore")}
                </button>
              </Show>
            </section>
          </Show>
        </Show>
      </Show>
    </div>
  );
}

function AppCard(props: {
  app: ComposioAppMeta;
  busy: Busy;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const [logoBroken, setLogoBroken] = createSignal(false);
  const isBusy = () => props.busy?.id === props.app.id;
  const category = () => props.app.categories[0] ?? "";
  return (
    <li class="marketplace-card apps-card">
      <div class="marketplace-card-head">
        <Show
          when={props.app.logo && !logoBroken()}
          fallback={
            <span class="apps-mark" aria-hidden="true">
              {props.app.name.charAt(0).toUpperCase()}
            </span>
          }
        >
          <img
            class="apps-logo"
            src={props.app.logo ?? ""}
            alt=""
            loading="lazy"
            onError={() => setLogoBroken(true)}
          />
        </Show>
        <div class="marketplace-card-title">
          <h3>{props.app.name}</h3>
          <Show when={props.app.toolsCount}>
            <small>{t("appsTools", { count: String(props.app.toolsCount ?? 0) })}</small>
          </Show>
        </div>
        <Show
          when={props.app.isConnected}
          fallback={
            <button
              type="button"
              class="marketplace-action marketplace-action-primary"
              disabled={isBusy()}
              onClick={() => props.onConnect()}
            >
              {isBusy() ? t("appsConnecting") : t("appsConnect")}
            </button>
          }
        >
          <span class="marketplace-badge marketplace-badge-connected">✓ {t("appsConnected")}</span>
        </Show>
      </div>
      <p>{props.app.description || t("appsNoDescription", { name: props.app.name })}</p>
      <div class="apps-card-foot">
        <small>{category()}</small>
        <Show when={!props.app.oneClick && !props.app.isConnected}>
          <span class="marketplace-badge marketplace-badge-setup">{t("appsNeedsOwnKeys")}</span>
        </Show>
        <Show when={props.app.isConnected}>
          <button
            type="button"
            class="marketplace-action marketplace-action-quiet"
            disabled={isBusy()}
            onClick={() => props.onDisconnect()}
          >
            {t("appsDisconnect")}
          </button>
        </Show>
      </div>
    </li>
  );
}
