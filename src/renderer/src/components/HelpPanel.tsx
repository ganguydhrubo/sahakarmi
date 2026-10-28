import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { type MessageKey, t } from "../i18n";
import { onboardingState, resetOnboarding, setChecklistHidden } from "../onboarding";
import type { CenterView } from "./Sidebar";

const SCREEN_HELP: Record<CenterView, { title: MessageKey; body: MessageKey }> = {
  coworker: { title: "team", body: "screenCoworker" },
  tasks: { title: "navTasks", body: "screenTasks" },
  orchestrator: { title: "navOrchestrator", body: "screenOrchestrator" },
  memory: { title: "navMemory", body: "screenMemory" },
  files: { title: "sharedFiles", body: "screenFiles" },
  approvals: { title: "approvals", body: "screenApprovals" },
  schedules: { title: "navSchedules", body: "screenSchedules" },
  routines: { title: "navRoutines", body: "screenRoutines" },
  usage: { title: "navUsage", body: "screenUsage" },
  business: { title: "navBusiness", body: "screenBusiness" },
  marketplace: { title: "navMarketplace", body: "screenMarketplace" },
  activity: { title: "navActivity", body: "screenActivity" },
  settings: { title: "settings", body: "screenSettings" },
};

/** done: the app confirms it · todo: can be done, not yet confirmed · optional: cannot be checked. */
type ItemStatus = "done" | "todo" | "optional";

interface ChecklistItem {
  id: string;
  title: MessageKey;
  hint: MessageKey;
  status: ItemStatus;
  action?: { label: MessageKey; run: () => void };
}

const VISIBLE_ITEMS = 3;

export interface HelpPanelProps {
  view: CenterView;
  providerConnected: boolean;
  hasTask: boolean;
  /** null when Routines is switched off in Settings → Features. */
  routineCount: number | null;
  onClose: () => void;
  onConnect: () => void;
  onStartTask: () => void;
  onOpenSkills: () => void;
  onOpenRoutines: () => void;
  onStartTour: () => void;
}

