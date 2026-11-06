import { createSignal, For, onMount, Show } from "solid-js";
import type {
  BotSummary,
  McpFixAction,
  McpServerInput,
  McpServerSummary,
} from "../../../shared/ipc";
import { t } from "../i18n";
import { McpServerRow } from "./McpServerRow";

/** Fix buttons the window can carry out itself. */
const FIXES: ReadonlySet<McpFixAction> = new Set(["edit", "recheck", "retry-long"]);

interface Draft {
  id?: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
  cwd: string;
}

const EMPTY: Draft = {
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  headers: "",
  cwd: "",
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
    cwd: server.cwd ?? "",
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
  const [bots, setBots] = createSignal<BotSummary[]>([]);
  const [testing, setTesting] = createSignal<string | null>(null);
  /** Pasted JSON whose servers clash with saved ones, waiting for the owner's answer (MCP-14). */
  const [conflict, setConflict] = createSignal<{ text: string; names: string[] } | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      // Electron wraps main-process errors; the owner only needs the message itself.
      setError(
        (cause instanceof Error ? cause.message : String(cause)).replace(
          /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  // Opening Settings re-reads Windows' PATH, so a just-installed program is found (MCP-3).
  onMount(() => {
    void run(async () => setServers(await window.sahkarmi.mcp.recheck()));
    void window.sahkarmi.agent
      .listBots()
      .then(setBots)
      .catch(() => setBots([]));
  });

  function importText(text: string, replace: string[] = []) {
    void run(async () => {
      const result = await window.sahkarmi.mcp.importJson(text, replace);
      setServers(result.servers);
      setJson("");
      setConflict(result.conflicts.length > 0 ? { text, names: result.conflicts } : null);
      setNotice(
        [
          result.added.length ? t("mcpAdded", { names: result.added.join(", ") }) : "",
          result.skipped.length ? t("mcpSkipped", { names: result.skipped.join("; ") }) : "",
        ]
          .filter(Boolean)
          .join(" · ") || null,
      );
    });
  }

  function test(server: McpServerSummary) {
    setTesting(server.id);
    void run(async () => {
      try {
        setServers(await window.sahkarmi.mcp.test(server.id));
      } finally {
        setTesting(null);
      }
    });
  }

  function fix(server: McpServerSummary, action: McpFixAction) {
    if (action === "edit") setDraft(draftOf(server));
    else if (action === "recheck")
      void run(async () => setServers(await window.sahkarmi.mcp.recheck()));
    else if (action === "retry-long") test(server);
  }

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
      cwd: current.cwd.trim(),
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
          onClick={() => importText(json())}
        >
          {t("mcpImport")}
        </button>
      </div>
      <Show when={conflict()}>
        {(current) => (
          <div class="mcp-card" role="alertdialog">
            <p>{t("mcpxConflict", { names: current().names.join(", ") })}</p>
            <div class="settings-buttons">
              <button
                type="button"
                disabled={busy()}
                onClick={() => importText(current().text, current().names)}
              >
                {t("mcpxReplace")}
              </button>
              <button type="button" disabled={busy()} onClick={() => setConflict(null)}>
                {t("mcpxKeep")}
              </button>
            </div>
          </div>
        )}
      </Show>

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
                <span>{t("mcpxCwd")}</span>
                <input
                  value={current().cwd}
                  placeholder="C:\\Users\\you\\my-server"
                  onInput={(event) => edit({ cwd: event.currentTarget.value })}
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
      <div class="settings-buttons">
        <button
          type="button"
          disabled={busy()}
          onClick={() => void run(async () => setServers(await window.sahkarmi.mcp.recheck()))}
        >
          {t("mcpxRecheck")}
        </button>
      </div>
      <p class="settings-meta">{t("mcpxRecheckHint")}</p>
      <Show when={testing()}>
        <p class="settings-meta" role="status">
          {t("mcpxTesting")}
        </p>
      </Show>
      <Show when={servers().length > 0} fallback={<p class="settings-meta">{t("mcpNone")}</p>}>
        <ul class="extension-list">
          <For each={servers()}>
            {(server) => (
              <McpServerRow
                server={server}
                bots={bots()}
                busy={busy()}
                fixes={FIXES}
                onToggle={() =>
                  void run(async () =>
                    setServers(await window.sahkarmi.mcp.setEnabled(server.id, !server.enabled)),
                  )
                }
                onEdit={() => setDraft(draftOf(server))}
                onRemove={() =>
                  void run(async () => setServers(await window.sahkarmi.mcp.remove(server.id)))
                }
                onTest={() => test(server)}
                onFix={(action) => fix(server, action)}
                onCoworkers={(ids) =>
                  void run(async () =>
                    setServers(await window.sahkarmi.mcp.setCoworkers(server.id, ids)),
                  )
                }
              />
            )}
          </For>
        </ul>
      </Show>
      <p class="settings-meta">{t("mcpRestartNote")}</p>
      <p class="settings-meta">{t("mcpTrustNote")}</p>
    </div>
  );
}
