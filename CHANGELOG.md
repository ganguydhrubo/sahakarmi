# Changelog

All notable changes to Sahkarmi are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-10-20

### Added: guardrails against known AI-agent failures

These are enforced by the app, outside the AI's context window, so a long conversation, a
compaction or a clever prompt cannot remove them. See `docs/AGENT-SAFETY-REPORT.md`.

- **Destructive commands always ask.** `rm -rf`, `DROP`/`TRUNCATE`/`DELETE FROM`, force-push,
  `reset --hard`, `prisma migrate reset`, `supabase db reset`, volume and cloud deletes,
  `terraform destroy`, `kubectl delete` and similar are a new category that can never be automatic.
- **Secrets always ask.** Reading `.env`, SSH/cloud keys or credential files, printing environment
  secrets, and typing into password, OTP, PIN or CVV fields need approval with every provider.
- **Emergency stop** ("Stop everything" in the sidebar, Ctrl/Cmd+Shift+Esc): interrupts every task,
  pauses every queue and blocks all actions until you lift it. It stays on after a restart.
- **Suggest-only coworkers:** a coworker can read and research but every change is blocked.
- **Per-task limits:** tool calls per task, minutes per task, and loop detection (the same action
  repeated). A task that hits one is stopped and its queue paused. All configurable.
- **Hourly cap** on messages, posts, orders and payments per coworker, even when pre-approved.
- **Prompt-injection defence:** browser content is labelled as untrusted data. When web or external
  content contains instruction-like text, the task switches to strict mode: every change asks.
  After any web read, actions that could send data out ask first.
- **Tamper-evident activity log:** entries are hash-chained, and the Activity view shows whether the
  chain is intact. Clearing the log leaves a marker entry.
- "Task done" shows real counts of tools that ran and failed.
- Coworker instructions now cover grounded answers (only from `Shared/Policies`), never claiming
  to be human, verifying after every change, and never improvising destructive fixes.

## [0.4.0] - 2026-10-20

### Added

- **Permissions enforced by the app.** Every tool call from Codex, Claude, Gemini, OpenCode and the
  built-in browser is checked against your rules (ask / allow / own folders only / block).
  Payments, messages, posting, orders, account changes and government forms can never run
  automatically. Paused actions appear in Approvals. Time- and use-limited pre-approvals.
- **Activity log** of blocked, asked and approved actions, with filters and CSV export.
- **Model usage** page: limits, tokens and cost per provider. Every number is labelled Verified,
  Estimated, Unavailable or Stale, with its source. Alerts at 80% and 95%.
- **Live activity status in Hinglish**, Claude Code style. It is driven by real events (tools,
  streaming, approvals, provider retries, outcome), with an elapsed timer. A **Masti** style adds
  playful lines while thinking; **Seedha** keeps it plain (Settings → General).
- **Rich replies:** tables, checklists, nested lists and code blocks, with copy buttons.
- **Voice notes:** record, pause, listen back and attach.
- **Business:** your own targets, and an honest integrations list (Fiverr not supported: no seller
  API).
- **Features** page with switches and a safe feature-list import (data only).
- **Model suggestions** (Labs, off by default). They never switch to a paid plan on their own.
- Global **Schedules** view. Settings split into sections. New views load on demand.

### Changed

- Claude now runs in default permission mode with every tool checked by Sahkarmi. Codex runs with
  the "untrusted" approval policy. OpenCode is started with permission prompts on.
- Provider auto-retries are shown as a retry ("Ek baar phir try ho raha hai…") instead of an error.
- Coworker status labels, tool cards, the task strip and error titles are shown in Hinglish.

## [0.3.3] - 2026-10-20

- Automatically download desktop updates, retry interrupted transfers twice, and cancel downloads after 45 seconds without progress. Retries use the full installer.
- Show update progress and restart/retry actions in the coworker screen and Settings, with English, Hindi, and Bengali labels.
- Record updater diagnostics in the application log.
- Batch streaming chat changes once per animation frame while preserving message identity and loaded-history behavior.
- Disable hot reload in UI tests for Windows compatibility.

