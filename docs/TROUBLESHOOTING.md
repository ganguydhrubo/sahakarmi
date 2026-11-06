# Troubleshooting Sahkarmi

## Sahkarmi says agent CLI setup is required

Open Terminal and verify the CLI:

```bash
codex --version
```

If the command is missing, install Codex using the official installer:

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
```

Then run `codex login`, sign in with ChatGPT, fully quit Sahkarmi, and open it again.

You can use Claude instead. Verify and install Claude CLI:

```bash
claude --version
curl -fsSL https://claude.ai/install.sh | bash
claude auth login
```

If Codex is installed in a non-standard location, launch Sahkarmi with `SAHKARMI_CODEX_PATH` set to the
absolute Codex executable path.

For a non-standard Claude location, set `SAHKARMI_CLAUDE_PATH` to the absolute Claude executable path.

## Computer Use is unavailable

Computer Use requires a compatible local Codex plugin plus macOS Screen Recording and Accessibility
permissions. Open **System Settings → Privacy & Security**, grant the permissions requested by the
plugin, then restart Sahkarmi. Sahkarmi does not bypass macOS prompts or plugin safety hand-offs.

## "Restart to update" does not update (Windows)

From 0.25.0, **Restart** closes Sahkarmi and a small helper installs the update once the app has
fully exited, then opens the new version by itself (about a minute). It runs as you, so Windows
never asks for administrator permission. If the install cannot finish, the old version opens
again and says why under the Restart button:

- **"A Sahkarmi file was still in use"**: usually antivirus checking the new files. The helper
  already retried three times. Restart the PC, open Sahkarmi and click Restart again.
- **"Windows or your antivirus blocked the installer"**: allow `Sahkarmi-<version>-x64.exe` in
  `%LOCALAPPDATA%\sahkarmi-updater\pending` in your antivirus, or download the installer from
  https://sahkarmi.site and run it.
- After two failed attempts, **Download update** hands the installer to your browser instead.

If you close Sahkarmi while an update is ready, it installs silently after the app has closed.

A copy installed with **Scoop** (or unpacked by hand) does not update itself: run
`scoop update sahkarmi`, or install with the installer from https://sahkarmi.site to get updates
inside the app. The Microsoft Store copy updates through the Store.

Versions before 0.25.0 could get stuck in a loop here: the installer started while the app was
still closing, a busy file made it stop with a hidden error box, and the next start found that
installer still running. Updating to 0.25.0 itself may still need one manual install from
https://sahkarmi.site on a PC that is already looping; later updates use the new helper.

**Settings → Export diagnostics** includes the updater log (`sahkarmi.log`, lines tagged
`updater`, including "last install result").

## Reset Sahkarmi

Quit Sahkarmi before moving data. To reset application state and the shared browser profile while
keeping agent workspaces, move this folder somewhere safe:

```text
~/Library/Application Support/Sahkarmi
```

To also reset agent workspaces, managed transfers, and downloads, move this folder as well:

```text
~/Sahkarmi
```

Sahkarmi creates fresh folders on the next launch. Review and back up their contents first. Do not
remove `~/.codex` or `~/.claude` unless you intentionally want to manage CLI login and history.

## Uninstall

Quit Sahkarmi and remove `Sahkarmi.app` from Applications. If you also want to remove local Sahkarmi
data, follow the reset steps above. Agent CLIs and their data are independent and are not removed
with Sahkarmi.

## Report a problem

Use [GitHub Issues](https://github.com/ganguydhrubo/sahakarmi/issues) for reproducible bugs. Include
the Sahkarmi version, macOS version, Apple Silicon model, provider and CLI version, and minimal
reproduction steps. Never publish tokens, `~/.codex`, `~/.claude`, conversations, private files,
Electron user data, or full unreviewed diagnostics.
