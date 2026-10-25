import { createSignal, For, onMount, Show } from "solid-js";
import type {
  BusinessIntegration,
  BusinessTarget,
  ComposioAppMeta,
  ComposioStatus,
  IntegrationSupport,
  SaveBusinessTargetInput,
  TargetPeriod,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { featureOn } from "../features";
import { type MessageKey, t } from "../i18n";
import { speechLocale } from "../preferences";

const formatValue = (value: number) => new Intl.NumberFormat(speechLocale()).format(value);

const SUPPORT_LABELS: Record<IntegrationSupport, MessageKey> = {
  supported: "supportSupported",
  "manual-import": "supportManual",
  "browser-assisted": "supportBrowser",
  "not-supported": "supportNone",
};
const PERIODS: TargetPeriod[] = ["weekly", "monthly", "quarterly", "yearly"];
const PERIOD_LABELS: Record<TargetPeriod, MessageKey> = {
  weekly: "periodWeekly",
  monthly: "periodMonthly",
  quarterly: "periodQuarterly",
  yearly: "periodYearly",
};

const EMPTY: SaveBusinessTargetInput = {
  title: "",
  metric: "",
  unit: "",
  targetValue: 0,
  currentValue: null,
  period: "monthly",
  dueDate: null,
  botId: null,
  notes: "",
};

export function BusinessView(props: { bots: BotProfile[] }) {
  const [targets, setTargets] = createSignal<BusinessTarget[]>([]);
  const [integrations, setIntegrations] = createSignal<BusinessIntegration[]>([]);
  const [composioStatus, setComposioStatus] = createSignal<ComposioStatus | null>(null);
  const [composioApps, setComposioApps] = createSignal<ComposioAppMeta[]>([]);
  const [draft, setDraft] = createSignal<SaveBusinessTargetInput | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [showKeyModal, setShowKeyModal] = createSignal(false);
  const [apiKeyInput, setApiKeyInput] = createSignal("");
  const [expandedAppId, setExpandedAppId] = createSignal<string | null>(null);
  const [connectingAppId, setConnectingAppId] = createSignal<string | null>(null);

  const refreshComposio = async () => {
    try {
      if (window.sahkarmi.composio) {
        const [status, apps] = await Promise.all([
          window.sahkarmi.composio.getStatus(),
          window.sahkarmi.composio.listApps(),
        ]);
        setComposioStatus(status);
        setComposioApps(apps);
      }
    } catch {
      // composio offline or unconfigured
    }
  };

  onMount(async () => {
    try {
      const [list, known] = await Promise.all([
        window.sahkarmi.business.listTargets(),
        window.sahkarmi.business.integrations(),
      ]);
      setTargets(list);
      setIntegrations(known);
      await refreshComposio();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const value = draft();
    if (!value) return;
    try {
      setTargets(await window.sahkarmi.business.saveTarget(value));
      setDraft(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function remove(target: BusinessTarget) {
    if (!window.confirm(t("targetDeleteConfirm", { title: target.title }))) return;
    setTargets(await window.sahkarmi.business.deleteTarget(target.id));
  }

  async function handleSaveKey(event: SubmitEvent) {
    event.preventDefault();
    try {
      const status = await window.sahkarmi.composio.setKey(apiKeyInput());
      setComposioStatus(status);
      setShowKeyModal(false);
      setApiKeyInput("");
      await refreshComposio();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handleConnect(appId: string) {
    setConnectingAppId(appId);
    setError(null);
    try {
      const res = await window.sahkarmi.composio.connect(appId);
      if (res.redirectUrl) {
        await window.sahkarmi.openUrl(res.redirectUrl);
      }
      setTimeout(async () => {
        await refreshComposio();
        setConnectingAppId(null);
      }, 5000);
    } catch (cause) {
      setConnectingAppId(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handleDisconnect(connectionId?: string) {
    if (!connectionId) return;
    if (!window.confirm("Are you sure you want to disconnect this integration?")) return;
    try {
      await window.sahkarmi.composio.disconnect(connectionId);
      await refreshComposio();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const patch = (next: Partial<SaveBusinessTargetInput>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  return (
    <section class="center-view business-view" aria-labelledby="business-heading">
      <header class="center-view-header window-drag">
        <h1 id="business-heading">{t("navBusiness")}</h1>
        <div class="center-view-actions">
          <Show when={featureOn("business-targets")}>
            <button type="button" class="button-primary" onClick={() => setDraft({ ...EMPTY })}>
              {t("targetNew")}
            </button>
          </Show>
        </div>
      </header>
      <div class="center-view-body">
        <Show when={error()}>
          <p class="center-view-error" role="alert">
            {error()}
          </p>
        </Show>

        <Show when={featureOn("business-targets")}>
          <h2 class="center-view-subheading">
            {t("targetsTitle")} <span class="data-label data-label-owner">{t("labelOwner")}</span>
          </h2>
          <p class="center-view-intro">{t("targetsIntro")}</p>

          <Show when={draft()}>
            {(value) => (
              <form class="target-form settings-card" onSubmit={(event) => void save(event)}>
                <label>
                  <span>{t("targetName")}</span>
                  <input
                    required
                    maxLength={120}
                    value={value().title}
                    placeholder={t("targetNameExample")}
                    onInput={(event) => patch({ title: event.currentTarget.value })}
                  />
                </label>
                <div class="target-form-row">
                  <label>
                    <span>{t("targetMetric")}</span>
                    <input
                      value={value().metric}
                      placeholder={t("targetMetricExample")}
                      onInput={(event) => patch({ metric: event.currentTarget.value })}
                    />
                  </label>
                  <label>
                    <span>{t("targetUnit")}</span>
                    <input
                      value={value().unit}
                      placeholder="₹ / orders"
                      onInput={(event) => patch({ unit: event.currentTarget.value })}
                    />
                  </label>
                </div>
                <div class="target-form-row">
                  <label>
                    <span>{t("targetGoal")}</span>
                    <input
                      required
                      type="number"
                      min="0"
                      step="any"
                      value={value().targetValue || ""}
                      onInput={(event) => patch({ targetValue: Number(event.currentTarget.value) })}
                    />
                  </label>
                  <label>
                    <span>{t("targetProgress")}</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={value().currentValue ?? ""}
                      onInput={(event) =>
                        patch({
                          currentValue:
                            event.currentTarget.value === ""
                              ? null
                              : Number(event.currentTarget.value),
                        })
                      }
                    />
                  </label>
                </div>
                <div class="target-form-row">
                  <label>
                    <span>{t("targetPeriod")}</span>
                    <select
                      value={value().period}
                      onChange={(event) =>
                        patch({ period: event.currentTarget.value as TargetPeriod })
                      }
                    >
                      <For each={PERIODS}>
                        {(period) => <option value={period}>{t(PERIOD_LABELS[period])}</option>}
                      </For>
                    </select>
                  </label>
                  <label>
                    <span>{t("targetDue")}</span>
                    <input
                      type="date"
                      value={value().dueDate ?? ""}
                      onInput={(event) => patch({ dueDate: event.currentTarget.value || null })}
                    />
                  </label>
                  <label>
                    <span>{t("targetOwner")}</span>
                    <select
                      value={value().botId ?? ""}
                      onChange={(event) => patch({ botId: event.currentTarget.value || null })}
                    >
                      <option value="">{t("targetOwnerYou")}</option>
                      <For each={props.bots}>
                        {(bot) => <option value={bot.id}>{bot.name}</option>}
                      </For>
                    </select>
                  </label>
                </div>
                <label>
                  <span>{t("targetNotes")}</span>
                  <textarea
                    rows={2}
                    value={value().notes}
                    onInput={(event) => patch({ notes: event.currentTarget.value })}
                  />
                </label>
                <div class="settings-buttons">
                  <button type="button" onClick={() => setDraft(null)}>
                    {t("cancel")}
                  </button>
                  <button type="submit" class="button-primary">
                    {t("targetSave")}
                  </button>
                </div>
              </form>
            )}
          </Show>

          <Show
            when={targets().length > 0}
            fallback={<p class="center-view-empty">{t("targetsEmpty")}</p>}
          >
            <ul class="target-list">
              <For each={targets()}>
                {(target) => {
                  const percent = () =>
                    target.currentValue === null || target.targetValue <= 0
                      ? null
                      : Math.round((target.currentValue / target.targetValue) * 100);
                  return (
                    <li class="target-card settings-card">
                      <div class="target-card-head">
                        <h3>{target.title}</h3>
                        <span class="settings-meta">
                          {t(PERIOD_LABELS[target.period])}
                          <Show when={target.dueDate}>
                            {" "}
                            · {t("targetDueOn", { date: target.dueDate ?? "" })}
                          </Show>
                        </span>
                      </div>
                      <p class="target-numbers">
                        <strong>
                          {target.currentValue === null
                            ? t("targetNotReported")
                            : formatValue(target.currentValue)}
                        </strong>{" "}
                        / {formatValue(target.targetValue)} {target.unit}{" "}
                        <Show when={target.metric}>· {target.metric}</Show>
                      </p>
                      <Show when={percent() !== null}>
                        <div class="usage-meter target-meter" aria-hidden="true">
                          <span style={{ width: `${Math.min(100, percent() ?? 0)}%` }} />
                        </div>
                      </Show>
                      <Show when={target.botId}>
                        <p class="settings-meta">
                          {t("targetOwnedBy", {
                            name: props.bots.find((bot) => bot.id === target.botId)?.name ?? "—",
                          })}
                        </p>
                      </Show>
                      <Show when={target.notes}>
                        <p>{target.notes}</p>
                      </Show>
                      <div class="settings-buttons">
                        <button type="button" onClick={() => setDraft({ ...target })}>
                          {t("targetUpdate")}
                        </button>
                        <button
                          type="button"
                          class="button-danger-quiet"
                          onClick={() => void remove(target)}
                        >
                          {t("delete")}
                        </button>
                      </div>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>

        <Show when={featureOn("integrations")}>
          <div style={{ "margin-top": "24px" }}>
            <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "flex-wrap": "wrap", gap: "12px", "margin-bottom": "8px" }}>
              <div>
                <h2 class="center-view-subheading" style={{ margin: "0 0 4px" }}>Cloud Integrations & Tools</h2>
                <p class="center-view-intro" style={{ margin: 0 }}>
                  Empower your AI coworkers with direct, authenticated tool access to external services.
                </p>
              </div>
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span class="integration-support integration-support-supported" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981", border: "1px solid rgba(16, 185, 129, 0.3)" }}>
                  Composio Free Tier Active (100k calls/mo)
                </span>
                <button
                  type="button"
                  class="button-secondary"
                  onClick={() => setShowKeyModal(true)}
                  style={{ "font-size": "13px", padding: "4px 10px" }}
                >
                  {composioStatus()?.configured ? `API Key: ${composioStatus()?.apiKeyMasked}` : "Set API Key"}
                </button>
              </div>
            </div>

            <Show when={showKeyModal()}>
              <form class="target-form settings-card" onSubmit={handleSaveKey} style={{ "margin-bottom": "20px" }}>
                <h3>Configure Composio API Key</h3>
                <p class="settings-meta" style={{ "margin-bottom": "12px" }}>
                  Get your free API key from{" "}
                  <a
                    href="https://app.composio.dev"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      void window.sahkarmi.openUrl("https://app.composio.dev");
                    }}
                    style={{ color: "var(--primary)", "text-decoration": "underline" }}
                  >
                    app.composio.dev
                  </a>{" "}
                  (includes 100,000 tool calls/month free forever).
                </p>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="password"
                    placeholder="Enter your Composio API key"
                    required
                    value={apiKeyInput()}
                    onInput={(e) => setApiKeyInput(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" class="button-primary">Save Key</button>
                  <button type="button" onClick={() => setShowKeyModal(false)}>Cancel</button>
                </div>
              </form>
            </Show>

            <div style={{ "margin-bottom": "16px", padding: "10px 14px", "border-radius": "8px", background: "rgba(99, 102, 241, 0.08)", border: "1px solid rgba(99, 102, 241, 0.2)", display: "flex", "align-items": "center", gap: "8px" }}>
              <span style={{ "font-size": "16px" }}>🛡️</span>
              <span style={{ "font-size": "12px", color: "var(--text-secondary)" }}>
                <strong>Zero-Spam Approval Gate:</strong> Sensitive actions (sending emails, posting Slack messages, merging pull requests) require explicit approval before coworkers can execute them.
              </span>
            </div>

            <ul class="integration-list">
              <For each={composioApps()}>
                {(app) => (
                  <li class="settings-card integration-card" style={{ display: "flex", "flex-direction": "column", "justify-content": "space-between" }}>
                    <div>
                      <div class="target-card-head" style={{ "margin-bottom": "8px" }}>
                        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                          <span style={{ "font-weight": 700, "font-size": "15px" }}>{app.name}</span>
                          <span class="settings-meta" style={{ "font-size": "11px", "text-transform": "uppercase" }}>{app.category}</span>
                        </div>
                        <span
                          class="integration-support"
                          style={{
                            background: app.isConnected ? "rgba(16, 185, 129, 0.15)" : "rgba(107, 114, 128, 0.15)",
                            color: app.isConnected ? "#10b981" : "var(--text-muted)",
                          }}
                        >
                          {app.isConnected ? "Connected" : "Available"}
                        </span>
                      </div>
                      <p style={{ "font-size": "13px", color: "var(--text-secondary)", margin: "0 0 12px" }}>{app.description}</p>
                    </div>

                    <div>
                      <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-top": "8px" }}>
                        <button
                          type="button"
                          class="button-text"
                          onClick={() => setExpandedAppId(expandedAppId() === app.id ? null : app.id)}
                          style={{ "font-size": "12px", padding: 0, color: "var(--primary)" }}
                        >
                          {expandedAppId() === app.id ? "Hide Tools" : `View Tools (${app.popularActions.length})`}
                        </button>
                        <Show
                          when={app.isConnected}
                          fallback={
                            <button
                              type="button"
                              class="button-primary"
                              disabled={connectingAppId() === app.id}
                              onClick={() => void handleConnect(app.id)}
                              style={{ "font-size": "12px", padding: "4px 12px" }}
                            >
                              {connectingAppId() === app.id ? "Connecting..." : "Connect"}
                            </button>
                          }
                        >
                          <button
                            type="button"
                            class="button-danger-quiet"
                            onClick={() => void handleDisconnect(app.connectedAccountId)}
                            style={{ "font-size": "12px", padding: "4px 10px" }}
                          >
                            Disconnect
                          </button>
                        </Show>
                      </div>

                      <Show when={expandedAppId() === app.id}>
                        <div style={{ "margin-top": "10px", padding: "8px", "border-radius": "6px", background: "var(--bg-secondary, rgba(0,0,0,0.03))" }}>
                          <span class="settings-meta" style={{ "font-size": "11px", display: "block", "margin-bottom": "4px" }}>Available Actions:</span>
                          <ul style={{ margin: 0, "padding-left": "16px", "font-size": "12px" }}>
                            <For each={app.popularActions}>
                              {(action) => (
                                <li style={{ "margin-bottom": "3px" }}>
                                  <strong>{action.displayName}</strong>
                                  <Show when={action.isSensitive}>
                                    <span style={{ "margin-left": "4px", color: "#f59e0b", "font-size": "10px" }}>(Needs Approval)</span>
                                  </Show>
                                </li>
                              )}
                            </For>
                          </ul>
                        </div>
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </div>

          <div style={{ "margin-top": "32px" }}>
            <h2 class="center-view-subheading">{t("integrationsTitle")} (Manual & Portals)</h2>
            <p class="center-view-intro">{t("integrationsIntro")}</p>
            <ul class="integration-list">
              <For each={integrations()}>
                {(integration) => (
                  <li class="settings-card integration-card">
                    <div class="target-card-head">
                      <h3>{integration.name}</h3>
                      <span class={`integration-support integration-support-${integration.support}`}>
                        {t(SUPPORT_LABELS[integration.support])}
                      </span>
                    </div>
                    <p>{integration.summary}</p>
                    <dl>
                      <dt>{t("integrationAccess")}</dt>
                      <dd>{integration.accessNeeded}</dd>
                      <dt>{t("integrationToday")}</dt>
                      <dd>{integration.workaround}</dd>
                    </dl>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>
      </div>
    </section>
  );
}
