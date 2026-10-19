# Changelog

All notable changes to Sahkarmi are documented here. The project follows
[Semantic Versioning](https://semver.org/).

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
