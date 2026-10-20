import type { CoworkerStatus } from "../../../shared/ipc";
import { LABELS } from "../activity-hinglish";

/** Coworker activity is always shown in Roman-script Hinglish. */
const STATUS_LABELS: Record<CoworkerStatus, string> = {
  idle: LABELS.statusIdle,
  working: LABELS.statusWorking,
  waiting: LABELS.statusWaiting,
  error: LABELS.statusError,
};

export function statusLabel(status: CoworkerStatus): string {
  return STATUS_LABELS[status];
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
