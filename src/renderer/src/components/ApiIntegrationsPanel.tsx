import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
  ApiAccess,
  ApiActivityEntry,
  ApiIntegrationPatch,
  ApiIntegrationStatus,
  ApiIntegrationSummary,
  ApiMissingField,
  ApiTestId,
  ApiTestResult,
  BotSummary,
  WorkspaceSummary,
} from "../../../shared/ipc";
import { PROVIDER_LABELS } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";
import { speechLocale } from "../preferences";
import { assignableEngines } from "./AssignAccess";

/** Electron wraps errors from the main process; the owner only needs the message itself. */
function plainError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "");
}

const STATUS_KEYS: Record<ApiIntegrationStatus, MessageKey> = {
  "needs-info": "apisStatusNeedsInfo",
  "ready-to-test": "apisStatusReadyToTest",
  tested: "apisStatusTested",
  failed: "apisStatusFailed",
  active: "apisStatusActive",
  disabled: "apisStatusDisabled",
};

const TEST_KEYS: Record<ApiTestId, MessageKey> = {
  auth: "apisTestAuth",
  connectivity: "apisTestConnectivity",
  endpoint: "apisTestEndpoint",
  request: "apisTestRequest",
  parsing: "apisTestParsing",
  permissions: "apisTestPermissions",
  errors: "apisTestErrors",
};

const OUTCOME: Record<ApiTestResult["outcome"], { icon: string; key: MessageKey }> = {
  passed: { icon: "✓", key: "apisOutcomePassed" },
  failed: { icon: "✕", key: "apisOutcomeFailed" },
  skipped: { icon: "–", key: "apisOutcomeSkipped" },
};

const FIELD_KEYS: Record<ApiMissingField, MessageKey> = {
  provider: "apisFieldProvider",
  baseUrl: "apisFieldBaseUrl",
  example: "apisFieldExample",
};

const FIELD_PLACEHOLDERS: Record<ApiMissingField, string> = {
  provider: "OpenWeather",
  baseUrl: "https://api.example.com/v1",
  example: "https://api.example.com/v1/weather?city=Kolkata",
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(speechLocale()) : "");

