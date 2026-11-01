import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import {
  APPROVAL_CATEGORIES,
  type ApprovalCategory,
  type DeleteWorkspaceInput,
  type WorkspaceState,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";

const CATEGORY_LABELS: Record<ApprovalCategory, MessageKey> = {
  payment: "categoryPayment",
  message: "categoryMessage",
  submission: "categorySubmission",
  data: "categoryData",
  other: "categoryOther",
};

const AUTHORITY_HOURS = 24;

/** The owner's controls for one workspace: its CEO, the authority given, and deleting it. */
export function WorkspaceTeamDialog(props: {
  workspaces: WorkspaceState;
  bots: BotProfile[];
  onClose: () => void;
  onSetCeo: (workspaceId: string, botId: string | null) => Promise<void>;
  onDelete: (input: DeleteWorkspaceInput) => Promise<void>;
}) {
  const workspace = createMemo(() =>
    props.workspaces.workspaces.find((item) => item.id === props.workspaces.activeWorkspaceId),
  );
  const members = createMemo(() =>
    props.bots.filter((bot) => bot.workspaceId === props.workspaces.activeWorkspaceId),
  );
  const others = createMemo(() =>
    props.workspaces.workspaces.filter((item) => item.id !== props.workspaces.activeWorkspaceId),
  );
  const [grants, { mutate }] = createResource(() => window.sahkarmi.approvals.listAuthority());
  const workspaceGrants = createMemo(() =>
    (grants() ?? []).filter((grant) => grant.workspaceId === workspace()?.id),
  );
  const [chosen, setChosen] = createSignal<ApprovalCategory[]>([]);
  const [moveTo, setMoveTo] = createSignal<string>(others()[0]?.id ?? "");
  const [confirming, setConfirming] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const nameOf = (botId: string) => props.bots.find((bot) => bot.id === botId)?.name ?? botId;

  async function attempt(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <div class="workspace-team-backdrop">
      <div
        class="workspace-team-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-team-heading"
      >
        <h2 id="workspace-team-heading">{workspace()?.name}</h2>

        <label class="workspace-team-field">
          <span>{t("workspaceCeo")}</span>
          <select
            onChange={(event) =>
              void attempt(async () => {
                const id = workspace()?.id;
                if (id) await props.onSetCeo(id, event.currentTarget.value || null);
                mutate(await window.sahkarmi.approvals.listAuthority());
              })
            }
          >
            <option value="" selected={!workspace()?.ceoBotId}>
              {t("workspaceNoCeo")}
            </option>
            <For each={members()}>
              {(bot) => (
                <option value={bot.id} selected={bot.id === workspace()?.ceoBotId}>
                  {bot.name}
                </option>
              )}
            </For>
          </select>
        </label>
        <p class="workspace-team-hint">{t("workspaceCeoHint")}</p>

        <Show when={workspace()?.ceoBotId}>
          <h3>{t("approvalAuthority")}</h3>
          <p class="workspace-team-hint">{t("approvalAuthorityHint")}</p>
          <div class="workspace-team-categories">
            <For each={APPROVAL_CATEGORIES}>
              {(category) => (
                <label>
                  <input
                    type="checkbox"
                    checked={chosen().includes(category)}
                    onChange={(event) =>
                      setChosen((list) =>
                        event.currentTarget.checked
                          ? [...list, category]
                          : list.filter((item) => item !== category),
                      )
                    }
                  />
                  {t(CATEGORY_LABELS[category])}
                </label>
              )}
            </For>
          </div>
          <button
            type="button"
            class="button-primary"
            disabled={chosen().length === 0}
            onClick={() =>
              void attempt(async () => {
                const id = workspace()?.id;
                if (!id) return;
                mutate(
                  await window.sahkarmi.approvals.grantAuthority({
                    workspaceId: id,
                    categories: chosen(),
                    hours: AUTHORITY_HOURS,
                  }),
                );
                setChosen([]);
              })
            }
          >
            {t("approvalAuthorityGrant")}
          </button>
          <ul class="workspace-team-grants">
            <For each={workspaceGrants()}>
              {(grant) => (
                <li>
                  <span>
                    <strong>{nameOf(grant.botId)}</strong>:{" "}
                    {grant.categories.map((item) => t(CATEGORY_LABELS[item])).join(", ")}
                  </span>
                  <button
                    type="button"
                    class="button-danger-quiet"
                    onClick={() =>
                      void attempt(async () => {
                        mutate(await window.sahkarmi.approvals.revokeAuthority(grant.id));
                      })
                    }
                  >
                    {t("approvalAuthorityRevoke")}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={members().some((bot) => bot.publishingAccounts?.length)}>
          <h3>{t("publishingAccounts")}</h3>
          <ul class="workspace-team-grants">
            <For each={members().filter((bot) => bot.publishingAccounts?.length)}>
              {(bot) => (
                <For each={bot.publishingAccounts}>
                  {(account) => (
                    <li>
                      <span>
                        <strong>{bot.name}</strong>: {account.platform} {account.accountId}
                      </span>
                      <button
                        type="button"
                        class="button-danger-quiet"
                        onClick={() =>
                          void attempt(() =>
                            window.sahkarmi.team.unbindPublishingAccount(
                              bot.id,
                              account.platform,
                              account.source,
                            ),
                          )
                        }
                      >
                        {t("publishingAccountsUnbind")}
                      </button>
                    </li>
                  )}
                </For>
              )}
            </For>
          </ul>
        </Show>

        <h3>{t("deleteWorkspace")}</h3>
        <Show when={others().length > 0} fallback={<p>{t("deleteWorkspaceOnlyOne")}</p>}>
          <p class="workspace-team-hint">{t("deleteWorkspaceHint")}</p>
          <label class="workspace-team-field">
            <span>{t("deleteWorkspaceCoworkers")}</span>
            <select onChange={(event) => setMoveTo(event.currentTarget.value)}>
              <For each={others()}>
                {(item) => (
                  <option value={item.id} selected={item.id === moveTo()}>
                    {t("deleteWorkspaceMoveTo")} {item.name}
                  </option>
                )}
              </For>
              <option value="" selected={!moveTo()}>
                {t("deleteWorkspaceDeleteCoworkers")}
              </option>
            </select>
          </label>
          <Show
            when={confirming()}
            fallback={
              <button type="button" class="button-danger-quiet" onClick={() => setConfirming(true)}>
                {t("deleteWorkspace")}
              </button>
            }
          >
            <p class="workspace-team-confirm" role="alert">
              {moveTo() ? t("deleteWorkspaceConfirmMove") : t("deleteWorkspaceConfirmDelete")}
            </p>
            <button type="button" onClick={() => setConfirming(false)}>
              {t("cancel")}
            </button>
            <button
              type="button"
              class="button-danger-quiet"
              onClick={() =>
                void attempt(async () => {
                  const id = workspace()?.id;
                  if (!id) return;
                  await props.onDelete({ workspaceId: id, moveCoworkersTo: moveTo() || null });
                  props.onClose();
                })
              }
            >
              {t("deleteWorkspaceConfirm")}
            </button>
          </Show>
        </Show>

        <Show when={error()}>
          <p class="workspace-error" role="alert">
            {error()}
          </p>
        </Show>
        <div class="workspace-team-footer">
          <button type="button" onClick={props.onClose}>
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
