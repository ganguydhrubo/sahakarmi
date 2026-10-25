import type { CoworkerStatus } from "../../../shared/ipc";
import { vocab } from "../activity-vocab";

/** Coworker status in the owner's chosen activity style (English or Hinglish). */
export function statusLabel(status: CoworkerStatus): string {
  const labels = vocab().LABELS;
  const byStatus: Record<CoworkerStatus, string> = {
    idle: labels.statusIdle,
    working: labels.statusWorking,
    waiting: labels.statusWaiting,
    error: labels.statusError,
  };
  return byStatus[status];
}

export function StatusDot(props: { status: CoworkerStatus; class?: string }) {
  return (
    <span
      class={`status-dot status-dot-${props.status} ${props.class ?? ""}`}
      role="img"
      aria-label={statusLabel(props.status)}
      title={statusLabel(props.status)}
    />
  );
}
