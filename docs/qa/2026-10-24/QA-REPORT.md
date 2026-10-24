# Sahkarmi desktop QA — 24 October 2026

Statuses: **PASS**, **FAIL**, **FIXED** (failed on 0.7.1, passes on the fixed build), **BLOCKED**, **NOT TESTED**.

## Environment

| Item | Value |
| --- | --- |
| Machine | Windows 11 Home Single Language 10.0.26200, 13th Gen Intel Core i7-13620H, 15.7 GB RAM, 1920×1200 display at 125 % |
| App under test | Installed release 0.7.1 (`%LOCALAPPDATA%\Programs\sahkarmi\Sahkarmi.exe`, ProductVersion 0.7.1.0) for the baseline; then the source build of this branch (commits 2e387db, 3f2e1d5, 89f09af) started with `electron .` for the fixed runs |
| Profile | Fresh, isolated: `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` pointed at an empty folder, so no sign-ins, no previous data. The owner's real profile was never used. |
| AI | Free built-in model only (OpenCode runtime), as instructed by the owner. Claude, Codex and Google Antigravity were not signed in and therefore **NOT TESTED** in this session. |
| Driving | Playwright over the Chromium DevTools Protocol (`--remote-debugging-port`), plus Win32 window placement. Screenshots are CDP page captures; the one window capture that includes the embedded browser pane is an OS screen grab. |
| Redaction | Every capture is checked for the owner's email address before saving; none contains it. |

## Evidence register

| ID | Area | Steps | Expected | Actual | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | First launch | Start 0.7.1 on a fresh profile | Setup screen; free model available without sign-in | Setup screen; OpenCode "Available"; Claude/Codex "Sign in required"; Antigravity "Not installed"; default pre-selected = OpenCode | PASS | `T01-first-launch-setup.png` |
| T02 | First launch | Continue with OpenCode | Main interface | Main interface opened, but a **What's New 0.7.1** dialog covers it on a brand-new install | PASS (UX note U1) | `T02-main-first-open.png`, `T02-main-interface-fresh.png` |
| T03 | Core conversation | Send first message to Asha on the free model (0.7.1) | Reply | **No reply. "Interrupted · Send again" after ~2 min; coworker stayed "working"; Send again queued for ever** | FAIL → FIXED (D1) | `T03a`…`T03h-*.png`, app log in `qa-home` (not committed) |
| T10–T12 | Core conversation | Same on build with fix D1 | Reply | Turn ran instead of being interrupted, but **no reply after 7 min and no error**; OpenCode's own log: `Free usage limit reached` within 1 s | FAIL → FIXED (D2) | `T10-fix-main-fresh.png`, `T11-fix-message-working.png`, `T12b-asha-thread-now.png` |
| T13 | Stop | Press Stop on the hung turn (0.7.1 behaviour) | Turn ends with a message | "OpenCode (free) sent back an empty reply…" shown; queue paused ("Ruka hua") | PASS | `T13-after-stop.png` |
| T14 | Watchdog | First message on build with D2 | Silent turn fails with a reason | After 90 s: "Failed · Send again" + explanation naming the free limit; composer usable again | FIXED | `T14-watchdog-failed-turn.png` |
| T30 | Free-model rotation | First message on build with D3 (fresh profile) | Reply | big-pickle silent → after 60 s note "Sahkarmi will try the next free model (opencode/beam-free)" → message re-sent automatically → **real reply at 66 s** | FIXED | `T30-rotation-first-reply.png` |
| S01 | Core conversation | Second coworker (Vikram) message | Reply | Reply in 6 s on the rotated free model | PASS | `S01-conversation-vikram-free-model.png` |
| S02 | Search | Ctrl+K, type "catalogue" | Dialog with matching coworker/message | Dialog opened; results shown | PASS | `S02-search-everything.png`, `T20`, `T21` |
| S03 | Provider setup | Settings → AI and models | Connect buttons per provider, free runtime connected | ChatGPT/Claude "Sign-in needed" with Connect + API key; Antigravity "Not installed" with Connect; OpenCode "Connected" | PASS (sign-in flows NOT TESTED) | `S03-settings-ai-and-models.png` |
| S04 | Settings | Permissions page | Page renders | Rendered | PASS (content not evaluated) | `S04-settings-permissions.png` |
| S05–S07 | Views | Approvals, Shared files, Schedules | Views render on an empty workspace | Rendered | PASS | `S05-approvals.png`, `S06-shared-files.png`, `S07-schedules.png` |
| S08 | Browser pane | Show browser | Embedded browser tab with Take over | Pane opened on Google with Take over button (OS capture) | PASS (Take over/hand-back NOT TESTED) | `S08b-browser-pane-os-capture.png` |
| S09 | Language | Settings → General → हिन्दी | Interface in Hindi | Navigation, settings and buttons in Hindi; **coworker roles, "No messages yet", "AI updates", "Version" stay English** | PASS (UX note U3) | `S09-hindi-interface-conversation.png`, `S09a-settings-hindi.png` |
| S10 | Theme | Night (dark) | Dark theme | Applied | PASS | `S10-dark-theme-conversation.png` |
| S11–S12 | Coworker CRUD | Ctrl+N; rename to Priya / Marketing | New coworker created and renamed | Created ("New coworker"); name applied; **role chip still "New coworker" after typing the title** (U4) | PASS | `S11-new-coworker-created.png`, `S12a`, `S12b` |
| S13–S14 | Delete + undo | Delete → confirm → Undo; delete again, wait 9.5 s | Undo restores; later delete is permanent | Undo restored Priya; second delete removed her after the 8-s window | PASS | `S13-undo-toast.png`, `S14-after-undo.png` |
| S15 | Persistence | Kill app, relaunch on same profile | Conversations, settings and window bounds kept; no setup/What's New again | All kept; `window-state.json` = 1456×940 at (40,40); window up ~10.6 s after launch (dev build) | PASS | `S15-after-restart.png` |
| P1 | Performance | Working set with the free runtime running | — | App ~590 MB across 5 Electron processes + OpenCode runtime 416 MB ≈ 1.0 GB working set (1.45 GB private) | INFO | PowerShell measurement (see Environment) |
| P2 | Startup | Time to CDP ready / window | — | Packaged 0.7.1: CDP ready in ~1 s after launch; dev build window after ~10.6 s (includes Electron + Vite assets) | INFO | — |
| U1 | Update | 0.7.1 auto-update on owner's PC (log) | Update downloaded and applied | Owner log: 0.7.1 downloaded 05:56 UTC and running | PASS | Owner's `sahkarmi.log` (not committed) |
| U2 | Runtime update | Bundled OpenCode auto-update once per session | Update, no error | Runtime 1.19.4 downloaded; **"AI tool update failed: EPERM/ENOTEMPTY"** logged although it succeeded | FAIL → FIXED (D4) | `qa-home` app log |
| SEC1 | Secrets | Grep source and built bundle for key patterns | None | Only redaction patterns matched (the log redacts `sk-ant-*`, `AIza*` keys) | PASS | `rg` over `src/`, `out/` |
| SEC2 | Telemetry | Grep for analytics/telemetry SDKs | None | None; outbound hosts in code: GitHub (updates), npm registry (runtime updates), dl.google.com (Antigravity on Connect), provider endpoints via their CLIs | PASS | `rg` over `src/` |
| SEC3 | Log privacy | Inspect app log | No secrets | The connected provider's **account email is written to the app log** in status lines (see U5) | INFO | Owner's and QA logs |

