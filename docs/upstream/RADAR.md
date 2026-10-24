# Upstream Radar

> **Radar v2 (24 Oct 2026):** `.github/workflows/upstream-watch.yml` runs every 6 hours, classifies
> each new OpenBot desktop release's licence, writes `reports/<tag>.md`, opens a tracking issue and
> mails the owner. No upstream code is ever merged (PolyForm Noncommercial since v0.1.12).
> How it works: [docs/UPSTREAM-SYNC.md](../UPSTREAM-SYNC.md). State: `state.json`.
> Lines below this note are appended by the radar, newest last.

## Radar log (v2)

<!-- radar-v2-log -->
- 2026-10-24 · [v0.49.0](https://github.com/nightly-labs/openbot/releases/tag/v0.49.0) · PolyForm Noncommercial 1.0.0 · **CRITICAL** (provider) · 37 candidates · [report](reports/v0.49.0.md) · [issue](https://github.com/ganguydhrubo/sahakarmi/issues/29)

---

## Radar v1 history (kept for reference)

### Upstream Radar & Clean-Room Architecture Tracking (v1)

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

### Check on 2026-10-23
- **nightly-labs/openbot**: Latest release [v0.48.1](https://github.com/nightly-labs/openbot/releases/tag/v0.48.1) (published 2026-10-22).
- **r2hu1/openbots**: Latest commit `0862bf6` ("Update user-menu.tsx").

### Check on 2026-10-24
- **nightly-labs/openbot**: Latest release [v0.48.2](https://github.com/nightly-labs/openbot/releases/tag/v0.48.2) (published 2026-10-23).
- **r2hu1/openbots**: Latest commit `3ca1ecc` ("feat: update pakages").
