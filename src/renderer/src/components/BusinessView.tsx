import { createSignal, For, onMount, Show } from "solid-js";
import type {
  BusinessIntegration,
  BusinessTarget,
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
  const [draft, setDraft] = createSignal<SaveBusinessTargetInput | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const [list, known] = await Promise.all([
        window.sahkarmi.business.listTargets(),
        window.sahkarmi.business.integrations(),
      ]);
      setTargets(list);
      setIntegrations(known);
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
          <h2 class="center-view-subheading">{t("integrationsTitle")}</h2>
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
        </Show>
      </div>
    </section>
  );
}