/** Search over name, provider and address; every word must match. */
export function apiMatches(api: ApiIntegrationSummary, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = `${api.name} ${api.provider ?? ""} ${api.baseUrl ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** Nobody may use an API until the owner picks at least one of these. */
export function accessChosen(access: ApiAccess): boolean {
  return (
    access.everyone ||
    access.ceo ||
    access.botIds.length > 0 ||
    access.workspaceIds.length > 0 ||
    (access.providers?.length ?? 0) > 0
  );
}

/**
 * Marketplace → APIs: the owner pastes any API key, Sahkarmi works out how the API is used,
 * tests it honestly, and only the coworkers the owner chooses may call it.
 */
export function ApiIntegrationsPanel(props: { query: string }) {
  const [apis, setApis] = createSignal<ApiIntegrationSummary[]>([]);
  const [bots, setBots] = createSignal<BotSummary[]>([]);
  const [workspaces, setWorkspaces] = createSignal<WorkspaceSummary[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [apiKey, setApiKey] = createSignal("");
  const [name, setName] = createSignal("");
  const [docsUrl, setDocsUrl] = createSignal("");
  const [specUrl, setSpecUrl] = createSignal("");
  const [discovering, setDiscovering] = createSignal(false);
  let disposed = false;

  onMount(() => {
    void (async () => {
      try {
        const list = await window.sahkarmi.apis.list();
        if (!disposed) setApis(list);
      } catch (cause) {
        if (!disposed) setError(plainError(cause));
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    void window.sahkarmi.agent
      .listBots()
      .then((list) => !disposed && setBots(list))
      .catch(() => undefined);
    void window.sahkarmi.team
      .listWorkspaces()
      .then((state) => !disposed && setWorkspaces(state.workspaces))
      .catch(() => undefined);
  });
  onCleanup(() => {
    disposed = true;
  });

  const words = createMemo(() => props.query.trim().toLowerCase().split(/\s+/).filter(Boolean));
  const shown = createMemo(() => apis().filter((api) => apiMatches(api, words())));
  const shownIds = createMemo(() => shown().map((api) => api.id));
  const byId = (id: string) => apis().find((api) => api.id === id);

  function replace(next: ApiIntegrationSummary): void {
    setApis((current) => {
      const index = current.findIndex((api) => api.id === next.id);
      if (index < 0) return [next, ...current];
      const copy = current.slice();
      copy[index] = next;
      return copy;
    });
  }

  async function discover(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const key = apiKey().trim();
    if (!key || discovering()) return;
    setDiscovering(true);
    setError(null);
    try {
      const next = await window.sahkarmi.apis.discover({
        apiKey: key,
        ...(name().trim() ? { name: name().trim() } : {}),
        ...(docsUrl().trim() ? { docsUrl: docsUrl().trim() } : {}),
        ...(specUrl().trim() ? { specUrl: specUrl().trim() } : {}),
      });
      if (disposed) return;
      replace(next);
      setApiKey("");
      setName("");
      setDocsUrl("");
      setSpecUrl("");
    } catch (cause) {
      if (!disposed) setError(plainError(cause));
    } finally {
      if (!disposed) setDiscovering(false);
    }
  }

  return (
    <div class="apps-panel apis-panel">
      <form class="settings-card apis-add-card" onSubmit={(event) => void discover(event)}>
        <h2>{t("apisAddTitle")}</h2>
        <p>{t("apisAddWhy")}</p>
        <div class="apps-key-form">
          <input
            type="password"
            autocomplete="off"
            required
            placeholder={t("apisKeyPlaceholder")}
            aria-label={t("apisKeyPlaceholder")}
            value={apiKey()}
            disabled={discovering()}
            onInput={(event) => setApiKey(event.currentTarget.value)}
          />
          <button
            type="submit"
            class="marketplace-action marketplace-action-primary"
            disabled={discovering() || !apiKey().trim()}
          >
            {discovering() ? t("apisDiscovering") : t("apisDiscover")}
          </button>
        </div>
        <details class="apis-more">
          <summary>{t("apisMore")}</summary>
          <div class="apis-fields">
            <label>
              <span>{t("apisProviderLabel")}</span>
              <input
                type="text"
                placeholder={t("apisProviderPlaceholder")}
                value={name()}
                disabled={discovering()}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{t("apisDocsLabel")}</span>
              <input
                type="url"
                placeholder="https://"
                value={docsUrl()}
                disabled={discovering()}
                onInput={(event) => setDocsUrl(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>{t("apisSpecLabel")}</span>
              <input
                type="url"
                placeholder="https://"
                value={specUrl()}
                disabled={discovering()}
                onInput={(event) => setSpecUrl(event.currentTarget.value)}
              />
            </label>
          </div>
        </details>
        <Show when={discovering()}>
          <p class="apps-notice" role="status">
            {t("apisDiscoveringNote")}
          </p>
        </Show>
        <small class="apps-note">{t("apisKeyMaskedNote")}</small>
      </form>

      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={!loading()} fallback={<p class="center-view-empty">{t("apisLoading")}</p>}>
        <Show
          when={shown().length > 0}
          fallback={
            <p class="center-view-empty">
              {apis().length > 0
                ? t("apisNoResults", { query: props.query.trim() })
                : t("apisEmpty")}
            </p>
          }
        >
          <section class="marketplace-section" aria-label={t("apisYours")}>
            <header class="marketplace-section-head">
              <h2>{t("apisYours")}</h2>
            </header>
            <ul class="apis-list">
              {/* Keyed by id so a card keeps its own state when the backend returns a new copy. */}
              <For each={shownIds()}>
                {(id) => (
                  <ApiCard
                    api={byId(id) as ApiIntegrationSummary}
                    bots={bots()}
                    workspaces={workspaces()}
                    onChange={replace}
                    onRemoved={(id) =>
                      setApis((current) => current.filter((item) => item.id !== id))
                    }
                  />
                )}
              </For>
            </ul>
          </section>
        </Show>
      </Show>
    </div>
  );
}

type CardBusy = "update" | "tests" | "activate" | "enable" | "access" | "remove" | null;

function ApiCard(props: {
  api: ApiIntegrationSummary;
  bots: BotSummary[];
  workspaces: WorkspaceSummary[];
  onChange: (next: ApiIntegrationSummary) => void;
  onRemoved: (id: string) => void;
}) {
  const [busy, setBusy] = createSignal<CardBusy>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [answers, setAnswers] = createSignal<Partial<Record<ApiMissingField, string>>>({});
  const [linkDocs, setLinkDocs] = createSignal("");
  const [linkSpec, setLinkSpec] = createSignal("");
  const [access, setAccess] = createSignal<ApiAccess>(copyAccess(props.api.access));
  const [accessSaved, setAccessSaved] = createSignal(false);
  const [confirmRemove, setConfirmRemove] = createSignal(false);
  const [activity, setActivity] = createSignal<ApiActivityEntry[] | null>(null);

  const api = () => props.api;
  const status = () => api().status;
  const number = (value: number) => new Intl.NumberFormat(speechLocale()).format(value);
  const botName = (id: string | null) =>
    id === null
      ? t("apisActivityTest")
      : (props.bots.find((bot) => bot.id === id)?.name ?? t("apisActivityUnknown"));
  const canTest = () => api().missing.length === 0 && status() !== "needs-info";
  const showAccess = () => ["tested", "active", "disabled"].includes(status());
  const accessDirty = () => JSON.stringify(access()) !== JSON.stringify(copyAccess(api().access));

  async function act(kind: Exclude<CardBusy, null>, action: () => Promise<void>): Promise<void> {
    if (busy()) return;
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(plainError(cause));
    } finally {
      setBusy(null);
    }
  }

  function submitMissing(event: SubmitEvent): void {
    event.preventDefault();
    const patch: ApiIntegrationPatch = {};
    for (const field of api().missing) {
      const value = answers()[field]?.trim();
      if (value) patch[field] = value;
    }
    if (linkDocs().trim()) patch.docsUrl = linkDocs().trim();
    if (linkSpec().trim()) patch.specUrl = linkSpec().trim();
    if (Object.keys(patch).length === 0) return;
    void act("update", async () => {
      props.onChange(await window.sahkarmi.apis.update(api().id, patch));
      setAnswers({});
      setLinkDocs("");
      setLinkSpec("");
    });
  }

  function toggleList(
    list: "botIds" | "workspaceIds" | "providers",
    id: string,
    checked: boolean,
  ): void {
    setAccessSaved(false);
    setAccess((current) => {
      const items = current[list] ?? [];
      return {
        ...current,
        [list]: checked
          ? [...items.filter((item) => item !== id), id]
          : items.filter((item) => item !== id),
      };
    });
  }
  // Engines the owner's coworkers run on (Claude, Codex, Antigravity…): give it to all of one.
  const engines = () => assignableEngines(props.bots);

  function saveAccess(): void {
    void act("access", async () => {
      const next = await window.sahkarmi.apis.setAccess(api().id, access());
      props.onChange(next);
      setAccess(copyAccess(next.access));
      setAccessSaved(true);
    });
  }

  async function loadActivity(): Promise<void> {
    try {
      setActivity(await window.sahkarmi.apis.activity(api().id));
    } catch (cause) {
      setActivity([]);
      setError(plainError(cause));
    }
  }

  return (
    <li class="settings-card apis-card" aria-label={api().name}>
      <div class="marketplace-card-head apis-card-head">
        <span class="apps-mark" aria-hidden="true">
          {api().name.charAt(0).toUpperCase()}
        </span>
        <div class="marketplace-card-title">
          <h3>{api().name}</h3>
          <Show when={api().provider}>
            <small>{api().provider}</small>
          </Show>
        </div>
        <span class={`marketplace-badge apis-status apis-status-${status()}`}>
          {t(STATUS_KEYS[status()])}
        </span>
      </div>

      <dl class="apis-facts">
        <dt>{t("apisKeyLabel")}</dt>
        <dd>
          <code>{api().keyMasked}</code>
        </dd>
        <dt>{t("apisBaseLabel")}</dt>
        <dd>
          <Show when={api().baseUrl} fallback={t("apisBaseUnknown")}>
            <code>{api().baseUrl}</code>
          </Show>
        </dd>
      </dl>

      <Show when={api().notes.length > 0}>
        <details class="apis-details">
          <summary>{t("apisFound")}</summary>
          <ul class="apis-notes">
            <For each={api().notes}>{(note) => <li>{note}</li>}</For>
          </ul>
          <dl class="apis-facts">
            <dt>{t("apisAuthLabel")}</dt>
            <dd>
              <code>
                {api().auth.kind}
                {api().auth.name ? ` · ${api().auth.name}` : ""}
              </code>
            </dd>
            <Show when={api().testRequest}>
              <dt>{t("apisTestRequestLabel")}</dt>
              <dd>
                <code>{api().testRequest}</code>
              </dd>
            </Show>
            <Show when={api().docsUrl}>
              <dt>{t("apisDocsLink")}</dt>
              <dd>
                <code>{api().docsUrl}</code>
              </dd>
            </Show>
            <Show when={api().specUrl}>
              <dt>{t("apisSpecLink")}</dt>
              <dd>
                <code>{api().specUrl}</code>
              </dd>
            </Show>
          </dl>
        </details>
      </Show>

      <Show when={api().missing.length > 0}>
        <form
          class="apis-missing"
          aria-label={t("apisMissingTitle")}
          onSubmit={(event) => submitMissing(event)}
        >
          <strong>{t("apisMissingTitle")}</strong>
          <p>{t("apisMissingWhy")}</p>
          <div class="apis-fields">
            <For each={api().missing}>
              {(field) => (
                <label>
                  <span>{t(FIELD_KEYS[field])}</span>
                  <input
                    type={field === "provider" ? "text" : "url"}
                    required
                    placeholder={FIELD_PLACEHOLDERS[field]}
                    value={answers()[field] ?? ""}
                    onInput={(event) => {
                      const value = event.currentTarget.value;
                      setAnswers((current) => ({ ...current, [field]: value }));
                    }}
                  />
                </label>
              )}
            </For>
          </div>
          <details class="apis-more">
            <summary>{t("apisMissingLinks")}</summary>
            <div class="apis-fields">
              <label>
                <span>{t("apisDocsLabel")}</span>
                <input
                  type="url"
                  placeholder="https://"
                  value={linkDocs()}
                  onInput={(event) => setLinkDocs(event.currentTarget.value)}
                />
              </label>
              <label>
                <span>{t("apisSpecLabel")}</span>
                <input
                  type="url"
                  placeholder="https://"
                  value={linkSpec()}
                  onInput={(event) => setLinkSpec(event.currentTarget.value)}
                />
              </label>
            </div>
          </details>
          <div class="marketplace-actions">
            <button
              type="submit"
              class="marketplace-action marketplace-action-primary"
              disabled={busy() !== null}
            >
              {busy() === "update" ? t("apisSaving") : t("apisMissingSave")}
            </button>
          </div>
        </form>
      </Show>

      <Show when={canTest()}>
        <section class="apis-tests" aria-label={t("apisTestsTitle")}>
          <div class="apis-row">
            <strong>{t("apisTestsTitle")}</strong>
            <Show when={api().testedAt}>
              <small class="apps-note">{t("apisTestedAt", { date: when(api().testedAt) })}</small>
            </Show>
            <button
              type="button"
              class="marketplace-action"
              disabled={busy() !== null}
              onClick={() =>
                void act("tests", async () =>
                  props.onChange(await window.sahkarmi.apis.runTests(api().id)),
                )
              }
            >
              {busy() === "tests"
                ? t("apisTesting")
                : api().tests.length > 0
                  ? t("apisRunTestsAgain")
                  : t("apisRunTests")}
            </button>
          </div>
          <Show
            when={api().tests.length > 0}
            fallback={<p class="apps-note">{t("apisTestsNone")}</p>}
          >
            <ul class="apis-test-list">
              <For each={api().tests}>
                {(test) => (
                  <li class={`apis-test apis-test-${test.outcome}`}>
                    <span class="apis-test-icon" aria-hidden="true">
                      {OUTCOME[test.outcome].icon}
                    </span>
                    <span class="apis-test-text">
                      <strong>{t(TEST_KEYS[test.id])}</strong>
                      <span class="apis-test-outcome">{t(OUTCOME[test.outcome].key)}</span>
                      <Show when={test.detail}>
                        <small>{test.detail}</small>
                      </Show>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={status() === "failed"}>
            <p class="apps-note">{t("apisTestsFailedNote")}</p>
          </Show>
        </section>
      </Show>

      <Show when={status() === "tested"}>
        <div class="apps-notice apis-ready">
          <p>{t("apisReadySummary")}</p>
          <div class="marketplace-actions">
            <button
              type="button"
              class="marketplace-action marketplace-action-primary"
              disabled={busy() !== null}
              onClick={() =>
                void act("activate", async () =>
                  props.onChange(await window.sahkarmi.apis.activate(api().id)),
                )
              }
            >
              {busy() === "activate" ? t("apisActivating") : t("apisActivate")}
            </button>
          </div>
        </div>
      </Show>

      <Show when={showAccess()}>
        <fieldset class="apis-access">
          <legend>{t("apisAccessTitle")}</legend>
          <Show when={!accessChosen(access())}>
            <p class="apps-note">{t("apisAccessNobody")}</p>
          </Show>
          <label>
            <input
              type="checkbox"
              checked={access().everyone}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setAccessSaved(false);
                setAccess((current) => ({ ...current, everyone: checked }));
              }}
            />
            {t("apisAccessEveryone")}
          </label>
          <label>
            <input
              type="checkbox"
              checked={access().ceo}
              disabled={access().everyone}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setAccessSaved(false);
                setAccess((current) => ({ ...current, ceo: checked }));
              }}
            />
            {t("apisAccessCeo")}
          </label>
          <Show when={engines().length > 0}>
            <small class="apis-access-group">{t("accessEngines")}</small>
            <For each={engines()}>
              {(engine) => (
                <label>
                  <input
                    type="checkbox"
                    checked={(access().providers ?? []).includes(engine)}
                    disabled={access().everyone}
                    onChange={(event) =>
                      toggleList("providers", engine, event.currentTarget.checked)
                    }
                  />
                  {t("accessEngine", { name: PROVIDER_LABELS[engine] })}
                </label>
              )}
            </For>
          </Show>
          <Show when={props.workspaces.length > 0}>
            <small class="apis-access-group">{t("apisAccessWorkspaces")}</small>
            <For each={props.workspaces}>
              {(workspace) => (
                <label>
                  <input
                    type="checkbox"
                    checked={access().workspaceIds.includes(workspace.id)}
                    disabled={access().everyone}
                    onChange={(event) =>
                      toggleList("workspaceIds", workspace.id, event.currentTarget.checked)
                    }
                  />
                  {t("apisAccessWorkspace", { name: workspace.name })}
                </label>
              )}
            </For>
          </Show>
          <Show when={props.bots.length > 0}>
            <small class="apis-access-group">{t("apisAccessBots")}</small>
            <For each={props.bots}>
              {(bot) => (
                <label>
                  <input
                    type="checkbox"
                    checked={access().botIds.includes(bot.id)}
                    disabled={access().everyone}
                    onChange={(event) => toggleList("botIds", bot.id, event.currentTarget.checked)}
                  />
                  {bot.name}
                </label>
              )}
            </For>
          </Show>
          <div class="apis-row">
            <button
              type="button"
              class="marketplace-action"
              disabled={busy() !== null || !accessDirty()}
              onClick={saveAccess}
            >
              {busy() === "access" ? t("apisSaving") : t("apisAccessSave")}
            </button>
            <Show when={accessSaved() && !accessDirty()}>
              <small class="apps-note" role="status">
                {t("apisAccessSaved")}
              </small>
            </Show>
          </div>
        </fieldset>
      </Show>

      <details class="apis-details">
        <summary>{t("apisEndpoints", { count: number(api().operationTotal) })}</summary>
        <Show
          when={api().operations.length > 0}
          fallback={<p class="apps-note">{t("apisEndpointsNone")}</p>}
        >
          <ul class="apis-ops">
            <For each={api().operations}>
              {(operation) => (
                <li>
                  <code class="apis-method">{operation.method.toUpperCase()}</code>
                  <code>{operation.path}</code>
                  <Show when={operation.risky}>
                    <span class="marketplace-badge marketplace-badge-setup">{t("apisRisky")}</span>
                  </Show>
                  <Show when={operation.summary}>
                    <small>{operation.summary}</small>
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={api().operationTotal > api().operations.length}>
            <p class="apps-note">
              {t("apisEndpointsShown", {
                shown: number(api().operations.length),
                total: number(api().operationTotal),
              })}
            </p>
          </Show>
        </Show>
      </details>

      <p class="apps-note">
        {api().calls > 0
          ? t("apisUsage", {
              calls: number(api().calls),
              errors: number(api().errors),
              date: when(api().lastUsedAt),
            })
          : t("apisUsageNever")}
      </p>

      <details
        class="apis-details"
        onToggle={(event) => {
          if (event.currentTarget.open) void loadActivity();
        }}
      >
        <summary>{t("apisActivity")}</summary>
        <Show when={activity()} fallback={<p class="apps-note">{t("apisActivityLoading")}</p>}>
          {(entries) => (
            <Show
              when={entries().length > 0}
              fallback={<p class="apps-note">{t("apisActivityEmpty")}</p>}
            >
              <table class="apis-activity">
                <thead>
                  <tr>
                    <th>{t("apisActivityTime")}</th>
                    <th>{t("apisActivityWho")}</th>
                    <th>{t("apisActivityOperation")}</th>
                    <th>{t("apisActivityStatus")}</th>
                    <th>{t("apisActivityMs")}</th>
                    <th>{t("apisActivityError")}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={entries()}>
                    {(entry) => (
                      <tr classList={{ "apis-activity-failed": !entry.ok }}>
                        <td>{when(entry.at)}</td>
                        <td>{botName(entry.botId)}</td>
                        <td>
                          <code>{entry.operation}</code>
                        </td>
                        <td>{entry.status ?? "—"}</td>
                        <td>{t("apisMs", { ms: number(entry.ms) })}</td>
                        <td>{entry.error ?? ""}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          )}
        </Show>
      </details>

      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>

      <Show when={confirmRemove()}>
        <div class="marketplace-confirm" role="alert">
          <span>{t("apisRemoveConfirm", { name: api().name })}</span>
          <div class="marketplace-actions">
            <button
              type="button"
              class="marketplace-action"
              onClick={() => setConfirmRemove(false)}
            >
              {t("cancel")}
            </button>
            <button
              type="button"
              class="marketplace-action marketplace-action-primary"
              disabled={busy() !== null}
              onClick={() =>
                void act("remove", async () => {
                  await window.sahkarmi.apis.revoke(api().id);
                  setConfirmRemove(false);
                  props.onRemoved(api().id);
                })
              }
            >
              {busy() === "remove" ? t("apisRemoving") : t("apisRemove")}
            </button>
          </div>
        </div>
      </Show>

      <div class="marketplace-actions apis-controls">
        <Show when={status() === "active" || status() === "disabled"}>
          <button
            type="button"
            class="marketplace-action"
            disabled={busy() !== null}
            onClick={() =>
              void act("enable", async () =>
                props.onChange(
                  await window.sahkarmi.apis.setEnabled(api().id, status() === "disabled"),
                ),
              )
            }
          >
            {status() === "disabled" ? t("apisEnable") : t("apisDisable")}
          </button>
        </Show>
        <button
          type="button"
          class="marketplace-action marketplace-action-quiet"
          disabled={busy() !== null || confirmRemove()}
          onClick={() => setConfirmRemove(true)}
        >
          {t("apisRemove")}
        </button>
      </div>
    </li>
  );
}

function copyAccess(access: ApiAccess): ApiAccess {
  return {
    everyone: access.everyone,
    ceo: access.ceo,
    botIds: [...access.botIds],
    workspaceIds: [...access.workspaceIds],
    providers: [...(access.providers ?? [])],
  };
}
