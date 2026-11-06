import { createMemo, createSignal, For, Show } from "solid-js";
import type {
  McpCandidate,
  McpNotMcpKind,
  McpRepoAnalysis,
  McpServerSummary,
} from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

const NOT_MCP: Record<McpNotMcpKind, MessageKey> = {
  cli: "mcpxNotMcpCli",
  "http-api": "mcpxNotMcpApi",
  webapp: "mcpxNotMcpWebapp",
};

const KIND: Record<McpRepoAnalysis["kind"], MessageKey> = {
  "mcp-stdio": "mcpxKindStdio",
  "mcp-http": "mcpxKindHttp",
  "mcp-needs-build": "mcpxKindBuild",
  "not-mcp": "mcpxKindNotMcp",
  unknown: "mcpxKindUnknown",
};

/** A server name from the repo: letters, numbers, - and _ only. */
export function suggestedName(repo: string): string {
  const base = (repo.split("/").pop() ?? "server")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^sahkarmi/i, "")
    .slice(0, 48);
  return base || "server";
}

export function commandLine(candidate: McpCandidate): string {
  const server = candidate.server;
  if (!server) return "";
  return server.transport === "http"
    ? (server.url ?? "")
    : [server.command ?? "", ...(server.args ?? [])].join(" ");
}

interface Props {
  busy: boolean;
  run: (action: () => Promise<unknown>) => void;
  onServers: (servers: McpServerSummary[], addedName: string) => void;
  /** Smart import is off: show the repo's .mcp.json in the paste box, as before. */
  onLegacyJson: (text: string) => void;
  /** Guided install of a candidate (null when that phase is not available). */
  onInstall?: (
    analysis: McpRepoAnalysis,
    candidate: McpCandidate,
    name: string,
    env: Record<string, string>,
  ) => void;
  /** The "Use as a Skill (CLI)" route for a repo that is not an MCP server. */
  onSkillRoute?: (analysis: McpRepoAnalysis) => void;
}

