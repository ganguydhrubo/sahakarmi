import { Show } from "solid-js";
import type { ToolCallKind, ToolCallSummary } from "../../../shared/ipc";
import { LABELS } from "../activity-hinglish";
import { t } from "../i18n";

const KIND_GLYPHS: Record<ToolCallKind, string> = {
  command: "M5 7l4 3-4 3M11 14h4",
  file: "M6 3.5h5l3 3V16.5H6zM11 3.5v3h3",
  browser: "M3.5 5.5h13v10h-13zM3.5 8.5h13",
  web: "M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13",
  coworker:
    "M7 9a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5M13.5 10a2 2 0 1 0 0-4M3 16c.5-3 2-4.5 4-4.5s3.5 1.5 4 4.5M12 12c2 0 3.5 1 4 4",
  approval: "M10 3l5.5 2v4.5c0 3.5-2.2 6-5.5 7.5-3.3-1.5-5.5-4-5.5-7.5V5zM7.5 10l1.8 1.8 3.4-3.6",
  tool: "M12.5 4.5a3.5 3.5 0 0 0-4.3 4.3L4 13l3 3 4.2-4.2a3.5 3.5 0 0 0 4.3-4.3L13.4 9.6l-2.3-.7-.7-2.3z",
};

/** A tool call made by a coworker, collapsed to one line until the owner expands it. */
export function ToolCallCard(props: { tool: ToolCallSummary }) {
  const statusText = () =>
    props.tool.status === "running"
      ? LABELS.toolRunning
      : props.tool.status === "failed"
        ? LABELS.toolFailed
        : LABELS.toolDone;
  const preview = () => props.tool.input?.split("\n")[0]?.slice(0, 90) ?? "";
  return (
    <article class={`tool-card tool-card-${props.tool.status}`}>
      <details>
        <summary>
          <span class={`tool-card-icon tool-card-icon-${props.tool.kind}`} aria-hidden="true">
            <svg viewBox="0 0 20 20">
              <title>{props.tool.kind}</title>
              <path d={KIND_GLYPHS[props.tool.kind]} />
            </svg>
          </span>
          <strong>{props.tool.name}</strong>
          <span class="tool-card-preview">{preview()}</span>
          <span class={`tool-card-status tool-card-status-${props.tool.status}`}>
            <Show when={props.tool.status === "running"}>
              <i class="tool-card-spinner" aria-hidden="true" />
            </Show>
            {statusText()}
          </span>
        </summary>
        <div class="tool-card-body">
          <Show when={props.tool.input}>
            <span class="tool-card-label">{t("input")}</span>
            <pre>{props.tool.input}</pre>
          </Show>
          <Show when={props.tool.output}>
            <span class="tool-card-label">{t("output")}</span>
            <pre>{props.tool.output}</pre>
          </Show>
        </div>
      </details>
    </article>
  );
}