## Defects

| ID | Severity | Title | Root cause | Fix |
| --- | --- | --- | --- | --- |
| D1 | P0 | First message on a fresh install "Interrupted"; coworker stuck working; queue never drains | `#refreshModelsAndCli` (window focus + periodic) restarts any provider that is not connected (Codex/Claude signed out). `#connect` ended with `#reconcileUnresolvedDeliveries()` over **all** providers, marking OpenCode's in-flight delivery "interrupted: Sahkarmi restarted…". | Commit 2e387db: reconcile only deliveries unresolved when the (re)connect began, for the (re)started providers, never one the service is starting itself. Regression test with a signed-out fake Claude. |
| D2 | P0 | Free model at its usage limit: turn stays "working" for ever, no error | OpenCode's ACP server swallows `AI_APICallError: Free usage limit reached` and never answers `session/prompt` (raw ACP probe: nothing for 45 s). | Commit 3f2e1d5: 60-s silence watchdog per turn; cancels and fails the turn with a provider-specific reason. |
| D3 | P1 | "Free model" is one hard-coded model (`opencode/big-pickle`), the one whose free limit is hit first | Per-model limits at OpenCode; other `-free` models still answer (verified with the CLI). | Commit 89f09af: rotate across OpenCode's free models; exhausted one skipped for an hour; automatic re-send once per delivery. |
| D4 | P3 | "AI tool update failed: EPERM/ENOTEMPTY" after a successful runtime update | `rmSync` of the temp folder fails while Windows still holds files. | Commit 3f2e1d5: retries, then a warning instead of an error. |

## UX notes (not fixed in this branch)

- **U1** What's New dialog appears on a brand-new install, before the user has seen the app once. Show it only when `seen` was a previous version.
- **U2** First-run default pre-selects a paid provider (Codex) when its sign-in exists on the PC, even for a user who did not choose it; consider defaulting to the free model and offering the paid one.
- **U3** Hindi locale leaves coworker role chips, "No messages yet", "AI updates" and "Version" in English.
- **U4** Editing the "Agent title" field in the coworker panel did not update the role chip in the list until later (needs a check of save timing).
- **U5** The connected provider's account email is written to the app log on every status line; keep it out of logs or redact in diagnostics export.
- **U6** Hinglish status lines ("Kaam chal raha hai", "0 line mein") appear in the English interface; intentional per `docs/HINGLISH-ACTIVITY-REPORT.md`, but confusing for non-Indian users. Consider tying it to the Hindi locale or the "Seedha (plain)" style.
- **U7** In the thread, the rotation notes are rendered after the reply they explain (ordering of system notes vs. the re-sent turn).
- **U8** `bun run release:preflight` fails on Windows with ENOENT (spawns a tool without a shell); documented in RELEASING as the release gate.

## Not tested in this session

Claude, Codex and Google Antigravity sign-in and conversations; attachments; voice notes; Take over / hand-back; approvals end to end (requires a provider that calls the approval tool); schedules firing; multi-window; macOS and Linux builds (no hardware); fresh *installer* run of 0.7.2 (not built yet).
