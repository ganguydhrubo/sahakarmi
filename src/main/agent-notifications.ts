import type { AgentEvent, ApprovalRequest, BotSummary } from "../shared/ipc";

export interface AgentNotificationContent {
  title: string;
  body: string;
  /** The coworker whose chat a click should open. */
  botId?: string;
  /** Set for approval requests: the card the click should bring into view. */
  approvalId?: string;
}

const MAX_APPROVAL_BODY = 160;

export function notificationForAgentEvent(
  event: AgentEvent,
  bots: BotSummary[],
): AgentNotificationContent | null {
  if (event.type !== "turn-completed" && event.type !== "prompt") return null;

  const bot = bots.find((candidate) => candidate.id === event.botId);
  if (!bot?.notifications) return null;

  if (event.type === "prompt") {
    return { title: bot.name, body: "Needs your input.", botId: bot.id };
  }
  if (event.status !== "completed") return null;
  return { title: bot.name, body: "Finished working.", botId: bot.id };
}

/**
 * Approval requests that appeared since the last approvals-changed event and should raise an
 * OS notification. Without one, a request raised while the owner was away expired unseen.
 * `seen` is updated in place so each request notifies at most once; requests that are no longer
 * pending are forgotten so the set stays small.
 */
export function notificationsForNewApprovals(
  approvals: ApprovalRequest[],
  bots: BotSummary[],
  seen: Set<string>,
): AgentNotificationContent[] {
  const pending = new Set<string>();
  const out: AgentNotificationContent[] = [];
  for (const approval of approvals) {
    if (approval.status !== "pending") continue;
    pending.add(approval.id);
    if (seen.has(approval.id)) continue;
    seen.add(approval.id);
    const bot = bots.find((candidate) => candidate.id === approval.botId);
    // The coworker's own "Notifications" switch (Settings) silences its approvals too.
    if (bot && !bot.notifications) continue;
    out.push({
      title: `${bot?.name ?? "A coworker"} needs your approval`,
      body: clip(approval.title || "Open Sahkarmi to approve or decline."),
      botId: approval.botId || undefined,
      approvalId: approval.id,
    });
  }
  for (const id of seen) if (!pending.has(id)) seen.delete(id);
  return out;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_APPROVAL_BODY ? `${flat.slice(0, MAX_APPROVAL_BODY - 1)}…` : flat;
}
