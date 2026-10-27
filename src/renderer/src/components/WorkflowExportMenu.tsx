import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { WorkflowExportSource, WorkflowFormat } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

const FORMATS: Array<{ format: WorkflowFormat; label: MessageKey }> = [
  { format: "md", label: "exportMd" },
  { format: "txt", label: "exportTxt" },
  { format: "json", label: "exportJson" },
];

/**
 * Export button with a small menu: what to export (when there is a choice) and the format.
 * The file is written by the main process after a normal "Save as" window.
 */
export function WorkflowExportMenu(props: {
  options: Array<{ label: MessageKey; source: WorkflowExportSource }>;
  class?: string;
}) {
  const [open, setOpen] = createSignal(false);
  const [choice, setChoice] = createSignal(0);
  const [busy, setBusy] = createSignal(false);
  const [message, setMessage] = createSignal<string | null>(null);
  let root: HTMLDivElement | undefined;

  onMount(() => {
    const close = (event: MouseEvent) => {
      if (open() && root && !root.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    onCleanup(() => document.removeEventListener("mousedown", close));
  });

  async function save(format: WorkflowFormat) {
    const option = props.options[choice()] ?? props.options[0];
    if (!option) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.sahkarmi.workflow.export(option.source, format);
      if (result) setMessage(t("exportSaved", { path: result.path }));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="workflow-export" ref={root}>
      <button
        type="button"
        class={props.class ?? "workflow-export-button"}
        aria-expanded={open()}
        aria-haspopup="dialog"
        onClick={() => {
          setMessage(null);
          setOpen((value) => !value);
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M10 3v10M6 9l4 4 4-4M4 16h12" />
        </svg>
        <span>{t("exportButton")}</span>
      </button>
      <Show when={open()}>
        <div
          class="workflow-export-popover"
          role="dialog"
          aria-label={t("exportButton")}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
        >
          <Show when={props.options.length > 1}>
            <div class="segmented">
              <For each={props.options}>
                {(option, index) => (
                  <button
                    type="button"
                    aria-pressed={choice() === index()}
                    classList={{ "segmented-active": choice() === index() }}
                    onClick={() => setChoice(index())}
                  >
                    {t(option.label)}
                  </button>
                )}
              </For>
            </div>
          </Show>
          <span class="workflow-export-label">{t("exportAs")}</span>
          <For each={FORMATS}>
            {(item) => (
              <button
                type="button"
                class="workflow-export-format"
                disabled={busy()}
                onClick={() => void save(item.format)}
              >
                {t(item.label)}
              </button>
            )}
          </For>
          <Show when={message()} fallback={<small>{t("exportHint")}</small>}>
            <small class="workflow-export-message" role="status">
              {message()}
            </small>
          </Show>
        </div>
      </Show>
    </div>
  );
}
