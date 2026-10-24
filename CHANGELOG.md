# Changelog

All notable changes to Sahkarmi are documented here. The project follows
[Semantic Versioning](https://semver.org/).


## [0.7.0] - 2026-10-24

### Added

- Search everything with Ctrl/Cmd+K: coworkers by name or role, and every message in the
  workspace, with a jump straight to the message.
- Keyboard shortcuts: Ctrl+1–9 open a coworker, Ctrl+N new coworker, Ctrl+, settings, Esc close.
- Settings → General: Interface size (Compact / Normal / Large) and the send key (Enter, or
  Ctrl+Enter with Enter for a new line).
- Deleting a coworker can be undone for 8 seconds, and Delete is now also in the coworker's own
  settings panel.
- "Send again" on a message whose reply failed or was stopped.
- Backup model: when a paid provider answers nothing or is at its usage limit (quota, 429),
  the coworker moves to the free model, says why, and sends the same message again there.
- The window opens where you left it, at the same size.

### Changed

- The app is usable as soon as the quick providers are up; Google's Antigravity agent keeps
  starting in the background instead of locking the composer for up to a minute.
- A message whose reply failed or was stopped now shows that status under the message.

## [0.6.3] - 2026-10-24

### Fixed

- Settings → AI and models said "Sign-in needed" for a provider that had failed to start; it now
  says "Could not start" and shows the reason under the row.
- AI tool versions offered "Update now" (an `npm install -g`) for a tool Sahkarmi could not even
  detect, and showed "Downloading… 0%" for npm installs that report no progress. A tool that is
  not detected now says so, and only the bundled runtime can be installed from nothing.

## [0.6.2] - 2026-10-24

### Fixed

- "AI updates" ran `npm install -g` for Claude Code and Codex again and again (hundreds of
  times a day) on computers where Sahkarmi uses a copy of the CLI that npm does not own, which
  also broke the npm shims while it ran: Codex showed "could not be started" and Claude asked
  to sign in. Sahkarmi now never changes your own tools by itself; only the bundled OpenCode
  runtime updates on its own, once per app session. "Update now" still runs the install for
  you and then says which copy Sahkarmi actually uses.
- OpenCode (and Google's agent) showed "Not installed" on a busy or cold disk because
  `--version` of the 200 MB binary took longer than the 5-second limit. The limit is 25 s.

## [0.6.1] - 2026-10-24

### Fixed

- Stopping a coworker no longer lets the stopped answer stream into the next turn (OpenCode keeps
  talking after a cancel; the next turn now waits until that stream has gone quiet), and a stopped
  turn with nothing said leaves no empty bubble.
- A new message from the owner resumes a queue that Stop had paused, instead of sitting at
  "Queued #1" until Resume was found.
- AI tool updates (bundled OpenCode, Codex) failed on Windows with "tar: Cannot connect to C:"
  when Git's tar was first on PATH. Extraction now runs with relative paths.
- Google Antigravity: a used-up quota (HTTP 429) used to end the turn with a blank reply and pages
  of harness chatter in the log. The coworker's chat now says the quota is used up and when it
  resets, and start-up chatter stays out of the log. Any provider that ends a turn with nothing
  said now gets a visible "empty reply" note.
- Sidebar previews show plain text instead of raw markdown marks.
- What's New shows this release's real changes (and nothing for versions without an entry).

## [0.6.0] - 2026-10-23

### Changed

- Google Antigravity now connects the same way as Claude and Codex: Connect downloads Google's own
  Antigravity agent (agy_acp_server 1.4.2 from dl.google.com, SHA-256 pinned), asks it whether it is
  signed in, and if not runs its "Log in with Google" sign-in, which opens the Google page in the
  browser. No terminal window, no separate install. A Google AI Studio API key also works.
- The Antigravity IDE (Antigravity.exe) is no longer treated as an agent server; this was the cause of
  "Google Antigravity exited with code 0".

### Removed

- The Gemini CLI provider. Google has moved individual use to Antigravity, and the Gemini CLI sign-in
  needed a terminal window. Coworkers saved on a Gemini model move to the bundled free model.

## [0.5.9] - 2026-10-23

### Fixed

- Google Antigravity provider connect: seamless connection via locally installed Antigravity desktop app and Google account detection or browser sign-in without 404 download errors.


## [0.5.7] - 2026-10-23

### Added

- Official Google Antigravity ACP provider integration with pinned SHA-256 runtime validation, Terms of Service gate, OAuth-personal Google sign-in and API key support, and trilingual Connect UI tiles in English, Hindi, and Bengali.
- Sibling localharness runtime binding for local ACP execution.

### Fixed

- Resolved multi-agent infinite microtask drain loop freeze when steering or delegating mid-turn.
- Resolved out-of-order turn association race condition when turn/completed arrives before turn/start response.
- Recover starting/running deliveries gracefully on dead provider process exit.
- Batched streamed IPC deltas on a 33ms cadence and guarded SolidJS reactive signal updates.
- Optimized MailboxStore with O(1) Map indexes, precomputed message exchange projections, and compact non-blocking JSON persistence.
- Stabilized RichMarkdown streaming re-renders with block equality caching.
- Optimized ACP client leak regex windowing and O(1) stdout chunk line buffering.


## [0.5.6] - 2026-10-22

### Fixed

- Eliminated 100% CPU freeze / "Not Responding" lockup caused by reactive IPC cascade between renderer and agent service on status changes.
- Narrowed renderer status dependency to a memoized readiness check, preventing recursive round-trip queries.
- Batched coworker queue updates on startup to eliminate repeated sidebar re-renders.
- Fixed startup drain stampede in agent service to only schedule drains for coworkers with actual pending work.
- Fixed delivery start error handling to prevent double drain queue scheduling.


## [0.5.5] - 2026-10-22

### Added

- Segregated & Organized Workspace Sidebar: OpenBot-style layout featuring top search, horizontal pinned/recent coworker avatar quick-switcher bar, and collapsible workspace sections with coworker counts.
- Enhanced Coworker Row Anatomy: Each coworker row now showcases bold title, role pill tag, right-aligned timestamp (e.g. `12:21 PM`), and truncated latest message preview.
- Human-Friendly Tool Display: Replaced raw snake_case tool labels and bulky debug blocks with clean, elegant action titles (`✨ Create Coworker`, `💬 Message to Coworker`, `🧠 Save Memory`) and compact status cards.

### Fixed

- Resolved attachment menu positioning so it floats cleanly above the toolbar without blocking the message input area, with auto-dismiss on outside click.
- Fixed exchange recipient dropdown menu z-index stacking and backdrop dismiss so it never gets trapped behind message bubbles.
- Added backdrop dismiss to voice recorder modal.

## [0.5.4] - 2026-10-22

### Added

- Persistent Coworker Memory Hub ("Smriti"): Coworkers can now save, search, and recall critical project decisions, architecture standards, and user preferences across threads.
- Native Memory Inspector UI: Browse, filter, search, and manage coworker memories directly from the sidebar.
- In-App "What's New in Sahkarmi" Dialog: Displays release highlights and new capabilities immediately after update.
- Automated Upstream Radar Watcher: Tracks upstream advancements and logs feature targets for native Sahkarmi clean-room adaptation.

### Fixed

- Eliminated redundant background status re-check polling that caused high CPU usage and sluggish button clicks.
- 100% Sahkarmi-branded attribution across all git repositories, licenses, documentation, and metadata.

## [0.5.3] - 2026-10-22

### Added

- Adaptive Multi-Agent Engine: Autonomous task graph DAG and specialist execution engine with single-agent fast path routing and real-time Multi-Agent UI visualizer.
- Action-Observation tool execution loop with permission boundaries and sensitive credential/secret redaction.
- Evidence-based verification gates with bounded defect repair loops.
- Inter-agent collaboration bus with cycle/recursion prevention.
- Added `create_coworker` tool to coworker agents: AI coworkers can now autonomously assemble and spin up specialist dev and business teams on user request.
- 100% Sahkarmi-branded attribution across all languages.

### Fixed

- Prevented silent NSIS installer relaunch loop on app quit and added automatic cleanup of stale pending updater files.
- Accurately resolves installed AI runtime tool CLI versions (Codex CLI, Claude Code, Gemini CLI) and refreshes live UI status on update without stuck "Update now" buttons.
- Hardened Windows file-write persistence with retry backoff against transient EPERM locks.

## [0.5.2] - 2026-10-22

### Added

- Real 3D animated cartoon coworker avatars inside the desktop application, replacing flat 2D silhouettes across sidebar, conversation title, message entries, and Settings.
- Full 3D character customization: all 8 avatar shapes (`blob`, `pebble`, `squircle`, `tablet`, `wedge`, `hex`, `cloud`, `teardrop`) render distinct 3D cartoon head archetypes, and all 11 colors update multi-stop radial gradients, specular highlights, luminous blinking eyes, antenna gems, and ear nodes in real time.
- Smooth CSS animations for eye blinking and floating levitation bobbing.
- Restores saved API keys across sessions for Gemini, Codex, and Claude from user home configuration files on application startup.

### Fixed

- Resolved Node DEP0190 child process spawn security warnings by adopting verbatim argument passing on Windows.
- Hardened test and build teardown scripts against transient Windows file handle release locks.

## [0.5.1] - 2026-10-21

### Added

- Expanded default coworker roster to 9 distinct Indian AI archetypes with custom taglines, roles, and personality archetypes: Mitra (Lead Orchestrator), Asha (Finance & GST), Vikram (Sales Dynamo), Meera (Customer Support), Arjun (Research Scout), Kavya (Content & Brand), Dev (Code Architect), Tara (Ops & Routines), and Kabir (Security & Vault).
- Interactive 3D cartoon coworker mascot design and real-time animated Deep Check diagnostic scanner with holographic HUD, radar sweep, and live inspection telemetry.

### Fixed

- Resolved Biome template literal formatting and semantic interactive button accessibility in ToolCallCard.
- Sorted i18n import structure and cleaned translation dictionaries for all 12 supported Indian languages.
- Complete verification of TypeScript soundness and test suite.

## [0.5.0] - 2026-10-21

### Added

- Support for all major Indian languages (except Urdu): Marathi (मराठी), Telugu (తెలుగు), Tamil (தமிழ்), Gujarati (ગુજરાતી), Kannada (ಕನ್ನಡ), Malayalam (മലയാളം), Punjabi (ਪੰਜਾਬੀ), Odia (ଓଡ଼ିଆ), Assamese (অসমীয়া), along with existing Hindi (हिन्दी), Bengali (বাংলা), and English.
- Voice input speech locales configured for all 11 Indian languages.
- Settings language selector expanded with native script button options.

## [0.4.9] - 2026-10-21

### Fixed

- Modern collapsible tool-call execution drawers matching Claude, Codex, Grok, and Antigravity: consecutive operations are unified into a sleek, clean progress card rather than spilling across the chat.
- Clean sanitized tool titles and file paths: eliminates raw JSON dumping, removes trailing braces and bounds clipping.
- Replaced informal raw status labels on tool cards and task queue.

### Added

- In-app Google Gemini API key management: paste free Google AI Studio keys directly in Settings without terminal windows or CLI prompts.

## [0.4.8] - 2026-10-21

### Fixed

- Set explicit taskbar and window icon using NativeImage on Windows with NSIS shortcut binding.
- Expand chat window bounds: increase user bubble max-width to 720px and bot bubble to 860px for a comfortable wide layout.
- Fix AI tool updates sheet clipping in settings panel and expand scroll container.
- Clean up informal activity thinking lines to professional enterprise tone; set factual activity as default.

### Added

- Add the `↳ Steer` button in TaskQueueStrip to steer or prioritize active turns with queued tasks immediately.
- Automatic background updates for all installed AI tools (OpenCode, Codex, Claude, Gemini) with zero user intervention.

## [0.4.7] - 2026-10-21

### Fixed

- Sanitize client hints and headers during Google sign-in to eliminate embedded WebView security warnings.
- Keep coworker browser tabs trusted during OAuth logins.

### Added

- Auto-update the bundled OpenCode runtime and surface every AI tool update (PR #25).

## [0.4.6] - 2026-10-21

### Fixed

- Keep the model picker inside the window, including from the chat header and composer. Add search and a scrolling model list; put free OpenCode models first and separate models requiring an account or credits.
- Read grouped ACP model lists. Report model selection failures instead of silently running a different model.
- Keep update errors and retry visible at the foot of the coworker panel. Show a restart notice automatically when the app update is downloaded.

### Added

- AI updates in the coworker panel: installed Claude, ChatGPT, Gemini and OpenCode versions, model counts, successful refresh times, new-model notices and a Refresh AI models button. Catalogs refresh automatically; separately installed AI tools retain their own updater.
- Check for Sahkarmi updates every 15 minutes and on focus/resume after sleep. Download automatically when App updates is set to automatic, then offer Restart.

## [0.4.5] - 2026-10-21

### Added

- **Working animation** around coworker avatars (team list, chat header, live status line), in an
  Indian style and driven only by real events: a turning rangoli dot ring while thinking, marigold
  and peacock sparks orbiting while a tool runs, a soft diya glow while waiting for you, a marigold
  petal burst when a task finishes, and a short red shake on failure. Respects "reduce motion".
## [0.4.4] - 2026-10-21

### Fixed

- Preserve every existing coworker model during startup and automatic CLI/model refresh, including coworkers that have never run. A slow or unavailable provider no longer causes saved selections to fall back to another AI. Only a brand-new default team gets an automatic initial provider.

## [0.4.3] - 2026-10-21

### Fixed

- Discover provider-reported models without waiting for an app release. Refresh at startup, every 15 minutes and on window focus, updating open model pickers without changing coworker selections.
- Detect installed AI CLI path/version changes and reconnect only while idle. Retain the last working catalog during discovery failures.
- Query Claude SDK and ACP model metadata without prompts, preserve legacy aliases, and route new models to their original provider.
- Stack the routine inspector based on available workspace width so a wider coworker panel cannot squeeze the workflow canvas.

### Notes

- Availability depends on the connected account and CLI. This does not replace independently installed CLI binaries; bundled runtimes update through Sahkarmi app releases.

## [0.4.2] - 2026-10-21

- Separate persistent icon navigation from the resizable coworker list; keep navigation usable
  when the list is collapsed. Keep real provider usage rings low in the rail and update controls
  at the foot of the coworker panel.
- Widen the default coworker panel, keep search visible, and show conversation previews.
- Arrange Routines around a readable workflow canvas with a separate right-hand inspector
  and a compact routine switcher. The inspector stacks below the canvas on narrow windows.

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
  and keeps a tracking issue with the latest Claude Agent SDK, Codex CLI, and Gemini CLI releases.

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

- Initial project release. See NOTICE.
