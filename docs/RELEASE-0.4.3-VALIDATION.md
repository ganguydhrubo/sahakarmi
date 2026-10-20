# Sahkarmi 0.4.3: automatic model catalog refresh

## Behavior

- Connect-time discovery, a 15-minute refresh timer and a window-focus refresh (60-second throttle).
- Provider-reported IDs are accepted and persisted with a provider namespace. RPC calls receive the original raw model ID.
- Claude uses SDK supportedModels metadata; Gemini/OpenCode use ACP session model metadata. Metadata discovery submits no prompt and enables no tools.
- Live models-changed events refresh open model pickers. Discovery does not change a coworker's selected model or reasoning effort.
- Failed/empty discovery retains the last successful in-memory list. Legacy aliases remain available. Fresh app launches fall back to built-in aliases if offline.
- Installed CLI path/version changes are detected. A provider reconnect waits for idle turns and persistence tasks; active work is not stopped for an update.
- This refresh does not install or overwrite global/user CLI binaries. Bundled runtime updates are distributed through verified Sahkarmi app releases.
- Account entitlements and what each CLI reports determine model availability. A new model name does not grant account access.

## Validation

- Full local suite: 268 tests across 34 files.
- Added model ID validation/provider isolation, empty/malformed catalog fallback, timer throttling/coalescing/stop/retry, Claude SDK discovery/cleanup/offline retention, ACP discovery and persistence.
- Service integration verifies a newly reported model reaches the wire with its original ID, changed CLI versions wait during active work and reconnect afterward, saved model selection remains, and failed discovery retains the list.
- Renderer regression verifies a new model appears in an already-open picker without changing selection until the owner selects it.
- Repository lint, TypeScript, browser smoke and production build are release checks.
- v0.5.0 / PR #9 stays parked.
