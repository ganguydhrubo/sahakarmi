# Sahkarmi workspace upgrade — delivery report

Branch: `feat/workspace-upgrade`, based on `main` at `fe2c89c` (v0.3.3).
Commits: `e339b78` (permissions) … `e374d6a` (polish) (run `git log fe2c89c..feat/workspace-upgrade`).
**No release, tag, installation or data migration was performed.** The branch is pushed and
waits for your review and merge.

Statuses: **IMPLEMENTED AND VERIFIED** (automated tests and/or real Electron run) ·
**IMPLEMENTED BUT NOT FULLY VERIFIED** · **PARTIALLY IMPLEMENTED** · **BLOCKED** ·
**NOT IMPLEMENTED**.

## 1. Feature status

| Area | Status | What was verified |
| --- | --- | --- |
| Permission policy engine (16 categories; ask / allow / own-folders / block; sensitive categories can never be automatic) | IMPLEMENTED AND VERIFIED | Unit tests. Real Electron IPC: `setLevel("payments","auto")` rejected, `shell=deny` persisted to `permissions.json`. |
| Enforcement — Claude adapter | IMPLEMENTED BUT NOT FULLY VERIFIED | `permissionMode: "default"`, and every tool goes through `canUseTool` to the policy. `bypassPermissions` and `allowDangerouslySkipPermissions` are removed. Not run against a live Claude login. **Limitation:** "allow" rules in your own `~/.claude/settings.json` can still pre-approve tools before `canUseTool`. |
| Enforcement — Codex adapter | IMPLEMENTED BUT NOT FULLY VERIFIED | `approvalPolicy: "untrusted"`. Command and file-change approval requests are decided by the policy (protocol tests with a fake Codex: hold until the owner decides, decline on reject, auto-accept inside the coworker folder, timeout). Not run against a live Codex; whether every `apply_patch` raises an approval under `untrusted` + full-access sandbox is unconfirmed. |
| Enforcement — Gemini CLI / OpenCode (ACP) | IMPLEMENTED AND VERIFIED (protocol) / NOT TESTED (live model) | Each `session/request_permission` is answered allow-once or reject-once; "always allow" is never chosen (fake ACP agent tests). Real Electron run: the bundled OpenCode 1.19.3 process receives `OPENCODE_PERMISSION={"edit":"ask","bash":"ask","webfetch":"ask","external_directory":"ask"}`. A live model call was impossible: opencode.ai is blocked from this sandbox. |
| Enforcement — Sahkarmi browser tools | IMPLEMENTED AND VERIFIED | Clicks, submits and key presses are classified from the element's label and page URL (EN/HI/BN keywords: pay, send, post, submit, GST/ITR…). Test: a "Pay now" click is held until approved, then runs. This is a keyword heuristic, not a guarantee. |
| Owner prompts for paused tool calls | IMPLEMENTED AND VERIFIED | Shown in Approvals as "Paused tool call". Answered in place, not messaged to the coworker. 15-minute timeout declines the action. Pending ones are closed honestly on restart. |
| Pre-approvals (time- and use-limited grants) | IMPLEMENTED AND VERIFIED | Unit tests: expiry, per-coworker scope, use counting; block overrides a grant. |
| Audit log + Activity view | IMPLEMENTED AND VERIFIED | Redacted actions (tokens, keys, card numbers stripped). Capped at 1,000 entries. Filters, CSV export and clear (unit + UI tests). |
| App updates permission | IMPLEMENTED BUT NOT FULLY VERIFIED | "Download app updates = Ask" stops automatic downloads (UpdateService option). Packaged auto-update was not exercised. |
| Model Usage dashboard | IMPLEMENTED AND VERIFIED (UI + ledger) / NOT TESTED (live providers) | Every number is labelled Verified, Estimated, Unavailable or Stale, with its source. Sources: Codex `account/rateLimits/read` + thread token totals; Claude `rate_limit_event` (status and reset only, because the SDK does not document the unit of `utilization`) + `result.modelUsage` tokens with cost labelled Estimated; OpenCode `usage_update` context and cost; Gemini Unavailable. Windows go Stale after 30 minutes or past their reset time. Alerts at 80% and 95%, plus limited and signed-out states. No live provider data was available here. |
| Model selector — task profiles and suggestions | IMPLEMENTED AND VERIFIED | Labs feature, off by default. Suggest-only: nothing switches without a click. Free coworkers stay on free models; a paid option is marked and asks for confirmation. **Automatic smart routing is NOT IMPLEMENTED (deliberately), so there is no silent paid switching.** |
| Business: owner-defined targets | IMPLEMENTED AND VERIFIED | Stored in `business-targets.json` and labelled "Owner-defined". Never mixed with provider or platform data. |
| Business: integrations registry | IMPLEMENTED AND VERIFIED | Fiverr = Not supported: there is no public seller API, and Sahkarmi does not scrape your account. GST portal and email = browser with you. Tally = file import. WhatsApp Business = not supported without the official platform. |
| Feature registry + manifest import | IMPLEMENTED AND VERIFIED | Availability is computed from real provider state. Imported lists are metadata only: any key that could carry code, links or commands is rejected (real Electron IPC test). Changes are previewed before applying; announced features are never shown as available. Safety features cannot be switched off. |
| Remote signed feature catalogue | NOT IMPLEMENTED | Manual import only. No network fetch or remote code. |
| Structured replies (headings, nested lists, checklists, tables, code, quotes) + copy | IMPLEMENTED AND VERIFIED | Parser tests include Hindi/Bengali and half-streamed fences. Copy code, copy table as TSV, copy message as Markdown or plain text. The parse is memoised per message body. |
| Voice notes (IDLE → REQUESTING_PERMISSION → RECORDING ⇄ PAUSED → PROCESSING → PREVIEW → SENDING → COMPLETE) | IMPLEMENTED BUT NOT FULLY VERIFIED | State machine unit-tested. Real Electron: the microphone permission is granted to the app window only (camera and geolocation denied). Actual recording was not exercised because there is no audio device here. The UI tells the owner that coworkers cannot hear audio and asks for a typed note. |
| Speech-to-text | NOT IMPLEMENTED (own engine) / IMPLEMENTED BUT NOT FULLY VERIFIED (Labs live dictation) | No transcript is ever invented. Live dictation uses the system Web Speech service, is off by default and discloses that it may be online. |
| Navigation and sectioned Settings | IMPLEMENTED AND VERIFIED | Rail: Shared files, Approvals, Schedules (global), Model usage, Business, Activity, Settings. Settings: General, AI and models, Permissions, Voice, Features, Updates, Data and privacy, About. |
| Versioned storage and privacy | IMPLEMENTED AND VERIFIED | New files: `permissions.json`, `permission-audit.json`, `usage.json`, `features.json`, `business-targets.json`, all `version: 1` with validation and atomic writes. Existing files are untouched. No analytics; usage stores counts only. |
| Updater | Unchanged from v0.3.3 (no duplication) | Only the "ask before downloading" hook was added. |

