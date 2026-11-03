import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
  KnowledgeBaseSummary,
  KnowledgeHit,
  KnowledgeProgress,
  KnowledgeSourceStatus,
  KnowledgeSourceSummary,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { speechLocale } from "../preferences";

const STATUS_LABELS: Record<KnowledgeSourceStatus, MessageKey> = {
  pending: "knowledgeStatusPending",
  indexing: "knowledgeStatusIndexing",
  ready: "knowledgeStatusReady",
  failed: "knowledgeStatusFailed",
  missing: "knowledgeStatusMissing",
};

/** "GST_Rules.pdf, p. 14" for a search hit. */
export function hitLabel(hit: KnowledgeHit): string {
  const c = hit.citation;
  const where =
    c.page !== null
      ? `p. ${c.page}`
      : c.slide !== null
        ? `slide ${c.slide}`
        : c.sheet
          ? `sheet ${c.sheet}`
          : c.heading
            ? c.heading
            : "";
  return where ? `${c.fileName}, ${where}` : c.fileName;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(speechLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function KnowledgeView(props: { workspaceId: string; bots: BotProfile[] }) {
  const [bases, setBases] = createSignal<KnowledgeBaseSummary[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [newName, setNewName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [renameValue, setRenameValue] = createSignal("");
  const [error, setError] = createSignal("");
  const [progress, setProgress] = createSignal<KnowledgeProgress | null>(null);
  const [query, setQuery] = createSignal("");
  const [hits, setHits] = createSignal<KnowledgeHit[] | null>(null);
  const [searching, setSearching] = createSignal(false);
  const [dropActive, setDropActive] = createSignal(false);

  const dropFiles = (event: DragEvent, kbId: string) => {
    event.preventDefault();
    setDropActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    const paths = api()?.pathsForFiles(files) ?? [];
    if (paths.length === 0) return;
    void run(() => api()?.addFiles(kbId, paths));
  };

  const api = () => window.sahkarmi?.knowledge;
  const workspaceBases = createMemo(() =>
    bases().filter((base) => base.workspaceId === props.workspaceId),
  );
  const selected = createMemo(
    () => workspaceBases().find((base) => base.id === selectedId()) ?? workspaceBases()[0] ?? null,
  );
  const workspaceBots = createMemo(() =>
    props.bots.filter((bot) => bot.workspaceId === props.workspaceId),
  );

  const apply = (next: KnowledgeBaseSummary[]) => {
    setBases(next);
    setError("");
  };

  const run = async (work: () => Promise<KnowledgeBaseSummary[]> | undefined) => {
    try {
      const next = await work();
      if (next) apply(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  onMount(() => {
    void run(() => api()?.list());
    const unsubscribe = window.sahkarmi?.agent?.onEvent?.((event) => {
      if (event.type === "knowledge-changed") setBases(event.bases);
      else if (event.type === "knowledge-progress") {
        setProgress(event.progress.status === "indexing" ? event.progress : null);
      }
    });
    onCleanup(() => unsubscribe?.());
  });

  const create = async (event: Event) => {
    event.preventDefault();
    const name = newName().trim();
    if (!name) return;
    await run(async () => {
      const next = await api()?.create({ name, workspaceId: props.workspaceId });
      if (next) {
        const made = next.find((base) => !bases().some((known) => known.id === base.id));
        if (made) setSelectedId(made.id);
      }
      setNewName("");
      setCreating(false);
      return next;
    });
  };

  const rename = async (event: Event) => {
    event.preventDefault();
    const base = selected();
    const name = renameValue().trim();
    if (!base || !name) return;
    await run(() => api()?.update({ id: base.id, name }));
    setRenaming(false);
  };

  const remove = async () => {
    const base = selected();
    if (!base) return;
    if (!window.confirm(t("knowledgeDeleteConfirm", { name: base.name }))) return;
    await run(() => api()?.delete(base.id));
    setSelectedId(null);
    setHits(null);
  };

  const setAccessAll = async (all: boolean) => {
    const base = selected();
    if (!base) return;
    await run(() =>
      api()?.update({
        id: base.id,
        botIds: all ? [] : workspaceBots().map((bot) => bot.id),
      }),
    );
  };

  const toggleBot = async (botId: string, on: boolean) => {
    const base = selected();
    if (!base) return;
    const current = base.botIds.length > 0 ? base.botIds : workspaceBots().map((bot) => bot.id);
    const next = on ? [...new Set([...current, botId])] : current.filter((id) => id !== botId);
    await run(() => api()?.update({ id: base.id, botIds: next }));
  };

  const setPrivate = async (hidden: boolean) => {
    const base = selected();
    if (!base) return;
    await run(() => api()?.update({ id: base.id, privacy: hidden ? "owner" : "coworkers" }));
  };

  const search = async (event: Event) => {
    event.preventDefault();
    const base = selected();
    const text = query().trim();
    if (!base || !text) return;
    setSearching(true);
    try {
      const result = await api()?.search({ query: text, kbIds: [base.id], limit: 8 });
      setHits(result?.hits ?? []);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const readyCount = (base: KnowledgeBaseSummary) =>
    base.sources.filter((source) => source.status === "ready").length;

  const sourceRow = (source: KnowledgeSourceSummary) => {
    const base = selected();
    if (!base) return null;
    return (
      <tr class={`knowledge-source knowledge-source-${source.status}`}>
        <td class="knowledge-source-name">
          <button
            type="button"
            class="knowledge-source-open"
            title={source.path}
            onClick={() => void api()?.openSource(base.id, source.id)}
          >
            {source.name}
          </button>
          <Show when={source.error}>
            <span class="knowledge-source-error">{source.error}</span>
          </Show>
        </td>
        <td>{source.kind}</td>
        <td>{formatBytes(source.size)}</td>
        <td>
          <span class={`knowledge-status knowledge-status-${source.status}`}>
            {t(STATUS_LABELS[source.status])}
          </span>
        </td>
        <td>{source.chunkCount > 0 ? source.chunkCount : ""}</td>
        <td>{formatDate(source.indexedAt)}</td>
        <td>
          <label class="knowledge-toggle">
            <input
              type="checkbox"
              checked={source.enabled}
              aria-label={t("knowledgeEnabled")}
              onChange={(event) =>
                void run(() =>
                  api()?.setSourceEnabled(base.id, source.id, event.currentTarget.checked),
                )
              }
            />
          </label>
        </td>
        <td>
          <button
            type="button"
            class="button-danger-quiet"
            onClick={() => void run(() => api()?.removeSource(base.id, source.id))}
          >
            {t("knowledgeRemove")}
          </button>
        </td>
      </tr>
    );
  };

  return (
    <section class="center-view knowledge-view" aria-labelledby="knowledge-heading">
      <header class="center-view-header window-drag">
        <h1 id="knowledge-heading">{t("knowledgeTitle")}</h1>
        <span class="center-view-badge">{workspaceBases().length}</span>
        <div class="memory-header-actions no-drag">
          <button type="button" class="button-primary" onClick={() => setCreating(true)}>
            {t("knowledgeNew")}
          </button>
        </div>
      </header>

      <div class="center-view-body">
        <p class="center-view-intro">{t("knowledgeSubtitle")}</p>
        <Show when={error()}>
          <p class="approval-error" role="alert">
            {error()}
          </p>
        </Show>
        <Show when={creating()}>
          <form class="knowledge-create" onSubmit={(event) => void create(event)}>
            <input
              ref={(input) => requestAnimationFrame(() => input.focus())}
              value={newName()}
              placeholder={t("knowledgeNamePlaceholder")}
              aria-label={t("knowledgeNamePlaceholder")}
              maxLength={80}
              onInput={(event) => setNewName(event.currentTarget.value)}
            />
            <button type="submit" class="button-primary">
              {t("knowledgeCreate")}
            </button>
            <button type="button" onClick={() => setCreating(false)}>
              {t("cancel")}
            </button>
          </form>
        </Show>

        <Show
          when={workspaceBases().length > 0}
          fallback={<p class="center-view-empty">{t("knowledgeEmpty")}</p>}
        >
          <div class="knowledge-layout">
            <nav class="knowledge-list" aria-label={t("knowledgeTitle")}>
              <For each={workspaceBases()}>
                {(base) => (
                  <button
                    type="button"
                    class="knowledge-list-item"
                    classList={{ "knowledge-list-active": selected()?.id === base.id }}
                    aria-current={selected()?.id === base.id ? "true" : undefined}
                    onClick={() => {
                      setSelectedId(base.id);
                      setHits(null);
                      setRenaming(false);
                    }}
                  >
                    <span class="knowledge-list-name">{base.name}</span>
                    <span class="knowledge-list-meta">
                      {t("knowledgeFiles", { count: String(readyCount(base)) })}
                      <Show when={base.indexing}> · {t("knowledgeIndexing")}</Show>
                      <Show when={base.privacy === "owner"}> · {t("knowledgePrivate")}</Show>
                    </span>
                  </button>
                )}
              </For>
            </nav>

            <Show when={selected()}>
              {(base) => (
                <div
                  class="knowledge-detail"
                  classList={{ "knowledge-drop-active": dropActive() }}
                  onDragOver={(event) => {
                    if (event.dataTransfer?.types.includes("Files")) {
                      event.preventDefault();
                      setDropActive(true);
                    }
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setDropActive(false);
                  }}
                  onDrop={(event) => dropFiles(event, base().id)}
                >
                  <Show when={dropActive()}>
                    <div class="attachment-drop-overlay">{t("knowledgeDropHint")}</div>
                  </Show>
                  <div class="knowledge-detail-head">
                    <Show
                      when={renaming()}
                      fallback={
                        <h2>
                          {base().name}
                          <button
                            type="button"
                            class="knowledge-quiet"
                            onClick={() => {
                              setRenameValue(base().name);
                              setRenaming(true);
                            }}
                          >
                            {t("knowledgeRename")}
                          </button>
                        </h2>
                      }
                    >
                      <form class="knowledge-create" onSubmit={(event) => void rename(event)}>
                        <input
                          value={renameValue()}
                          maxLength={80}
                          aria-label={t("knowledgeRename")}
                          onInput={(event) => setRenameValue(event.currentTarget.value)}
                        />
                        <button type="submit" class="button-primary">
                          {t("knowledgeRename")}
                        </button>
                        <button type="button" onClick={() => setRenaming(false)}>
                          {t("cancel")}
                        </button>
                      </form>
                    </Show>
                    <div class="knowledge-actions">
                      <button
                        type="button"
                        onClick={() => void run(() => api()?.addFiles(base().id))}
                      >
                        {t("knowledgeAddFiles")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void run(() => api()?.addFolder(base().id))}
                      >
                        {t("knowledgeAddFolder")}
                      </button>
                      <button
                        type="button"
                        disabled={base().indexing}
                        onClick={() => void run(() => api()?.sync(base().id))}
                      >
                        {t("knowledgeSync")}
                      </button>
                      <button
                        type="button"
                        class="button-danger-quiet"
                        onClick={() => void remove()}
                      >
                        {t("knowledgeDelete")}
                      </button>
                    </div>
                  </div>

                  <Show when={progress()?.kbId === base().id && progress()}>
                    {(current) => (
                      <p class="knowledge-progress" aria-live="polite">
                        {t("knowledgeIndexingFile", {
                          name: current().name,
                          done: String(current().done + 1),
                          total: String(current().total),
                        })}
                      </p>
                    )}
                  </Show>

                  <div class="knowledge-access">
                    <fieldset class="knowledge-access-group">
                      <legend>{t("knowledgeAccess")}</legend>
                      <label class="knowledge-toggle">
                        <input
                          type="radio"
                          name={`access-${base().id}`}
                          checked={base().botIds.length === 0}
                          onChange={() => void setAccessAll(true)}
                        />
                        <span>{t("knowledgeAccessAll")}</span>
                      </label>
                      <label class="knowledge-toggle">
                        <input
                          type="radio"
                          name={`access-${base().id}`}
                          checked={base().botIds.length > 0}
                          onChange={() => void setAccessAll(false)}
                        />
                        <span>{t("knowledgeAccessSome")}</span>
                      </label>
                      <Show when={base().botIds.length > 0}>
                        <div class="knowledge-bots">
                          <For each={workspaceBots()}>
                            {(bot) => (
                              <label class="knowledge-toggle">
                                <input
                                  type="checkbox"
                                  checked={base().botIds.includes(bot.id)}
                                  onChange={(event) =>
                                    void toggleBot(bot.id, event.currentTarget.checked)
                                  }
                                />
                                <span>{bot.name}</span>
                              </label>
                            )}
                          </For>
                        </div>
                      </Show>
                    </fieldset>
                    <label class="knowledge-toggle knowledge-private">
                      <input
                        type="checkbox"
                        checked={base().privacy === "owner"}
                        onChange={(event) => void setPrivate(event.currentTarget.checked)}
                      />
                      <span>{t("knowledgePrivateHint")}</span>
                    </label>
                  </div>

                  <Show when={base().folders.length > 0}>
                    <h3>{t("knowledgeFolders")}</h3>
                    <ul class="knowledge-folders">
                      <For each={base().folders}>
                        {(folder) => (
                          <li>
                            <span title={folder.path}>{folder.path}</span>
                            <span class="knowledge-list-meta">
                              {t("knowledgeFiles", { count: String(folder.fileCount) })}
                            </span>
                            <button
                              type="button"
                              class="button-danger-quiet"
                              onClick={() =>
                                void run(() => api()?.removeFolder(base().id, folder.id))
                              }
                            >
                              {t("knowledgeRemove")}
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>

                  <h3>{t("knowledgeSources")}</h3>
                  <Show
                    when={base().sources.length > 0}
                    fallback={<p class="center-view-empty">{t("knowledgeNoSources")}</p>}
                  >
                    <div class="knowledge-table-wrap">
                      <table class="knowledge-table">
                        <thead>
                          <tr>
                            <th>{t("knowledgeColumnFile")}</th>
                            <th>{t("knowledgeColumnType")}</th>
                            <th>{t("knowledgeColumnSize")}</th>
                            <th>{t("knowledgeColumnStatus")}</th>
                            <th>{t("knowledgeColumnPassages")}</th>
                            <th>{t("knowledgeColumnIndexed")}</th>
                            <th>{t("knowledgeEnabled")}</th>
                            <th>
                              <span class="sr-only">{t("knowledgeRemove")}</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <For each={base().sources}>{sourceRow}</For>
                        </tbody>
                      </table>
                    </div>
                  </Show>

                  <h3>{t("knowledgeTry")}</h3>
                  <form class="knowledge-create" onSubmit={(event) => void search(event)}>
                    <input
                      type="search"
                      value={query()}
                      placeholder={t("knowledgeTryPlaceholder")}
                      aria-label={t("knowledgeTry")}
                      onInput={(event) => setQuery(event.currentTarget.value)}
                    />
                    <button type="submit" class="button-primary" disabled={searching()}>
                      {t("knowledgeSearch")}
                    </button>
                  </form>
                  <Show when={hits()}>
                    {(found) => (
                      <Show
                        when={found().length > 0}
                        fallback={<p class="center-view-empty">{t("knowledgeNoHits")}</p>}
                      >
                        <ol class="knowledge-hits">
                          <For each={found()}>
                            {(hit) => (
                              <li class="knowledge-hit">
                                <button
                                  type="button"
                                  class="knowledge-hit-head"
                                  onClick={() =>
                                    void api()?.openSource(
                                      hit.citation.kbId,
                                      hit.citation.documentId,
                                    )
                                  }
                                >
                                  <span class="citation-pill">{hit.citation.id}</span>
                                  <span>{hitLabel(hit)}</span>
                                </button>
                                <p>{hit.citation.excerpt}</p>
                              </li>
                            )}
                          </For>
                        </ol>
                      </Show>
                    )}
                  </Show>
                </div>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
