import type {
  ApprovalAuthorityGrant,
  ApprovalRequest,
  BotSummary,
  WorkspaceSummary,
} from "../shared/ipc";

type TeamMember = Pick<BotSummary, "id" | "workspaceId">;

/**
 * Who may message whom. Coworkers only reach their own workspace. Under a CEO work goes through
 * the CEO, so nobody quietly hands a colleague's job to someone else; without a CEO, colleagues
 * in the workspace talk to each other as they always have.
 */
export function messageRefusal(
  sender: TeamMember,
  recipient: TeamMember,
  ceoBotId: string | null | undefined,
): string | null {
  if (sender.workspaceId !== recipient.workspaceId) {
    return "That coworker works in another workspace, so the message was not sent.";
  }
  if (ceoBotId && sender.id !== ceoBotId && recipient.id !== ceoBotId) {
    return "This workspace has a CEO: send this to the CEO, who assigns the work.";
  }
  return null;
}

/** Whose past chats a coworker may search: its own, or the team's if it is entitled to them. */
export function recallableBots<T extends TeamMember>(
  self: T,
  all: T[],
  scope: unknown,
  ceoBotId: string | null | undefined,
): T[] {
  if (scope !== "team") return all.filter((bot) => bot.id === self.id);
  if (ceoBotId && self.id !== ceoBotId) return all.filter((bot) => bot.id === self.id);
  return all.filter((bot) => bot.workspaceId === self.workspaceId);
}

/**
 * Why a coworker may not decide this request, or null if it may. Authority comes only from an
 * unexpired grant in the same workspace for this kind of request; nobody decides their own.
 * Pausing a tool call for "other" covers shell commands and the like: those stay with the owner.
 */
export function decideRefusal(
  decider: TeamMember,
  approval: Pick<ApprovalRequest, "botId" | "category" | "kind" | "status" | "ownerOnly">,
  requester: TeamMember | undefined,
  grants: ApprovalAuthorityGrant[],
): string | null {
  if (approval.status !== "pending") return `This request is already ${approval.status}.`;
  if (approval.botId === decider.id) return "Nobody can decide their own request.";
  if (approval.ownerOnly) return "Only the owner can decide this request.";
  if (!requester || requester.workspaceId !== decider.workspaceId) {
    return "That request belongs to another workspace.";
  }
  if (approval.kind === "permission" && approval.category === "other") {
    return "Only the owner can decide this kind of request.";
  }
  const held = grants.some(
    (grant) =>
      grant.botId === decider.id &&
      grant.workspaceId === decider.workspaceId &&
      grant.categories.includes(approval.category),
  );
  return held ? null : `You hold no authority for "${approval.category}" requests.`;
}

/** Who should hear about a request: the employee it was passed to, else the CEO, else nobody. */
export function deciderFor(
  approval: Pick<ApprovalRequest, "botId" | "category" | "kind" | "status" | "ownerOnly">,
  requester: TeamMember | undefined,
  members: TeamMember[],
  grants: ApprovalAuthorityGrant[],
): string | null {
  const eligible = [...grants]
    .sort((left, right) => Number(!left.parentGrantId) - Number(!right.parentGrantId))
    .filter((grant) => {
      const decider = members.find((member) => member.id === grant.botId);
      return decider && decideRefusal(decider, approval, requester, [grant]) === null;
    });
  return eligible[0]?.botId ?? null;
}

/** Why the CEO may not pass this authority on, or null. It can only give what it holds. */
export function delegateRefusal(
  ceo: TeamMember,
  employee: TeamMember | undefined,
  workspace: Pick<WorkspaceSummary, "ceoBotId"> | undefined,
  categories: ApprovalRequest["category"][],
  ownerGrant: ApprovalAuthorityGrant | undefined,
): string | null {
  if (workspace?.ceoBotId !== ceo.id) return "Only the workspace's CEO can delegate approvals.";
  if (!employee || employee.id === ceo.id || employee.workspaceId !== ceo.workspaceId) {
    return "You can only delegate to an employee in your workspace.";
  }
  if (!ownerGrant) return "The owner has not given you approval authority.";
  const beyond = categories.filter((category) => !ownerGrant.categories.includes(category));
  return beyond.length > 0
    ? `The owner did not give you authority for: ${beyond.join(", ")}.`
    : null;
}

/** The standing brief about who this coworker works with. */
export function teamInstructions(
  bot: Pick<BotSummary, "id">,
  ceo: Pick<BotSummary, "id" | "name"> | undefined,
): string[] {
  const territory =
    "Stay in your own territory. Do only work inside your role, and only with your own folder, browser, signed-in accounts, tasks and documents. If work belongs to a colleague, do not do it yourself: hand it over with sahkarmi.send_message (under a CEO, send it to the CEO). Never open, change or claim a colleague's folder, pages or tasks.";
  if (!ceo) return [territory];
  if (ceo.id === bot.id) {
    return [
      territory,
      "You are this workspace's CEO: every other coworker here is your employee, and sahkarmi.list_agents shows them with their roles. When the owner gives you work, split it and delegate each part with sahkarmi.send_message to the employee whose role fits, one message per employee. Do not do their work yourself. Their results come back to you as messages. When every result is in, consolidate them and report to the owner in one clear reply. The owner always has the final say.",
      "You have approval authority only if the owner granted it, only for the kinds they named. Decide coworkers' requests with sahkarmi.decide_approval, and pass part of your authority to an employee with sahkarmi.delegate_approval_authority only when that employee's role fits. Treat every request as if the owner were watching; when unsure, leave it for the owner. Never decide your own requests.",
    ];
  }
  return [
    territory,
    `You report to ${ceo.name} (${ceo.id}), this workspace's CEO. Take work from the CEO or the owner, and send results to the CEO. Do not assign work to other employees; ask the CEO to.`,
  ];
}
