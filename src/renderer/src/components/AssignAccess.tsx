import { createSignal, For, Show } from "solid-js";
import type { AgentProviderId, BotSummary, WorkspaceSummary } from "../../../shared/ipc";
import { PROVIDER_LABELS, providerForModel } from "../../../shared/ipc";
import {
  accessIsEmpty,
  EVERYONE_ACCESS,
  type ResourceAccess,
  type ResourceKind,
} from "../../../shared/resource-access";
import { t } from "../i18n";

export interface AssignTargets {
  bots: BotSummary[];
  workspaces: WorkspaceSummary[];
}

/** Coworkers and workspaces, loaded once per open picker (cheap: both are in memory). */
export async function loadAssignTargets(): Promise<AssignTargets> {
  const [bots, state] = await Promise.all([
    window.sahkarmi.agent.listBots().catch(() => [] as BotSummary[]),
    window.sahkarmi.team.listWorkspaces().catch(() => null),
  ]);
  return { bots, workspaces: state?.workspaces ?? [] };
}

/** "Everyone", "Nobody yet", or e.g. "CEOs · All Claude coworkers · Sales workspace · Asha". */
export function accessSummary(access: ResourceAccess, targets: AssignTargets): string {
  if (access.everyone) return t("assignSummaryEveryone");
  if (accessIsEmpty(access)) return t("assignSummaryNobody");
  const parts: string[] = [];
  if (access.ceo) parts.push(t("assignSummaryCeo"));
  for (const id of access.providers) {
    const label = PROVIDER_LABELS[id as keyof typeof PROVIDER_LABELS] ?? id;
    parts.push(t("accessEngine", { name: label }));
  }
  for (const id of access.workspaceIds) {
    const name = targets.workspaces.find((workspace) => workspace.id === id)?.name;
    if (name) parts.push(t("assignSummaryWorkspace", { name }));
  }
  const names = access.botIds
    .map((id) => targets.bots.find((bot) => bot.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  if (names.length > 3) parts.push(`${names.slice(0, 3).join(", ")} +${names.length - 3}`);
  else if (names.length > 0) parts.push(names.join(", "));
  return parts.join(" · ") || t("assignSummaryNobody");
}

type ListKey = "botIds" | "workspaceIds" | "providers";

/** The main engines, plus any other one a coworker already runs on. */
export function assignableEngines(bots: BotSummary[]): AgentProviderId[] {
  return [
    ...new Set<AgentProviderId>([
      ...MAIN_ENGINES,
      ...bots.filter((bot) => Boolean(bot.model)).map((bot) => providerForModel(bot.model)),
    ]),
  ];
}

const MAIN_ENGINES: AgentProviderId[] = ["claude", "codex", "antigravity", "opencode"];

/**
 * The owner picks who may use one resource: everyone, every coworker on an engine, each
 * workspace's CEO, whole workspaces, single coworkers. Same choices for APIs, apps, skills and
 * MCP servers. Saving with "everyone" ticked gives it back to everyone.
 */
export function AccessPicker(props: {
  name: string;
  initial: ResourceAccess;
  targets: AssignTargets;
  onSave: (access: ResourceAccess) => Promise<void>;
  onClose: () => void;
}) {
  const [access, setAccess] = createSignal<ResourceAccess>({
    ...props.initial,
    botIds: [...props.initial.botIds],
    workspaceIds: [...props.initial.workspaceIds],
    providers: [...props.initial.providers],
  });
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const engines = () => assignableEngines(props.targets.bots);

  function toggle(list: ListKey, id: string, checked: boolean) {
    setAccess((current) => ({
      ...current,
      [list]: checked
        ? [...current[list].filter((item) => item !== id), id]
        : current[list].filter((item) => item !== id),
    }));
  }

  async function save() {
    setBusy(true);
    try {
      await props.onSave(access());
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset class="apis-access assign-access">
      <legend>{t("assignTitle", { name: props.name })}</legend>
      <p class="apps-note">
        {access().everyone
          ? t("assignEveryoneNote")
          : accessIsEmpty(access())
            ? t("assignNobodyNote")
            : accessSummary(access(), props.targets)}
      </p>
      <label>
        <input
          type="checkbox"
          checked={access().everyone}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
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
                checked={access().providers.includes(engine)}
                disabled={access().everyone}
                onChange={(event) => toggle("providers", engine, event.currentTarget.checked)}
              />
              {t("accessEngine", { name: PROVIDER_LABELS[engine] })}
            </label>
          )}
        </For>
      </Show>
      <Show when={props.targets.workspaces.length > 0}>
        <small class="apis-access-group">{t("apisAccessWorkspaces")}</small>
        <For each={props.targets.workspaces}>
          {(workspace) => (
            <label>
              <input
                type="checkbox"
                checked={access().workspaceIds.includes(workspace.id)}
                disabled={access().everyone}
                onChange={(event) =>
                  toggle("workspaceIds", workspace.id, event.currentTarget.checked)
                }
              />
              {t("apisAccessWorkspace", { name: workspace.name })}
            </label>
          )}
        </For>
      </Show>
      <Show when={props.targets.bots.length > 0}>
        <small class="apis-access-group">{t("apisAccessBots")}</small>
        <For each={props.targets.bots}>
          {(bot) => (
            <label>
              <input
                type="checkbox"
                checked={access().botIds.includes(bot.id)}
                disabled={access().everyone}
                onChange={(event) => toggle("botIds", bot.id, event.currentTarget.checked)}
              />
              {bot.name}
            </label>
          )}
        </For>
      </Show>
      <div class="apis-row">
        <button type="button" class="marketplace-action" disabled={busy()} onClick={save}>
          {t("assignSave")}
        </button>
        <button type="button" class="link-button" disabled={busy()} onClick={props.onClose}>
          {t("assignCancel")}
        </button>
      </div>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>
    </fieldset>
  );
}

/**
 * A small "Assign" button for one app, skill or MCP server; it opens the picker in place.
 * Loads the current choice only when opened, so long lists stay light.
 */
export function AssignButton(props: {
  kind: ResourceKind;
  id: string;
  name: string;
  /** The current choice when the caller already knows it (otherwise it is looked up). */
  access?: ResourceAccess;
  onSaved?: () => void;
}) {
  const [open, setOpen] = createSignal<{ access: ResourceAccess; targets: AssignTargets } | null>(
    null,
  );
  const [saved, setSaved] = createSignal(false);

  async function show() {
    const [targets, overview] = await Promise.all([
      loadAssignTargets(),
      props.access
        ? Promise.resolve(null)
        : window.sahkarmi.assignments.overview().catch(() => null),
    ]);
    const found = overview?.find((item) => item.kind === props.kind && item.id === props.id);
    setOpen({ access: props.access ?? found?.access ?? { ...EVERYONE_ACCESS }, targets });
  }

  return (
    <div class="assign-inline">
      <Show
        when={open()}
        fallback={
          <button type="button" class="link-button assign-button" onClick={() => void show()}>
            {t("assignButton")}
          </button>
        }
      >
        {(state) => (
          <AccessPicker
            name={props.name}
            initial={state().access}
            targets={state().targets}
            onSave={async (access) => {
              await window.sahkarmi.assignments.set(
                props.kind,
                props.id,
                access.everyone ? null : access,
              );
              setSaved(true);
              setTimeout(() => setSaved(false), 2500);
              props.onSaved?.();
            }}
            onClose={() => setOpen(null)}
          />
        )}
      </Show>
      <Show when={saved()}>
        <small class="apps-note" role="status">
          {t("assignSaved")}
        </small>
      </Show>
    </div>
  );
}
