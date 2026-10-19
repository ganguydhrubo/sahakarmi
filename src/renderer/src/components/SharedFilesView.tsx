import { createResource, createSignal, For, Show } from "solid-js";
import type { SharedFileEntry } from "../../../shared/ipc";
import { t } from "../i18n";

export function SharedFilesView() {
  const [directory, setDirectory] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [listing, { mutate, refetch }] = createResource(directory, (path) =>
    window.sahkarmi.files.list(path).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }),
  );
  const crumbs = () => {
    const parts = (listing()?.directory ?? "").split("/").filter(Boolean);
    return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
  };

  async function addFiles() {
    setError(null);
    try {
      mutate(await window.sahkarmi.files.add(directory()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function act(entry: SharedFileEntry | null, action: "open" | "reveal") {
    setError(null);
    void window.sahkarmi.files
      .open({ path: entry?.path ?? directory(), action })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }

  return (
    <section class="center-view files-view" aria-labelledby="files-heading">
      <header class="center-view-header window-drag">
        <h1 id="files-heading">{t("sharedFiles")}</h1>
        <div class="center-view-actions no-drag">
          <button type="button" onClick={() => act(null, "reveal")}>
            {t("openFolder")}
          </button>
          <button type="button" class="button-primary" onClick={() => void addFiles()}>
            {t("addFiles")}
          </button>
        </div>
      </header>
      <div class="center-view-body">
        <p class="center-view-intro">
          {t("sharedFilesIntro")} <code>{listing()?.root}</code>
        </p>
        <nav class="files-breadcrumbs" aria-label="Folder">
          <button type="button" onClick={() => setDirectory("")}>
            {t("sharedFiles")}
          </button>
          <For each={crumbs()}>
            {(crumb) => (
              <>
                <span aria-hidden="true">/</span>
                <button type="button" onClick={() => setDirectory(crumb.path)}>
                  {crumb.name}
                </button>
              </>
            )}
          </For>
          <button
            type="button"
            class="files-refresh"
            onClick={() => void refetch()}
            aria-label="Refresh"
          >
            ↻
          </button>
        </nav>
        <Show when={error()}>
          <p class="center-view-error" role="alert">
            {error()}
          </p>
        </Show>
        <Show
          when={(listing()?.entries.length ?? 0) > 0}
          fallback={<p class="center-view-empty">{listing.loading ? "…" : t("emptyFolder")}</p>}
        >
          <table class="files-table">
            <tbody>
              <For each={listing()?.entries ?? []}>
                {(entry) => (
                  <tr>
                    <td class="files-name">
                      <button
                        type="button"
                        onClick={() =>
                          entry.kind === "directory" ? setDirectory(entry.path) : act(entry, "open")
                        }
                      >
                        <span class={`files-icon files-icon-${entry.kind}`} aria-hidden="true" />
                        {entry.name}
                      </button>
                    </td>
                    <td class="files-size">
                      {entry.kind === "file" ? formatSize(entry.size) : ""}
                    </td>
                    <td class="files-date">{formatDate(entry.modifiedAt)}</td>
                    <td class="files-actions">
                      <button type="button" onClick={() => act(entry, "reveal")}>
                        {t("openFolder")}
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
