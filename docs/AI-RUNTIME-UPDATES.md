# AI tool updates (bundled OpenCode runtime, Codex, Claude, Gemini, upstream OpenBot)

## The question this answers

"Why does Sahkarmi not update itself when OpenBot publishes a release?"

There are three different "updates" involved, and only some of them can ever be automatic.

| What is updating | Can Sahkarmi update it automatically? | Why |
|---|---|---|
| **Sahkarmi itself** | Yes | `electron-updater` checks GitHub releases every 15 minutes and on wake. Verified on this PC: `updater "Checking for update"` → `Update for version 0.4.6 is not available (latest version: 0.4.6)`. |
| **The bundled OpenCode runtime** | Yes, now | The binary was pinned in `scripts/fetch-opencode.ts` at build time, so a new OpenCode release only reached users through a manual PR → merge → tag → release → install chain. The app now downloads it itself. |
| **Codex CLI, Claude Code, Gemini CLI** | On request only | These are the user's own global npm installs. Sahkarmi shows the version gap and runs `npm install -g <package>@latest` only when the owner clicks "Update now". |
| **Upstream OpenBot** | Never, by design | Sahkarmi is a fork of OpenBot **v0.1.11** (Apache-2.0). OpenBot after v0.1.11 is **PolyForm Noncommercial**, so its code cannot be merged into an Apache-2.0 product that is distributed freely. The app shows the upstream release and the note; features are re-implemented by hand. |

## How the automatic runtime update works

1. `src/main/ai-runtime-service.ts` asks the npm registry for the newest
   `opencode-<platform>-<arch>` package (the package that carries the binary).
2. If it is newer than the runtime in use, the app downloads the tarball, checks it
   against the sha512 digest npm publishes (`dist.integrity`), unpacks it with `tar`,
   runs the binary once to confirm the reported version, and only then stores it in
   `<userData>/runtime/opencode/<version>/`.
3. `src/backend/cli.ts` prefers that downloaded runtime over the copy inside the
   installer, so the new version is used from the next start. The installed app files
   are never modified, and removing the folder rolls the app back to the bundled one.
4. Automatic downloads follow the existing "App updates" permission. When it is set to
   "ask", the app only reports the update and waits for the owner to click.

Failures never replace a working runtime: a corrupt download, a missing `tar`, or a
version mismatch leaves the previous runtime in place and reports the reason.

## What the owner sees

Sidebar → **AI updates** now lists every tool with the version in use, the newest
version, and a **Update now** button when they differ. Upstream OpenBot is listed with
its release tag and the licence note.

## Verified

- `bun run lint`, `bun run typecheck`, `bun run test` (289 tests) and `bun run build`
  pass locally.
- Unit tests cover version comparison, npm integrity checks, the OpenCode package
  naming, the "newest downloaded runtime wins" rule and the panel behaviour.
- Not verified end to end: a real 180 MB runtime download inside a packaged build,
  and the npm update of an installed CLI. Those need a signed build on a real
  machine.
