import type { CoworkerStatus } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

const STATUS_LABELS: Record<CoworkerStatus, MessageKey> = {
  idle: "statusIdle",
  working: "statusWorking",
  waiting: "statusWaiting",
  error: "statusError",
};

export function statusLabel(status: CoworkerStatus): string {
  return t(STATUS_LABELS[status]);
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
