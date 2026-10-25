import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import {
  PERMISSION_CATEGORIES,
  type PermissionAuditEntry,
  type PermissionCategory,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { speechLocale } from "../preferences";
import { permissionCategoryLabel } from "./PermissionsSettings";

const DECISION_LABELS: Record<PermissionAuditEntry["decision"], MessageKey> = {
  allowed: "decisionAllowed",
  denied: "decisionDenied",
  approved: "approved",
  rejected: "rejected",
  "timed-out": "decisionTimedOut",
};

/** The permission audit log: what coworkers tried, and what the policy or the owner decided. */
export function ActivityView(props: { bots: BotProfile[] }) {
  const [entries, setEntries] = createSignal<PermissionAuditEntry[]>([]);
  const [category, setCategory] = createSignal<PermissionCategory | "">("");
  const [onlyBlocked, setOnlyBlocked] = createSignal(false);

  const load = async () => setEntries(await window.sahkarmi.permissions.audit());
  onMount(() => void load());

  const visible = createMemo(() =>
    entries().filter(
      (entry) =>
        (!category() || entry.category === category()) &&
        (!onlyBlocked() || ["denied", "rejected", "timed-out"].includes(entry.decision)),
    ),
  );

  function exportCsv() {
    const header = [
      "time",
      "coworker",
      "provider",
      "category",
      "action",
      "level",
      "decision",
      "reason",
    ];
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = visible().map((entry) =>
      [
        entry.at,
        props.bots.find((bot) => bot.id === entry.botId)?.name ?? entry.botId ?? "",
        entry.provider,
        entry.category,
        entry.action,
        entry.level,
        entry.decision,
        entry.reason,
      ]
        .map(quote)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `sahkarmi-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function clear() {
    if (!window.confirm(t("activityClearConfirm"))) return;
    await window.sahkarmi.permissions.clearAudit();
    await load();
  }

  return (
    <section class="center-view activity-view" aria-labelledby="activity-heading">
      <header class="center-view-header window-drag">
        <h1 id="activity-heading">{t("navActivity")}</h1>
        <div class="center-view-actions">
          <button type="button" onClick={() => void load()}>
            {t("usageRefresh")}
          </button>
          <button type="button" disabled={visible().length === 0} onClick={exportCsv}>
            {t("activityExport")}
          </button>
        </div>
      </header>
      <div class="center-view-body">
        <p class="center-view-intro">{t("activityIntro")}</p>
        <div class="activity-filters">
          <label>
            <span>{t("activityCategory")}</span>
            <select
              value={category()}
              onChange={(event) =>
                setCategory(event.currentTarget.value as PermissionCategory | "")
              }
            >
              <option value="">{t("activityAll")}</option>
              <For each={PERMISSION_CATEGORIES}>
                {(value) => <option value={value}>{permissionCategoryLabel(value)}</option>}
              </For>
            </select>
          </label>
          <label class="activity-check">
            <input
              type="checkbox"
              checked={onlyBlocked()}
              onChange={(event) => setOnlyBlocked(event.currentTarget.checked)}
            />
            <span>{t("activityBlockedOnly")}</span>
          </label>
        </div>
        <Show
          when={visible().length > 0}
          fallback={<p class="center-view-empty">{t("activityEmpty")}</p>}
        >
          <table class="usage-table activity-table">
            <thead>
              <tr>
                <th scope="col">{t("activityWhen")}</th>
                <th scope="col">{t("usageCoworker")}</th>
                <th scope="col">{t("activityCategory")}</th>
                <th scope="col">{t("activityAction")}</th>
                <th scope="col">{t("activityDecision")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={visible()}>
                {(entry) => (
                  <tr>
                    <td>
                      {new Intl.DateTimeFormat(speechLocale(), {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(entry.at))}
                    </td>
                    <td>{props.bots.find((bot) => bot.id === entry.botId)?.name ?? "—"}</td>
                    <td>{permissionCategoryLabel(entry.category)}</td>
                    <td class="activity-action" title={entry.reason}>
                      <code>{entry.action}</code>
                      <small>{entry.provider}</small>
                    </td>
                    <td>
                      <span class={`activity-decision activity-decision-${entry.decision}`}>
                        {t(DECISION_LABELS[entry.decision])}
                      </span>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
        <div class="settings-buttons">
          <button
            type="button"
            class="button-danger-quiet"
            disabled={entries().length === 0}
            onClick={() => void clear()}
          >
            {t("activityClear")}
          </button>
        </div>
        <p class="settings-meta">{t("activityPrivacy")}</p>
      </div>
    </section>
  );
}