export function HelpPanel(props: HelpPanelProps) {
  let panel: HTMLElement | undefined;
  const [toolsAdded, setToolsAdded] = createSignal<boolean | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [confirmReset, setConfirmReset] = createSignal(false);
  const [resetDone, setResetDone] = createSignal(false);

  onMount(() => {
    // Read once when Help opens; a failure just leaves the item as Optional.
    void Promise.all([
      window.sahkarmi.customSkills?.list() ?? Promise.resolve([]),
      window.sahkarmi.mcp?.list() ?? Promise.resolve([]),
    ])
      .then(([skills, servers]) => setToolsAdded(skills.length > 0 || servers.length > 0))
      .catch(() => setToolsAdded(null));
    panel?.querySelector<HTMLElement>(".help-panel-close")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panel?.contains(target)) return;
      if ((target as Element).closest?.("[data-help-button]")) return;
      props.onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    keepClearOfComposer();
    window.addEventListener("resize", keepClearOfComposer);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", keepClearOfComposer);
    });
  });

  /** With the team list hidden or narrow, sit above the message box instead of over it. */
  function keepClearOfComposer() {
    if (!panel) return;
    panel.style.bottom = "";
    panel.style.maxHeight = "";
    const composer = document.querySelector('[data-tour="composer"]')?.getBoundingClientRect();
    const own = panel.getBoundingClientRect();
    if (composer && own.right > composer.left && own.left < composer.right) {
      const bottom = Math.max(12, window.innerHeight - composer.top + 8);
      panel.style.bottom = `${bottom}px`;
      panel.style.maxHeight = `${Math.max(160, window.innerHeight - bottom - 12)}px`;
    }
  }

  const items = createMemo<ChecklistItem[]>(() => {
    const list: ChecklistItem[] = [
      {
        id: "provider",
        title: "checkProvider",
        hint: "checkProviderHint",
        status: props.providerConnected ? "done" : "todo",
        action: { label: "checkProviderAction", run: props.onConnect },
      },
      {
        id: "task",
        title: "checkTask",
        hint: "checkTaskHint",
        status: props.hasTask ? "done" : "todo",
        action: { label: "checkTaskAction", run: props.onStartTask },
      },
      { id: "browser", title: "checkBrowser", hint: "checkBrowserHint", status: "optional" },
      {
        id: "tools",
        title: "checkTools",
        hint: "checkToolsHint",
        status: toolsAdded() === true ? "done" : "optional",
        action: { label: "checkToolsAction", run: props.onOpenSkills },
      },
    ];
    if (props.routineCount !== null) {
      list.push({
        id: "workflow",
        title: "checkWorkflow",
        hint: "checkWorkflowHint",
        status: props.routineCount > 0 ? "done" : "optional",
        action: { label: "checkWorkflowAction", run: props.onOpenRoutines },
      });
    }
    // Things still to do first, then optional ones, then what is done.
    const rank: Record<ItemStatus, number> = { todo: 0, optional: 1, done: 2 };
    return list
      .map((item, index) => ({ item, index }))
      .sort((a, b) => rank[a.item.status] - rank[b.item.status] || a.index - b.index)
      .map(({ item }) => item);
  });
  // The browser item cannot be checked, so it never holds the quiet "all done" line back.
  const allDone = createMemo(() =>
    items().every((item) => item.status === "done" || item.id === "browser"),
  );
  const shown = createMemo(() => (expanded() ? items() : items().slice(0, VISIBLE_ITEMS)));
  const screen = () => SCREEN_HELP[props.view] ?? SCREEN_HELP.coworker;

  return (
    <section
      ref={(element) => (panel = element)}
      class="help-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="help-panel-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <header class="help-panel-header">
        <h2 id="help-panel-title">{t("helpButton")}</h2>
        <button
          type="button"
          class="help-panel-close"
          aria-label={t("helpClose")}
          title={t("helpClose")}
          onClick={props.onClose}
        >
          ✕
        </button>
      </header>

      <div class="help-panel-section help-panel-screen">
        <h3>{t("helpThisScreen")}</h3>
        <p>
          <strong>{t(screen().title)}</strong> · {t(screen().body)}
        </p>
      </div>

      <div class="help-panel-section">
        <div class="help-panel-section-head">
          <h3>{t("helpGettingStarted")}</h3>
          <button
            type="button"
            class="help-panel-link"
            aria-expanded={!onboardingState().checklistHidden}
            onClick={() => setChecklistHidden(!onboardingState().checklistHidden)}
          >
            {onboardingState().checklistHidden ? t("helpShowChecklist") : t("helpHideChecklist")}
          </button>
        </div>
        <Show when={!onboardingState().checklistHidden}>
          <Show when={allDone()}>
            <p class="help-panel-quiet">{t("helpAllDone")}</p>
          </Show>
          <ul class="help-checklist">
            <For each={shown()}>
              {(item) => (
                <li class="help-checklist-item" data-status={item.status} data-item={item.id}>
                  <span class="help-checklist-mark" aria-hidden="true">
                    {item.status === "done" ? "✓" : item.status === "optional" ? "○" : "•"}
                  </span>
                  <div class="help-checklist-copy">
                    <strong>{t(item.title)}</strong>
                    <span>{t(item.hint)}</span>
                  </div>
                  <Show when={item.status !== "todo"}>
                    <span class="help-checklist-status">
                      {item.status === "done" ? t("helpDone") : t("helpOptional")}
                    </span>
                  </Show>
                  <Show when={item.status !== "done" && item.action}>
                    {(action) => (
                      <button type="button" class="help-checklist-action" onClick={action().run}>
                        {t(action().label)}
                      </button>
                    )}
                  </Show>
                </li>
              )}
            </For>
          </ul>
          <Show when={items().length > VISIBLE_ITEMS}>
            <button
              type="button"
              class="help-panel-link"
              aria-expanded={expanded()}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded()
                ? t("helpShowFewer")
                : t("helpShowAll", { count: String(items().length) })}
            </button>
          </Show>
        </Show>
      </div>

      <div class="help-panel-footer">
        <button type="button" class="button-primary" onClick={props.onStartTour}>
          {t("helpShowMeAround")}
        </button>
        <Show
          when={confirmReset()}
          fallback={
            <button
              type="button"
              class="help-panel-link"
              onClick={() => {
                setResetDone(false);
                setConfirmReset(true);
              }}
            >
              {t("helpReset")}
            </button>
          }
        >
          <fieldset class="help-panel-confirm">
            <legend>{t("helpResetConfirm")}</legend>
            <button
              type="button"
              onClick={() => {
                resetOnboarding();
                setConfirmReset(false);
                setResetDone(true);
                setExpanded(false);
              }}
            >
              {t("helpResetYes")}
            </button>
            <button type="button" onClick={() => setConfirmReset(false)}>
              {t("helpResetCancel")}
            </button>
          </fieldset>
        </Show>
        <Show when={resetDone()}>
          <p class="help-panel-quiet" role="status">
            {t("helpResetDone")}
          </p>
        </Show>
      </div>
    </section>
  );
}
