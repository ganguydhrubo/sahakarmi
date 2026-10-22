# AI Tool Updates (Bundled OpenCode Runtime, Codex, Claude, Gemini)

## Runtime Update Architecture

Sahkarmi manages three distinct categories of runtime updates safely without disrupting local workflows:

| What is updating | Can Sahkarmi update it automatically? | Mechanism |
|---|---|---|
| **Sahkarmi Desktop App** | Yes | `electron-updater` checks GitHub releases periodically and prompts or updates seamlessly. |
| **Bundled OpenCode runtime** | Yes | Downloads the signed official package, verifies sha512 integrity, and stores it in `<userData>/runtime/opencode/<version>/`. |
| **Codex CLI, Claude Code, Gemini CLI** | On request | These are the user's global npm tools. Sahkarmi resolves installed CLI versions, displays available updates, and invokes npm update commands when triggered. |

## How Automatic OpenCode Runtime Update Works

1. `src/main/ai-runtime-service.ts` queries the npm registry for the newest `opencode-<platform>-<arch>` package.
2. If newer than the runtime in use, the app downloads the tarball, validates against the published sha512 integrity hash, unpacks with `tar`, and tests the binary.
3. `src/backend/cli.ts` switches to the newly verified runtime on next launch.
4. Automatic downloads respect the user's configured update permissions.
