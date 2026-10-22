# Upstream Radar & Clean-Room Architecture Tracking

## 1. Upstream Targets & License Boundaries

Sahkarmi tracks developments from the following open-source upstream projects to incorporate cutting-edge capabilities into its native Indian-market localized desktop suite:

| Repository | Scope / Focus | License Status | Integration Policy |
| :--- | :--- | :--- | :--- |
| `nightly-labs/openbot` | Local-first desktop workspace, UI patterns, browser automation | PolyForm Noncommercial (v0.1.12+) / Apache-2.0 (v0.1.11 and prior) | **Clean-Room Implementation Only**: Never copy code directly from v0.1.12+. Study features, architecture, and behavior; write clean, independent implementations adhering to Sahkarmi's 100% native brand and Solid.js architecture. |
| `r2hu1/openbots` | Autonomous multi-agent coordination, team orchestration, self-hosting | Apache-2.0 | **Architectural Reference**: Direct inspiration for Sahkarmi's Adaptive Multi-Agent Engine DAG, tool registries, and execution loops. |

---

## 2. Feature Porting & Status Matrix

| Feature Concept | Upstream Reference | Sahkarmi Implementation | Status |
| :--- | :--- | :--- | :--- |
| **Adaptive Multi-Agent DAG Engine** | `r2hu1/openbots` agent orchestration | `src/backend/adaptive-orchestrator.ts`, `OrchestratorView.tsx` | **Implemented (v0.5.3)** |
| **Autonomous Dev Team Assembly** | `r2hu1/openbots` dynamic team creation | `create_coworker` tool in `agent-service.ts` | **Implemented (v0.5.3)** |
| **Action-Observation Tool Registry & Guardrails** | `r2hu1/openbots` tool sandboxing | `src/backend/tool-registry.ts` with credential redactor | **Implemented (v0.5.3)** |
| **Evidence-based Verification Gates** | `r2hu1/openbots` QA validation | `src/backend/verification-repair-engine.ts` | **Implemented (v0.5.3)** |
| **Persistent Agent Notebook / Memory Hub ("Smriti")** | `nightly-labs/openbot` Cobrain note-sync & memory | `src/backend/agent-memory-store.ts`, `save_memory` / `search_memory` tools | **Implemented (v0.5.4)** |
| **In-App What's New & Release Highlights** | `nightly-labs/openbot` v0.38+ Release notes dialog | `src/renderer/src/components/WhatsNewDialog.tsx` | **Implemented (v0.5.4)** |
| **CPU & Idle Performance Polish** | `nightly-labs/openbot` v0.40+ CPU optimizations | Removal of redundant status re-check polling & animation dampening | **Implemented (v0.5.4)** |

---

## 3. Automated Tracking Logs

Automated checks run via `.github/workflows/upstream-watch.yml` or locally via `npm run upstream:check`.

### Check on 2026-10-22
- **nightly-labs/openbot**: Latest release [v0.47.1](https://github.com/nightly-labs/openbot/releases/tag/v0.47.1) (published 2026-10-21).
- **r2hu1/openbots**: Latest commit `0862bf6` ("Update user-menu.tsx").
