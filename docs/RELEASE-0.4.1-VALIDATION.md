# Sahkarmi 0.4.1 release validation

This integrates the owner-approved PRs #10–#18. PR #9 (the separate v0.5.0 agent-safety update) remains excluded. Each original feature commit is retained in the integration history.

## Scope

Update error explanations and unsigned Mac installer fallback; inline approvals and read-only command handling; taskbar branding; Auto mode; usable Business integrations; Marketplace coworkers/skills; Tasks, header model picker and sidebar update bar; provider Connect and real usage rings; Routines and schedule calendar.

The supplied local audit was reviewed as evidence to verify, not a blanket correctness claim. The theme selector was ported into current Settings with icons, a selected badge, contrast borders and native appearance synchronization. Its startup script is an external local file compatible with the app's existing script-src self policy. No CSP relaxation was made. The audit's ENOENT-suppression change was not imported.

## Integration fixes

- Preserve all navigation, translations and style blocks across independent PRs.
- Keep Marketplace open after adding a coworker, so its Add action becomes Open.
- Await turn-completion and association tasks before agent shutdown returns. A regression test blocks the final reply write and checks that shutdown waits and persists the reply.
- Launch Windows CMD/BAT provider-login shims through the quoted command processor; login arguments are fixed internal commands.
- Port mock CLI scripts to Windows and run the real Electron browser smoke executable on Windows.
- Replace timing assumptions in routine-restart and late-history tests with explicit lifecycle boundaries.

## Local verification

On Windows, bun run check completed successfully: Biome lint, both TypeScript targets, 33 test files / 261 passing tests, the real Electron browser-host smoke test, and production build. Browser smoke includes navigation/actions, request identity, child tabs, screenshots, cookies, caching, downloads, control lifecycle and persisted tabs.

The parked safety branch is not an ancestor of this release. No v0.5.0 tag was created. The original audit checkout and its uncommitted work were left intact in a separate worktree.

## Limits

Provider login protocol tests use mock providers. This does not prove every live account sign-in or externally hosted model will always respond. No blanket WCAG AAA, measured frame-rate, offline OpenCode inference, or 100% seamlessness claim is made. Unsigned Mac builds continue to update via the downloaded DMG. Packaged platform launch verification and installer publication run in GitHub release CI.
