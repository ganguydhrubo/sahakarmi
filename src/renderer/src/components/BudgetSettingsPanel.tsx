import { createSignal, For, onMount, Show } from "solid-js";
import type { BotSummary, BudgetSettings, SetBudgetInput } from "../../../shared/ipc";
import { featureOn } from "../features";
import { t } from "../i18n";

/**
 * Settings > Features > Work limits: replies a day per coworker and steps per team run.
 * An empty box means no limit, which is how every coworker starts.
 */
export function BudgetSettingsPanel() {
  const [budgets, setBudgets] = createSignal<BudgetSettings | null>(null);
  const [bots, setBots] = createSignal<BotSummary[]>([]);
  const [saved, setSaved] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    const api = window.sahkarmi?.orchestrator;
    if (!api?.getBudgets) return;
    void api
      .getBudgets()
      .then(setBudgets)
      .catch(() => undefined);
    void window.sahkarmi?.agent
      ?.listBots?.()
      .then(setBots)
      .catch(() => undefined);
  });

  async function save(patch: SetBudgetInput) {
    const api = window.sahkarmi?.orchestrator;
    if (!api?.setBudgets) return;
    try {
      setBudgets(await api.setBudgets(patch));
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  /** Empty or 0 clears the limit; anything else must be a whole number. */
  function limitFrom(event: Event & { currentTarget: HTMLInputElement }): number | null {
    const raw = event.currentTarget.value.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
  }

  return (
    <Show when={budgets()}>
      {(current) => (
        <section class="engine-settings budget-settings" aria-label={t("budgetTitle")}>
          <h3>{t("budgetTitle")}</h3>
          <p class="settings-meta">{t("budgetIntro")}</p>
          <Show when={!featureOn("budget-stop")}>
            <p class="settings-meta" role="note">
              {t("budgetOff")}
            </p>
          </Show>
          <label class="engine-setting">
            <span>{t("budgetTeamRunLabel")}</span>
            <input
              type="number"
              min={1}
              placeholder={t("budgetNoLimit")}
              value={current().teamRunSteps ?? ""}
              onChange={(event) => void save({ teamRunSteps: limitFrom(event) })}
            />
          </label>
          <For each={bots()}>
            {(bot) => (
              <label class="engine-setting">
                <span>
                  {bot.name} · {t("budgetCoworkerLabel")}
                </span>
                <input
                  type="number"
                  min={1}
                  placeholder={t("budgetNoLimit")}
                  value={current().coworkers[bot.id] ?? ""}
                  onChange={(event) =>
                    void save({ coworkers: { [bot.id]: limitFrom(event) } })
                  }
                />
                <Show when={current().coworkers[bot.id] !== undefined}>
                  <small class="settings-meta">
                    {t("budgetUsedToday", { used: String(current().usedToday[bot.id] ?? 0) })}
                  </small>
                </Show>
              </label>
            )}
          </For>
          <Show when={saved()}>
            <p class="settings-meta" role="status">
              {t("budgetSaved")}
            </p>
          </Show>
          <Show when={error()}>
            <p class="center-view-error" role="alert">
              {error()}
            </p>
          </Show>
        </section>
      )}
    </Show>
  );
}
