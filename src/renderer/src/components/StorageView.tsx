import { createSignal, For, onMount, Show } from "solid-js";
import type {
  StorageCategory,
  StorageCategoryId,
  StorageCleanInput,
  StorageUsage,
} from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

const LABELS: Record<StorageCategoryId, { name: MessageKey; hint: MessageKey }> = {
  browser: { name: "storageBrowser", hint: "storageBrowserHint" },
  runtimes: { name: "storageRuntimes", hint: "storageRuntimesHint" },
  accounts: { name: "storageAccounts", hint: "storageAccountsHint" },
  attachments: { name: "storageAttachments", hint: "storageAttachmentsHint" },
  knowledge: { name: "storageKnowledge", hint: "storageKnowledgeHint" },
  logs: { name: "storageLogs", hint: "storageLogsHint" },
  mailboxArchive: { name: "storageMailboxArchive", hint: "storageMailboxArchiveHint" },
};

/** The safe clean action of each category; none for data that is the owner's own. */
const ACTIONS: Partial<
  Record<StorageCategoryId, { label: MessageKey; confirm: MessageKey; input: StorageCleanInput }>
> = {
  browser: {
    label: "storageCleanBrowser",
    confirm: "storageConfirmBrowser",
    input: { category: "browser" },
  },
  runtimes: {
    label: "storageCleanRuntimes",
    confirm: "storageConfirmRuntimes",
    input: { category: "runtimes" },
  },
  accounts: {
    label: "storageCleanAccounts",
    confirm: "storageConfirmAccounts",
    input: { category: "accounts" },
  },
  logs: { label: "storageCleanLogs", confirm: "storageConfirmLogs", input: { category: "logs" } },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Settings > Storage: sizes per kind of data, with safe clean actions. */
export function StorageView() {
  const [usage, setUsage] = createSignal<StorageUsage | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [note, setNote] = createSignal<string | null>(null);
  const [days, setDays] = createSignal(90);

  async function measure() {
    setBusy(true);
    try {
      setUsage(await window.sahkarmi.maintenance.storageUsage());
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => void measure());

  async function clean(input: StorageCleanInput, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await window.sahkarmi.maintenance.cleanStorage(input);
      const parts = [
        result.removedItems
          ? t("storageCleaned", {
              size: formatBytes(result.bytes),
              count: String(result.removedItems),
            })
          : t("storageNothing"),
      ];
      if (result.skipped) parts.push(t("storageSkipped", { count: String(result.skipped) }));
      setNote(parts.join(" "));
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
    await measure();
  }

  const total = () => (usage()?.categories ?? []).reduce((sum, item) => sum + item.bytes, 0);
  const size = (item: StorageCategory) =>
    item.partial ? t("storageAtLeast", { size: formatBytes(item.bytes) }) : formatBytes(item.bytes);

  return (
    <section class="settings-card storage-view">
      <p class="settings-meta">{t("storageIntro")}</p>
      <div class="settings-buttons">
        <button type="button" disabled={busy()} onClick={() => void measure()}>
          {busy() ? t("storageMeasuring") : t("storageRefresh")}
        </button>
        <Show when={usage()}>
          <strong>{t("storageTotal", { size: formatBytes(total()) })}</strong>
        </Show>
      </div>
      <Show when={note()}>
        <p class="settings-meta" role="status">
          {note()}
        </p>
      </Show>
      <ul class="storage-list">
        <For each={usage()?.categories ?? []}>
          {(item) => {
            const action = ACTIONS[item.id];
            return (
              <li class="storage-row">
                <div>
                  <strong>{t(LABELS[item.id].name)}</strong>
                  <span class="storage-size">{size(item)}</span>
                  <p class="settings-meta">{t(LABELS[item.id].hint)}</p>
                </div>
                <Show when={action}>
                  {(entry) => (
                    <button
                      type="button"
                      disabled={busy()}
                      onClick={() => void clean(entry().input, t(entry().confirm))}
                    >
                      {t(entry().label)}
                    </button>
                  )}
                </Show>
                <Show when={item.id === "attachments"}>
                  <div class="storage-attachments">
                    <button
                      type="button"
                      disabled={busy()}
                      onClick={() =>
                        void clean(
                          { category: "attachments", olderThanDays: days() },
                          t("storageConfirmAttachments", { days: String(days()) }),
                        )
                      }
                    >
                      {t("storageCleanAttachments")}
                    </button>
                    <input
                      type="number"
                      min="1"
                      max="3650"
                      value={days()}
                      aria-label={t("storageDays")}
                      onInput={(event) => {
                        const value = Number.parseInt(event.currentTarget.value, 10);
                        if (Number.isFinite(value) && value >= 1) setDays(value);
                      }}
                    />
                    <span>{t("storageDays")}</span>
                  </div>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    </section>
  );
}
