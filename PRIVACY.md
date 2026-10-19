# Privacy

Sahkarmi is local-first and has no Sahkarmi-operated account, cloud backend, telemetry service, or
remote conversation store.

## Data stored on your Mac

- `~/Sahkarmi/Bots` contains one workspace per agent.
- `~/Sahkarmi/Shared` contains managed transfers shared between agents.
- `~/Sahkarmi/Downloads` contains files downloaded by the embedded browser.
- `~/Library/Application Support/Sahkarmi` contains agent metadata, message queues, attachment drafts,
  the shared browser profile, cookies, and application preferences.
- `~/.codex` is owned by Codex CLI and contains its login and thread data. Sahkarmi does not copy or
  manage Codex credentials.
- `~/.claude` is owned by Claude CLI and contains its login and session data. Sahkarmi does not copy
  or manage Claude credentials.

Attachments copied into Sahkarmi remain in managed storage after their original file is moved or
deleted. All agents share the embedded browser profile, including cookies and website sessions.

## Network connections

Sahkarmi itself does not open a listening HTTP port. Network traffic may still occur when:

- the local Codex App Server connects to OpenAI;
- the local Claude Agent SDK connects to Anthropic through Claude CLI;
- you or an agent visits a page in the embedded browser;
- a locally installed Codex plugin connects to its service;
- an installed build checks GitHub Releases for updates;
- you open an explicitly labeled external support or setup link.

Account usage shown in Sahkarmi is requested through the local Codex App Server. Sahkarmi does not send
that usage to its maintainer.

## Agent access

Agents currently use `danger-full-access` with `approvalPolicy: never`. They can read and modify local
files, run programs, use the network, and control the embedded browser without an Sahkarmi confirmation
dialog. This is an explicit product behavior, not a host security boundary. Keep backups and do not
give an agent a task you would not allow a local command-line tool to perform.

On first launch, Sahkarmi explains this access and does not start the agent services until you
explicitly accept it. The acceptance record stays in Sahkarmi's local application-support directory.

Computer Use is provided by a separately installed local Codex plugin. macOS permission prompts and
any plugin safety hand-offs remain controlled by macOS and that plugin.

## Exports

The account menu can export a local ZIP containing agent profiles, conversation snapshots, queues,
and managed message attachments. It intentionally excludes CLI credentials, browser cookies, and
agent workspace files.

The diagnostics export contains application and CLI versions, capability states, and aggregate queue
counts. It contains no conversations, visited URLs, account email, file contents, or local file paths.

## Delete your data

Quit Sahkarmi, then remove the Sahkarmi folders listed above. Removing
`~/Library/Application Support/Sahkarmi` also removes the embedded browser's cookies and logins.
Removing `~/Sahkarmi` removes agent workspaces, transfers, and downloads. Sahkarmi does not delete
`~/.codex` or `~/.claude`; use each CLI's own controls if you also want to remove its local data.

Review folders before deleting them and keep a backup of anything you need. Deleted Sahkarmi data is
not recoverable through an Sahkarmi cloud service because no such service exists.

## Questions

Use [GitHub Discussions](https://github.com/ganguydhrubo/sahkarmi/discussions) for privacy questions.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), without attaching
credentials, conversations, or unrelated private files.