export function McpGithubConnect(props: Props) {
  const [url, setUrl] = createSignal("");
  const [analysis, setAnalysis] = createSignal<McpRepoAnalysis | null>(null);
  const [chosen, setChosen] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [env, setEnv] = createSignal<Record<string, string>>({});
  const candidate = createMemo(
    () => analysis()?.candidates.find((entry) => entry.id === chosen()) ?? null,
  );

  function check() {
    props.run(async () => {
      const result = await window.sahkarmi.mcp.analyzeGithub(url().trim());
      if (result.legacyJson !== undefined) {
        props.onLegacyJson(result.legacyJson);
        setAnalysis(null);
        return;
      }
      setAnalysis(result);
      setChosen(result.candidates[0]?.id ?? null);
      setName(suggestedName(result.repo));
      setEnv({});
    });
  }

  function add(current: McpRepoAnalysis, picked: McpCandidate) {
    props.run(async () => {
      const servers = await window.sahkarmi.mcp.addCandidate(
        current.id,
        picked.id,
        name().trim(),
        env(),
      );
      props.onServers(servers, name().trim());
      setAnalysis(null);
      setUrl("");
    });
  }

  return (
    <div class="extension-field">
      <span>{t("mcpGithubLabel")}</span>
      <div class="extension-row">
        <input
          type="url"
          placeholder="https://github.com/owner/repo"
          value={url()}
          onInput={(event) => setUrl(event.currentTarget.value)}
        />
        <button type="button" disabled={props.busy || !url().trim()} onClick={check}>
          {t("mcpFromGithub")}
        </button>
      </div>
      <Show when={analysis()}>
        {(current) => (
          <div class="mcp-card" aria-live="polite">
            <h4>
              {current().repo} · {t(KIND[current().kind])}
            </h4>
            <Show when={current().kind === "not-mcp"}>
              <ul class="mcp-steps">
                <For each={current().notMcp}>{(kind) => <li>{t(NOT_MCP[kind])}</li>}</For>
              </ul>
              <p class="settings-meta">{t("mcpxNotMcpWhy")}</p>
              <Show when={current().cli && props.onSkillRoute}>
                <div class="settings-buttons">
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.onSkillRoute?.(current())}
                  >
                    {t("mcpxUseAsSkill")}
                  </button>
                </div>
              </Show>
            </Show>
            <Show when={current().heavy}>
              <p class="extension-warning">{t("mcpxHeavy")}</p>
            </Show>
            <For each={current().warnings}>
              {(warning) => <small class="settings-meta">{warning}</small>}
            </For>
            <Show when={current().evidence.length > 0}>
              <details>
                <summary>{t("mcpxEvidence")}</summary>
                <ul class="mcp-steps">
                  <For each={current().evidence}>{(line) => <li>{line}</li>}</For>
                </ul>
                <small class="settings-meta">
                  {t("mcpxPinned", { commit: current().commit.slice(0, 7) })}
                </small>
              </details>
            </Show>
            <Show when={current().candidates.length > 0}>
              <fieldset class="mcp-coworkers">
                <legend>{t("mcpxChooseWay")}</legend>
                <For each={current().candidates}>
                  {(entry) => (
                    <label class="extension-pick">
                      <input
                        type="radio"
                        name="mcp-candidate"
                        checked={chosen() === entry.id}
                        onChange={() => setChosen(entry.id)}
                      />
                      <span class="extension-item-text">
                        <strong>{entry.label}</strong>
                        <Show when={entry.server}>
                          <small class="extension-source">{commandLine(entry)}</small>
                        </Show>
                        <small class="settings-meta">{entry.evidence.join(" · ")}</small>
                        <Show when={entry.placeholders.length > 0}>
                          <small class="extension-warning">
                            {t("mcpxCandidateTemplate", { tokens: entry.placeholders.join(", ") })}
                          </small>
                        </Show>
                        <Show when={entry.needs.length > 0}>
                          <small class="settings-meta">
                            {t("mcpxNeeds", { tools: entry.needs.join(", ") })}
                          </small>
                        </Show>
                      </span>
                    </label>
                  )}
                </For>
              </fieldset>
              <Show when={candidate()}>
                {(picked) => (
                  <>
                    <label class="extension-field">
                      <span>{t("mcpName")}</span>
                      <input
                        value={name()}
                        onInput={(event) => setName(event.currentTarget.value)}
                      />
                    </label>
                    <For each={picked().requiredEnv}>
                      {(required) => (
                        <label class="extension-field">
                          <span>
                            {required.name}
                            {required.isRequired
                              ? ` (${t("mcpxRequired")})`
                              : ` (${t("mcpxOptional")})`}
                          </span>
                          <input
                            type={required.isSecret ? "password" : "text"}
                            autocomplete="off"
                            placeholder={required.description}
                            value={env()[required.name] ?? ""}
                            onInput={(event) =>
                              setEnv({ ...env(), [required.name]: event.currentTarget.value })
                            }
                          />
                        </label>
                      )}
                    </For>
                    <div class="settings-buttons">
                      <Show when={picked().install && props.onInstall}>
                        <button
                          type="button"
                          disabled={props.busy || !name().trim()}
                          onClick={() =>
                            props.onInstall?.(current(), picked(), name().trim(), env())
                          }
                        >
                          {t("mcpxInstallForMe")}
                        </button>
                      </Show>
                      <Show when={picked().server}>
                        <button
                          type="button"
                          disabled={props.busy || !name().trim()}
                          onClick={() => add(current(), picked())}
                        >
                          {t("mcpxAddCandidate")}
                        </button>
                      </Show>
                    </div>
                    <small class="settings-meta">{t("mcpxAddedOff")}</small>
                  </>
                )}
              </Show>
            </Show>
            <Show when={current().kind === "unknown"}>
              <p class="settings-meta">{t("mcpxUnknownHint")}</p>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
