# Sahkarmi workspace upgrade — interface audit and implementation plan

Inspected: `main` at `fe2c89c` (package version 0.3.3). Latest published release: **v0.3.3**
(16 assets, release run 39400119963 green). Baseline checks before any change: Biome clean,
typecheck clean, **159 tests passed / 3 skipped**, production build OK
(renderer JS 341.7 kB, CSS 144.0 kB).

Research limits: the reference pages (Codex app, Codex pricing, OpenCode desktop, Cdesktop, Floot)
cannot be fetched from this build sandbox (DNS blocked). Findings below come from web search
results, official SDK type definitions shipped in `node_modules`, and the bundled OpenCode binary.

## 1. Audit of the current interface

### Strengths
- Coherent brand: saffron/indigo tokens, Paper/Night/System themes, EN/HI/BN, bundled fonts.
- Three-pane shell with resizable/collapsible panes, workspace switcher, live status dots.
- Task queue strip, tool-call cards, approvals inbox, schedules, shared files, browser take-over.
- Four providers (Codex, Claude, Gemini CLI, bundled OpenCode) behind one internal protocol.
- v0.3.3 updater: automatic download, stall watchdog, bounded retry, phase-aware controls.

### Navigation problems
- Schedules are only reachable inside one coworker's composer; there is no global list.
- No place to see which provider/model each coworker uses, or any usage/limit information.
- Settings is one flat grid; providers, permissions, voice and data controls are mixed or missing.

### Missing functionality
- Usage and quota visibility (Codex rate limits were fetched but never shown).
- Permission policy: every adapter runs with full access and auto-accepts every tool call.
  Approvals rely on the model choosing to call `request_approval` (prompt-only safeguard).
- Structured rendering: assistant text shows only inline bold/code; lists, tables and code
  blocks are flattened.
- Voice: Web Speech API only, no recording, preview, cancel or audio attachment; usually fails
  inside Electron.
- No feature registry, no business targets, no integration registry.

### Workflow friction
- A risky browser click (pay / submit / send) is not intercepted by the application.
- The owner cannot tell whether a number came from the provider or was guessed.

### Performance
- v0.3.3 already batches streamed deltas per animation frame. Markdown parsing must be memoised
  per message body so streaming does not re-parse unrelated messages.
- Provider/model catalogues and usage must refresh on demand or on an interval, never per render.

### Compatibility risks
- Changing provider approval modes can change agent behaviour; defaults must keep low-risk work
  automatic so coworkers stay useful.
- Data files must be versioned; no existing file may be rewritten in an incompatible way.

## 2. Verified data sources (what is real)

| Provider | Data | Source | Label |
| --- | --- | --- | --- |
| Codex (ChatGPT) | 5-hour and weekly window %, reset time | App Server `account/rateLimits/read` | VERIFIED |
| Codex | tokens per thread | `thread/tokenUsage/updated` | VERIFIED (tokens) |
| Claude | 5-hour / 7-day utilization, reset, status | Agent SDK `rate_limit_event` | VERIFIED |
| Claude | tokens and USD per turn | SDK `result.modelUsage` / `total_cost_usd` ("an estimate, not a billing statement") | tokens VERIFIED, cost ESTIMATED |
| OpenCode | context tokens used/size, cost | ACP `usage_update` | tokens VERIFIED, cost ESTIMATED |
| Gemini CLI | none exposed over ACP | — | UNAVAILABLE |
| Fiverr | no official seller API for orders/gigs (affiliate API only) | web research | NOT SUPPORTED |

## 3. Implementation checklist

| # | Feature | Existing | Change | Main files | Acceptance | Risk | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Permission policy + enforcement | auto-accept everywhere | policy store, effective-policy engine, mandatory safeguards, pre-authorisations, audit log; enforce in Claude `canUseTool`, Codex approvals (`untrusted`), ACP `request_permission` (+ `OPENCODE_PERMISSION`), Sahkarmi browser tools | `permission-*.ts`, adapters, `agent-service.ts` | sensitive actions always need approval; deny blocks | medium | unit + adapter tests |
| 2 | Usage ledger + Model Usage view | Codex limits fetched, unused | ledger (versioned JSON), per-provider snapshots with source/time, freshness → STALE, alerts | `usage-store.ts`, adapters, `ModelUsageView.tsx` | no fabricated values; labels everywhere | low | unit + UI tests |
| 3 | Structured rendering | inline only | block markdown renderer (lists, nested, checklists, tables, code, quotes) + copy actions | `markdown.ts`, `RichMarkdown.tsx` | EN/HI/BN preserved; streaming safe | low | unit tests |
| 4 | Voice workspace | Web Speech dictation | MediaRecorder state machine, level meter, pause/resume, preview, cancel, attach audio, optional live transcript with disclosure | `voice-recorder.ts`, `VoiceRecorder.tsx` | honest engine label; audio never sent as "heard" | medium (packaged mic not testable here) | state-machine tests |
| 5 | Feature registry | none | built-in definitions + computed availability + validated manifest import with change preview (metadata only, no code) | `feature-registry.ts`, `FeaturesView.tsx` | unusable features never shown as available | low | unit tests |
| 6 | Business integrations + targets | none | integration registry (Fiverr = not supported, explains access needed), owner-defined targets store | `business-store.ts`, `BusinessView.tsx` | targets labelled owner-defined, never mixed with quotas | low | unit + UI tests |
| 7 | Navigation + Settings sections | flat | rail entries (Model Usage, Integrations, Schedules, Activity), sectioned Settings with Permissions, Voice, Features | `Sidebar.tsx`, `SettingsView.tsx` | every control persisted | low | UI tests |

Not in scope this pass (reported honestly): remote signed feature catalogue, local/offline
speech-to-text engine, smart automatic model routing across paid providers, image generation.
