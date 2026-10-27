import { createSignal, For, onMount, Show } from "solid-js";
import type { McpServerInput, McpServerSummary } from "../../../shared/ipc";
import { t } from "../i18n";

interface Draft {
  id?: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}

const EMPTY: Draft = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
};

/** "KEY=value" (env) or "Name: value" (headers) lines → a map. */
export function parsePairs(text: string, separator: "=" | ":"): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(separator);
    const key = (index < 0 ? line : line.slice(0, index)).trim();
    if (key) result[key] = index < 0 ? "" : line.slice(index + 1).trim();
  }
  return result;
}

function draftOf(server: McpServerSummary): Draft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    args: server.args.join("\n"),
    // Saved values never reach the window: keys only, blank keeps the saved value.
    env: server.envKeys.map((key) => `${key}=`).join("\n"),
    url: server.url,
    headers: server.headerKeys.map((key) => `${key}: `).join("\n"),
  };
}

export function McpSettings() {
  const [servers, setServers] = createSignal<McpServerSummary[]>([]);
  const [json, setJson] = createSignal("");
  const [repo, setRepo] = createSignal("");
  const [draft, setDraft] = createSignal<Draft | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  onMount(() => void run(async () => setServers(await window.sahkarmi.mcp.list())));

  const edit = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  function saveDraft(current: Draft) {
    const input: McpServerInput = {
      id: current.id,
      name: current.name.trim(),
      transport: current.transport,
      command: current.command,
      args: current.args
        .split(/\r?\n/)
        .map((arg) => arg.trim())
        .filter(Boolean),
      env: parsePairs(current.env, "="),
      url: current.url,
      headers: parsePairs(current.headers, ":"),
    };
    void run(async () => {
      setServers(await window.sahkarmi.mcp.save(input));
      setDraft(null);
    });
  }

  return (
    <div class="extension-settings">
      <p class="settings-meta">{t("mcpIntro")}</p>

      <label class="extension-field">
        <span>{t("mcpPasteLabel")}</span>
        <textarea
          rows={6}
          spellcheck={false}
          placeholder={
            '{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-github"]\n    }\n  }\n}'
          }
          value={json()}
          onInput={(event) => setJson(event.currentTarget.value)}
        />
      </label>
      <div class="settings-buttons">
        <button
          type="button"
          disabled={busy() || !json().trim()}
          onClick={() =>
            void run(async () => {
              const result = await window.sahkarmi.mcp.importJson(json());
              setServers(result.servers);
              setJson("");
              setNotice(
                [
                  result.added.length ? t("mcpAdded", { names: result.added.join(", ") }) : "",
                  result.skipped.length
                    ? t("mcpSkipped", { names: result.skipped.join("; ") })
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
              );
            })
          }
        >
          {t("mcpImport")}
        </button>
      </div>

      <label class="extension-field">
        <span>{t("mcpGithubLabel")}</span>
        <div class="extension-row">
          <input
            type="url"
            placeholder="https://github.com/owner/repo"
            value={repo()}
            onInput={(event) => setRepo(event.currentTarget.value)}
          />
          <button
            type="button"
            disabled={busy() || !repo().trim()}
            onClick={() =>
              void run(async () => {
                // Shown in the box above so the owner sees exactly what would run before importing.
                setJson(await window.sahkarmi.mcp.githubJson(repo().trim()));
              })
            }
          >
            {t("mcpFromGithub")}
          </button>
        </div>
      </label>

      <Show
        when={draft()}
        fallback={
          <div class="settings-buttons">
            <button type="button" disabled={busy()} onClick={() => setDraft({ ...EMPTY })}>
              {t("mcpAddByHand")}
            </button>
          </div>
        }
      >
        {(current) => (
          <div class="extension-form">
            <label class="extension-field">
              <span>{t("mcpName")}</span>
              <input
                value={current().name}
                placeholder="github"
                onInput={(event) => edit({ name: event.currentTarget.value })}
              />
            </label>
            <div class="extension-field">
              <span>{t("mcpTransport")}</span>
              <div class="segmented">
                <button
                  type="button"
                  classList={{ "segmented-active": current().transport === "stdio" }}
                  onClick={() => edit({ transport: "stdio" })}
                >
                  {t("mcpLocal")}
                </button>
                <button
                  type="button"
                  classList={{ "segmented-active": current().transport === "http" }}
                  onClick={() => edit({ transport: "http" })}
                >
                  {t("mcpRemote")}
                </button>
              </div>
            </div>
            <Show
              when={current().transport === "stdio"}
              fallback={
                <>
                  <label class="extension-field">
                    <span>{t("mcpUrl")}</span>
                    <input
                      type="url"
                      value={current().url}
                      placeholder="https://example.com/mcp"
                      onInput={(event) => edit({ url: event.currentTarget.value })}
                    />
                  </label>
                  <label class="extension-field">
                    <span>{t("mcpHeaders")}</span>
                    <textarea
                      rows={2}
                      spellcheck={false}
                      value={current().headers}
                      placeholder="Authorization: Bearer ..."
                      onInput={(event) => edit({ headers: event.currentTarget.value })}
                    />
                  </label>
                </>
              }
            >
              <label class="extension-field">
                <span>{t("mcpCommand")}</span>
                <input
                  value={current().command}
                  placeholder="npx"
                  onInput={(event) => edit({ command: event.currentTarget.value })}
                />
              </label>
              <label class="extension-field">
                <span>{t("mcpArgs")}</span>
                <textarea
                  rows={3}
                  spellcheck={false}
                  value={current().args}
                  placeholder={"-y\n@modelcontextprotocol/server-github"}
                  onInput={(event) => edit({ args: event.currentTarget.value })}
                />
              </label>
              <label class="extension-field">
                <span>{t("mcpEnv")}</span>
                <textarea
                  rows={2}
                  spellcheck={false}
                  value={current().env}
                  placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=..."
                  onInput={(event) => edit({ env: event.currentTarget.value })}
                />
              </label>
            </Show>
            <Show when={current().id}>
              <p class="settings-meta">{t("mcpSecretKept")}</p>
            </Show>
            <div class="settings-buttons">
              <button type="button" disabled={busy()} onClick={() => saveDraft(current())}>
                {t("mcpSave")}
              </button>
              <button type="button" disabled={busy()} onClick={() => setDraft(null)}>
                {t("mcpCancel")}
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={notice()}>
        <p class="settings-meta" role="status">
          {notice()}
        </p>
      </Show>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>

      <h3>{t("mcpServers")}</h3>
      <Show when={servers().length > 0} fallback={<p class="settings-meta">{t("mcpNone")}</p>}>
        <ul class="extension-list">
          <For each={servers()}>
            {(server) => (
              <li class="extension-item">
                <button
                  type="button"
                  role="switch"
                  class="feature-switch"
                  aria-checked={server.enabled}
                  aria-label={`${t("mcpOn")}: ${server.name}`}
                  disabled={busy()}
                  onClick={() =>
                    void run(async () =>
                      setServers(await window.sahkarmi.mcp.setEnabled(server.id, !server.enabled)),
                    )
                  }
                >
                  <span />
                </button>
                <span class="extension-item-text">
                  <strong>{server.name}</strong>
                  <small class="extension-source">
                    {server.transport === "http"
                      ? server.url
                      : [server.command, ...server.args].join(" ")}
                  </small>
                </span>
                <button type="button" disabled={busy()} onClick={() => setDraft(draftOf(server))}>
                  {t("mcpEdit")}
                </button>
                <button
                  type="button"
                  disabled={busy()}
                  onClick={() =>
                    void run(async () => setServers(await window.sahkarmi.mcp.remove(server.id)))
                  }
                >
                  {t("mcpRemove")}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="settings-meta">{t("mcpRestartNote")}</p>
      <p class="settings-meta">{t("mcpTrustNote")}</p>
    </div>
  );
}
