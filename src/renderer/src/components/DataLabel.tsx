import type { UsageDataLabel } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

const LABELS: Record<UsageDataLabel, { key: MessageKey; hint: MessageKey }> = {
  verified: { key: "labelVerified", hint: "labelVerifiedHint" },
  estimated: { key: "labelEstimated", hint: "labelEstimatedHint" },
  unavailable: { key: "labelUnavailable", hint: "labelUnavailableHint" },
  stale: { key: "labelStale", hint: "labelStaleHint" },
};

/** Says where a number came from. Shown next to every usage figure. */
export function DataLabel(props: { label: UsageDataLabel }) {
  return (
    <span class={`data-label data-label-${props.label}`} title={t(LABELS[props.label].hint)}>
      {t(LABELS[props.label].key)}
    </span>
  );
}
