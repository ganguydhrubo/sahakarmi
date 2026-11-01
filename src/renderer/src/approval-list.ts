import type { ApprovalRequest } from "../../shared/ipc";

/**
 * Every "approvals changed" event carries freshly copied requests, and the lists key their cards
 * by object: a new copy tears a card down and rebuilds it, which is the flicker, the lost note and
 * the jumping focus. An unchanged request keeps its object, and an unchanged list keeps its array.
 */
export function stableApprovals(
  current: ApprovalRequest[],
  next: ApprovalRequest[],
): ApprovalRequest[] {
  const known = new Map(current.map((approval) => [approval.id, approval]));
  const merged = next.map((approval) => {
    const existing = known.get(approval.id);
    return existing && JSON.stringify(existing) === JSON.stringify(approval) ? existing : approval;
  });
  const same =
    merged.length === current.length && merged.every((item, index) => item === current[index]);
  return same ? current : merged;
}
