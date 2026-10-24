import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { MessageSearchHit } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { t } from "../i18n";

export interface GlobalSearchProps {
  open: boolean;
  bots: BotProfile[];
  workspaceId: string | null;
  onClose: () => void;
  onOpenBot: (botId: string, messageId?: string) => void;
}

type SearchRow =
  | { kind: "bot"; id: string; bot: BotProfile }
  | { kind: "message"; id: string; hit: MessageSearchHit };

/** Ctrl/Cmd+K palette: coworkers by name or role, and every message of the workspace. */
export function GlobalSearch(props: GlobalSearchProps) {
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<MessageSearchHit[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [active, setActive] = createSignal(0);
  let input: HTMLInputElement | undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;

  const botRows = (): SearchRow[] => {
    const needle = query().trim().toLowerCase();
    return props.bots
      .filter(
        (bot) =>
          !needle ||
          bot.name.toLowerCase().includes(needle) ||
          (bot.role ?? "").toLowerCase().includes(needle),
      )
      .slice(0, needle ? 6 : 9)
      .map((bot) => ({ kind: "bot" as const, id: `bot:${bot.id}`, bot }));
  };
  const rows = (): SearchRow[] => [
    ...botRows(),
    ...hits().map((hit) => ({ kind: "message" as const, id: `msg:${hit.messageId}`, hit })),
  ];

  function runSearch(text: string) {
    const needle = text.trim();
    if (timer) clearTimeout(timer);
    if (needle.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer = setTimeout(() => {
      const id = ++requestId;
      void window.sahkarmi.agent
        .searchMessages({ query: needle, workspaceId: props.workspaceId ?? undefined })
        .then((found) => {
          if (id !== requestId) return;
          setHits(found);
          setActive(0);
        })
        .catch(() => {
          if (id === requestId) setHits([]);
        })
        .finally(() => {
          if (id === requestId) setSearching(false);
        });
    }, 180);
  }

  function choose(row: SearchRow | undefined) {
    if (!row) return;
    if (row.kind === "bot") props.onOpenBot(row.bot.id);
    else props.onOpenBot(row.hit.botId, row.hit.messageId);
    props.onClose();
  }

  function onKeyDown(event: KeyboardEvent) {
    const count = rows().length;
    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      setActive((current) => (current + 1) % count);
    } else if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      setActive((current) => (current - 1 + count) % count);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(rows()[active()]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      props.onClose();
    }
  }

  createEffect(() => {
    if (!props.open) return;
    setQuery("");
    setHits([]);
    setActive(0);
    requestAnimationFrame(() => input?.focus());
  });
  onMount(() => onCleanup(() => timer && clearTimeout(timer)));

  const botName = (botId: string) => props.bots.find((bot) => bot.id === botId)?.name ?? botId;

  return (
    <Show when={props.open}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop closes the palette; the dialog itself handles keys */}
      <div class="global-search-backdrop" onClick={props.onClose}>
        <div
          class="global-search"
          role="dialog"
          aria-label={t("searchEverything")}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <input
            ref={input}
            type="search"
            class="global-search-input"
            placeholder={t("searchEverythingHint")}
            aria-label={t("searchEverything")}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              runSearch(event.currentTarget.value);
            }}
          />
          <div class="global-search-results" role="listbox" aria-label={t("searchEverything")}>
            <Show when={botRows().length}>
              <p class="global-search-heading">{t("searchCoworkers")}</p>
            </Show>
            <For each={rows()}>
              {(row, index) => (
                <>
                  <Show when={row.kind === "message" && index() === botRows().length}>
                    <p class="global-search-heading">{t("searchMessages")}</p>
                  </Show>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index() === active()}
                    classList={{
                      "global-search-row": true,
                      "global-search-row-active": index() === active(),
                    }}
                    onMouseEnter={() => setActive(index())}
                    onClick={() => choose(row)}
                  >
                    <Show
                      when={row.kind === "bot" && row}
                      fallback={
                        <Show when={row.kind === "message" && row}>
                          {(item) => (
                            <>
                              <strong>
                                {item().hit.author === "user"
                                  ? t("you")
                                  : botName(item().hit.botId)}
                                <span class="global-search-meta">
                                  {" · "}
                                  {botName(item().hit.botId)}
                                </span>
                              </strong>
                              <span class="global-search-excerpt">{item().hit.excerpt}</span>
                            </>
                          )}
                        </Show>
                      }
                    >
                      {(item) => (
                        <>
                          <strong>{item().bot.name}</strong>
                          <span class="global-search-excerpt">{item().bot.role}</span>
                        </>
                      )}
                    </Show>
                  </button>
                </>
              )}
            </For>
            <Show when={!rows().length && query().trim().length >= 2 && !searching()}>
              <p class="global-search-empty">{t("searchNothing")}</p>
            </Show>
            <Show when={searching()}>
              <p class="global-search-empty">{t("searching")}</p>
            </Show>
          </div>
          <p class="global-search-footer">{t("shortcutsHint")}</p>
        </div>
      </div>
    </Show>
  );
}
