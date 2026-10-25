import { createMemo, createSignal, For, Show } from "solid-js";
import type { ApprovalCategory, ApprovalRequest } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";

const CATEGORY_LABELS: Record<ApprovalCategory, MessageKey> = {
  payment: "categoryPayment",
  message: "categoryMessage",
  submission: "categorySubmission",
  data: "categoryData",
  other: "categoryOther",
};

interface ApprovalsViewProps {
  approvals: ApprovalRequest[];
  bots: BotProfile[];
  onDecide: (approvalId: string, decision: "approved" | "rejected", note: string) => Promise<void>;
  onOpenCoworker: (botId: string) => void;
}

export function ApprovalsView(props: ApprovalsViewProps) {
  const pending = createMemo(() =>
    props.approvals.filter((approval) => approval.status === "pending"),
  );
  const decided = createMemo(() =>
    props.approvals.filter((approval) => approval.status !== "pending"),
  );
  return (
    <section class="center-view approvals-view" aria-labelledby="approvals-heading">
      <header class="center-view-header window-drag">
        <h1 id="approvals-heading">{t("approvals")}</h1>
        <Show when={pending().length > 0}>
          <span class="center-view-badge">{pending().length}</span>
        </Show>
      </header>
      <div class="center-view-body">
        <h2 class="center-view-subheading">{t("pending")}</h2>
        <Show
          when={pending().length > 0}
          fallback={<p class="center-view-empty">{t("approvalsEmpty")}</p>}
        >
          <ul class="approval-list">
            <For each={pending()}>
              {(approval) => (
                <ApprovalCard
                  approval={approval}
                  bot={props.bots.find((bot) => bot.id === approval.botId)}
                  onDecide={props.onDecide}
                  onOpenCoworker={props.onOpenCoworker}
                />
              )}
            </For>
          </ul>
        </Show>
        <Show when={decided().length > 0}>
          <h2 class="center-view-subheading">{t("history")}</h2>
          <ul class="approval-list approval-history">
            <For each={decided()}>
              {(approval) => (
                <ApprovalCard
                  approval={approval}
                  bot={props.bots.find((bot) => bot.id === approval.botId)}
                  onDecide={props.onDecide}
                  onOpenCoworker={props.onOpenCoworker}
                />
              )}
            </For>
          </ul>
        </Show>
      </div>
    </section>
  );
}

export function ApprovalCard(props: {
  approval: ApprovalRequest;
  bot: BotProfile | undefined;
  onDecide: ApprovalsViewProps["onDecide"];
  onOpenCoworker: (botId: string) => void;
}) {
  const [note, setNote] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const pending = () => props.approval.status === "pending";

  async function decide(decision: "approved" | "rejected") {
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onDecide(props.approval.id, decision, note());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      class={`approval-card approval-card-${props.approval.status}`}
      classList={{ "approval-risk-high": isHighRisk(props.approval) }}
    >
      <div class="approval-card-head">
        <button
          type="button"
          class="approval-coworker"
          onClick={() => props.onOpenCoworker(props.approval.botId)}
          disabled={!props.bot}
        >
          <AgentAvatar bot={props.bot} />
          <span>
            <strong>{props.bot?.name ?? props.approval.botId}</strong>
            <small>{props.bot?.role}</small>
          </span>
        </button>
        <Show when={!(props.approval.kind === "permission" && props.approval.category === "other")}>
          <span class={`approval-category approval-category-${props.approval.category}`}>
            {t(CATEGORY_LABELS[props.approval.category])}
          </span>
        </Show>
        <Show when={props.approval.kind === "permission"}>
          <span class="approval-kind" title={t("approvalPausedHint")}>
            {t("approvalPaused")}
          </span>
        </Show>
        <time datetime={props.approval.createdAt}>{formatWhen(props.approval.createdAt)}</time>
      </div>
      <h3>
        {props.approval.title}
        <Show when={props.approval.amount}>
          <span class="approval-amount">{props.approval.amount}</span>
        </Show>
      </h3>
      <Show when={props.approval.details}>
        <p class="approval-details">{props.approval.details}</p>
      </Show>
      <Show when={props.approval.technical}>
        {(technical) => (
          <details class="approval-technical">
            <summary>{t("approvalTechnical")}</summary>
            <pre>{technical()}</pre>
          </details>
        )}
      </Show>
      <Show
        when={pending()}
        fallback={
          <p class="approval-outcome">
            <span class={`approval-outcome-pill approval-outcome-${props.approval.status}`}>
              {props.approval.status === "approved" ? t("approved") : t("rejected")}
            </span>
            <Show when={props.approval.note}>{(value) => <span>“{value()}”</span>}</Show>
          </p>
        }
      >
        <label class="approval-note">
          <span class="sr-only">{t("addNote")}</span>
          <input
            value={note()}
            placeholder={t("addNote")}
            onInput={(event) => setNote(event.currentTarget.value)}
          />
        </label>
        <div class="approval-actions">
          <button
            type="button"
            class="button-danger-quiet"
            disabled={busy()}
            onClick={() => void decide("rejected")}
          >
            {t("reject")}
          </button>
          <button
            type="button"
            class="button-primary"
            disabled={busy()}
            onClick={() => void decide("approved")}
          >
            {t("approve")}
          </button>
        </div>
        <Show when={error()}>
          <p class="approval-error" role="alert">
            {error()}
          </p>
        </Show>
      </Show>
    </li>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

const HIGH_RISK_PERMISSIONS = new Set([
  "file_delete",
  "external_messages",
  "publication",
  "business_actions",
  "payments",
  "account_settings",
  "official_forms",
]);

/** Money, outside messages, publishing and deleting get a red edge so they never look routine. */
function isHighRisk(approval: ApprovalRequest): boolean {
  if (approval.kind === "permission") {
    return HIGH_RISK_PERMISSIONS.has(approval.permissionCategory ?? "");
  }
  return ["payment", "message", "submission"].includes(approval.category);
}
