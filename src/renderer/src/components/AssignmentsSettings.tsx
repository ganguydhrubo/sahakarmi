import { createSignal, For, onMount, Show } from "solid-js";
import type { ResourceOverviewItem } from "../../../shared/ipc";
import type { ResourceKind } from "../../../shared/resource-access";
import { type MessageKey, t } from "../i18n";
import { AccessPicker, type AssignTargets, accessSummary, loadAssignTargets } from "./AssignAccess";

const KINDS: Array<{ kind: ResourceKind; label: MessageKey }> = [
  { kind: "api", label: "assignmentsKindApi" },
  { kind: "app", label: "assignmentsKindApp" },
  { kind: "skill", label: "assignmentsKindSkill" },
  { kind: "mcp", label: "assignmentsKindMcp" },
];

/**
 * Settings > Assignments: every API, connected app, skill and MCP server, whether it is
 * connected, who it is given to and whether coworkers can use it now. Each row can be
 * reassigned here with the same picker as in Marketplace and the other Settings pages.
 */
export function AssignmentsSettings() {
  const [items, setItems] = createSignal<ResourceOverviewItem[] | null>(null);
  const [targets, setTargets] = createSignal<AssignTargets>({ bots: [], workspaces: [] });
  const [editing, setEditing] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  async function refresh() {
    try {
      const [overview, loaded] = await Promise.all([
        window.sahkarmi.assignments.overview(),
        loadAssignTargets(),
      ]);
      setItems(overview);
      setTargets(loaded);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  onMount(() => void refresh());

  return (
    <div class="assignments">
      <p class="settings-meta">{t("assignmentsIntro")}</p>
      <button type="button" class="link-button" onClick={() => void refresh()}>
        {t("assignmentsRefresh")}
      </button>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={items()}>
        {(list) => (
          <Show
            when={list().length > 0}
            fallback={<p class="settings-meta">{t("assignmentsEmpty")}</p>}
          >
            <For each={KINDS.filter((group) => list().some((item) => item.kind === group.kind))}>
              {(group) => (
                <section class="assignments-group">
                  <h3>{t(group.label)}</h3>
                  <ul class="assignments-list">
                    <For each={list().filter((item) => item.kind === group.kind)}>
                      {(item) => {
                        const key = `${item.kind}:${item.id}`;
                        return (
                          <li class="assignments-row" data-available={item.available}>
                            <div class="assignments-head">
                              <strong>{item.name}</strong>
                              <span class="assignments-badges">
                                <span class="assignments-badge" data-ok={item.connected}>
                                  {item.connected
                                    ? t("assignmentsConnected")
                                    : t("assignmentsNotConnected")}
                                </span>
                                <span class="assignments-badge" data-ok={item.available}>
                                  {item.available
                                    ? t("assignmentsAvailable")
                                    : t("assignmentsUnavailable")}
                                </span>
                              </span>
                            </div>
                            <small class="settings-meta">
                              {t("assignmentsAssignedTo", {
                                who: accessSummary(item.access, targets()),
                              })}
                            </small>
                            <Show when={item.note}>
                              <small class="assignments-note">{item.note}</small>
                            </Show>
                            <Show
                              when={editing() === key}
                              fallback={
                                <button
                                  type="button"
                                  class="link-button"
                                  onClick={() => setEditing(key)}
                                >
                                  {t("assignButton")}
                                </button>
                              }
                            >
                              <AccessPicker
                                name={item.name}
                                initial={item.access}
                                targets={targets()}
                                onSave={async (access) => {
                                  await window.sahkarmi.assignments.set(
                                    item.kind,
                                    item.id,
                                    access.everyone && item.kind !== "api" ? null : access,
                                  );
                                  await refresh();
                                }}
                                onClose={() => setEditing(null)}
                              />
                            </Show>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </section>
              )}
            </For>
          </Show>
        )}
      </Show>
    </div>
  );
}
