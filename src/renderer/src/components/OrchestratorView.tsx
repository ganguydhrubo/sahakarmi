import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { AgentEvent, OrchestratorRun, TaskExecutionStrategy } from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";
import { WorkflowExportMenu } from "./WorkflowExportMenu";

export function OrchestratorView(props: {
  bots: BotProfile[];
  onOpenCoworker?: (botId: string) => void;
}) {
  const [runs, setRuns] = createSignal<OrchestratorRun[]>([]);
  const [selectedRunId, setSelectedRunId] = createSignal<string | null>(null);
  const [objective, setObjective] = createSignal("");
  const [strategyMode, setStrategyMode] = createSignal<"auto" | TaskExecutionStrategy>("auto");
  const [loading, setLoading] = createSignal(false);

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

  return (
    <div class="tasks-view" style={{ "overflow-y": "auto", height: "100%", padding: "24px" }}>
      {/* Header */}
      <header style={{ "margin-bottom": "24px" }}>
        <div
          style={{ display: "flex", "align-items": "center", gap: "10px", "margin-bottom": "6px" }}
        >
          <h1 style={{ margin: 0, "font-size": "22px", "font-weight": "700" }}>
            {t("orchestratorTitle")}
          </h1>
          <span
            style={{
              padding: "2px 8px",
              "border-radius": "12px",
              "font-size": "11px",
              "font-weight": "600",
              background: "rgba(249, 115, 22, 0.15)",
              color: "rgb(249, 115, 22)",
              border: "1px solid rgba(249, 115, 22, 0.3)",
            }}
          >
            Adaptive DAG Engine
          </span>
        </div>
        <p style={{ margin: 0, color: "var(--color-text-muted, #888)", "font-size": "14px" }}>
          {t("orchestratorSubtitle")}
        </p>
      </header>

      {/* New Orchestration Run Form */}
      <section
        style={{
          background: "var(--color-bg-secondary, rgba(255, 255, 255, 0.04))",
          border: "1px solid var(--color-border, rgba(255, 255, 255, 0.08))",
          "border-radius": "12px",
          padding: "16px",
          "margin-bottom": "24px",
        }}
      >
        <form
          onSubmit={handleStartRun}
          style={{ display: "flex", "flex-direction": "column", gap: "12px" }}
        >
          <textarea
            value={objective()}
            onInput={(e) => setObjective(e.currentTarget.value)}
            placeholder={t("orchestratorObjectivePlaceholder")}
            rows={3}
            style={{
              width: "100%",
              "box-sizing": "border-box",
              padding: "12px",
              "border-radius": "8px",
              border: "1px solid var(--color-border, rgba(255, 255, 255, 0.12))",
              background: "var(--color-bg-primary, rgba(0, 0, 0, 0.2))",
              color: "inherit",
              "font-family": "inherit",
              "font-size": "14px",
              resize: "vertical",
            }}
          />

          <div
            style={{
              display: "flex",
              "align-items": "center",
              "justify-content": "space-between",
              "flex-wrap": "wrap",
              gap: "10px",
            }}
          >
            <div
              style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "13px" }}
            >
              <span style={{ color: "var(--color-text-muted, #888)" }}>Execution Mode:</span>
              <button
                type="button"
                onClick={() => setStrategyMode("auto")}
                style={{
                  padding: "4px 10px",
                  "border-radius": "6px",
                  border: "1px solid",
                  cursor: "pointer",
                  "font-size": "12px",
                  "background-color":
                    strategyMode() === "auto" ? "var(--color-accent, #ea580c)" : "transparent",
                  color: strategyMode() === "auto" ? "#fff" : "inherit",
                  "border-color":
                    strategyMode() === "auto"
                      ? "var(--color-accent, #ea580c)"
                      : "var(--color-border, rgba(255, 255, 255, 0.15))",
                }}
              >
                Auto-Adaptive
              </button>
              <button
                type="button"
                onClick={() => setStrategyMode("single-agent")}
                style={{
                  padding: "4px 10px",
                  "border-radius": "6px",
                  border: "1px solid",
                  cursor: "pointer",
                  "font-size": "12px",
                  "background-color":
                    strategyMode() === "single-agent"
                      ? "var(--color-accent, #ea580c)"
                      : "transparent",
                  color: strategyMode() === "single-agent" ? "#fff" : "inherit",
                  "border-color":
                    strategyMode() === "single-agent"
                      ? "var(--color-accent, #ea580c)"
                      : "var(--color-border, rgba(255, 255, 255, 0.15))",
                }}
              >
                Fast Path (1 Agent)
              </button>
              <button
                type="button"
                onClick={() => setStrategyMode("multi-agent")}
                style={{
                  padding: "4px 10px",
                  "border-radius": "6px",
                  border: "1px solid",
                  cursor: "pointer",
                  "font-size": "12px",
                  "background-color":
                    strategyMode() === "multi-agent"
                      ? "var(--color-accent, #ea580c)"
                      : "transparent",
                  color: strategyMode() === "multi-agent" ? "#fff" : "inherit",
                  "border-color":
                    strategyMode() === "multi-agent"
                      ? "var(--color-accent, #ea580c)"
                      : "var(--color-border, rgba(255, 255, 255, 0.15))",
                }}
              >
                Multi-Agent DAG
              </button>
            </div>

            <button
              type="submit"
              disabled={loading() || !objective().trim()}
              style={{
                padding: "8px 18px",
                "border-radius": "8px",
                border: "none",
                background: "var(--color-accent, #ea580c)",
                color: "#fff",
                "font-weight": "600",
                "font-size": "13px",
                cursor: loading() || !objective().trim() ? "not-allowed" : "pointer",
                opacity: loading() || !objective().trim() ? 0.6 : 1,
              }}
            >
              {loading() ? "Analyzing & Dispatching..." : t("orchestratorStart")}
            </button>
          </div>
        </form>
      </section>

      {/* Runs Section */}
      <Show
        when={runs().length > 0}
        fallback={
          <div
            style={{
              "text-align": "center",
              padding: "48px 16px",
              color: "var(--color-text-muted, #888)",
            }}
          >
            <p>{t("orchestratorNoRuns")}</p>
          </div>
        }
      >
        <div style={{ display: "grid", "grid-template-columns": "260px 1fr", gap: "20px" }}>
          {/* Runs Sidebar */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <h3
              style={{
                margin: "0 0 4px 0",
                "font-size": "13px",
                "text-transform": "uppercase",
                color: "var(--color-text-muted, #888)",
                "letter-spacing": "0.5px",
              }}
            >
              Active & Past Runs
            </h3>
            <For each={runs()}>
              {(run) => (
                <button
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  style={{
                    display: "flex",
                    "flex-direction": "column",
                    "align-items": "flex-start",
                    gap: "4px",
                    padding: "10px 12px",
                    "border-radius": "8px",
                    border: "1px solid",
                    cursor: "pointer",
                    "text-align": "left",
                    background:
                      selectedRunId() === run.id
                        ? "rgba(249, 115, 22, 0.12)"
                        : "var(--color-bg-secondary, rgba(255, 255, 255, 0.03))",
                    "border-color":
                      selectedRunId() === run.id
                        ? "rgba(249, 115, 22, 0.5)"
                        : "var(--color-border, rgba(255, 255, 255, 0.08))",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      "justify-content": "space-between",
                      width: "100%",
                    }}
                  >
                    <span
                      style={{
                        "font-size": "11px",
                        "font-weight": "600",
                        "text-transform": "uppercase",
                        color: run.strategy === "single-agent" ? "#38bdf8" : "#f97316",
                      }}
                    >
                      {run.strategy}
                    </span>
                    <span
                      style={{
                        "font-size": "10px",
                        padding: "2px 6px",
                        "border-radius": "4px",
                        background:
                          run.status === "completed"
                            ? "rgba(34, 197, 94, 0.15)"
                            : run.status === "failed"
                              ? "rgba(239, 68, 68, 0.15)"
                              : run.status === "running"
                                ? "rgba(59, 130, 246, 0.15)"
                                : "rgba(156, 163, 175, 0.15)",
                        color:
                          run.status === "completed"
                            ? "#22c55e"
                            : run.status === "failed"
                              ? "#ef4444"
                              : run.status === "running"
                                ? "#3b82f6"
                                : "#9ca3af",
                      }}
                    >
                      {run.status}
                    </span>
                  </div>
                  <div
                    style={{
                      "font-size": "13px",
                      "font-weight": "500",
                      overflow: "hidden",
                      "text-overflow": "ellipsis",
                      display: "-webkit-box",
                      "-webkit-line-clamp": "2",
                      "-webkit-box-orient": "vertical",
                      color: "inherit",
                    }}
                  >
                    {run.objective}
                  </div>
                </button>
              )}
            </For>
          </div>

          {/* Run Detail & DAG Graph */}
          <Show when={currentRun()}>
            {(run) => (
              <div
                style={{
                  background: "var(--color-bg-secondary, rgba(255, 255, 255, 0.02))",
                  border: "1px solid var(--color-border, rgba(255, 255, 255, 0.08))",
                  "border-radius": "12px",
                  padding: "20px",
                  display: "flex",
                  "flex-direction": "column",
                  gap: "20px",
                }}
              >
                {/* Run Top Status Bar */}
                <div
                  style={{
                    display: "flex",
                    "align-items": "flex-start",
                    "justify-content": "space-between",
                    gap: "16px",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        gap: "8px",
                        "margin-bottom": "6px",
                      }}
                    >
                      <span
                        style={{
                          padding: "3px 8px",
                          "border-radius": "6px",
                          "font-size": "11px",
                          "font-weight": "600",
                          background:
                            run().strategy === "single-agent"
                              ? "rgba(56, 189, 248, 0.15)"
                              : "rgba(249, 115, 22, 0.15)",
                          color: run().strategy === "single-agent" ? "#38bdf8" : "#f97316",
                        }}
                      >
                        {run().strategy === "single-agent"
                          ? t("orchestratorFastPath")
                          : t("orchestratorMultiAgent")}
                      </span>
                      <span style={{ "font-size": "12px", color: "var(--color-text-muted, #888)" }}>
                        {new Date(run().startedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <h2 style={{ margin: 0, "font-size": "16px", "font-weight": "600" }}>
                      {run().objective}
                    </h2>
                  </div>

                  {/* Run Controls */}
                  <div style={{ display: "flex", gap: "8px" }}>
                    <WorkflowExportMenu
                      options={[
                        { label: "exportButton", source: { kind: "team-run", runId: run().id } },
                      ]}
                    />
                    <Show when={run().status === "running"}>
                      <button
                        type="button"
                        onClick={() => handlePause(run().id)}
                        style={{
                          padding: "6px 12px",
                          "border-radius": "6px",
                          border: "1px solid var(--color-border, rgba(255, 255, 255, 0.15))",
                          background: "transparent",
                          color: "inherit",
                          cursor: "pointer",
                          "font-size": "12px",
                        }}
                      >
                        Pause
                      </button>
                    </Show>
                    <Show when={run().status === "paused"}>
                      <button
                        type="button"
                        onClick={() => handleResume(run().id)}
                        style={{
                          padding: "6px 12px",
                          "border-radius": "6px",
                          border: "none",
                          background: "#22c55e",
                          color: "#fff",
                          cursor: "pointer",
                          "font-size": "12px",
                          "font-weight": "600",
                        }}
                      >
                        Resume
                      </button>
                    </Show>
                    <Show when={run().status === "running" || run().status === "paused"}>
                      <button
                        type="button"
                        onClick={() => handleCancel(run().id)}
                        style={{
                          padding: "6px 12px",
                          "border-radius": "6px",
                          border: "none",
                          background: "#ef4444",
                          color: "#fff",
                          cursor: "pointer",
                          "font-size": "12px",
                        }}
                      >
                        Cancel
                      </button>
                    </Show>
                  </div>
                </div>

                {/* Assigned Specialist Instances */}
                <div>
                  <h4
                    style={{
                      margin: "0 0 8px 0",
                      "font-size": "12px",
                      "text-transform": "uppercase",
                      color: "var(--color-text-muted, #888)",
                      "letter-spacing": "0.5px",
                    }}
                  >
                    Active Specialist Instances
                  </h4>
                  <div style={{ display: "flex", "flex-wrap": "wrap", gap: "10px" }}>
                    <For each={run().instances}>
                      {(instance) => {
                        const bot = getBotForId(instance.botId);
                        return (
                          <div
                            style={{
                              display: "flex",
                              "align-items": "center",
                              gap: "8px",
                              padding: "6px 10px",
                              "border-radius": "8px",
                              background: "var(--color-bg-primary, rgba(0, 0, 0, 0.2))",
                              border: "1px solid var(--color-border, rgba(255, 255, 255, 0.08))",
                              "font-size": "12px",
                            }}
                          >
                            <Show when={bot}>
                              {(b) => (
                                <AgentAvatar shape={b().avatarShape} color={b().avatarColor} />
                              )}
                            </Show>
                            <div>
                              <div style={{ "font-weight": "600" }}>{instance.botName}</div>
                              <div
                                style={{
                                  "font-size": "10px",
                                  color: "var(--color-text-muted, #888)",
                                  "text-transform": "uppercase",
                                }}
                              >
                                {instance.role} · {instance.status}
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>

                {/* DAG Task Graph */}
                <div>
                  <h4
                    style={{
                      margin: "0 0 10px 0",
                      "font-size": "12px",
                      "text-transform": "uppercase",
                      color: "var(--color-text-muted, #888)",
                      "letter-spacing": "0.5px",
                    }}
                  >
                    Dependency Task Graph (DAG)
                  </h4>
                  <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
                    <For each={run().tasks}>
                      {(task, idx) => {
                        const bot = getBotForId(task.assignedBotId);
                        return (
                          <div
                            style={{
                              padding: "12px 14px",
                              "border-radius": "8px",
                              border: "1px solid",
                              background: "var(--color-bg-primary, rgba(0, 0, 0, 0.2))",
                              "border-color":
                                task.status === "completed"
                                  ? "rgba(34, 197, 94, 0.3)"
                                  : task.status === "running"
                                    ? "rgba(59, 130, 246, 0.4)"
                                    : task.status === "repairing"
                                      ? "rgba(249, 115, 22, 0.4)"
                                      : task.status === "failed"
                                        ? "rgba(239, 68, 68, 0.4)"
                                        : "var(--color-border, rgba(255, 255, 255, 0.08))",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                "align-items": "center",
                                "justify-content": "space-between",
                                "margin-bottom": "6px",
                              }}
                            >
                              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                                <span style={{ "font-weight": "600", "font-size": "13px" }}>
                                  #{idx() + 1} {task.title}
                                </span>
                                <Show when={bot}>
                                  {(b) => (
                                    <span
                                      style={{
                                        "font-size": "11px",
                                        color: "var(--color-text-muted, #888)",
                                      }}
                                    >
                                      ({b().name})
                                    </span>
                                  )}
                                </Show>
                              </div>
                              <span
                                style={{
                                  "font-size": "10px",
                                  "font-weight": "600",
                                  padding: "2px 6px",
                                  "border-radius": "4px",
                                  "text-transform": "uppercase",
                                  background:
                                    task.status === "completed"
                                      ? "rgba(34, 197, 94, 0.15)"
                                      : task.status === "failed"
                                        ? "rgba(239, 68, 68, 0.15)"
                                        : task.status === "repairing"
                                          ? "rgba(249, 115, 22, 0.15)"
                                          : task.status === "running"
                                            ? "rgba(59, 130, 246, 0.15)"
                                            : "rgba(156, 163, 175, 0.15)",
                                  color:
                                    task.status === "completed"
                                      ? "#22c55e"
                                      : task.status === "failed"
                                        ? "#ef4444"
                                        : task.status === "repairing"
                                          ? "#f97316"
                                          : task.status === "running"
                                            ? "#3b82f6"
                                            : "#9ca3af",
                                }}
                              >
                                {task.status}
                              </span>
                            </div>

                            <p
                              style={{
                                margin: "0 0 8px 0",
                                "font-size": "12px",
                                color: "var(--color-text-muted, #888)",
                              }}
                            >
                              {task.description}
                            </p>

                            {/* Verification Evidence */}
                            <Show when={task.evidence.length > 0}>
                              <div
                                style={{
                                  display: "flex",
                                  "flex-wrap": "wrap",
                                  gap: "6px",
                                  "margin-top": "6px",
                                }}
                              >
                                <For each={task.evidence}>
                                  {(ev) => (
                                    <span
                                      style={{
                                        "font-size": "10px",
                                        padding: "2px 6px",
                                        "border-radius": "4px",
                                        background: ev.passed
                                          ? "rgba(34, 197, 94, 0.1)"
                                          : "rgba(239, 68, 68, 0.1)",
                                        color: ev.passed ? "#22c55e" : "#ef4444",
                                        border: `1px solid ${ev.passed ? "rgba(34, 197, 94, 0.2)" : "rgba(239, 68, 68, 0.2)"}`,
                                      }}
                                    >
                                      {ev.type}: {ev.passed ? "PASS" : "FAIL"}
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

                {/* Inter-Agent Collaboration Stream */}
                <Show when={run().messages.length > 0}>
                  <div>
                    <h4
                      style={{
                        margin: "0 0 10px 0",
                        "font-size": "12px",
                        "text-transform": "uppercase",
                        color: "var(--color-text-muted, #888)",
                        "letter-spacing": "0.5px",
                      }}
                    >
                      Inter-Agent Handoffs & Collaboration Log
                    </h4>
                    <div style={{ display: "flex", "flex-direction": "column", gap: "6px" }}>
                      <For each={run().messages}>
                        {(msg) => (
                          <div
                            style={{
                              padding: "8px 12px",
                              "border-radius": "6px",
                              background: "rgba(255, 255, 255, 0.02)",
                              border: "1px solid var(--color-border, rgba(255, 255, 255, 0.05))",
                              "font-size": "12px",
                              display: "flex",
                              "align-items": "center",
                              "justify-content": "space-between",
                            }}
                          >
                            <div>
                              <span style={{ "font-weight": "600", color: "#f97316" }}>
                                [{msg.type}]
                              </span>{" "}
                              <span>{msg.summary}</span>
                            </div>
                            <span
                              style={{
                                "font-size": "10px",
                                color: "var(--color-text-muted, #888)",
                              }}
                            >
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
