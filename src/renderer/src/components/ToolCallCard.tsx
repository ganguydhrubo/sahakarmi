import { createSignal, For, Show } from "solid-js";
import type { ToolCallKind, ToolCallSummary } from "../../../shared/ipc";

export type { ToolCallSummary };

import { LABELS } from "../activity-hinglish";
import { t } from "../i18n";

export const KIND_GLYPHS: Record<ToolCallKind, string> = {
  command: "M5 7l4 3-4 3M11 14h4",
  file: "M6 3.5h5l3 3V16.5H6zM11 3.5v3h3",
  browser: "M3.5 5.5h13v10h-13zM3.5 8.5h13",
  web: "M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M3.5 10h13M10 3.5c2 2 2 11 0 13M10 3.5c-2 2-2 11 0 13",
  coworker:
    "M7 9a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5M13.5 10a2 2 0 1 0 0-4M3 16c.5-3 2-4.5 4-4.5s3.5 1.5 4 4.5M12 12c2 0 3.5 1 4 4",
  approval: "M10 3l5.5 2v4.5c0 3.5-2.2 6-5.5 7.5-3.3-1.5-5.5-4-5.5-7.5V5zM7.5 10l1.8 1.8 3.4-3.6",
  tool: "M12.5 4.5a3.5 3.5 0 0 0-4.3 4.3L4 13l3 3 4.2-4.2a3.5 3.5 0 0 0 4.3-4.3L13.4 9.6l-2.3-.7-.7-2.3z",
};

