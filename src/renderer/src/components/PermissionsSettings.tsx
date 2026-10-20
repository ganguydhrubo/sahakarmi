import { createSignal, For, onMount, Show } from "solid-js";
import {
  PERMISSION_CATEGORIES,
  PERMISSION_LEVELS,
  type PermissionCategory,
  type PermissionLevel,
  type PermissionPolicyState,
  type SafetyLimits,
  SENSITIVE_PERMISSION_CATEGORIES,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { speechLocale } from "../preferences";

const CATEGORY_KEYS: Record<PermissionCategory, MessageKey> = {
  research: "permResearch",
  file_read: "permFileRead",
  file_create: "permFileCreate",
  file_modify: "permFileModify",
  file_delete: "permFileDelete",
  destructive: "permDestructive",
  credentials: "permCredentials",
  shell: "permShell",
  browser_navigation: "permBrowserNav",
  browser_interaction: "permBrowserAct",
  downloads: "permDownloads",
  external_messages: "permMessages",
  publication: "permPublication",
  business_actions: "permBusiness",
  payments: "permPayments",
  account_settings: "permAccounts",
  official_forms: "permForms",
  app_updates: "permUpdates",
};
const LEVEL_KEYS: Record<PermissionLevel, MessageKey> = {
  ask: "levelAsk",
  auto: "levelAuto",
  workspace: "levelWorkspace",
  deny: "levelDeny",
};

export function permissionCategoryLabel(category: PermissionCategory | "system"): string {
  return t(category === "system" ? "categorySystem" : CATEGORY_KEYS[category]);
}

const LIMIT_FIELDS: Array<{
  key: keyof SafetyLimits;
  label: MessageKey;
  min: number;
  max: number;
}> = [
  { key: "maxToolCallsPerTurn", label: "limitToolCalls", min: 5, max: 1000 },
  { key: "maxTurnMinutes", label: "limitMinutes", min: 1, max: 240 },
  { key: "maxRepeatedCalls", label: "limitRepeats", min: 2, max: 50 },
  { key: "maxOutboundPerHour", label: "limitOutbound", min: 1, max: 500 },
];

/** Mirrors the backend rule; the backend re-checks every change. */
function levelsFor(category: PermissionCategory): PermissionLevel[] {
  if (SENSITIVE_PERMISSION_CATEGORIES.includes(category)) return ["ask", "deny"];
  if (category === "app_updates") return ["auto", "ask"];
  return [...PERMISSION_LEVELS];
}

export function PermissionsSettings(props: { bots: BotProfile[] }) {
  const [policy, setPolicy] = createSignal<PermissionPolicyState | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [grantCategory, setGrantCategory] = createSignal<PermissionCategory>("external_messages");
  const [grantBot, setGrantBot] = createSignal("");
  const [grantHours, setGrantHours] = createSignal(2);
  const [grantUses, setGrantUses] = createSignal("5");
  const [grantNote, setGrantNote] = createSignal("");
  const [limits, setLimits] = createSignal<SafetyLimits | null>(null);

  async function run(action: () => Promise<PermissionPolicyState>) {
    try {
      setPolicy(await action());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  onMount(
    () =>
      void run(() => window.sahkarmi.permissions.get()).then(() =>
        setLimits(policy()?.limits ?? null),
      ),
  );

  return (
    <div class="permissions-settings">
      <p class="settings-meta">{t("permIntro")}</p>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={policy()}>
        {(state) => (
          <>
            <table class="permission-table">
              <thead>
                <tr>
                  <th scope="col">{t("permAction")}</th>
                  <th scope="col">{t("permLevel")}</th>
                </tr>
              </thead>
              <tbody>
                <For each={PERMISSION_CATEGORIES}>
                  {(category) => (
                    <tr>
                      <th scope="row">
                        {permissionCategoryLabel(category)}
                        <Show when={SENSITIVE_PERMISSION_CATEGORIES.includes(category)}>
                          <span class="permission-sensitive" title={t("permSensitiveHint")}>
                            {t("permSensitive")}
                          </span>
                        </Show>
                      </th>
                      <td>
                        <select
                          aria-label={permissionCategoryLabel(category)}
                          value={state().levels[category]}
                          onChange={(event) =>
                            void run(() =>
                              window.sahkarmi.permissions.setLevel(
                                category,
                                event.currentTarget.value as PermissionLevel,
                              ),
                            )
                          }
                        >
                          <For each={levelsFor(category)}>
                            {(level) => <option value={level}>{t(LEVEL_KEYS[level])}</option>}
                          </For>
                        </select>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>

            <h3>{t("suggestOnlyTitle")}</h3>
            <p class="settings-meta">{t("suggestOnlyIntro")}</p>
            <ul class="suggest-only-list">
              <For each={props.bots}>
                {(bot) => (
                  <li>
                    <label class="activity-check">
                      <input
                        type="checkbox"
                        checked={state().suggestOnlyBots.includes(bot.id)}
                        onChange={(event) =>
                          void run(() =>
                            window.sahkarmi.permissions.setSuggestOnly(
                              bot.id,
                              event.currentTarget.checked,
                            ),
                          )
                        }
                      />
                      <span>{bot.name}</span>
                    </label>
                  </li>
                )}
              </For>
            </ul>

            <h3>{t("safetyTitle")}</h3>
            <p class="settings-meta">{t("safetyIntro")}</p>
            <Show when={limits()}>
              {(draft) => (
                <form
                  class="grant-form safety-limits"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(() => window.sahkarmi.permissions.setLimits(draft())).then(() =>
                      setLimits(policy()?.limits ?? draft()),
                    );
                  }}
                >
                  <For each={LIMIT_FIELDS}>
                    {(field) => (
                      <label>
                        <span>{t(field.label)}</span>
                        <input
                          type="number"
                          min={field.min}
                          max={field.max}
                          value={draft()[field.key]}
                          onInput={(event) =>
                            setLimits({
                              ...draft(),
                              [field.key]: Number(event.currentTarget.value),
                            })
                          }
                        />
                      </label>
                    )}
                  </For>
                  <button type="submit" class="button-primary">
                    {t("limitsSave")}
                  </button>
                </form>
              )}
            </Show>

            <h3>{t("grantTitle")}</h3>
            <p class="settings-meta">{t("grantIntro")}</p>
            <Show when={state().grants.length > 0}>
              <ul class="grant-list">
                <For each={state().grants}>
                  {(grant) => (
                    <li>
                      <span>
                        <strong>{permissionCategoryLabel(grant.category)}</strong> ·{" "}
                        {grant.botId
                          ? (props.bots.find((bot) => bot.id === grant.botId)?.name ?? grant.botId)
                          : t("grantAnyone")}{" "}
                        ·{" "}
                        {t("grantUntil", {
                          when: new Intl.DateTimeFormat(speechLocale(), {
                            dateStyle: "short",
                            timeStyle: "short",
                          }).format(new Date(grant.expiresAt)),
                        })}
                        <Show when={grant.usesLeft !== null}>
                          {" "}
                          · {t("grantUsesLeft", { count: String(grant.usesLeft) })}
                        </Show>
                        <Show when={grant.note}>
                          <small> — {grant.note}</small>
                        </Show>
                      </span>
                      <button
                        type="button"
                        class="button-danger-quiet"
                        onClick={() =>
                          void run(() => window.sahkarmi.permissions.revokeGrant(grant.id))
                        }
                      >
                        {t("grantRevoke")}
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <form
              class="grant-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(() =>
                  window.sahkarmi.permissions.addGrant({
                    category: grantCategory(),
                    botId: grantBot() || null,
                    hours: grantHours(),
                    maxUses: grantUses() ? Number(grantUses()) : null,
                    note: grantNote(),
                  }),
                ).then(() => setGrantNote(""));
              }}
            >
              <label>
                <span>{t("permAction")}</span>
                <select
                  value={grantCategory()}
                  onChange={(event) =>
                    setGrantCategory(event.currentTarget.value as PermissionCategory)
                  }
                >
                  <For
                    each={PERMISSION_CATEGORIES.filter((category) => category !== "app_updates")}
                  >
                    {(category) => (
                      <option value={category}>{permissionCategoryLabel(category)}</option>
                    )}
                  </For>
                </select>
              </label>
              <label>
                <span>{t("targetOwner")}</span>
                <select
                  value={grantBot()}
                  onChange={(event) => setGrantBot(event.currentTarget.value)}
                >
                  <option value="">{t("grantAnyone")}</option>
                  <For each={props.bots}>{(bot) => <option value={bot.id}>{bot.name}</option>}</For>
                </select>
              </label>
              <label>
                <span>{t("grantFor")}</span>
                <select
                  value={String(grantHours())}
                  onChange={(event) => setGrantHours(Number(event.currentTarget.value))}
                >
                  <option value="0.5">{t("grant30m")}</option>
                  <option value="2">{t("grant2h")}</option>
                  <option value="8">{t("grant8h")}</option>
                  <option value="24">{t("grant1d")}</option>
                  <option value="168">{t("grant7d")}</option>
                </select>
              </label>
              <label>
                <span>{t("grantUses")}</span>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  placeholder={t("grantUnlimited")}
                  value={grantUses()}
                  onInput={(event) => setGrantUses(event.currentTarget.value)}
                />
              </label>
              <label class="grant-note">
                <span>{t("targetNotes")}</span>
                <input
                  maxLength={200}
                  value={grantNote()}
                  placeholder={t("grantNoteExample")}
                  onInput={(event) => setGrantNote(event.currentTarget.value)}
                />
              </label>
              <button type="submit" class="button-primary">
                {t("grantAdd")}
              </button>
            </form>
          </>
        )}
      </Show>
    </div>
  );
}
