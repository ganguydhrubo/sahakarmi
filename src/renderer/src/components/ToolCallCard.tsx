import { createSignal, For, Show } from "solid-js";
import type { ToolCallKind, ToolCallSummary } from "../../../shared/ipc";

export type { ToolCallSummary };

import { vocab } from "../activity-vocab";
import { type MessageKey, t } from "../i18n";

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
  let title = "";
  let subtitle = "";

  // Attempt JSON extraction
  let parsed: Record<string, unknown> | null = null;
  if (rawInput.startsWith("{") && rawInput.endsWith("}")) {
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      // not strict JSON, proceed
    }
  }

  // Handle Sahkarmi & Agent Orchestration tools with first-class human readable titles
  if (tool.name === "sahkarmi_create_coworker" || tool.name.endsWith("create_coworker")) {
    const name = typeof parsed?.name === "string" ? parsed.name : "New Coworker";
    const role = typeof parsed?.role === "string" ? ` (${parsed.role})` : "";
    title = `${t("toolCreateCoworker", { name })}${role}`;
    subtitle = typeof parsed?.description === "string" ? parsed.description : "";
  } else if (tool.name === "sahkarmi_send_message" || tool.name.endsWith("send_message")) {
    const target =
      typeof parsed?.to === "string"
        ? parsed.to
        : typeof parsed?.recipient === "string"
          ? parsed.recipient
          : typeof parsed?.recipientBotId === "string"
            ? parsed.recipientBotId
            : t("toolCoworker");
    const msg =
      typeof parsed?.message === "string"
        ? parsed.message
        : typeof parsed?.body === "string"
          ? parsed.body
          : typeof parsed?.content === "string"
            ? parsed.content
            : "";
    title = t("toolMessageTo", { name: target });
    subtitle = msg.length > 80 ? `${msg.slice(0, 77)}…` : msg;
  } else if (tool.name === "save_memory") {
    const key = typeof parsed?.key === "string" ? parsed.key : "";
    const content = typeof parsed?.content === "string" ? parsed.content : "";
    title = key ? `${t("toolSaveMemory")}: ${key}` : t("toolSaveMemory");
    subtitle = content.length > 80 ? `${content.slice(0, 77)}…` : content;
  } else if (tool.name === "search_memory") {
    title = t("toolSearchMemory");
    subtitle = typeof parsed?.query === "string" ? `“${parsed.query}”` : "";
  } else if (tool.name === "list_memories") {
    title = t("toolListMemories");
    subtitle = typeof parsed?.category === "string" ? parsed.category : "";
  } else if (parsed && (parsed.path || parsed.file_path || parsed.filePath)) {
    const fullPath = String(parsed.path || parsed.file_path || parsed.filePath);
    const fileName = fullPath.split(/[/\\]/).filter(Boolean).pop() ?? fullPath;
    const name = tool.name.toLowerCase();
    const op = name.includes("edit")
      ? "toolEditFile"
      : name.includes("write")
        ? "toolWriteFile"
        : name.includes("read")
          ? "toolReadFile"
          : "toolFile";
    title = t(op, { name: fileName });
    subtitle = fullPath;
  } else if (parsed && (parsed.command || parsed.cmd)) {
    const command = parsed.command || parsed.cmd;
    const cmd = unwrapShell(Array.isArray(command) ? command.join(" ") : String(command));
    title = clipLine(cmd);
    subtitle = t("toolCommand");
  }

  if (!title) {
    if (tool.kind === "file") {
      const cleaned = rawInput
        .split("\n")[0]
        .replace(/[\s{]+$/, "")
        .trim();
      const fileName = cleaned.split(/[/\\]/).filter(Boolean).pop() ?? cleaned;
      title = t("toolFile", { name: fileName });
      subtitle = cleaned;
    } else if (tool.kind === "command") {
      title = clipLine(unwrapShell(rawInput.replace(/[\s{]+$/, "")));
      subtitle = t("toolCommand");
    } else {
      const cleanedName = (tool.name || "Tool")
        .replace(/^sahkarmi_/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const firstLine = rawInput
        .split("\n")[0]
        .trim()
        .replace(/[\s{]+$/, "");
      title = cleanedName;
      subtitle = firstLine.length > 75 ? `${firstLine.slice(0, 72)}…` : firstLine;
    }
  }

  return { title, subtitle, cleanInput };
}

/** First line, at most 75 characters. */
function clipLine(text: string): string {
  const line = text.split("\n")[0].trim();
  return line.length > 75 ? `${line.slice(0, 72)}…` : line;
}

/**
 * Shows the command the coworker meant, not the shell that ran it:
 * `"C:\…\powershell.exe" -Command "Get-ChildItem"` becomes `Get-ChildItem`.
 */
export function unwrapShell(command: string): string {
  let text = command.trim();
  const wrapper =
    /^"?(?:[^"\s]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?\s+(?:-(?!command\b|c\b)\w+\s+)*-(?:command|c)\s+([\s\S]+)$/i.exec(
      text,
    ) ??
    /^"?(?:[^"\s]*[\\/])?(?:cmd)(?:\.exe)?"?\s+\/[cs]\s+([\s\S]+)$/i.exec(text) ??
    /^"?(?:[^"\s]*\/)?(?:bash|sh|zsh)"?\s+-l?c\s+([\s\S]+)$/.exec(text);
  if (wrapper) {
    text = wrapper[1].trim();
    const quote = text[0];
    if ((quote === '"' || quote === "'") && text.endsWith(quote) && text.length > 1) {
      text = text.slice(1, -1);
    }
  }
  return text.replace(/\\\\/g, "\\").replace(/\\"/g, '"');
}

/** A single tool call card. */
export function ToolCallCard(props: { tool: ToolCallSummary }) {
  const statusText = () =>
    props.tool.status === "running"
      ? vocab().LABELS.toolRunning
      : props.tool.status === "failed"
        ? vocab().LABELS.toolFailed
        : vocab().LABELS.toolDone;

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

  /** "2 commands, 1 file, 1 coworker message": what the steps were, never a bare "other". */
  const summaryBreakdown = () => {
    const labels: Record<string, [MessageKey, MessageKey]> = {
      command: ["toolKindCommandOne", "toolKindCommandMany"],
      file: ["toolKindFileOne", "toolKindFileMany"],
      browser: ["toolKindWebOne", "toolKindWebMany"],
      web: ["toolKindWebOne", "toolKindWebMany"],
      coworker: ["toolKindCoworkerOne", "toolKindCoworkerMany"],
      approval: ["toolKindApprovalOne", "toolKindApprovalMany"],
      tool: ["toolKindToolOne", "toolKindToolMany"],
    };
    const counts = new Map<[MessageKey, MessageKey], number>();
    for (const tool of props.tools) {
      const pair = labels[tool.kind] ?? labels.tool;
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    return [...counts]
      .map(([[one, many], count]) => t(count === 1 ? one : many, { count: String(count) }))
      .join(", ");
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
            <Show
              when={isAnyRunning()}
              fallback={t("toolRanSteps", { count: String(props.tools.length) })}
            >
              {t("toolRunningStep", {
                current: String(activeToolIndex() + 1),
                total: String(props.tools.length),
              })}
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
              {vocab().LABELS.toolRunning}
            </Show>
            <Show when={isAnyFailed() && !isAnyRunning()}>{vocab().LABELS.toolFailed}</Show>
            <Show when={isAllDone()}>{vocab().LABELS.toolDone}</Show>
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