/** Formats tool call details cleanly without ugly unescaped JSON or trailing brackets. */
export function formatToolDisplay(tool: ToolCallSummary): {
  title: string;
  subtitle: string;
  cleanInput: string;
} {
  const rawInput = tool.input?.trim() ?? "";
  const cleanInput = rawInput;
  let title = tool.name;
  let subtitle = "";

  // Attempt JSON extraction
  if (rawInput.startsWith("{") && rawInput.endsWith("}")) {
    try {
      const parsed = JSON.parse(rawInput);
      if (parsed.path || parsed.file_path || parsed.filePath) {
        const fullPath = String(parsed.path || parsed.file_path || parsed.filePath);
        const fileName = fullPath.split(/[/\\]/).filter(Boolean).pop() ?? fullPath;
        const op = tool.name.includes("edit")
          ? "Edit"
          : tool.name.includes("write")
            ? "Write"
            : tool.name.includes("read")
              ? "Read"
              : "File";
        title = `${op} ${fileName}`;
        subtitle = fullPath;
      } else if (parsed.command || parsed.cmd) {
        const cmd = String(parsed.command || parsed.cmd).trim();
        title = cmd.split("\n")[0].slice(0, 75);
        subtitle = "Terminal command";
      }
    } catch {
      // not strict JSON, proceed
    }
  }

  if (!subtitle) {
    if (tool.kind === "file") {
      const cleaned = rawInput
        .split("\n")[0]
        .replace(/[\s{]+$/, "")
        .trim();
      const fileName = cleaned.split(/[/\\]/).filter(Boolean).pop() ?? cleaned;
      title = `File: ${fileName}`;
      subtitle = cleaned;
    } else if (tool.kind === "command") {
      const firstLine = rawInput
        .split("\n")[0]
        .trim()
        .replace(/[\s{]+$/, "");
      title = firstLine.length > 75 ? `${firstLine.slice(0, 72)}…` : firstLine;
      subtitle = "Command";
    } else {
      const firstLine = rawInput
        .split("\n")[0]
        .trim()
        .replace(/[\s{]+$/, "");
      title = tool.name || "Tool";
      subtitle = firstLine.length > 75 ? `${firstLine.slice(0, 72)}…` : firstLine;
    }
  }

  return { title, subtitle, cleanInput };
}

/** A single tool call card. */
export function ToolCallCard(props: { tool: ToolCallSummary }) {
  const statusText = () =>
    props.tool.status === "running"
      ? LABELS.toolRunning
      : props.tool.status === "failed"
        ? LABELS.toolFailed
        : LABELS.toolDone;

  const display = () => formatToolDisplay(props.tool);

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
          <strong class="tool-card-title">{display().title}</strong>
          <span class="tool-card-preview">{display().subtitle}</span>
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

/**
 * Modern collapsible Action Drawer for consecutive tool executions.
 * Matches Claude, Codex, Grok, and Antigravity:
 * Compact single-line summary when collapsed, rich structured timeline when expanded.
 */
export function ToolGroupCard(props: { tools: ToolCallSummary[] }) {
  const isAnyRunning = () => props.tools.some((t) => t.status === "running");
  const isAnyFailed = () => props.tools.some((t) => t.status === "failed");
  const isAllDone = () => props.tools.every((t) => t.status === "completed");

  const [manuallyToggled, setManuallyToggled] = createSignal<boolean | null>(null);
  const isOpen = () => manuallyToggled() ?? isAnyRunning();

  const toggleOpen = () => {
    setManuallyToggled(!isOpen());
  };

  const summaryBreakdown = () => {
    const commands = props.tools.filter((t) => t.kind === "command").length;
    const files = props.tools.filter((t) => t.kind === "file").length;
    const browsers = props.tools.filter((t) => t.kind === "browser" || t.kind === "web").length;
    const parts: string[] = [];
    if (commands > 0) parts.push(`${commands} command${commands > 1 ? "s" : ""}`);
    if (files > 0) parts.push(`${files} file${files > 1 ? "s" : ""}`);
    if (browsers > 0) parts.push(`${browsers} web action${browsers > 1 ? "s" : ""}`);
    const remaining = props.tools.length - commands - files - browsers;
    if (remaining > 0) parts.push(`${remaining} other`);
    return parts.join(", ") || `${props.tools.length} steps`;
  };

  const activeToolIndex = () => {
    const idx = props.tools.findIndex((t) => t.status === "running");
    return idx >= 0 ? idx : props.tools.length - 1;
  };

  return (
    <article
      class="tool-group-card"
      classList={{
        "tool-group-running": isAnyRunning(),
        "tool-group-failed": isAnyFailed(),
        "tool-group-done": isAllDone(),
        "tool-group-open": isOpen(),
      }}
    >
      <button
        type="button"
        class="tool-group-header"
        aria-expanded={isOpen()}
        onClick={toggleOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleOpen();
          }
        }}
      >
        <span class="tool-group-icon" aria-hidden="true">
          <Show
            when={isAnyRunning()}
            fallback={
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                class="fill-none stroke-current"
                stroke-width="1.6"
              >
                <path
                  d="M13 3 6 11h5l-2 6 7-8h-5z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            }
          >
            <i class="tool-card-spinner" />
          </Show>
        </span>
        <div class="tool-group-info">
          <span class="tool-group-headline">
            <Show when={isAnyRunning()} fallback={`Ran ${props.tools.length} operations`}>
              {`Running step ${activeToolIndex() + 1} of ${props.tools.length}`}
            </Show>
          </span>
          <span class="tool-group-breakdown">{summaryBreakdown()}</span>
        </div>
        <div class="tool-group-status-wrap">
          <span
            class="tool-group-badge"
            classList={{
              "tool-group-badge-running": isAnyRunning(),
              "tool-group-badge-failed": isAnyFailed() && !isAnyRunning(),
              "tool-group-badge-done": isAllDone(),
            }}
          >
            <Show when={isAnyRunning()}>
              <i class="tool-card-spinner" aria-hidden="true" />
              Running
            </Show>
            <Show when={isAnyFailed() && !isAnyRunning()}>Failed</Show>
            <Show when={isAllDone()}>Done ✓</Show>
          </span>
          <span
            class="tool-group-chevron"
            classList={{ "tool-group-chevron-open": isOpen() }}
            aria-hidden="true"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              class="fill-none stroke-current"
              stroke-width="1.8"
            >
              <path d="m6 8 4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        </div>
      </button>

      <Show when={isOpen()}>
        <div class="tool-group-drawer">
          <div class="tool-group-timeline">
            <For each={props.tools}>
              {(tool) => {
                const [itemOpen, setItemOpen] = createSignal(false);
                const display = () => formatToolDisplay(tool);

                return (
                  <div
                    class="tool-group-step"
                    classList={{
                      "tool-step-running": tool.status === "running",
                      "tool-step-failed": tool.status === "failed",
                      "tool-step-done": tool.status === "completed",
                    }}
                  >
                    <button
                      type="button"
                      class="tool-step-row"
                      onClick={() => setItemOpen(!itemOpen())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setItemOpen(!itemOpen());
                        }
                      }}
                    >
                      <span class={`tool-step-icon tool-card-icon-${tool.kind}`} aria-hidden="true">
                        <svg aria-hidden="true" viewBox="0 0 20 20">
                          <path d={KIND_GLYPHS[tool.kind]} />
                        </svg>
                      </span>
                      <span class="tool-step-title" title={display().title}>
                        {display().title}
                      </span>
                      <Show when={display().subtitle && display().subtitle !== display().title}>
                        <span class="tool-step-subtitle" title={display().subtitle}>
                          {display().subtitle}
                        </span>
                      </Show>
                      <span class={`tool-step-status tool-step-status-${tool.status}`}>
                        <Show when={tool.status === "running"}>
                          <i class="tool-card-spinner" />
                        </Show>
                        <Show when={tool.status === "completed"}>✓</Show>
                        <Show when={tool.status === "failed"}>✕</Show>
                      </span>
                    </button>

                    <Show when={itemOpen()}>
                      <div class="tool-step-details">
                        <Show when={tool.input}>
                          <span class="tool-card-label">{t("input")}</span>
                          <pre>{tool.input}</pre>
                        </Show>
                        <Show when={tool.output}>
                          <span class="tool-card-label">{t("output")}</span>
                          <pre>{tool.output}</pre>
                        </Show>
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </article>
  );
}
