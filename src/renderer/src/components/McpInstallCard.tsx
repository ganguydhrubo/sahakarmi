import { createSignal, For, onCleanup, Show } from "solid-js";
import type {
  McpInstallJob,
  McpInstallPlan,
  McpInstallStepView,
  McpServerSummary,
} from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";
import { diagnosisText } from "./McpServerRow";

const STEP: Record<McpInstallStepView["kind"], MessageKey> = {
  "download-uv": "mcpxStep_downloadUv",
  "download-node": "mcpxStep_downloadNode",
  "python-install": "mcpxStep_pythonInstall",
  venv: "mcpxStep_venv",
  pip: "mcpxStep_pip",
  npm: "mcpxStep_npm",
  clone: "mcpxStep_clone",
  build: "mcpxStep_build",
  "docker-pull": "mcpxStep_dockerPull",
  verify: "mcpxStep_verify",
  skill: "mcpxStep_skill",
  save: "mcpxStep_save",
  test: "mcpxStep_test",
};

function size(plan: McpInstallPlan): string {
  if (!plan.sizeMb) return t("mcpxSizeUnknown");
  const mb = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} GB` : `${value} MB`);
  return t("mcpxSize", { min: mb(plan.sizeMb.min), max: mb(plan.sizeMb.max) });
}

interface Props {
  plan: McpInstallPlan;
  onDone: (job: McpInstallJob) => void;
  onServers: (servers: McpServerSummary[]) => void;
  onClose: () => void;
}

/**
 * The approval card (audit §11.8): what will be downloaded or run, from where, pinned to which
 * version or commit, into which folder and roughly how big. Nothing runs before "Approve".
 */
export function McpInstallCard(props: Props) {
  const [job, setJob] = createSignal<McpInstallJob | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => timer && clearInterval(timer));

  function poll(id: string) {
    timer = setInterval(() => {
      void window.sahkarmi.mcp
        .installStatus(id)
        .then((current) => {
          setJob(current);
          if (current.servers) props.onServers(current.servers);
          if (current.state !== "running") {
            if (timer) clearInterval(timer);
            props.onDone(current);
          }
        })
        .catch((cause) => setError(String(cause)));
    }, 1000);
  }

  async function approve() {
    setError(null);
    try {
      const started = await window.sahkarmi.mcp.runInstall(props.plan.id);
      setJob(started);
      poll(started.id);
    } catch (cause) {
      setError(
        (cause instanceof Error ? cause.message : String(cause)).replace(
          /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
          "",
        ),
      );
    }
  }

  const stepState = (index: number) => job()?.steps[index]?.state ?? "waiting";

  return (
    <div class="mcp-card" role="dialog" aria-label={t("mcpxApproveTitle")}>
      <h4>
        {props.plan.kind === "skill"
          ? t("mcpxSkillTitle", { name: props.plan.name })
          : t("mcpxApproveTitle")}
      </h4>
      <Show when={props.plan.kind === "skill"}>
        <p class="settings-meta">{t("mcpxSkillIntro")}</p>
      </Show>
      <dl class="mcp-plan-facts">
        <dt>{t("mcpxSource")}</dt>
        <dd>{props.plan.source}</dd>
        <dt>{t("mcpxFolder")}</dt>
        <dd>
          <code>{props.plan.folder}</code>
        </dd>
        <dt>{t("mcpxDownload")}</dt>
        <dd>{size(props.plan)}</dd>
      </dl>
      <Show when={props.plan.heavy}>
        <p class="extension-warning">{t("mcpxHeavy")}</p>
      </Show>
      <For each={props.plan.warnings}>
        {(warning) => <small class="settings-meta">{warning}</small>}
      </For>
      <ol class="mcp-steps">
        <For each={props.plan.steps}>
          {(step, index) => (
            <li data-state={stepState(index())}>
              {t(STEP[step.kind])}
              <Show when={stepState(index()) === "running"}> … </Show>
              <Show when={stepState(index()) === "done"}> ✓</Show>
              <Show when={stepState(index()) === "failed"}> ✗</Show>
              <br />
              <code>{step.command}</code>
            </li>
          )}
        </For>
      </ol>
      <p class="settings-meta">{t("mcpxApproveNote")}</p>
      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show
        when={job()}
        fallback={
          <div class="settings-buttons">
            <button type="button" onClick={() => void approve()}>
              {t("mcpxApprove")}
            </button>
            <button type="button" onClick={props.onClose}>
              {t("mcpCancel")}
            </button>
          </div>
        }
      >
        {(current) => (
          <>
            <Show when={current().state === "running"}>
              <p class="settings-meta" role="status">
                {t("mcpxInstalling")}
              </p>
              <div class="settings-buttons">
                <button
                  type="button"
                  onClick={() => void window.sahkarmi.mcp.cancelInstall(current().id)}
                >
                  {t("mcpCancel")}
                </button>
              </div>
            </Show>
            <Show when={current().state === "failed"}>
              <p class="extension-warning" role="alert">
                {t("mcpxInstallFailed", {
                  reason: diagnosisText(current().diagnosis?.code ?? "unknown"),
                })}
              </p>
            </Show>
            <Show when={current().state === "done" && props.plan.kind === "skill"}>
              <div class="mcp-card">
                <strong>
                  {t("mcpxSkillDone", { name: current().skillName ?? props.plan.name })}
                </strong>
                <p class="settings-meta">{t("mcpxSkillKeys")}</p>
                <div class="settings-buttons">
                  <button
                    type="button"
                    onClick={() => void window.sahkarmi.openUrl("https://www.pexels.com/api/")}
                  >
                    {t("mcpxGetPexels")}
                  </button>
                </div>
                <p class="settings-meta">{t("mcpxSkillOutput")}</p>
              </div>
            </Show>
            <Show when={current().state === "done" && props.plan.kind !== "skill"}>
              <p class="settings-meta" role="status">
                {t("mcpxInstallDone")}
              </p>
            </Show>
            <details>
              <summary>{t("mcpxInstallLog")}</summary>
              <pre class="mcp-stderr">{current().log}</pre>
            </details>
            <Show when={current().state !== "running"}>
              <div class="settings-buttons">
                <button type="button" onClick={props.onClose}>
                  {t("close")}
                </button>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
