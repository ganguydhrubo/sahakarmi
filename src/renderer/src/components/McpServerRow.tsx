import { For, Show } from "solid-js";
import type {
  BotSummary,
  McpDiagnosisCode,
  McpFixAction,
  McpProblem,
  McpServerSummary,
} from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";
import { AssignButton } from "./AssignAccess";

const DIAGNOSIS: Record<McpDiagnosisCode, MessageKey> = {
  "command-not-found": "mcpxDiag_commandNotFound",
  "store-stub": "mcpxDiag_storeStub",
  "module-missing": "mcpxDiag_moduleMissing",
  "not-mcp": "mcpxDiag_notMcp",
  "no-reply": "mcpxDiag_noReply",
  "stdout-noise": "mcpxDiag_stdoutNoise",
  auth: "mcpxDiag_auth",
  "port-in-use": "mcpxDiag_portInUse",
  "first-run-timeout": "mcpxDiag_firstRunTimeout",
  "path-not-found": "mcpxDiag_pathNotFound",
  "long-path": "mcpxDiag_longPath",
  "build-tools": "mcpxDiag_buildTools",
  "python-version": "mcpxDiag_pythonVersion",
  exited: "mcpxDiag_exited",
  unknown: "mcpxDiag_unknown",
};

export const FIX_LABEL: Record<McpFixAction, MessageKey> = {
  edit: "mcpxFix_edit",
  recheck: "mcpxFix_recheck",
  "retry-long": "mcpxFix_retryLong",
  "install-uv": "mcpxFix_installUv",
  "install-node": "mcpxFix_installNode",
  "install-python": "mcpxFix_installPython",
  reinstall: "mcpxFix_reinstall",
  "use-skill-route": "mcpxFix_skillRoute",
  "shared-mode": "mcpxFix_shared",
};

/** One sentence per problem kind, saying what to do about it (MCP-6). */
export function problemText(problem: McpProblem): string {
  switch (problem.kind) {
    case "placeholder":
      return problem.detail && problem.detail !== problem.subject
        ? t("mcpxProblemPlaceholderKey", { key: problem.subject, token: problem.detail })
        : t("mcpxProblemPlaceholder", { token: problem.subject });
    case "missing-command":
      return t("mcpxProblemMissingCommand", { command: problem.subject });
    case "store-stub":
      return t("mcpxProblemStoreStub", { command: problem.subject });
    case "missing-folder":
      return t("mcpxProblemMissingFolder", { path: problem.subject });
    case "missing-file":
      return t("mcpxProblemMissingFile", { path: problem.subject });
    case "missing-env":
      return t("mcpxProblemMissingEnv", { name: problem.subject });
  }
}

export function diagnosisText(code: McpDiagnosisCode): string {
  return t(DIAGNOSIS[code] ?? "mcpxDiag_unknown");
}

interface Props {
  server: McpServerSummary;
  bots: BotSummary[];
  busy: boolean;
  /** Fix buttons this build can carry out. */
  fixes: ReadonlySet<McpFixAction>;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onTest: () => void;
  onFix: (action: McpFixAction) => void;
  onCoworkers: (ids: string[] | null) => void;
  /** Shared mode switch; missing when the feature is off. */
  onShared?: (shared: boolean) => void;
}

export function McpServerRow(props: Props) {
  const status = () => props.server.status;
  const fixButton = (action: McpFixAction | undefined) => (
    <Show when={action && props.fixes.has(action)}>
      <button type="button" disabled={props.busy} onClick={() => action && props.onFix(action)}>
        {t(FIX_LABEL[action as McpFixAction])}
      </button>
    </Show>
  );

  return (
    <li class="extension-item mcp-server-item">
      <button
        type="button"
        role="switch"
        class="feature-switch"
        aria-checked={props.server.enabled}
        aria-label={`${t("mcpOn")}: ${props.server.name}`}
        disabled={props.busy}
        onClick={props.onToggle}
      >
        <span />
      </button>
      <span class="extension-item-text">
        <strong>{props.server.name}</strong>
        <small class="extension-source">
          {props.server.transport === "http"
            ? props.server.url
            : [props.server.command, ...props.server.args].join(" ")}
        </small>
        <Show when={props.server.cwd}>
          <small class="extension-source">
            {t("mcpxCwd")}: {props.server.cwd}
          </small>
        </Show>
        <For each={props.server.problems}>
          {(problem) => (
            <small class="extension-warning" role="note">
              {problemText(problem)}{" "}
              <Show when={problem.link}>
                <button
                  type="button"
                  class="link-button"
                  onClick={() => void window.sahkarmi.openUrl(problem.link as string)}
                >
                  {t("mcpxGetIt")}
                </button>
              </Show>{" "}
              {fixButton(problem.fix)}
            </small>
          )}
        </For>
        <Show when={props.server.needsTest && !status()?.ok && props.server.problems.length === 0}>
          <small class="settings-meta">{t("mcpxNeedsTest")}</small>
        </Show>
        <Show when={status()}>
          {(current) => (
            <Show
              when={current().ok}
              fallback={
                <small class="extension-warning" role="note">
                  {t("mcpxTestFailed", {
                    reason: diagnosisText(current().diagnosis?.code ?? "unknown"),
                  })}{" "}
                  {fixButton(current().diagnosis?.fix)}
                  <Show when={current().stderrTail || current().error}>
                    <details>
                      <summary>{t("mcpxShowDetails")}</summary>
                      <pre class="mcp-stderr">
                        {[current().error, current().stderrTail].filter(Boolean).join("\n")}
                      </pre>
                    </details>
                  </Show>
                </small>
              }
            >
              <small class="settings-meta">
                {current().toolCount > 0
                  ? t("mcpxTestOk", {
                      count: String(current().toolCount),
                      names: current().toolNames.slice(0, 8).join(", "),
                    })
                  : t("mcpxTestOkNone")}{" "}
                {t("mcpxLastChecked", {
                  time: new Date(current().lastCheckedAt).toLocaleString(),
                })}
              </small>
              <Show when={(current().tools?.length ?? 0) > 0}>
                <details>
                  <summary>{t("mcpxTools")}</summary>
                  <ul class="mcp-tool-list">
                    <For each={current().tools}>
                      {(tool) => (
                        <li>
                          <code>{tool.name}</code>
                          <Show when={tool.description}> — {tool.description}</Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </details>
              </Show>
            </Show>
          )}
        </Show>
        <Show when={props.onShared && props.server.transport === "stdio"}>
          <Show when={props.server.heavy && !props.server.shared}>
            <small class="extension-warning" role="note">
              {t("mcpxHeavyServer")}
            </small>
          </Show>
          <label class="settings-meta mcp-shared">
            <input
              type="checkbox"
              checked={props.server.shared === true}
              disabled={props.busy}
              onChange={(event) => props.onShared?.(event.currentTarget.checked)}
            />{" "}
            {t("mcpxShared")}
          </label>
        </Show>
        <AssignButton kind="mcp" id={props.server.id} name={props.server.name} />
      </span>
      <button type="button" disabled={props.busy} onClick={props.onTest}>
        {t("mcpxTest")}
      </button>
      <button type="button" disabled={props.busy} onClick={props.onEdit}>
        {t("mcpEdit")}
      </button>
      <button type="button" disabled={props.busy} onClick={props.onRemove}>
        {t("mcpRemove")}
      </button>
    </li>
  );
}
