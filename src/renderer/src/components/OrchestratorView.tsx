import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type {
  AgentEvent,
  OrchestratorRun,
  OrchestratorVerificationEvidence,
  TaskExecutionStrategy,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";
import { PerformanceView } from "./PerformanceView";
import { WorkflowExportMenu } from "./WorkflowExportMenu";

/** Older runs have no verdict: read their pass/fail. */
function verdictOf(evidence: OrchestratorVerificationEvidence) {
  return evidence.verdict ?? (evidence.passed ? "passed" : "failed");
}

function verdictLabel(evidence: OrchestratorVerificationEvidence): string {
  const verdict = verdictOf(evidence);
  return verdict === "passed"
    ? t("engineVerdictPassed")
    : verdict === "failed"
      ? t("engineVerdictFailed")
      : t("engineVerdictUnverified");
}

export function OrchestratorView(props: {
  bots: BotProfile[];
  onOpenCoworker?: (botId: string) => void;
}) {
  const [runs, setRuns] = createSignal<OrchestratorRun[]>([]);
  const [selectedRunId, setSelectedRunId] = createSignal<string | null>(null);
  const [objective, setObjective] = createSignal("");
  const [strategyMode, setStrategyMode] = createSignal<"auto" | TaskExecutionStrategy>("auto");
  const [loading, setLoading] = createSignal(false);
  const [checkCommand, setCheckCommand] = createSignal("");
  const [showPerformance, setShowPerformance] = createSignal(false);

  const loadRuns = async () => {
    try {
      if (!window.sahkarmi?.orchestrator) return;
      const list = await window.sahkarmi.orchestrator.getRuns();
      setRuns(list);
      if (list.length > 0 && !selectedRunId()) {
        setSelectedRunId(list[0].id);
      }
    } catch (err) {
      console.error("Failed to load orchestrator runs:", err);
    }
  };

  onMount(() => {
    void loadRuns();

    const unsubscribe = window.sahkarmi?.agent?.onEvent?.((event: AgentEvent) => {
      if (
        event.type === "orchestrator-run-updated" ||
        event.type === "orchestrator-task-updated" ||
        event.type === "orchestrator-handoff"
      ) {
        void loadRuns();
      }
    });

    onCleanup(() => {
      if (typeof unsubscribe === "function") unsubscribe();
    });
  });

  const handleStartRun = async (e: Event) => {
    e.preventDefault();
    const text = objective().trim();
    if (!text || loading()) return;

    setLoading(true);
    try {
      const mode = strategyMode();
      const forced: TaskExecutionStrategy | undefined = mode === "auto" ? undefined : mode;
      const newRun = await window.sahkarmi.orchestrator.startRun({
        objective: text,
        forcedStrategy: forced,
        checkCommand: checkCommand().trim() || null,
      });
      setObjective("");
      await loadRuns();
      setSelectedRunId(newRun.id);
    } catch (err) {
      console.error("Failed to start orchestrator run:", err);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async (runId: string) => {
    await window.sahkarmi.orchestrator.pauseRun(runId);
    await loadRuns();
  };

  const handleResume = async (runId: string) => {
    await window.sahkarmi.orchestrator.resumeRun(runId);
    await loadRuns();
  };

  const handleCancel = async (runId: string) => {
    await window.sahkarmi.orchestrator.cancelRun(runId);
    await loadRuns();
  };

  const currentRun = () => runs().find((r) => r.id === selectedRunId()) ?? runs()[0];

  const getBotForId = (botId: string) => {
    return props.bots.find((b) => b.id === botId);
  };

  const modes: Array<{ id: "auto" | TaskExecutionStrategy; label: string }> = [
    { id: "auto", label: "Auto-Adaptive" },
    { id: "single-agent", label: "Fast Path (1 Agent)" },
    { id: "multi-agent", label: "Multi-Agent DAG" },
  ];

  return (
    <div class="orch-view">
      <header class="orch-header">
        <div class="orch-header-row">
          <h1>{t("orchestratorTitle")}</h1>
          <span class="orch-badge">Adaptive DAG Engine</span>
        </div>
        <p>{t("orchestratorSubtitle")}</p>
        <button
          type="button"
          class="orch-performance-toggle"
          aria-expanded={showPerformance()}
          onClick={() => setShowPerformance((value) => !value)}
        >
          {showPerformance() ? t("performanceHide") : t("performanceShow")}
        </button>
      </header>
      <Show when={showPerformance()}>
        <PerformanceView />
      </Show>

      <form class="orch-form" onSubmit={handleStartRun}>
        <textarea
          class="orch-objective"
          value={objective()}
          onInput={(e) => setObjective(e.currentTarget.value)}
          placeholder={t("orchestratorObjectivePlaceholder")}
          rows={3}
        />
        <label class="orch-check">
          <span>{t("engineCheckLabel")}</span>
          <input
            type="text"
            maxLength={500}
            value={checkCommand()}
            onInput={(e) => setCheckCommand(e.currentTarget.value)}
            placeholder={t("engineCheckPlaceholder")}
          />
          <small class="settings-meta">{t("engineCheckHint")}</small>
        </label>
        <div class="orch-form-row">
          <div class="orch-modes">
            <span>Execution Mode:</span>
            <For each={modes}>
              {(mode) => (
                <button
                  type="button"
                  class="orch-mode"
                  classList={{ "orch-mode-active": strategyMode() === mode.id }}
                  aria-pressed={strategyMode() === mode.id}
                  onClick={() => setStrategyMode(mode.id)}
                >
                  {mode.label}
                </button>
              )}
            </For>
          </div>
          <button
            type="submit"
            class="button-primary orch-launch"
            disabled={loading() || !objective().trim()}
          >
            {loading() ? "Analyzing & Dispatching..." : t("orchestratorStart")}
          </button>
        </div>
      </form>

      <Show
        when={runs().length > 0}
        fallback={
          <div class="orch-empty">
            <p>{t("orchestratorNoRuns")}</p>
          </div>
        }
      >
        <div class="orch-layout">
          <div class="orch-runs">
            <h3 class="orch-section-title">Active & Past Runs</h3>
            <For each={runs()}>
              {(run) => (
                <button
                  type="button"
                  class="orch-run"
                  classList={{ "orch-run-active": selectedRunId() === run.id }}
                  onClick={() => setSelectedRunId(run.id)}
                >
                  <div class="orch-run-head">
                    <span
                      class="orch-strategy"
                      classList={{ "orch-strategy-single": run.strategy === "single-agent" }}
                    >
                      {run.strategy}
                    </span>
                    <span class="orch-status" data-status={run.status}>
                      {run.status}
                    </span>
                  </div>
                  <div class="orch-run-objective">{run.objective}</div>
                </button>
              )}
            </For>
          </div>

          <Show when={currentRun()}>
            {(run) => (
              <div class="orch-detail">
                <div class="orch-detail-top">
                  <div class="orch-detail-title">
                    <div class="orch-detail-meta">
                      <span
                        class="orch-status orch-status-strategy"
                        data-status={run().strategy === "single-agent" ? "single" : "multi"}
                      >
                        {run().strategy === "single-agent"
                          ? t("orchestratorFastPath")
                          : t("orchestratorMultiAgent")}
                      </span>
                      <span class="orch-detail-time">
                        {new Date(run().startedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <h2>{run().objective}</h2>
                  </div>

                  <div class="orch-controls">
                    <WorkflowExportMenu
                      options={[
                        { label: "exportButton", source: { kind: "team-run", runId: run().id } },
                      ]}
                    />
                    <Show when={run().status === "running"}>
                      <button type="button" onClick={() => handlePause(run().id)}>
                        Pause
                      </button>
                    </Show>
                    <Show when={run().status === "paused"}>
                      <button
                        type="button"
                        class="orch-resume"
                        onClick={() => handleResume(run().id)}
                      >
                        Resume
                      </button>
                    </Show>
                    <Show when={run().status === "running" || run().status === "paused"}>
                      <button
                        type="button"
                        class="orch-cancel"
                        onClick={() => handleCancel(run().id)}
                      >
                        Cancel
                      </button>
                    </Show>
                  </div>
                </div>

                <Show when={run().waitingOn}>
                  {(wait) => (
                    <div class="orch-wait">
                      Waiting for your approval: "{wait().title}". Decide it on the Approvals screen
                      or in Telegram; the run continues on its own afterwards.
                    </div>
                  )}
                </Show>

                <div>
                  <h4 class="orch-section-title">Active Specialist Instances</h4>
                  <div class="orch-instances">
                    <For each={run().instances}>
                      {(instance) => {
                        const bot = getBotForId(instance.botId);
                        return (
                          <div class="orch-instance">
                            <Show when={bot}>
                              {(b) => (
                                <AgentAvatar shape={b().avatarShape} color={b().avatarColor} />
                              )}
                            </Show>
                            <div>
                              <div class="orch-instance-name">{instance.botName}</div>
                              <div class="orch-instance-role">
                                {instance.role} · {instance.status}
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>

                <div>
                  <h4 class="orch-section-title">Dependency Task Graph (DAG)</h4>
                  <div class="orch-tasks">
                    <For each={run().tasks}>
                      {(task, idx) => {
                        const bot = getBotForId(task.assignedBotId);
                        return (
                          <div class="orch-task" data-status={task.status}>
                            <div class="orch-task-head">
                              <div class="orch-task-title">
                                <span>
                                  #{idx() + 1} {task.title}
                                </span>
                                <Show when={bot}>
                                  {(b) => <span class="orch-task-bot">({b().name})</span>}
                                </Show>
                              </div>
                              <span class="orch-status" data-status={task.status}>
                                {task.status}
                              </span>
                              <Show when={task.status === "completed" && task.verification}>
                                {(verification) => (
                                  <span
                                    class="orch-verdict"
                                    data-verdict={verification()}
                                    title={
                                      verification() === "unverified"
                                        ? t("engineUnverifiedHint")
                                        : undefined
                                    }
                                  >
                                    {verification() === "verified"
                                      ? t("engineVerdictPassed")
                                      : t("engineVerdictUnverified")}
                                  </span>
                                )}
                              </Show>
                            </div>

                            <p>{task.description}</p>
                            <Show when={typeof task.inputs.result === "string"}>
                              <details class="orch-task-result">
                                <summary>Result</summary>
                                <p>{String(task.inputs.result)}</p>
                              </details>
                            </Show>
                            <Show when={task.error && task.status === "failed"}>
                              <p class="orch-task-error">{task.error}</p>
                            </Show>

                            <Show when={task.evidence.length > 0}>
                              <div class="orch-evidence">
                                <For each={task.evidence}>
                                  {(ev) => (
                                    <span
                                      data-passed={ev.passed ? "true" : "false"}
                                      data-verdict={verdictOf(ev)}
                                      title={ev.summary}
                                    >
                                      {ev.type}: {verdictLabel(ev)}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>

                <Show when={run().messages.length > 0}>
                  <div>
                    <h4 class="orch-section-title">Inter-Agent Handoffs & Collaboration Log</h4>
                    <div class="orch-log">
                      <For each={run().messages}>
                        {(msg) => (
                          <div class="orch-msg">
                            <div>
                              <span class="orch-msg-type">[{msg.type}]</span>{" "}
                              <span>{msg.summary}</span>
                            </div>
                            <span class="orch-msg-time">
                              {new Date(msg.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
