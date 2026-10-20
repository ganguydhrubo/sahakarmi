# Changelog

All notable changes to Sahkarmi are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [0.4.1] - 2026-10-20

### taskbar logo

### Fixed

- The Sahkarmi logo now shows on the Windows taskbar and window (and on Linux). The icon ships
  with the app and is set on the window directly, so Windows never falls back to a blank icon.

### Business page

### Changed

- The Business page only lists integrations coworkers can actually help with (GST portal,
  Tally / spreadsheets, Email). Fiverr and WhatsApp Business, which have no usable access, are gone.

### Update handling

### Fixed

- **Check for updates** now says why it failed (no internet, update files not found, GitHub
  limiting requests) instead of a generic "check your connection".
- On Mac builds without an Apple signature, which macOS will not let replace themselves, the
  update button now opens the new installer download instead of failing.

### inline approvals

### Changed

- **Approve in the chat.** When a coworker is paused waiting for you, the Approve / Reject card now
  appears right in that coworker's conversation. It is still listed in Approvals as well.
- **Fewer pointless approvals.** Look-only commands chained together (`node --version; npm
  --version`, `ls …; echo …`, PowerShell `Get-ChildItem … | Select-Object`) no longer ask. Anything
  that writes, redirects, deletes or runs something else still asks.

### auto mode

### Added

- **Auto mode** (Settings → Permissions): coworkers stop asking for everyday work: files anywhere,
  commands, browsing and downloads. Payments, sending messages, posting, orders, account changes
  and government forms still ask, and anything set to Block stays blocked.

### marketplace

### Added

- **Marketplace** in the sidebar, with two tabs and search.
  - **Agents:** 12 ready-made coworkers for Indian businesses, including GST Accountant, Sales
    Follow-up, Customer Support, Payment Reminders and Marketplace Seller Assistant. **Add**
    creates a real coworker with its job already set; after that the button says **Open**.
  - **Skills:** 12 step-by-step playbooks, including GST Invoice Check, Project Plan, Meeting
    Actions and Customer Reply Draft. **Install** saves the playbook in `Shared/Skills`, and
    coworkers are told to follow it when a task matches. **Remove** uninstalls it.
- No install counts or ratings are shown, because none are collected.

### tasks, header model picker, update bar

### Added

- **Tasks:** a new Tasks page with one "What do you want done?" box. Pick a coworker, type or
  speak the task and send it; it is queued like a normal message and that coworker's chat opens.
  Recent tasks across the whole team are listed below with their real status (Waiting, Working,
  Done, Failed, Stopped), and clicking one opens its chat.
- **Model in the chat header:** the coworker's model and reasoning level ("Luna · Medium") now
  show in the chat header. Click to change either one.
- **Update bar in the sidebar:** "Update ready → Restart", "Update available → Download" or the
  download progress now sits at the foot of the sidebar.

### Fixed

- The model picker no longer looks silently broken before an AI provider is connected: it says
  "Connect an AI provider to choose a model" and offers a **Connect** button that opens
  Settings → AI and models.

### one-click Connect and limit rings

### Added

- **Connect buttons** (Settings → AI and models): one click starts the provider's own sign-in in
  your browser. Use the account where you bought that AI plan.
  - **ChatGPT (Codex):** if Codex is not installed, Sahkarmi downloads the official build once
    (checksum-verified) and then opens the ChatGPT sign-in.
  - **Claude:** Claude Code now ships inside Sahkarmi. Sign in, then paste the code the page shows.
  - **Gemini:** opens a window for the Google sign-in (installs Gemini CLI there if Node.js is present).
  - **OpenCode:** built in and free, no sign-in.
- **Limit rings** in the sidebar: how much of each provider's real 5-hour and weekly limit is used,
  with reset times. Shown only for providers that report limits.

### Fixed

- Settings → Features no longer shows "Checking…" forever; provider rows update as soon as each
  provider connects.

### routines and calendar

### Added

- **Routines** (new in the sidebar): chain several coworkers into one automation. Each step goes
  to a coworker through the normal queue, so permissions and approvals apply as usual, and its
  final reply is handed to the next step. Run on a schedule (once, hourly, daily, weekdays,
  weekly or every N minutes) or with **Run now**. Routine details show a step diagram, the last
  run and every step's status. A failed step stops the run; history is kept on this computer.
  Repeating more often than every 5 minutes needs confirmation.
- **Calendar** in Schedules: Day, Week and Month views of scheduled tasks and routines, plus an
  **Upcoming runs** list. Future entries come from the real schedules; past entries only show
  what actually ran. Busy days collapse into "+N more".

### Audit follow-up

- Clear theme selection with icons, a selected badge and contrasting borders. Stored appearance
  is applied before rendering using a CSP-compatible startup script; native appearance stays in sync.
- Agent shutdown waits for turn-completion writes before returning, protecting final replies and
  preventing test cleanup from racing persistence. Storage errors remain visible.

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
