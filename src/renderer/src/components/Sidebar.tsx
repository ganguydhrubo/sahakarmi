import { createMemo, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { AppInfo, CoworkerStatus, UpdateStatus, WorkspaceState } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { featureOn } from "../features";
import { type MessageKey, t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";
import { LogoMark } from "./Logo";
import { StatusDot, statusLabel } from "./StatusDot";

export type CenterView =
  | "coworker"
  | "tasks"
  | "files"
  | "approvals"
  | "schedules"
  | "usage"
  | "business"
  | "marketplace"
  | "activity"
  | "settings";

const RAIL_ITEMS: Array<{
  view: Exclude<CenterView, "coworker">;
  label: MessageKey;
  feature: string | null;
  icon: () => JSX.Element;
}> = [
  { view: "tasks", label: "navTasks", feature: null, icon: TasksIcon },
  { view: "files", label: "sharedFiles", feature: "shared-files", icon: FilesIcon },
  { view: "approvals", label: "approvals", feature: null, icon: ApprovalsIcon },
  { view: "schedules", label: "navSchedules", feature: "schedules", icon: ScheduleIcon },
  { view: "usage", label: "navUsage", feature: "model-usage", icon: UsageIcon },
  { view: "business", label: "navBusiness", feature: "business-targets", icon: BusinessIcon },
  { view: "marketplace", label: "navMarketplace", feature: "marketplace", icon: MarketplaceIcon },
  { view: "activity", label: "navActivity", feature: null, icon: ActivityIcon },
  { view: "settings", label: "settings", feature: null, icon: SettingsIcon },
];

interface SidebarProps {
  bots: BotProfile[];
  activeBotId: string;
  view: CenterView;
  appInfo: AppInfo | null;
  workspaces: WorkspaceState;
  statuses: Record<string, CoworkerStatus>;
  unread: Record<string, number>;
  pendingApprovals: number;
  onSelectBot: (botId: string) => void;
  onCreateBot: () => void;
  onEditBot: (botId: string) => void;
  onDeleteBot: (botId: string) => Promise<void>;
  onSelectView: (view: CenterView) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRenameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  onCollapse: () => void;
  /** Shown as a compact bar at the bottom of the sidebar while an update is on its way. */
  updateStatus?: UpdateStatus;
  onUpdateAction?: () => Promise<void>;
}

interface BotContextMenu {
  botId: string;
  x: number;
  y: number;
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-4 fill-none stroke-current">
      <circle cx="8.5" cy="8.5" r="5.5" stroke-width="1.6" />
      <path d="m12.7 12.7 3.6 3.6" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[18px] fill-none stroke-current">
      <path d="M10 4v12M4 10h12" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

export function SidebarToggleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="sidebar-toggle-icon">
      <rect x="2.75" y="3.25" width="14.5" height="13.5" rx="2.25" />
      <path d="M7.25 3.75v12.5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="bot-context-icon size-4 fill-none stroke-current"
    >
      <path d="m12.6 4.2 3.2 3.2-8.7 8.7-3.8.6.6-3.8 8.7-8.7Z" stroke-width="1.4" />
      <path d="m10.9 5.9 3.2 3.2" stroke-width="1.4" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="bot-context-icon bot-context-danger-icon size-4 fill-none stroke-current"
    >
      <path
        d="M4.5 6.2h11M8 3.8h4M6.2 6.2l.7 9.3h6.2l.7-9.3M8.4 8.7v4.5M11.6 8.7v4.5"
        stroke-width="1.35"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function MarketplaceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <path d="M3.5 7.5 4.6 3.8h10.8l1.1 3.7M3.5 7.5c0 1.2 1 2.1 2.2 2.1s2.1-.9 2.1-2.1c0 1.2 1 2.1 2.2 2.1s2.1-.9 2.1-2.1c0 1.2 1 2.1 2.2 2.1s2.2-.9 2.2-2.1M3.5 7.5h13M4.8 9.4v6.8h10.4V9.4M8.3 16.2v-3.6h3.4v3.6" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <path d="m3.5 5.5 1.3 1.3 2.4-2.6M3.5 11l1.3 1.3 2.4-2.6M9.5 5.6h7M9.5 11.1h7M9.5 15.8h7" />
    </svg>
  );
}


/** "Update ready → Restart" at the foot of the sidebar; wired to the normal update actions. */
export function SidebarUpdateBar(props: { status: UpdateStatus; onAction: () => Promise<void> }) {
  const [failed, setFailed] = createSignal(false);
  const phase = () => props.status.phase;
  const label = () => {
    switch (phase()) {
      case "ready":
        return t("updateBarReady");
      case "downloading":
        return t("updateBarDownloading", { progress: String(props.status.progress ?? 0) });
      case "installing":
        return t("updateBarInstalling");
      default:
        return t("updateBarAvailable");
    }
  };
  const action = () =>
    phase() === "ready"
      ? t("updateBarRestart")
      : phase() === "available"
        ? t("updateBarDownload")
        : null;
  return (
    <Show when={["available", "downloading", "ready", "installing"].includes(phase())}>
      <div class="sidebar-update-bar" role="status">
        <span class="sidebar-update-label">
          {label()}
          <Show when={props.status.availableVersion}>
            {(version) => <small> v{version()}</small>}
          </Show>
        </span>
        <Show when={action()}>
          {(text) => (
            <button
              type="button"
              class="sidebar-update-action"
              onClick={() => {
                setFailed(false);
                void props.onAction().catch(() => setFailed(true));
              }}
            >
              {text()}
            </button>
          )}
        </Show>
        <Show when={phase() === "downloading"}>
          <progress
            class="sidebar-update-progress"
            max="100"
            value={props.status.progress ?? 0}
            aria-label={label()}
          />
        </Show>
        <Show when={failed()}>
          <small class="sidebar-update-error">{t("updateActionFailed")}</small>
        </Show>
      </div>
    </Show>
  );
}

function FilesIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <path d="M3 6.2c0-.9.7-1.7 1.7-1.7h3.2l1.6 1.8h5.8c.9 0 1.7.7 1.7 1.7v6.8c0 .9-.7 1.7-1.7 1.7H4.7c-.9 0-1.7-.7-1.7-1.7Z" />
    </svg>
  );
}

function ApprovalsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <path d="M10 2.9 15.5 5v4.6c0 3.6-2.2 6.3-5.5 7.5-3.3-1.2-5.5-3.9-5.5-7.5V5L10 2.9Z" />
      <path d="m7.6 9.9 1.5 1.5 3.3-3.4" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <circle cx="10" cy="10.5" r="6.5" />
      <path d="M10 6.8v3.9l2.6 1.6M7.5 2.8h5" />
    </svg>
  );
}

function UsageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <path d="M3.5 16.5h13M5.5 13.5v-3M9 13.5V6.5M12.5 13.5v-5M16 13.5V4" />
    </svg>
  );
}

function BusinessIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <circle cx="10" cy="10" r="6.8" />
      <circle cx="10" cy="10" r="3.6" />
      <circle cx="10" cy="10" r=".9" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <path d="M2.8 10h3.4l2-5 3.6 10 2-5h3.4" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="rail-nav-icon">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="workspace-chevron">
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

export function Sidebar(props: SidebarProps) {
  const [query, setQuery] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<BotContextMenu | null>(null);
  const [deleteTargetId, setDeleteTargetId] = createSignal<string | null>(null);
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = createSignal(false);
  const [workspaceEditor, setWorkspaceEditor] = createSignal<
    { mode: "create" } | { mode: "rename"; workspaceId: string } | null
  >(null);
  const [workspaceName, setWorkspaceName] = createSignal("");
  const [workspaceError, setWorkspaceError] = createSignal<string | null>(null);
  let firstMenuItem: HTMLButtonElement | undefined;
  let workspaceInput: HTMLInputElement | undefined;

  const activeWorkspace = createMemo(
    () =>
      props.workspaces.workspaces.find(
        (workspace) => workspace.id === props.workspaces.activeWorkspaceId,
      ) ?? props.workspaces.workspaces[0],
  );
  const filteredBots = createMemo(() => {
    const normalizedQuery = query().trim().toLowerCase();
    return normalizedQuery
      ? props.bots.filter((bot) =>
          `${bot.name} ${bot.role} ${bot.preview}`.toLowerCase().includes(normalizedQuery),
        )
      : props.bots;
  });
  const deleteTarget = createMemo(() => props.bots.find((bot) => bot.id === deleteTargetId()));

  onMount(() => {
    const closeMenus = () => {
      setContextMenu(null);
      setWorkspaceMenuOpen(false);
      setWorkspaceEditor(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteTargetId()) setDeleteTargetId(null);
      else closeMenus();
    };
    window.addEventListener("pointerdown", closeMenus);
    window.addEventListener("blur", closeMenus);
    window.addEventListener("keydown", closeOnEscape);
    onCleanup(() => {
      window.removeEventListener("pointerdown", closeMenus);
      window.removeEventListener("blur", closeMenus);
      window.removeEventListener("keydown", closeOnEscape);
    });
  });

  function openContextMenu(botId: string, x: number, y: number) {
    setDeleteError(null);
    setContextMenu({
      botId,
      x: Math.max(8, Math.min(x, window.innerWidth - 190)),
      y: Math.max(8, Math.min(y, window.innerHeight - 116)),
    });
    requestAnimationFrame(() => firstMenuItem?.focus());
  }

  async function confirmDelete() {
    const botId = deleteTargetId();
    if (!botId || deleting()) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await props.onDeleteBot(botId);
      setDeleteTargetId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }

  function startWorkspaceEditor(mode: "create" | "rename") {
    const workspace = activeWorkspace();
    setWorkspaceError(null);
    setWorkspaceName(mode === "rename" ? (workspace?.name ?? "") : "");
    setWorkspaceEditor(
      mode === "rename" && workspace ? { mode, workspaceId: workspace.id } : { mode: "create" },
    );
    requestAnimationFrame(() => workspaceInput?.focus());
  }

  async function saveWorkspace(event: SubmitEvent) {
    event.preventDefault();
    const editor = workspaceEditor();
    const name = workspaceName().trim();
    if (!editor || !name) return;
    try {
      if (editor.mode === "create") await props.onCreateWorkspace(name);
      else await props.onRenameWorkspace(editor.workspaceId, name);
      setWorkspaceEditor(null);
      setWorkspaceMenuOpen(false);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <aside id="bot-sidebar" aria-label="Coworker navigation" class="sidebar left-rail panel-edge">
      <div class="window-drag sidebar-topbar rail-topbar">
        <div class="rail-brand">
          <LogoMark size={26} />
          <span class="rail-brand-name">
            <strong>Sahkarmi</strong>
            <small lang="hi">सहकर्मी</small>
          </span>
        </div>
        <button
          type="button"
          class="sidebar-icon-button sidebar-toggle-button no-drag"
          onClick={props.onCollapse}
          aria-label="Hide sidebar"
          aria-controls="bot-sidebar"
          aria-expanded="true"
          title="Hide sidebar"
        >
          <SidebarToggleIcon />
        </button>
      </div>

      <div class="workspace-switcher" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          class="workspace-button"
          aria-haspopup="menu"
          aria-expanded={workspaceMenuOpen()}
          aria-label={`${t("workspace")}: ${activeWorkspace()?.name ?? ""}`}
          onClick={() => {
            setWorkspaceMenuOpen((open) => !open);
            setWorkspaceEditor(null);
          }}
        >
          <span class="workspace-initial" aria-hidden="true">
            {(activeWorkspace()?.name ?? "S").slice(0, 1).toUpperCase()}
          </span>
          <span class="workspace-copy">
            <small>{t("workspace")}</small>
            <strong>{activeWorkspace()?.name}</strong>
          </span>
          <ChevronDownIcon />
        </button>
        <Show when={workspaceMenuOpen()}>
          <div class="workspace-menu" role="menu" aria-label={t("workspace")}>
            <For each={props.workspaces.workspaces}>
              {(workspace) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={workspace.id === props.workspaces.activeWorkspaceId}
                  class="workspace-menu-item"
                  onClick={() => {
                    props.onSelectWorkspace(workspace.id);
                    setWorkspaceMenuOpen(false);
                  }}
                >
                  <span class="workspace-initial" aria-hidden="true">
                    {workspace.name.slice(0, 1).toUpperCase()}
                  </span>
                  {workspace.name}
                </button>
              )}
            </For>
            <div class="bot-context-separator" />
            <Show
              when={workspaceEditor()}
              fallback={
                <>
                  <button
                    type="button"
                    role="menuitem"
                    class="workspace-menu-item"
                    onClick={() => startWorkspaceEditor("create")}
                  >
                    <PlusIcon /> {t("newWorkspace")}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    class="workspace-menu-item"
                    onClick={() => startWorkspaceEditor("rename")}
                  >
                    <EditIcon /> {t("renameWorkspace")}
                  </button>
                </>
              }
            >
              <form class="workspace-editor" onSubmit={(event) => void saveWorkspace(event)}>
                <input
                  ref={(element) => (workspaceInput = element)}
                  value={workspaceName()}
                  maxLength={60}
                  aria-label={t("workspaceNamePrompt")}
                  placeholder={t("workspaceNamePrompt")}
                  onInput={(event) => setWorkspaceName(event.currentTarget.value)}
                />
                <button type="submit" class="button-primary" disabled={!workspaceName().trim()}>
                  OK
                </button>
              </form>
              <Show when={workspaceError()}>
                <p class="workspace-error">{workspaceError()}</p>
              </Show>
            </Show>
          </div>
        </Show>
      </div>

      <div class="rail-section-heading">
        <span>{t("team")}</span>
        <span class="rail-count">{props.bots.length}</span>
      </div>

      <Show when={props.bots.length > 6}>
        <div class="sidebar-search-wrap">
          <label class="search-field">
            <span class="sr-only">{t("searchTeam")}</span>
            <SearchIcon />
            <input
              type="search"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("searchTeam")}
              aria-label={t("searchTeam")}
            />
          </label>
        </div>
      </Show>

      <nav aria-label={t("team")} class="bot-list team-list">
        <Show
          when={filteredBots().length > 0}
          fallback={
            <p class="empty-search">{props.bots.length ? t("noMatches") : t("noCoworkers")}</p>
          }
        >
          <For each={filteredBots()}>
            {(bot) => {
              const status = () => props.statuses[bot.id] ?? "idle";
              const unread = () => props.unread[bot.id] ?? 0;
              return (
                <button
                  type="button"
                  class="bot-row team-row"
                  classList={{
                    "bot-row-active": props.view === "coworker" && props.activeBotId === bot.id,
                    "bot-row-menu-open": contextMenu()?.botId === bot.id,
                  }}
                  aria-pressed={props.view === "coworker" && props.activeBotId === bot.id}
                  aria-label={`${bot.name}, ${bot.role || t("newCoworker")}, ${statusLabel(status())}`}
                  onClick={() => props.onSelectBot(bot.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openContextMenu(bot.id, event.clientX, event.clientY);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) {
                      return;
                    }
                    event.preventDefault();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    openContextMenu(bot.id, bounds.left + 28, bounds.top + 32);
                  }}
                >
                  <span class="bot-row-avatar">
                    <AgentAvatar bot={bot} />
                    <StatusDot status={status()} class="team-row-status" />
                  </span>
                  <span class="bot-row-copy">
                    <strong>{bot.name}</strong>
                    <span class="team-row-role">{bot.role || "—"}</span>
                  </span>
                  <Show when={unread() > 0}>
                    <span class="team-row-unread" aria-hidden="true">
                      {unread()}
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </Show>
        <button type="button" class="new-coworker-button" onClick={props.onCreateBot}>
          <span class="new-coworker-plus" aria-hidden="true">
            <PlusIcon />
          </span>
          {t("newCoworker")}
        </button>
      </nav>

      <nav class="rail-nav" aria-label="Sahkarmi">
        <For
          each={RAIL_ITEMS.filter(
            (item) =>
              item.feature === null ||
              featureOn(item.feature) ||
              (item.feature === "business-targets" && featureOn("integrations")),
          )}
        >
          {(item) => (
            <button
              type="button"
              class="rail-nav-item"
              classList={{ "rail-nav-active": props.view === item.view }}
              aria-current={props.view === item.view ? "page" : undefined}
              onClick={() => props.onSelectView(item.view)}
            >
              {item.icon()}
              <span>{t(item.label)}</span>
              <Show when={item.view === "approvals" && props.pendingApprovals > 0}>
                <span class="rail-badge">
                  {props.pendingApprovals}
                  <span class="sr-only"> {t("pending")}</span>
                </span>
              </Show>
            </button>
          )}
        </For>
        <Show when={props.updateStatus && props.onUpdateAction}>
          <SidebarUpdateBar
            status={props.updateStatus as UpdateStatus}
            onAction={() => props.onUpdateAction?.() ?? Promise.resolve()}
          />
        </Show>
        <p class="rail-tagline">
          {t("tagline")}
          <Show when={props.appInfo}>
            {(info) => (
              <span class="sr-only" data-testid="app-version">
                Version {info().version} · {info().platform}
              </span>
            )}
          </Show>
        </p>
      </nav>

      <Show when={contextMenu()}>
        {(menu) => (
          <Portal>
            <div
              class="bot-context-menu"
              role="menu"
              aria-label={t("editCoworker")}
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                ref={(element) => (firstMenuItem = element)}
                type="button"
                role="menuitem"
                onClick={() => {
                  const botId = menu().botId;
                  setContextMenu(null);
                  props.onEditBot(botId);
                }}
              >
                <EditIcon />
                <span>{t("editCoworker")}</span>
              </button>
              <div class="bot-context-separator" />
              <button
                type="button"
                role="menuitem"
                class="bot-context-danger"
                onClick={() => {
                  const botId = menu().botId;
                  setContextMenu(null);
                  setDeleteTargetId(botId);
                }}
              >
                <DeleteIcon />
                <span>{t("deleteCoworker")}</span>
              </button>
            </div>
          </Portal>
        )}
      </Show>

      <Show when={deleteTarget()}>
        {(bot) => (
          <Portal>
            <div
              class="bot-delete-backdrop"
              role="presentation"
              onPointerDown={(event) => {
                if (event.currentTarget === event.target && !deleting()) setDeleteTargetId(null);
              }}
            >
              <section
                class="bot-delete-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="bot-delete-title"
                aria-describedby="bot-delete-description"
              >
                <AgentAvatar
                  bot={bot()}
                  style={{ width: "44px", height: "44px", "margin-bottom": "15px" }}
                />
                <h2 id="bot-delete-title">Delete {bot().name}?</h2>
                <p id="bot-delete-description">
                  This removes the coworker, its queue, schedules, approvals and managed files used
                  only by that conversation. Its workspace folder and CLI history stay on this
                  computer.
                </p>
                <Show when={deleteError()}>
                  {(message) => <p class="bot-delete-error">{message()}</p>}
                </Show>
                <div class="bot-delete-actions">
                  <button
                    type="button"
                    disabled={deleting()}
                    onClick={() => setDeleteTargetId(null)}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    class="bot-delete-confirm"
                    disabled={deleting()}
                    onClick={() => void confirmDelete()}
                  >
                    {deleting() ? "Deleting…" : t("delete")}
                  </button>
                </div>
              </section>
            </div>
          </Portal>
        )}
      </Show>
    </aside>
  );
}
