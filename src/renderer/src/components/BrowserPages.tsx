import { For, type JSX, Show } from "solid-js";
import type { BrowserTab } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

export type BrowserStartAction = "browser" | "files" | "tasks" | "settings" | "voice";

function MenuIcon(props: { children: JSX.Element }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      class="browser-start-icon fill-none stroke-current"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      {props.children}
    </svg>
  );
}

const START_ITEMS: Array<{
  action: BrowserStartAction;
  label: MessageKey;
  icon: () => JSX.Element;
}> = [
  {
    action: "browser",
    label: "menuOpenBrowser",
    icon: () => (
      <MenuIcon>
        <rect x="3" y="4" width="14" height="9.5" rx="1.5" />
        <path d="M7.5 16.5h5M10 13.5v3" />
      </MenuIcon>
    ),
  },
  {
    action: "files",
    label: "menuOpenFiles",
    icon: () => (
      <MenuIcon>
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h3.2l1.6 1.7h6.2A1.5 1.5 0 0 1 17 8.2v6.3a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />
      </MenuIcon>
    ),
  },
  {
    action: "tasks",
    label: "menuOpenTasks",
    icon: () => (
      <MenuIcon>
        <path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M10 6.5h6.5M10 12.5h6.5" />
      </MenuIcon>
    ),
  },
  {
    action: "settings",
    label: "menuOpenSettings",
    icon: () => (
      <MenuIcon>
        <circle cx="10" cy="10" r="2.4" />
        <path d="M10 2.8v2M10 15.2v2M2.8 10h2M15.2 10h2M4.9 4.9l1.4 1.4M13.7 13.7l1.4 1.4M4.9 15.1l1.4-1.4M13.7 6.3l1.4-1.4" />
      </MenuIcon>
    ),
  },
  {
    action: "voice",
    label: "menuOpenVoice",
    icon: () => (
      <MenuIcon>
        <path d="M3.5 9v2M6.5 7v6M10 4.5v11M13.5 7v6M16.5 9v2" />
      </MenuIcon>
    ),
  },
];

/** The first thing the browser panel shows before any page is open. */
export function BrowserStartMenu(props: { onAction: (action: BrowserStartAction) => void }) {
  return (
    <nav class="browser-start-menu" aria-label={t("browser")}>
      <For each={START_ITEMS}>
        {(item) => (
          <button
            type="button"
            class="browser-start-item"
            data-action={item.action}
            onClick={() => props.onAction(item.action)}
          >
            {item.icon()}
            <span>{t(item.label)}</span>
          </button>
        )}
      </For>
    </nav>
  );
}

function CardCloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path d="m5 5 10 10M15 5 5 15" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}

/** Every open page as a small live picture; click one to open it, X to close it. */
export function BrowserPageList(props: {
  tabs: BrowserTab[];
  activeTabId: string | null;
  previews: Record<string, string>;
  controlledTabIds: ReadonlySet<string>;
  onOpen: (tabId: string) => void;
  onClose: (tabId: string) => void;
}) {
  return (
    <ul class="browser-pages" aria-label={t("browserPages")}>
      <For each={props.tabs}>
        {(tab) => {
          const title = () => (tab.loading ? "Loading…" : tab.title || tab.url);
          return (
            <li
              class="browser-page-card"
              classList={{
                "browser-page-card-active": tab.id === props.activeTabId,
                "browser-page-card-controlled": props.controlledTabIds.has(tab.id),
              }}
            >
              <button
                type="button"
                class="browser-page-open"
                aria-label={`${t("browserOpenPage")}: ${title()}`}
                title={tab.url}
                onClick={() => props.onOpen(tab.id)}
              >
                <span class="browser-page-frame">
                  <Show
                    when={props.previews[tab.id]}
                    fallback={
                      <span class="browser-page-empty">{t("browserPreviewUnavailable")}</span>
                    }
                  >
                    {(image) => <img src={image()} alt="" />}
                  </Show>
                </span>
                <span class="browser-page-title">{title()}</span>
              </button>
              <button
                type="button"
                class="browser-page-close"
                aria-label={`${t("browserClosePage")}: ${title()}`}
                title={t("browserClosePage")}
                onClick={() => props.onClose(tab.id)}
              >
                <CardCloseIcon />
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
