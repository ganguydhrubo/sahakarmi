import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import type { AgentMemory } from "../../../shared/ipc";
import { t } from "../i18n";
import { speechLocale } from "../preferences";

type MemoryKind = "fact" | "decision" | "preference" | "architecture";

const KINDS: MemoryKind[] = ["fact", "decision", "preference", "architecture"];

const KIND_LABELS = {
  fact: "memoryKindFact",
  decision: "memoryKindDecision",
  preference: "memoryKindPreference",
  architecture: "memoryKindArchitecture",
} as const;

const kindLabel = (kind: string) => t(KIND_LABELS[kind as MemoryKind] ?? "memoryKindFact");

/** Long notes start folded so the grid stays even; the owner can open each one. */
const LONG_NOTE = 360;

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
};

/** Coworkers sometimes save "&amp;" for "&"; show what they meant. */
export function readableText(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|#39|#x27|apos);/g,
    (entity) => ENTITIES[entity] ?? entity,
  );
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(speechLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Memories shown at first and added by each "Show more". */
const PAGE = 100;

export function MemoryView(props: {
  workspaceId: string;
  bots?: Array<{ id: string; name: string }>;
}) {
  const [memories, setMemories] = createSignal<AgentMemory[]>([]);
  const [total, setTotal] = createSignal(0);
  const [shown, setShown] = createSignal(PAGE);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [selectedKind, setSelectedKind] = createSignal<"all" | MemoryKind>("all");
  const [showAddModal, setShowAddModal] = createSignal(false);
  const [error, setError] = createSignal("");

  const [newKey, setNewKey] = createSignal("");
  const [newContent, setNewContent] = createSignal("");
  const [newKind, setNewKind] = createSignal<MemoryKind>("fact");
  const [newTags, setNewTags] = createSignal("");
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const countFor = (kind: "all" | MemoryKind) =>
    kind === "all" ? memories().length : memories().filter((m) => m.category === kind).length;
  const authorName = (botId: string | undefined) =>
    botId ? props.bots?.find((bot) => bot.id === botId)?.name : undefined;
  let opener: HTMLButtonElement | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let loadId = 0;

  /** This workspace's memories: the newest page, or the best matches for the search box. */
  const loadMemories = async () => {
    const id = ++loadId;
    try {
      if (!window.sahkarmi?.memory || !props.workspaceId) return;
      const result = await window.sahkarmi.memory.list({
        workspaceId: props.workspaceId,
        query: searchQuery().trim() || undefined,
        limit: shown(),
      });
      if (id !== loadId) return;
      setMemories(result.memories);
      setTotal(result.total);
    } catch (err) {
      console.error("Failed to load memories:", err);
    }
  };

  createEffect(
    on(
      () => props.workspaceId,
      () => {
        setShown(PAGE);
        void loadMemories();
      },
      { defer: true },
    ),
  );

  const onSearch = (value: string) => {
    setSearchQuery(value);
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadMemories(), 200);
  };

  onMount(() => {
    void loadMemories();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showAddModal()) {
        event.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey);
      if (searchTimer) clearTimeout(searchTimer);
    });
  });

  // The search runs in the memory database (word forms match); the kind filter is local.
  const filteredMemories = () =>
    memories().filter((m) => selectedKind() === "all" || m.category === selectedKind());

  const openNew = () => {
    setEditingId(null);
    setNewKey("");
    setNewContent("");
    setNewKind("fact");
    setNewTags("");
    setShowAddModal(true);
  };

  const openEdit = (memory: AgentMemory) => {
    setEditingId(memory.id);
    setNewKey(readableText(memory.key));
    setNewContent(readableText(memory.content));
    setNewKind(
      (KINDS as string[]).includes(memory.category) ? (memory.category as MemoryKind) : "fact",
    );
    setNewTags(memory.tags.join(", "));
    setShowAddModal(true);
  };

  const closeDialog = () => {
    setShowAddModal(false);
    setEditingId(null);
    setError("");
    opener?.focus();
  };

  const handleSave = async (event: Event) => {
    event.preventDefault();
    if (!newKey().trim() || !newContent().trim()) {
      setError(t("memoryNeedBoth"));
      return;
    }
    if (!window.sahkarmi?.memory) return;
    try {
      await window.sahkarmi.memory.save({
        workspaceId: props.workspaceId,
        id: editingId() ?? undefined,
        key: newKey().trim(),
        content: newContent().trim(),
        category: newKind(),
        tags: newTags()
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
    } catch (err) {
      setError(t("memorySaveFailed", { error: err instanceof Error ? err.message : String(err) }));
      return;
    }
    setNewKey("");
    setNewContent("");
    setNewTags("");
    closeDialog();
    await loadMemories();
  };

  const handleDelete = async (memory: AgentMemory) => {
    if (!window.sahkarmi?.memory) return;
    if (!window.confirm(t("memoryDeleteConfirm", { name: readableText(memory.key) }))) return;
    try {
      await window.sahkarmi.memory.delete(memory.id, props.workspaceId);
    } catch (err) {
      window.alert(
        t("memoryDeleteFailed", { error: err instanceof Error ? err.message : String(err) }),
      );
    }
    await loadMemories();
  };

  return (
    <section class="center-view memory-view" aria-labelledby="memory-heading">
      <header class="center-view-header window-drag">
        <h1 id="memory-heading">{t("memoryTitle")}</h1>
        <span class="center-view-badge">{searchQuery().trim() ? memories().length : total()}</span>
        <div class="memory-header-actions no-drag">
          <input
            type="search"
            class="memory-search"
            placeholder={t("memorySearch")}
            aria-label={t("memorySearch")}
            value={searchQuery()}
            onInput={(event) => onSearch(event.currentTarget.value)}
          />
          <button ref={opener} type="button" class="button-primary" onClick={openNew}>
            {t("memoryAdd")}
          </button>
        </div>
      </header>

      <div class="center-view-body">
        <p class="center-view-intro">{t("memorySubtitle")}</p>
        <p class="center-view-intro">{t("memoryScopeNote")}</p>
        <fieldset class="memory-filters">
          <legend class="sr-only">{t("memoryKind")}</legend>
          <For each={["all", ...KINDS] as const}>
            {(kind) => (
              <button
                type="button"
                class="marketplace-filter"
                aria-pressed={selectedKind() === kind}
                onClick={() => setSelectedKind(kind)}
              >
                {kind === "all" ? t("memoryAll") : kindLabel(kind)}
                <span class="marketplace-filter-count">{countFor(kind)}</span>
              </button>
            )}
          </For>
        </fieldset>

        <Show
          when={filteredMemories().length > 0}
          fallback={
            <p class="center-view-empty">
              {searchQuery().trim() ? t("memoryNoMatch") : t("memoryEmpty")}
            </p>
          }
        >
          <ul class="memory-grid">
            <For each={filteredMemories()}>
              {(memory) => {
                const long = () => memory.content.length > LONG_NOTE;
                const open = () => expanded().has(memory.id);
                return (
                  <li class={`memory-card memory-card-${memory.category}`}>
                    <div class="memory-card-head">
                      <h2>{readableText(memory.key)}</h2>
                      <span class={`memory-kind memory-kind-${memory.category}`}>
                        {kindLabel(memory.category)}
                      </span>
                    </div>
                    <p
                      id={`memory-content-${memory.id}`}
                      class="memory-content"
                      classList={{ "memory-content-folded": long() && !open() }}
                    >
                      {readableText(memory.content)}
                    </p>
                    <Show when={long()}>
                      <button
                        type="button"
                        class="memory-more"
                        aria-expanded={open()}
                        aria-controls={`memory-content-${memory.id}`}
                        onClick={() => toggleExpanded(memory.id)}
                      >
                        {open() ? t("showLess") : t("showAll")}
                      </button>
                    </Show>
                    <Show when={memory.tags.length > 0}>
                      <span class="memory-tags">
                        <For each={memory.tags}>{(tag) => <span>#{readableText(tag)}</span>}</For>
                      </span>
                    </Show>
                    <div class="memory-card-foot">
                      <time class="memory-updated" dateTime={memory.updatedAt}>
                        {formatUpdated(memory.updatedAt)}
                      </time>
                      <Show when={authorName(memory.authorBotId)}>
                        {(name) => (
                          <span class="memory-updated">
                            {t("memoryByCoworker", { name: name() })}
                          </span>
                        )}
                      </Show>
                      <button type="button" class="memory-more" onClick={() => openEdit(memory)}>
                        {t("memoryEdit")}
                      </button>
                      <button
                        type="button"
                        class="button-danger-quiet memory-delete"
                        onClick={() => void handleDelete(memory)}
                      >
                        {t("memoryDelete")}
                      </button>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
          <Show when={!searchQuery().trim() && total() > memories().length}>
            <p class="center-view-intro">
              {t("memoryShowing", { shown: String(memories().length), total: String(total()) })}{" "}
              <button
                type="button"
                class="memory-more"
                onClick={() => {
                  setShown((count) => count + PAGE);
                  void loadMemories();
                }}
              >
                {t("memoryLoadMore")}
              </button>
            </p>
          </Show>
        </Show>
      </div>

      <Show when={showAddModal()}>
        {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: clicking the dimmed backdrop closes the dialog; Escape and Cancel do the same from the keyboard */}
        <div class="marketplace-detail-backdrop" onClick={closeDialog}>
          <form
            ref={(form) => requestAnimationFrame(() => form.querySelector("input")?.focus())}
            class="marketplace-detail memory-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="memory-dialog-title"
            noValidate
            onSubmit={(event) => void handleSave(event)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                closeDialog();
              }
            }}
          >
            <h2 id="memory-dialog-title">
              {editingId() ? t("memoryEditTitle") : t("memoryNewTitle")}
            </h2>
            <label class="memory-field">
              <span>{t("memoryName")}</span>
              <input
                value={newKey()}
                placeholder={t("memoryNamePlaceholder")}
                onInput={(event) => setNewKey(event.currentTarget.value)}
              />
            </label>
            <label class="memory-field">
              <span>{t("memoryKind")}</span>
              <select
                value={newKind()}
                onChange={(event) => setNewKind(event.currentTarget.value as MemoryKind)}
              >
                <For each={KINDS}>{(kind) => <option value={kind}>{kindLabel(kind)}</option>}</For>
              </select>
            </label>
            <label class="memory-field">
              <span>{t("memoryDetails")}</span>
              <textarea
                rows={4}
                value={newContent()}
                placeholder={t("memoryDetailsPlaceholder")}
                onInput={(event) => setNewContent(event.currentTarget.value)}
              />
            </label>
            <label class="memory-field">
              <span>{t("memoryTags")}</span>
              <input
                value={newTags()}
                placeholder={t("memoryTagsPlaceholder")}
                onInput={(event) => setNewTags(event.currentTarget.value)}
              />
            </label>
            <Show when={error()}>
              <p class="approval-error" role="alert">
                {error()}
              </p>
            </Show>
            <div class="memory-dialog-actions">
              <button type="button" onClick={closeDialog}>
                {t("cancel")}
              </button>
              <button type="submit" class="button-primary">
                {t("memorySave")}
              </button>
            </div>
          </form>
        </div>
      </Show>
    </section>
  );
}
