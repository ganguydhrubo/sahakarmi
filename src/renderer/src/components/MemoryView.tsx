import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
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

export function MemoryView() {
  const [memories, setMemories] = createSignal<AgentMemory[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
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
  let opener: HTMLButtonElement | undefined;

  const loadMemories = async () => {
    try {
      if (!window.sahkarmi?.memory) return;
      setMemories(await window.sahkarmi.memory.list());
    } catch (err) {
      console.error("Failed to load memories:", err);
    }
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
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const filteredMemories = () => {
    const q = searchQuery().toLowerCase().trim();
    return memories().filter((m) => {
      const matchesKind = selectedKind() === "all" || m.category === selectedKind();
      const matchesQuery =
        !q ||
        m.key.toLowerCase().includes(q) ||
        m.content.toLowerCase().includes(q) ||
        m.tags.some((tag) => tag.toLowerCase().includes(q));
      return matchesKind && matchesQuery;
    });
  };

  const closeDialog = () => {
    setShowAddModal(false);
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
    await window.sahkarmi.memory.save({
      key: newKey().trim(),
      content: newContent().trim(),
      category: newKind(),
      tags: newTags()
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    setNewKey("");
    setNewContent("");
    setNewTags("");
    closeDialog();
    await loadMemories();
  };

  const handleDelete = async (memory: AgentMemory) => {
    if (!window.sahkarmi?.memory) return;
    if (!window.confirm(t("memoryDeleteConfirm", { name: readableText(memory.key) }))) return;
    await window.sahkarmi.memory.delete(memory.id);
    await loadMemories();
  };

  return (
    <section class="center-view memory-view" aria-labelledby="memory-heading">
      <header class="center-view-header window-drag">
        <h1 id="memory-heading">{t("memoryTitle")}</h1>
        <span class="center-view-badge">{memories().length}</span>
        <div class="memory-header-actions no-drag">
          <input
            type="search"
            class="memory-search"
            placeholder={t("memorySearch")}
            aria-label={t("memorySearch")}
            value={searchQuery()}
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
          />
          <button
            ref={opener}
            type="button"
            class="button-primary"
            onClick={() => setShowAddModal(true)}
          >
            {t("memoryAdd")}
          </button>
        </div>
      </header>

      <div class="center-view-body">
        <p class="center-view-intro">{t("memorySubtitle")}</p>
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
          fallback={<p class="center-view-empty">{t("memoryEmpty")}</p>}
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
            <h2 id="memory-dialog-title">{t("memoryNewTitle")}</h2>
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
