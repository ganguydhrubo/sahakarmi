# Sahkarmi — Adaptive Multi-Agent Architecture Review
**Inspired by OpenBots Engineering Principles**

## 1. Executive Summary
This document reviews the architectural foundations of Sahkarmi in relation to the public engineering patterns of [OpenBots](https://github.com/r2hu1/openbots). It outlines the design for Sahkarmi's **Adaptive Multi-Agent Engine**: a high-performance, deterministic execution environment that dynamically scales between a single-agent fast path and a structured, dependency-aware multi-agent task graph (DAG).

---

## 2. OpenBots Architecture & Transferable Engineering Principles

OpenBots demonstrates several key architectural strengths for production-grade agent environments:

1. **Separation of Concerns:**
   - Persistent Agent Definitions (roles, system prompts, permission templates) are decoupled from ephemeral **Agent Execution Instances** (runtime memory, assigned subtask, active scratchpads, execution logs).
2. **Durable Task Graphs (DAGs):**
   - Complex workflows are broken down into discrete task nodes with explicit inputs, deliverables, dependencies, and verification criteria.
   - Independent tasks execute concurrently; dependent tasks wait until prerequisites succeed.
3. **Action-Observation Loop & Tool Registries:**
   - Execution is driven by an explicit Action-Observation cycle. Tool execution is sandboxed, inputs/outputs are strictly validated, and secrets are redacted before persistence.
4. **Adaptive Scaling (Not Always Multi-Agent):**
   - Simple tasks bypass orchestrator overhead via a direct single-agent fast path.
   - Multi-agent collaboration is activated only when task complexity, multiple workstreams, or multi-domain verification demands it.
5. **Automated Review & Repair Gates:**
   - Tasks cannot be marked complete by agent assertion alone. Real verification evidence (lints, typechecks, tests, builds) is required.
   - Failures create explicit defect tasks routed to specialists for bounded repair loops.

---

## 3. Sahkarmi Baseline & Gap Analysis

| Architectural Dimension | Existing Sahkarmi Implementation | OpenBots Pattern to Adapt | Engine Upgrade Target |
| :--- | :--- | :--- | :--- |
| **Agent Modeling** | `BotProfile` / `BotSummary` in `BotStore`. Represents persistent coworker bots. | Decoupled persistent bot profile from runtime execution instance. | Create `AgentExecutionInstance` spawned per task with unique context, workspace, and lifecycle. |
| **Orchestration Policy** | Single-agent FIFO queue in `MailboxStore`. Requests processed turn-by-turn per bot. | Adaptive DAG orchestrator evaluating task complexity, dependencies, and specialist roles. | Create `AdaptiveOrchestrator` with complexity evaluator, DAG planner, and parallel task scheduler. |
| **Collaboration & Handoffs** | Basic bot-to-bot messaging in `MailboxStore` (`sender: { kind: "bot" }`). | Structured agent collaboration bus (delegation, review requests, handoffs, escalations). | Create `AgentCollaborationBus` with infinite loop prevention, role routing, and artifact handoffs. |
| **Tool Execution & Safety** | ACP / AppServer / Claude tool loops with `classifyCommand` / `classifyBrowserAction`. | Validated Action-Observation registry with permission boundaries and secret sanitization. | Create unified `ToolRegistry` with structured execution telemetry and credential redaction. |
| **Verification & Quality Gates** | Ad-hoc terminal checks or manual user verification. | Automated verification & repair engine with bounded retry budgets. | Create `VerificationRepairEngine` running linter, typecheck, unit tests, and build checks before sign-off. |
| **Durable State & Recovery** | `bots.json`, `mailbox.json`, `schedules.json` via atomic file writes. | Atomic task claiming, execution history, and interrupted run recovery. | Create `OrchestratorStore` managing runs, tasks, dependencies, and deliverables persistently. |
| **User Experience & Telemetry** | Single coworker conversation thread, status dots, and tool cards. | Real-time DAG visualization, specialist instance indicators, and live activity streams. | Expose live DAG task graph, instance lifecycle, and verification evidence directly in the UI. |

---

## 4. Architectural Design: Adaptive Multi-Agent Engine

```
                          ┌────────────────────────┐
                          │    User Request / UI   │
                          └───────────┬────────────┘
                                      │
                         ┌────────────▼───────────┐
                         │  AdaptiveOrchestrator  │
                         └────────────┬───────────┘
                                      │
               ┌──────────────────────┴──────────────────────┐
               │ Complexity & Strategy Evaluation            │
               ▼                                             ▼
     [ Single-Agent Fast Path ]                   [ Multi-Agent Task Graph (DAG) ]
    ┌─────────────────────────┐                  ┌───────────────────────────────┐
    │ 1 Assigned Specialist   │                  │ Task Planner & Dependency DAG │
    │ Direct Execution Loop   │                  │ Concurrency & Handoff Engine  │
    └───────────┬─────────────┘                  └───────────────┬───────────────┘
                │                                                │
                └─────────────────────┬──────────────────────────┘
                                      │
                         ┌────────────▼────────────┐
                         │ Agent Execution Factory │
                         │ (Spawns Context & Work) │
                         └────────────┬────────────┘
                                      │
                ┌─────────────────────┼─────────────────────┐
                ▼                     ▼                     ▼
        ┌───────────────┐     ┌───────────────┐     ┌───────────────┐
        │ Instance: Dev │     │Instance: Asha │     │ Instance: QA  │
        │  (Code AST)   │     │ (Finance/GST) │     │  (Test Suite) │
        └───────┬───────┘     └───────┬───────┘     └───────┬───────┘
                │                     │                     │
                └─────────────────────┼─────────────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │   Unified Tool Registry   │
                        │ & Action-Observation Loop │
                        └─────────────┬─────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │ Automated Review & Repair │
                        │  (Lint, Types, Tests DAG) │
                        └─────────────┬─────────────┘
                                      │
                        ┌─────────────▼─────────────┐
                        │ Persistent Delivery State │
                        │  & Real-Time Event Stream │
                        └───────────────────────────┘
```

---

## 5. Security, Isolation, and Resource Governance

1. **Workspace Scoping:** Each execution instance runs in an assigned directory path. File modifications are recorded as discrete patches/diffs.
2. **Tool Permission Boundaries:** Specialists receive only the permissions required for their role (e.g. QA can run tests and read files, but cannot make external financial transactions).
3. **Execution Budgets:** Bounded delegation depth (maximum 3 levels), max turn limits (10 turns per task), and max repair attempts (3 attempts) prevent infinite loops.
4. **Secret Sanitization:** All environment variables, tokens, and API keys are redacted from logs and tool outputs before serialization.