## 2. Tests and measurements

- `bunx vitest run`: **205 passed, 3 skipped** (baseline 159 passed, 3 skipped). The skips are the
  existing root-only chmod tests. No test was removed or weakened. Two Settings tests now open the
  right section first, and one selector follows the new paragraph markup.
- Biome: clean. `tsc` (node + web): clean. `bun run build`: OK.
- Renderer bundle: startup JS **452 kB** (baseline 342 kB; +38 kB gzipped before lazy loading). The
  new views load on demand: Settings 29 kB, Model usage 19 kB, Business 16 kB, Permissions 12 kB,
  Activity 7 kB. The growth is mostly the 215 new strings in three languages. CSS 162 kB (was 144 kB).
- Real Electron run (Linux, xvfb, non-root user, clean profile): IPC round-trips for permissions,
  usage, features and business; data files created; OpenCode started with the permission
  environment; mic granted, camera and geolocation denied.

## 3. Not done / needs you

1. Review and merge `feat/workspace-upgrade`, then cut v0.4.0 yourself (tag and Release workflow).
   Nothing was released.
2. Live checks this sandbox could not run: one task each on Codex, Claude, Gemini and OpenCode,
   confirming that "Run commands" and "Edit files" prompt appear in Approvals; one voice note with a
   real microphone; a packaged Windows install.
3. Claude users with allow-rules in `~/.claude/settings.json`: those rules can pre-approve tools.
   A follow-up could pass `settingSources: ["project"]`.

Screenshots: `docs/screenshots/upgrade-*.jpg`.