## [0.3.2] - 2026-10-20

### Fixed

- The provider chosen on the setup screen is now applied to the team: coworkers that have never
  run move to that provider's default model (for example "Free model (no login)" after choosing
  OpenCode), even when another AI such as Claude is also connected. Previously the team silently
  stayed on the first AI that happened to connect, which looked like the model was not saved.
- Fresh installs default to the bundled OpenCode instead of ChatGPT (Codex).
- Each AI provider's status is shown as soon as it is known instead of after all four were tried,
  so the model picker opens sooner.
- macOS release build no longer fails with "GitHub Personal Access Token is not set".
- The model picker in the message box opened downward, off the bottom of the window, so it
  looked dead. It now opens upward when there is no room below.
- Overlapping provider connections could leave a provider (typically OpenCode) stuck on
  "Checking" with every model greyed out; a resolved status is no longer overwritten.
- Free models that echo their tool call as text (`type=tool_call … <|func_arg_name|>`) no longer
  show that text in the chat.
- A second Sahkarmi instance exits immediately; the packaged-app launch checks allow 10 s.

### Added

- A plain-text log at `<app data>/logs/sahkarmi.log` (agent errors and provider status) for
  diagnosing problems on a user's machine. Settings → Export diagnostics still works.
- Weekly "Upstream watch" workflow: opens a pull request when a newer OpenCode is published,
  and keeps a tracking issue with the latest Claude Agent SDK, Codex CLI, Gemini CLI and upstream
  OpenBot releases (OpenBot code after v0.1.11 is noncommercial-licensed and is never merged).

## [0.3.0] - 2026-10-19

### Added

- Free AI out of the box: OpenCode 1.19.3 (MIT) is bundled inside the installer. Coworkers run on
  its free models with no login, account or API key.
- Gemini support through Gemini CLI (`gemini --acp`), using the user's existing Google sign-in
  (free tier), API key or Vertex AI. Models: Gemini Auto, Pro, Flash.
- Agent Client Protocol (ACP) adapter: any ACP agent CLI can drive a coworker, with Sahkarmi's
  browser, approval, take-over and team tools exposed through a loopback-only MCP bridge.
- Auto-detection of every installed AI CLI and its existing login: Claude Code, Codex (ChatGPT),
  Gemini CLI and OpenCode (including any provider signed in with `opencode auth login`).
- Coworkers that have never run move to whichever AI is actually available.

### Fixed

- Provider status rows no longer get overwritten when two connections overlap.
- Opening a coworker whose AI CLI is missing no longer shows an error.

## [0.2.2] - 2026-10-19

### Fixed

- Releases always publish the Windows installer, even if the optional macOS or Linux builds fail.

## [0.2.1] - 2026-10-19

### Fixed

- Release builds: macOS and Linux jobs no longer fail on timing-sensitive backend tests; first
  release with downloadable Windows, macOS and Linux installers.

## [0.2.0] - 2026-10-19

### Added

- Sahkarmi brand: logo, app icons, saffron/indigo palette (light + dark), bundled Mukta, Baloo 2 and
  Hind Siliguri fonts, English / हिन्दी / বাংলা interface.
- Three-pane coworker layout: workspace switcher, team list with live status, shared files,
  approvals inbox, settings.
- Five default coworkers: Asha (Accounts), Vikram (Sales), Meera (Support), Arjun (Research),
  Kavya (Content).
- Task queue strip with pause / resume / cancel, collapsible tool-call cards, voice input,
  run-on-schedule, and human browser take-over for login / 2FA / CAPTCHA.
- Approvals: coworkers must ask before payments, sending messages to customers, or submitting forms.

### Upstream

- Forked from OpenBot v0.1.11 (Apache-2.0). See NOTICE.
