# Changelog

All notable changes to Sahkarmi are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.28.0] - 2026-11-09

### Added

- Telegram: when a coworker needs an OTP, a login ID (user name, email or phone) or a password
  to sign in somewhere, your Telegram chat asks too. Reply with it: it is typed straight into
  that page, your message is deleted from the chat at once, and the coworker never sees it.
  Only the Telegram account you paired can answer. /skip says no; /pc lets you type it on the
  computer yourself.
- Passwords and PINs from Telegram only when you turn on Settings > Telegram > Allow passwords
  from Telegram (off by default). OTPs and login IDs always work.
- Telegram tells you when a coworker needs you at the computer, for example for a "verify you
  are human" check or a payment page.
- Telegram: /coworkers shows a button for each coworker; one tap and your next message goes to
  them.
- Coworkers can ask for a login ID on the secure card, not only a password, OTP or PIN.

## [0.27.0] - 2026-11-09

Every new part is behind its own switch in Settings > Features. The ones that are on by default
change nothing until they are needed, so an upgraded install works as 0.26.1 did.

### Added

- Ask once after outside content (on): once a reply has read a web page, a web search, an app,
  a connector or a file outside the coworker's folders, its first command, outgoing message or
  key-file read is asked on the normal approval card, even in auto mode. One question per reply;
  the answer covers the rest of it. Work without outside content gets no new question.
- Approval cards say where a request came from: you, your phone, a routine, a schedule, a team
  run, another coworker by name, the app itself, or the page, app or file the coworker read.
- Work limits (Settings > Features > Work limits): replies a day for each coworker and steps per
  team run. Nothing is limited until you set a number. At the limit the coworker or run pauses
  with a notice saying where to raise it; a running reply is never cut short.
- Auto concurrency: how many coworkers work at once follows the PC's free memory. Fair turns:
  messages you typed go first, then whoever waited longest. Both off by default.
- Processor use and awake browser pages under the memory meter. Optional per-coworker page
  budget (two awake pages each) and a site crash guard (a site that crashes three times in ten
  minutes stays asleep for coworkers).
- Leftover coworker programs from a crashed start are found and closed (off by default; only
  Sahkarmi's own programs).
- Skill packs: eighteen ready skill packs pinned to exact versions with checked licences, skill
  import that brings a plugin's linked files along, and suggested connections that are added
  only after you confirm.
- Ready-made connectors list (off by default) with each service's name and logo, pinned
  versions and per-tool permission rules.
- Open Interpreter as an engine (off by default), using your own install.
- Built-in browser: keys and tokens on a page are hidden from the AI (on), and clicked elements
  can be remembered (off).
- Settings > About lists the open-source projects Sahkarmi uses and their licences.

### Fixed

- The orange "Could not update. Please try again." card came up at start whenever GitHub was
  briefly slow or down. A check you did not ask for (at start, on its timer, after sleep) now
  stays quiet on a passing problem (no internet, timeout, dropped connection, GitHub busy) and
  tries again after 2 minutes. Check for updates still tells you the reason.
- Gemini showed "Google account 1, 2" instead of each account's email when the sign-in had been
  saved in an older format. Every format now shows the email; the sign-in is only ever sent to
  Google's own address.
- A message sent again (Gemini moving to the next Google account, or a retry on a free model)
  showed twice in the open chat.
- A browser tab whose page closed itself, as sign-in pop-ups do, could not be shown or used by
  its coworker again.

## [0.26.1] - 2026-11-08

### Fixed

- Built-in browser stopped working for every coworker (errors naming getTitle or getURL) after
  a page ended by itself, for example a video or upload page that closed its own window, or a
  page whose process was killed while memory was short. The tab kept pointing at the dead page,
  so every later browser call failed until Sahkarmi was restarted, and coworkers looped asking
  the owner to hand the browser back. A tab now lets go of a dead page at once and opens its
  address in a fresh page on its next use; a crashed page is reloaded the same way. Other tabs
  and coworkers are not affected.
- "… is using your desktop" was posted again and again in one chat, even after the coworker's
  last reply (every 3 minutes without a desktop step, and on each follow-up turn). A chat now
  gets the line once, and again only after 30 minutes without desktop use there.

## [0.26.0] - 2026-11-08

0.25.1 was never published, so its two fixes ship here too.

### Added

- Memory limit (Settings > Features): choose how much RAM Sahkarmi and the coworker programs it
  starts may use together: Automatic, a ready-made size (2, 3, 4, 6, 8, 12 GB… up to what this
  PC has) or any amount in half-GB steps. Sahkarmi measures its real use (every program it
  started, grouped as Claude, Codex, Antigravity, OpenCode, tools), shows it live with where the
  memory goes, forecasts when the limit would be reached at the present growth, and suggests a
  limit for this PC. Near the limit it closes idle coworker programs and makes background work
  wait; work already running is never stopped for memory. Automatic keeps the old behaviour.
- Warning threshold for the memory limit, and "Most steps in one Claude turn" (50-1000, was a
  fixed 200).
- Assign APIs, connected apps, skills and MCP servers to whole AI engines (every Claude,
  Codex, Antigravity… coworker), single coworkers, whole workspaces or each workspace's CEO.
  The same "Assign" picker is on Marketplace > APIs, Apps and Skills and on Settings > Skills
  and MCP Servers. Anything never assigned stays available to everyone, as before.
- Settings > Assignments: every API, connected app, skill and MCP server in one list, with
  whether it is connected, who it is assigned to, and whether coworkers can use it right now
  (and if not, why).
- Antigravity accounts show their email address instead of "Google account 1, 2, 3".

### Fixed

- "This PC is short of free memory, so this message waits" no longer interrupts a coworker that
  is already working: a Claude coworker whose program is open never waits, Sahkarmi first
  closes idle Claude programs before making anyone wait, and the note disappears as soon as the
  work starts. The thresholds now fit 16 GB PCs (3 GB free is fine).
- Antigravity keeps working when an MCP server cannot start: the chat opens without that server
  and says which one and why, instead of failing or waiting for ever. An empty Antigravity MCP
  config file (0 bytes) no longer causes an error on every session, and Sahkarmi's own tools no
  longer drop with "connection forcibly closed".
- Connected apps no longer flip to "Connect" when one check with Composio fails; the last known
  state is kept and Settings > Assignments says the check failed. A newly connected or removed
  app reaches idle coworkers at their next message instead of only in a new chat.
- A turn about to be stopped for showing no progress is announced at three quarters of the time
  limit first.
- From 0.25.1: Claude coworkers can use the apps you connect in Marketplace > Apps, and a
  message you type never waits for free memory.

### Changed

- When memory is short, idle Claude programs close after one minute instead of ten, and a chat
  stops trying automatic compaction after two failures in a row (ideas from the upstream
  project's latest releases, written fresh for Sahkarmi).

## [0.25.1] - 2026-11-07

### Fixed

- Claude coworkers can now use the apps you connect in Marketplace > Apps (Notion, Gmail,
  GitHub and the rest). Before, only Codex coworkers received them, so a Claude coworker said
  "no Notion tools reached this session" while the app showed Connected. Anything that sends,
  creates, changes or deletes still asks for your approval first.
- A message you type to a coworker no longer waits for free memory. Only routines, scheduled
  work and coworker-to-coworker messages wait when the PC is short of memory.

## [0.25.0] - 2026-11-06

### Fixed

- Windows updates: "Restart to update" no longer loops. Sahkarmi now closes completely before a
  small helper installs the update as you (never through an administrator prompt), retries
  silently when antivirus still holds a file, and opens the new version by itself. If it still
  cannot install, the old version opens and says why. Before, one busy file made the installer
  stop on an error box that silent updates never showed, so it waited forever unseen and the
  next start asked for the same restart again. Closing Sahkarmi with an update ready installs it
  silently the same way.
- Copies installed with Scoop no longer try to update themselves into a second copy; they say
  to run `scoop update sahkarmi`.
- Claude coworkers: a conversation whose saved session was lost (after signing in to another
  account, for example) starts a fresh session and keeps your message, instead of failing every
  message. One coworker's failure no longer stops every other Claude coworker.
- Antigravity and other ACP coworkers remember their conversation after a restart even when the
  agent had to open a new session.
- A signed-out AI that no coworker uses is no longer started every few minutes to check it.

### Changed

- Many coworkers at once: up to 64 can work at the same time (Settings > Engine). A new Claude
  coworker waits for free memory instead of filling an 8 GB PC, and when memory runs low only a
  few browser pages stay awake; the rest sleep and wake when a coworker needs them.

## [0.24.0] - 2026-11-06

### Added

- Marketplace → APIs: paste an API key (and, if you like, a name or a docs link). Sahkarmi finds
  how the API works from its OpenAPI/Swagger description, its documentation page or the public
  APIs.guru directory, and asks only for what it could not find. Seven real tests run before you
  can turn it on (key, connection, endpoint, a real answer, readable data, permissions, errors and
  limits), and you choose which coworkers, workspaces or CEO may use it. Coworkers then answer
  questions like "tomorrow's weather in Kolkata" with live data. Keys are encrypted on this PC and
  never shown to coworkers; reading calls never ask, calls that change something ask you once.
- MCP servers: "Test server" really connects, lists the server's tools, and explains a failure
  in plain words with a one-click fix (install uv, Node.js or Python, re-check PATH). New servers
  stay off until a test passes, and you can choose which coworkers get each server.
- Connect from GitHub tells you whether a repo is an MCP server and how to run it, with the
  evidence. "Install for me" shows one approval card with every download and command, then
  installs into Sahkarmi's own folder.
- Projects that are not MCP servers, such as MoneyPrinterTurbo, can be set up as a Skill your
  coworkers run, step by step.
- Shared mode runs a heavy MCP server once for all coworkers.
- Memory: coworkers can recall related team memories at the start of a message (Settings >
  Features), and the Memory page lists, searches and deletes them.
- Settings > Storage shows what uses space and frees it safely.
- Settings > Features: how many coworkers may work at once, and how long a silent task may run
  before it is stopped.
- Team runs say honestly whether a task was checked (passed, failed or not checked), and you can
  add your own check command. A Performance view shows how coworker turns went; it stays on
  your PC.
- Tasks cut off when Sahkarmi closed can be run again with one click.
- Optional: keep Sahkarmi running in the tray when the window closes (off by default).
- Labs, off by default: the CEO plans team runs, and a second AI model reviews each task.

### Changed

- New coworkers start on the most capable model of the AI you use (Codex: Sol; Claude: Opus).
  Coworkers you already set up keep their model.
- Approvals: once you say "no" to a step, the coworker's retries of that same step in the same
  task are refused without asking you again. Cards say in plain words when a command also runs
  a second one.
- Messages you type while a coworker works join its current task; scheduled tasks, routines and
  team runs wait their turn.
- A brief AI-service hiccup (overloaded, server error, network) is retried automatically, at
  most twice. When a model is at its limit, only that message moves to the free model.
- Lighter and faster: only the AI tools your coworkers use start with the app, idle Claude
  sessions close after 10 minutes and resume where they left off, long chats update one message
  at a time and load the newest 80 messages first, and coworker pages go quiet while Sahkarmi is
  minimised.
- Knowledge Bases index in a separate background process, so the window never waits for them.
- Old messages are archived by month, so large mailboxes open at once.
- API keys you give Sahkarmi are stored encrypted with Windows, and each AI tool receives only
  its own key.

### Fixed

- A tab you were typing in is never reloaded because a coworker saved on the same site, even when
  you started typing just before.
- A coworker could run a shell command without your approval through an unchecked path; every
  command now goes through the approval rules.
- Coworkers can no longer change Sahkarmi's own settings, other AI tools' settings, or files that
  hold keys without asking.
- Browser downloads now follow the downloads permission.
- Coworkers can no longer pass a task back and forth without end (stopped after 6 hand-offs).
- Pause and Cancel on a team run now really stop the coworker, and runs waiting on your approval
  continue after a restart.
- Codex is started without a shell and fully stopped with everything it started.
- MCP servers installed after Sahkarmi started, old SSE addresses and Windows' Microsoft Store
  Python stub are handled correctly.
- A damaged settings file is set aside and reported instead of stopping the app.

## [0.23.0] - 2026-11-06

### Added

- Messages you type while a coworker is working now join the task it is doing, as in Claude
  Code: the coworker reads them at its next step and adjusts, without the work being stopped
  and without the message waiting in line. This works for Codex and Claude coworkers with a
  text message; other models, attachments and messages behind others in the queue still wait
  their turn, and "Send now" still stops the task and starts the message.
- A very long paste (over 5,000 characters) is attached as a text file instead of filling the
  message box.
- Settings > MCP servers warns when a local server's command is not on this PC, so a missing
  install or wrong path no longer leaves coworkers silently without that server's tools.

### Changed

- A coworker whose Claude, Codex or OpenAI plan, quota or credit is used up moves the message to
  the backup free model in more cases ("Credit balance is too low", "hit your usage limit",
  "insufficient_quota", "out of extra usage"), so started work goes on.
- Coworkers are told to read the page after submitting, sending, saving or paying in the
  browser, and to report an error or no change plainly instead of reporting success.
- Deleting a coworker now lets go of its Claude or Codex session, so it stops using memory.

### Fixed

- Errors in Settings > MCP servers and Settings > Skills no longer start with "Error invoking
  remote method ...".
- Searching the Marketplace's learned skills with no match said you had no learned skills; it
  now says there are no matches.

## [0.22.1] - 2026-11-05

### Fixed

- The Export menu in a coworker's chat opened behind the task strip ("queued / running / done")
  and was cut off completely while the browser was open, so it could not be used. The Export
  menu and the model menu next to it now open on top, under their button, in every layout.
- The page in the browser panel now always fits the panel. It used to take the panel's size from
  one step before (after resizing the window, changing the text size or enlarging the browser),
  so pages were cut off or left a gap; and a rounding error made it a pixel wider than the
  window, cutting off its right edge.

## [0.22.0] - 2026-11-05

### Fixed

- One approval per task. Saying yes to a post, message or form on a site now covers the next steps of that same task (Next, Share, a retry after the page redraws) for up to 2 hours, instead of a new card for every click. A new instruction asks again; deleting something, payments and account changes always ask. Two identical questions at the same moment now share one card. The main window also reloads by itself if its page crashes.

- Claude coworkers no longer sit at "Request line mein hai" forever. Sahkarmi shared
  `~\.claude` with Claude Code, so both used one sign-in file: whichever account signed in or
  refreshed last won, and Sahkarmi kept falling back to "sign-in required" and queueing every
  message to a Claude coworker. Sahkarmi now keeps its own Claude sign-in in
  `%APPDATA%\Sahkarmi\claude-account` (CLAUDE_CONFIG_DIR for every Claude process it starts);
  existing coworker chats move there once, so they still resume. Sign in once with Connect.
- Connect for Claude finishes as soon as the browser page says you are signed in, instead of
  waiting for the sign-in tool to exit (it could wait forever, then report "took too long").
- A signed-out provider is checked again even while other coworkers are working; before, it was
  skipped whenever any coworker was busy, so a sign-in done meanwhile was never noticed.
- The Claude sign-in check no longer reads a slow start on a busy PC as "signed out": longer
  limit, one retry, no extra shell, and a failing check is logged with its reason.
- A coworker whose AI is signed out says so in its chat, with where to click, instead of an
  endless queued spinner.

- Coworker browsers are kept apart. There was one browser panel and one selected page for
  everyone: opening coworker B's browser when B had no pages of its own showed coworker A's
  page on top of B's empty start screen. The panel now shows only the coworker whose chat is
  open, a colleague's page never takes the panel, closing a page selects the same coworker's
  next page, and refreshing a site no longer reloads other coworkers' pages of that site.
- Logins stay after a restart. Electron drops cookies without an expiry date when the app
  closes, and sites such as Facebook can keep the login itself in them (the daily run then found
  "Continue as ..." instead of the account). A coworker's browser now keeps those cookies, in
  Chromium's encrypted cookie store, for sites it has open; a site that logs out still removes
  them, and cookies are written to disk shortly after each change and on quit.
- Splitting the old shared browser no longer copies one site's login into several coworkers
  (one Facebook session in many cookie jars, so a login change in one ended it for all); each
  site's login goes to one coworker. The split that already ran on a PC is not repeated.
- An approved Post goes through: the repeat of an approved click is matched by coworker,
  action, button name and page address without its query string, because Facebook changes both
  between page reads and the approval never matched (a new approval was opened instead).
- LinkedIn posts are no longer refused as "could not be verified": the signed-in member is read
  from inside the open LinkedIn page, the same way LinkedIn's site does, because the app's own
  background request was challenged by LinkedIn's bot check.
- A coworker tied to one account whose browser is signed in to another (for example Instagram)
  asks the owner once whether to switch, instead of refusing every action with no way out.
  It still never acts as another account without that approval.
- The password and code card no longer fails with "The page changed since the coworker asked"
  when a site redraws itself on the same address: on the same origin it finds the password (or
  code) field again; on another origin it still refuses. The value is never logged or stored.
- Page caches in coworker browsers (up to ~1 GB each) are emptied once after start when they
  pass 150 MB; cookies, local storage and IndexedDB are not touched.

### Added

- Coworkers can use the Windows desktop (`sahkarmi_desktop`: screenshot, list/focus/close
  windows, click, move, scroll, drag, type, keys, launch apps, read a window's controls through
  UI Automation), with every AI provider. Settings > Permissions > "Control this PC" (default
  Ask: one approval per coworker per app session). Sahkarmi's own windows, password fields,
  credential and UAC screens, and script hosts are refused; a note in the coworker's chat says
  when it uses the desktop, and only one coworker drives the desktop at a time.

### Performance

- The window no longer repaints all the time while idle: every avatar's eyes blinked forever
  (32 running SVG animations, about 1,400 repaints every 10 seconds even with nothing
  happening). Only the avatar under the pointer and working coworkers animate now.
- Clicking back into the window no longer starts a model refresh (one process per AI tool), an
  update check and an AI-tool check every time; focus does that at most every 10 minutes, waking
  the PC still does it at once, and the 15-minute timers are unchanged. Signed-out providers are
  checked at most every 3 minutes in the background.

### Disk space

- Old AI tool copies are removed at start: every Claude Code, Codex and OpenCode version except
  the one in use, the old Codex download in `tools\codex`, interrupted downloads, download
  folders in %TEMP% older than an hour and half-written save files. Before, the previous copy
  (300-480 MB each) was kept, and one still running during an update was never removed.
- Uninstall asks whether to delete your Sahkarmi data too (default No); an update or a silent
  uninstall never touches it. Uninstall always removes the update download cache.

### Changed

- New interface font: Inter for all Latin text (Mukta and Hind Siliguri still draw Hindi and
  Bengali); the rounded Baloo 2 headings are gone.

## [0.21.2] - 2026-11-03

### Fixed

- "Restart to update" no longer loops on Windows PCs where the installer cannot start without a
  permission prompt. Each Restart click is written down before the installer runs; if the same
  version is still running at the next start, the app says that the last update did not install
  and asks to choose Yes when Windows asks for permission (Sahkarmi is free software and not yet
  signed, so Windows calls it an unknown publisher). After two such attempts the update is
  handed to the browser as a normal download, which installs the way the first install did.
- A failed attempt also switches off the silent install at quit, so closing Sahkarmi no longer
  raises the same permission prompt every time.
- An installer that cannot start at all (missing or blocked file) is reported at once instead of
  leaving the app on "Installing update…" with every coworker stopped; the app restarts itself
  so work can continue.
- A copy installed from the Microsoft Store says so on the Updates page instead of the generic
  "Updates are available in installed desktop builds."

## [0.21.1] - 2026-11-03

### Fixed

- Spreadsheet passages no longer carry "| | | |" from empty cells: blank cells at either end of
  a row are dropped and a run of blanks in the middle collapses to one, so Excel and CSV rows
  read cleanly in search results and in what coworkers are given.
- Existing Knowledge Bases pick up indexing improvements by themselves: the first time a newer
  Sahkarmi opens a base, every file is read again in the background and vectors left by an
  older embedding model are removed. Nothing to remove or add by hand.

### Changed

- Telegram: the pairing code is shown in its own highlighted box, large, with a Copy button,
  so the one thing you have to send from your phone cannot be missed.
- Multi-Agent (team runs) screen uses the same paper, lines, buttons and saffron as the rest of
  the app, in light and dark, instead of its own grey styling.
- Page introductions share one width and spacing on every screen (Knowledge, Memory, Routines,
  Activity, Business, Shared files, Marketplace), and the Routines empty state sits in the same
  gutter as everything else.

## [0.21.0] - 2026-11-03

### Added

- Smarter search (optional): the Knowledge page has a card to download one small embedding
  model (potion-base-8M by The Minish Lab, MIT, about 30 MB, from huggingface.co) once. With it
  installed, every passage gets a 256-byte vector and searches match by meaning too, so
  "holiday rules" finds the leave policy even when the words differ. The model is a lookup table
  that runs in plain JavaScript inside the app: no native code, no GPU, no cloud, and your
  documents never leave the computer. It loads on the first search (a quarter of a second) and
  is dropped from memory again after ten idle minutes. "Turn off and delete" removes the files
  and every vector.
- Word stemming in the full-text index: "registrations" now finds "registration", "running"
  finds "run". Existing bases are upgraded on first open, no re-indexing needed.

### Changed

- Searches with the model installed fuse the word ranking and the meaning ranking (reciprocal
  rank), keep the per-file cap, and only use the model for Latin-script queries (Hindi and
  Bengali script stay on the word index). Weak meaning matches are dropped, so unrelated
  messages still get no document excerpts.

## [0.20.0] - 2026-11-03

### Added

- Knowledge Bases: a new "Knowledge" page where you make a base (for example "Price lists" or
  "Company policies") and add PDF, Word, PowerPoint, Excel, CSV, Markdown, text, JSON or HTML
  files, single files or whole folders, or drop them on the page. Everything is read and indexed
  on this computer, in a SQLite full-text index next to Sahkarmi's own data; nothing is uploaded.
- Coworkers answer from your documents. Every message you send is first matched against the bases
  the coworker may read, and the best passages go in with the message, so the coworker answers
  from your own files and cites them as [S1], [S2]. A pill in the reply opens the file. Coworkers
  also have three tools, list_knowledge_bases, search_knowledge_base and read_document_section,
  on every provider (Codex, Claude, Gemini, OpenCode and the others).
- Citations keep their place: page for PDFs, slide for PowerPoint (with speaker notes), sheet for
  Excel (rows as "a | b | c", with the header row on every passage), and the heading for Word,
  Markdown and HTML. Search works in English, Hindi and Bengali, including Hinglish.
- Each base says who may search it: every coworker in the workspace, or only the ones you pick,
  and a base can be hidden from coworkers while you organise it. The Knowledge page has a search
  box to try what coworkers will find, and "Check for changes" re-indexes files that changed and
  marks files that moved away.
- Settings > Features has two switches: "Knowledge Bases" and "Documents in every message".

### Changed

- Nothing new is downloaded or bundled for this: the index uses the SQLite built into the app and
  the PDF reader it already had, so the installer size, start-up time and memory use stay as they
  were. Indexing runs one file at a time in the background and yields between files.

## [0.19.0] - 2026-11-03

### Added

- Coworkers keep going on their own. When a coworker stops after an answer that is only a plan,
  or asks "shall I continue?" without a real question for you, Sahkarmi sends "Continue" for you
  (up to eight times for a plan, twice for a next step). Settings > Features has the switch
  "Keep going without babysitting".
- Change the model or thinking level while a coworker works. The header and settings pickers stay
  open during a turn; the choice is kept and starts with the next turn, and the header says
  "After this turn" until then.
- Thinking levels None, Minimal and Ultra are available on the models that support them.
- Every coworker has an Instructions file (AGENTS.md in its own folder). Settings shows it,
  you can edit it there or open it in the folder, and a coworker that is asked to remember a rule
  writes it into that file. A save that would overwrite a change the coworker just made is
  refused once so nothing is lost, and the chat notes when the coworker updated its rules.
- Branch from here: any coworker answer has "Branch from here" in its menu. It makes a copy of
  the coworker, with the conversation up to that answer as its starting point, so you can try a
  different direction without losing the original.
- Folders in the sidebar, three levels deep. Make one with the "+" on the workspace name, drag
  coworkers and folders into each other, or use "Move to folder" in a coworker's menu. A nested
  folder shows its path, and folded folders stay folded.
- The chat says "Waiting for the AI service" when a working coworker has heard nothing from its
  provider for a minute, and "No internet" when the computer is offline.

### Changed

- Messages that are only waiting in a coworker's queue no longer block deleting it; they go with
  the coworker. Only work that has really started still blocks a delete.
- A message sent while the provider needs a sign-in stays in the queue and starts by itself after
  you sign in, instead of failing.
- Browser steps return a one-line status instead of a whole page snapshot, so coworkers spend far
  fewer tokens on web tasks. A coworker asks for the page only when it needs it, and can take a
  screenshot of one element.

## [0.18.0] - 2026-11-03

### Added

- Team runs now do real work. The Multi-Agent screen hands each task to one of your coworkers
  through its normal queue, so permissions and approvals apply exactly as if you had typed the
  task yourself. A run that needs your approval pauses by itself, costs nothing while it waits,
  and continues when you decide on the computer or in Telegram. Close the app in the middle and
  press Resume later: the run carries on from the last finished step. Each task shows its result
  on its card. Settings > Features has a switch, "Team runs: durable engine"; off, the older
  in-app planner is used. The engine loads only when a team run starts, so the app opens as fast
  as before.

### Changed

- On Windows there is no menu bar any more, so the Alt key no longer opens one over the chat.
  Ctrl+. still stops all coworkers.
- Copying selected chat text gives plain text, so a paste into WhatsApp, a mail or a document
  carries no app colours or layout.
- Model names that do not fit now wrap in the model picker instead of being cut off.

### Fixed

- Queue changes no longer rewrite the queue file when nothing in it changed, and a save that
  Windows briefly blocks (antivirus, indexing, sync) is retried instead of failing.
- Custom MCP servers that start slowly (npx on Windows) now get 20 seconds to start in ChatGPT
  (Codex) coworkers instead of ten.
- Claude's model list and plan limits no longer inherit Claude Code's own session variables when
  Sahkarmi is started from inside Claude Code.
- Quitting never hangs: if a coworker process or a dialog holds the app, it closes after eight
  seconds anyway.

## [0.17.1] - 2026-11-02

### Fixed

- The list of steps in a chat no longer opens and closes by itself while a coworker works, so the
  chat stays still. It opens only when you click it; the running step's name shows on its header.

### Changed

- Every approval now explains itself in everyday English: what the coworker wants to do, why, which
  website or service is involved, what happens if you approve and what gets shared. This also shows
  in the Telegram notification. Technical detail stays folded away.
- A coworker's approval request that does not explain itself is sent back to the coworker to rewrite
  instead of reaching you.
- A connected-app approval from an older version must be asked for again before the action can run.

## [0.17.0] - 2026-11-01

### Added

- Approve or reject from Telegram: a notification has Approve, Reject and Details buttons, plus
  `/pending`, `/approve`, `/reject`, `/details`, `/cancel`, `/status`, `/policy` and `/ceo` commands.
  The decision reaches Sahkarmi at once, and the Telegram message updates when a request is decided
  on the computer, runs out of time or is cancelled. Only the paired owner can decide. Chats paired
  before this version are recognised without pairing again.
- Delete a workspace from its menu (Team and CEO): move its coworkers to another workspace, or
  delete them with it, after a confirmation. A workspace whose coworkers are working, and your only
  workspace, cannot be deleted.
- A CEO for a workspace: choose one coworker. It gives the others their work, collects their results
  and reports to you in one reply, also on Telegram. The CEO has no extra permissions.
- You can give the CEO authority to decide some kinds of approval, for 24 hours at a time. It can
  pass part of that to an employee, never more; taking it back ends what was passed on. Nobody
  decides their own request, and every decision records who made it.
- Publishing accounts: a coworker is tied to one Facebook, Instagram or LinkedIn account after you
  approve it. If another account is signed in, or the account cannot be confirmed, it stops; it
  never falls back to a different account. Connected-app posting uses the tied connection too.

### Fixed

- Coworkers no longer interfere with each other's work: each can use only its own browser pages,
  cannot read another's private folder or search another's chats, and messages stay inside the
  workspace. Under a CEO, work goes through the CEO. Coworkers can still talk to each other.
- Every coworker now has its own browser with its own sign-ins, so one coworker's sign-in or open
  page no longer changes another's. Existing sign-ins (cookies) are copied once to the coworkers
  that used those sites, and the old browser data is kept. Sites that keep their sign-in outside
  cookies, such as WhatsApp Web, need signing in again.
- The approval screen no longer flickers. Repeated updates no longer rebuild the cards, so a note
  you are typing stays, and repeated identical requests show as one card.
- A Telegram chat no longer changes coworker silently when a new coworker is added.
- Saving a coworker's settings retries when Windows briefly holds the file.
- Requests still waiting from before a restart now show straight away on the Approvals screen.
- Less freezing with many browser pages. Pages changing their title or loading state no
  longer flood the app, page pictures are small and paused while the window is hidden, and at most
  six unused pages stay awake (each is a separate process). Sleeping pages stay in the list and wake
  signed in. Saving chat, approval and file records no longer blocks the app in a burst.
- AI servers no coworker uses no longer stay in memory. OpenCode and the other agent servers stop
  after a minute if no coworker uses them, or after 15 quiet minutes, and start again when used.

### Changed

- Help now explains the CEO, Telegram approvals, each coworker's browser, publishing accounts and
  deleting a workspace.

## [0.16.0] - 2026-10-28

### Fixed

- Model usage showed far too many Claude tokens (more than 240 crore in a week) and a cost of
  over US$ 1,700. Claude Code reports a running total for each chat, and when a chat was reopened
  after a restart that total included everything from before, so the same work was counted again
  and again. Each chat is now counted once, across restarts. The old Claude counts were too high to
  keep, so they were removed and counting starts again from the update; a notice on the page says
  so for a week. ChatGPT (Codex) counts were correct and are kept.
- Claude's plan limits now show real percentages: the 5-hour window, the weekly limit and any
  per-model weekly limit, each with its reset time. They are read when the app starts and when you
  open Model usage, without sending a prompt, and updated during each Claude task. Before, only a
  "Close to the limit" status was kept, and it could stay on screen days after the limit reset.
- A limit window that has already reset no longer shows its old percentage.
- Team memory showed "&amp;" instead of "&" in titles and notes, and long notes (file paths,
  commit hashes) spilled into the next card. Text now wraps inside the card, and long notes fold
  with a Show all button.

### Changed

- The rings above Settings show each provider's logo and fill up as its real limit is used, for
  every provider that reports a limit (now Claude as well as ChatGPT).
- Model usage has a cleaner layout: one card per provider with short numbers that fit (3.68Cr;
  the exact count is in the tooltip), clear status pills, and providers that report nothing
  listed in one row instead of empty cards. The cost is labelled as what the work would cost at
  API prices, not a bill, when you are on a fixed-price plan.
- Team memory cards have a colour strip for each kind, a count on each filter, and the date each
  note was last updated.

## [0.15.0] - 2026-10-28

### Added

- Getting started help that stays out of the way. A new install shows a small welcome card in
  the empty chat (Start a task, Explore features, Not now). It is not a popup: the message box
  keeps working, and once dismissed it does not come back. Anyone who already has chats never
  sees it.
- A Help button (?) above Settings in the left rail. It explains the screen you are on, has a
  short Getting started list (a step shows Done only when the app can confirm it), a three-step
  "Show me around" tour, and Reset guidance. It works offline and in English, Hindi and Bengali.

## [0.14.0] - 2026-10-28

### Fixed

- Chats with Claude coworkers keep their order. Before, switching to another coworker and back
  could move older replies to the bottom of the chat. This happened after a long chat was
  summarised, after you pressed Stop, or after a background task finished.
- Claude Code's own notes (the "This session is being continued…" summary, "[Request interrupted
  by user]" and background-task notices) no longer show up as messages from you.

## [0.13.0] - 2026-10-27

### Added

- Settings > Skills: add skills the way Claude Code does. Paste a GitHub link (for example
  anthropics/skills) to see every skill (SKILL.md) in that open-source repo and install the ones
  you pick, or paste a SKILL.md yourself. Every coworker gets them, whichever AI it runs on
  (Claude, Codex, Gemini, Antigravity), and reads a skill before a task that matches it.
- Settings > MCP servers: give coworkers new tools with MCP servers, the same ones Claude Code uses.
  Paste the MCP JSON from a README, Claude Desktop or a .mcp.json file, load a repo's .mcp.json,
  or add a server by hand (a program on this PC or a web address). Servers can be switched off,
  edited or removed. Keys you enter are kept in a file only you can read and are never shown
  again. On Windows, npx-based servers start correctly without extra setup.
- New or changed MCP servers reach coworkers the next time Sahkarmi starts. Their tools still go
  through your approvals.
- Export what a coworker or a team did as a neat Markdown (.md), plain text (.txt) or JSON file:
  the task, every step with timing, what was said and the result. Use the Export button in a
  chat (this task or the whole chat), on a team run, or on a routine. Passwords, keys, OTPs and
  card numbers are hidden in the file.
- Routines > Import workflow: open an exported JSON file, pick which of your coworkers does each
  step, and it becomes a routine you can run again.

### Fixed

- The app no longer freezes while the AIs connect after it opens. AIs now connect side by side
  instead of one after another, so chat is ready in about a second instead of four or five, and
  opening a chat no longer waits for a slow AI to finish starting.

## [0.12.7] - 2026-10-27

### Fixed

- Claude coworkers' messages are easier to follow, like Claude Code. What the coworker says
  between steps now shows as separate paragraphs, each next to the steps it ran, instead of one
  long paragraph with sentences joined together ("fields.Fields") under "Ran N steps".
- A coworker asking another coworker still gets the whole reply.
- The task strip above the chat no longer cuts off chips: "Send now" stays on one line, and a
  waiting message shows more of its text.

## [0.12.6] - 2026-10-27

### Fixed

- Sahkarmi is much lighter. Saved browser tabs no longer all load when the app starts: only the
  tab on screen loads, the others when you open them or a coworker uses them. A tab nobody used
  for 30 minutes sleeps (its page is freed; the tab, its address and your sign-ins stay). A
  coworker opening a page it already has open reuses that tab instead of making a duplicate.
- Your cursor stays in the chat box while coworkers work. Before, every coworker click or key
  press took the keyboard into the browser, so you had to click the message box again.
- Taking over the browser for one coworker no longer stops all the others. Only the coworker that
  asked you waits; the others carry on in their own tabs and cannot touch the tab you are using.
  A coworker that was asked to wait is told when you hand the browser back.
- Coworkers can fill Google Sheets and other spreadsheets themselves: type into the selected cell
  (Tab moves to the next cell, a new line to the next row) or paste whole rows. Pasting never
  touches your clipboard.
- Key combos such as Ctrl+A and Shift+Tab work in the built-in browser.
- Coworkers can click icon buttons drawn as pictures (Instagram's menu, X's Post button). When an
  element is gone, the coworker gets a clear "take a fresh snapshot" message instead of "Script
  failed to execute".
- When a click opens a new tab (job titles on Naukri), the coworker is told which tab to read.
- Screenshots of a browser tab work when the browser panel is closed.
- A coworker asking you to take over is never refused for a long reason; it is shortened instead.
- Coworkers on Google Antigravity no longer fail browser calls for a missing tab or revision.
- Coworkers on Google Antigravity no longer fail while you take time to approve something. After
  about 2.5 minutes the coworker is told to wait; when you approve, it is told and its repeat of
  the same action goes through without asking you again.
- Reading a very big page (Instagram, a large sheet) no longer goes over Claude's limit: every
  button and link is kept, and long page text is read in parts.
- Reading a page in a hidden tab is faster and no longer times out: the page runs at full speed
  while a coworker works in it, and slows down again afterwards to save battery.

## [0.12.4] - 2026-10-27

### Fixed

- Sahkarmi no longer refuses to open with "Sahkarmi is finishing an update". In 0.12.3 any
  Sahkarmi installer that was still running blocked the start: a first-time user who ticked
  "Run Sahkarmi" at the end of setup, or an old installer stuck in the background, made the app
  close again and again. Now the app waits only for an installer of a newer version, waits at
  most 5 minutes, and never waits twice in a row.
- Development runs use their own Windows app ID, so the installed Sahkarmi always shows its own
  logo in the taskbar.

## [0.12.3] - 2026-10-26

### Fixed

- "Update now" for Claude Code and Codex works. It used to run `npm install -g`, which updated a
  copy Sahkarmi did not use (Claude's own installer puts its `claude.exe` first, so the version
  never changed) and failed with "a file of the tool is in use" while a coworker was running the
  tool. Now Sahkarmi downloads its own copy from npm into a new folder for each version, checks
  npm's checksum and the program's version, and switches to it when your coworkers are not busy.
  It always uses the newer copy: its own or yours. Your own installs are never changed. With
  automatic updates allowed, this happens by itself, like the OpenCode runtime.
- The built-in browser no longer reloads tabs in a loop. When a coworker kept working on a site
  (for example Google Search Console with many tabs open), the tab you were looking at reloaded
  after every one of its clicks, and broken links showed a 404 again and again. Now a tab is
  reloaded only after the coworker has been quiet for 5 seconds, at most once every 30 seconds,
  never when it shows an error page, and never when a coworker has typed in it and not saved.

## [0.12.2] - 2026-10-26

### Fixed

- Updates no longer start again and again with "Retry". Opening Sahkarmi while an update was
  still installing blocked the installer, threw away the finished download, downloaded it again
  and kept failing because Windows was still using the file. Now a finished download is kept,
  a file that is in use is not retried every few seconds, and if an update is installing when
  you open Sahkarmi, it says so, closes, and opens by itself when the install is done.

## [0.12.1] - 2026-10-26

### Fixed

- Codex coworkers whose chat started before an update now get the new tools by themselves.
  Codex cannot add tools to a running chat, so on the next message Sahkarmi starts a fresh chat
  for the coworker and gives it the latest part of the earlier conversation. You still see the
  whole chat; nothing to do by hand.

## [0.12.0] - 2026-10-26

### Added

- Coworkers learn skills as they work. After a task that took several steps, a fix, or a
  correction from you, a coworker saves the playbook to Shared/Skills/Learned, and later runs
  improve it (the version goes up, with a note of what changed). Skills never hold passwords,
  OTPs, keys or card numbers. Marketplace > Skills lists them under "Learned by your
  coworkers", where you can open or delete each one.
- Coworkers can search earlier chats (their own, or the whole team's) to recall what was
  decided, sent or promised, instead of guessing.
- Chat with your coworkers from Telegram. In Settings > Telegram, open @BotFather from the
  button, paste the bot token, then tap "Pair in Telegram" and press Start; only that one chat
  is answered. Your message goes into the coworker's normal queue, Telegram shows "typing..."
  while it works, and its finished reply comes back to Telegram. A "Show me how" guide walks a
  first-time user through all 7 steps with a picture for each. /coworkers lists them and /use switches. New approvals are announced there too (you
  still allow or deny them in the app). Sahkarmi must be open on the computer.

### Fixed

- When a coworker changes a site in one browser tab, your other tabs of the same site no
  longer show old data: the tab you are looking at reloads a moment after the coworker
  finishes, and hidden tabs reload when you open them. A tab you typed or clicked in is never
  reloaded over your work.

## [0.11.4] - 2026-10-26

### Added

- A live plan list above the message box shows the coworker's steps and ticks them off as it
  works (Codex, Claude and other agents; new coworkers get a plan tool of their own).
- Send stays available while a coworker works: your message goes into the queue. Esc in the
  message box stops the coworker, and Send now on a queued message runs it next.
- Approvals from the keyboard: Enter approves and Esc rejects an approval card in the chat.

### Changed

- Your message shows in the chat at once and the box is ready for the next one.
- Long chats open fast: the latest 80 messages show first, with "Show earlier messages".
- Tool rows read as one plain line in English, Hindi and Bengali, and commands show what the
  coworker ran instead of the PowerShell wrapper.

### Fixed

- Tool calls no longer vanish while a coworker works; the row grows as calls arrive.
- Streamed text no longer shows twice.
- Claude coworkers start again on Windows (the npm .cmd shim no longer wins over claude.exe).
- A chat whose AI tool is not installed opens at once instead of waiting about 6 seconds.
- On a busy computer, a slow page's file picker no longer slips past and opens the Windows
  dialog: a coworker's click now watches for it a little longer (400 ms).

## [0.11.3] - 2026-10-26

### Fixed

- Coworkers made before 0.11.2 can upload too. Their AI runtime kept the old tool list, so they
  did not know about upload and asked for Take over. Now, when a coworker clicks an Upload or
  Add photo button, Sahkarmi keeps the Windows file dialog closed and tells the coworker to use
  upload on the same button.
- A coworker's click no longer opens a Windows "Open" file dialog over the app.
- An AI tool update that failed no longer says "npm is not available" when npm is installed; it
  shows npm's real reason (for example, a file in use).

## [0.11.2] - 2026-10-26

### Fixed

- Coworkers can now attach files from this computer to web pages themselves (a photo for a
  Facebook or LinkedIn post, a document for a form). The browser tool gained an upload action
  that fills the page's file picker without opening a system dialog, so an upload no longer
  needs Take over. It follows the file-reading permission; publishing still asks you first.

## [0.11.1] - 2026-10-26

### Changed

- Settings > About: the founder's "D" now glows, floats and shifts colour gently (still when
  Windows is set to reduce motion).

## [0.11.0] - 2026-10-26

### Added

- Secure password and OTP card: when a site asks for a password, OTP or PIN, the coworker asks
  for it in a card in the chat. What you type goes straight into that page field (same site
  only) and is never shown to the coworker, saved or added to the chat. Take over and Decline
  are on the card too.
- Browser pages: every open page shows as a small live picture in its own column beside the
  chat. Click one to open it, X to close it, + for a new page. Pages a coworker is using are
  outlined.
- Browser start menu: an empty browser offers Open Browser, Open Files, Open Tasks, Open Agent
  settings and Open Voice.
- The browser panel can be dragged wider or narrower, expanded to fill the chat space and
  restored, or shrunk to the page pictures.
- Chat follows new messages only while you are at the bottom, scrolls smoothly, and shows a
  "Get to bottom" button with a new-message dot when you scroll up.
- Settings > About: meet the founder, Dhrubo, with LinkedIn, Telegram and email, plus
  Sahkarmi's website, LinkedIn, Facebook and Instagram, with smooth motion.
- Settings > AI: add more Google accounts for Gemini. When one account reaches Google's limit,
  Sahkarmi moves to the next and sends the message again.

### Changed

- Gemini starts together with the other AI tools instead of after them, keeps a recent chat
  warm, and sleeps after 30 minutes without use. Replies on an existing Gemini chat arrive
  about twice as fast once Gemini is ready.

### Fixed

- Gemini no longer starts twice at launch, and model checks no longer leave helper processes
  running in the background.
- The voice note preview shows its real length instead of 0:00.
- A page a coworker was working on in the background could appear on top of the app, outside
  the browser panel. Background pages now stay out of sight while coworkers use them.

## [0.10.0] - 2026-10-25

### Added

- Settings > Voice: speak instead of typing, on this PC. Download a model once and dictation
  works offline; your voice never leaves the computer. Models: all 22 scheduled Indian languages
  (AI4Bharat IndicConformer), Hinglish fast and best (Roman script with punctuation), English
  fast, and Whisper large-v3 turbo for about 100 languages with a language picker.
- Spoken replies: Indian voices (AI4Bharat Rasa: Hindi, Bengali, Marathi, Tamil, Telugu and 8
  more) and English voices (Kokoro), with four voice choices, Listen, speaking speed, Read aloud
  in each reply's menu, and an optional "Read replies aloud" for the open chat.
- The microphone in the message box and on Tasks now writes text live after each pause when a
  dictation model is installed. A voice note can now be turned into text only.
- Every download is pinned to a fixed version and checked by SHA-256 before use. Strings in
  English, Hindi and Bengali.

## [0.9.2] - 2026-10-25

### Added

- Marketplace > Apps lists all 1,660 Composio apps with their real logos before you add a key.
  The key card opens only when you press Connect or Add key.
- The key card is now a full setup guide: five simple steps with logos and a link to the API
  Keys page, Platform (ak_) versus Connect (ck_) keys, Full access, a "Something went wrong?"
  list for every known error, and a safety note. In English, Hindi and Bengali.

### Fixed

- A good Composio key could be refused when it was pasted with quotes, a label such as
  COMPOSIO_API_KEY=, spaces or hidden characters. Sahkarmi now cleans the paste first.
- A refused key now says why in plain words: a user key (uak_) instead of the Project API key
  (ak_), a key Composio calls invalid, or a limited key. The technical "Error invoking remote
  method" prefix is gone.
- A Connect key (ck_) is named and explained without being sent. A key with read-only access
  now says it needs Full access when an app is connected, with a Replace key button.

## [0.9.1] - 2026-10-25

### Fixed

- GitHub Copilot, Cursor, Kimi Code and the other new agents connected but never answered
  ("The selected model default is no longer reported"). They answer now.
- Clicking Connect again while GitHub Copilot was still installing started a second install that
  failed and left Copilot looking "not installed". A second click now shows the install in
  progress, and Sahkarmi carries on when the tool did land.
- GitHub Copilot signs in on its own: with your GitHub CLI sign-in when you have one, otherwise
  GitHub's page opens and Sahkarmi shows the code to enter there. No console to type in.
- A failed connect is now written to the app log, so it can be traced.

## [0.9.0] - 2026-10-25

### Added

- Marketplace has a new Apps tab. It lists every app Composio offers (GitHub, Gmail, Google
  Calendar, Slack, Notion, Jira, Linear and many more) with Connect buttons, logos and a search
  box. Connected apps sit at the top under "Your apps". It runs on Composio's free Hobby plan:
  $0, no card, 1,00,000 tool calls a month. You paste your own Composio key once; it stays on
  this computer.
- Coworkers use your connected apps through your own accounts. Reading is instant. Anything that
  sends, creates, changes or deletes stops for your approval first; once you approve, the
  coworker carries out that same action, exactly once.
- The provider connect screen is rebuilt: brand marks, groups for Connected, Found on this
  computer and Add a provider, Free badges, and inline install and sign-in progress.
- 11 more agents over ACP: Cursor, GitHub Copilot, Kimi Code, Cline, Qwen Code, Grok, Factory
  Droid, Qoder, Goose, Mistral Vibe and Kiro. Connect installs the tool when needed and starts
  its sign-in; tools already installed are found.
- Coworkers can create and change routines when you ask them to in chat. Agreeing to "post every
  day at 6 PM" now creates a real routine instead of only a note.
- Routines from your previous desktop agent are brought over once, paused, on first start, each
  matched to the coworker with the same name. Its own data is only read, never changed.
- When OpenCode's free limit is used up, a coworker moves by itself to another free provider you
  have connected (Gemini, GitHub Copilot or Kiro) and answers your message there.

### Changed

- The Composio section moved out of Business into Marketplace > Apps.
- Composio is reached through its current API (the old one was switched off). A busy or slow
  Composio is handled quietly: Sahkarmi waits and retries, never repeats a send or a delete, and
  pauses for a minute after repeated failures.
- When OpenCode's free limit is used up, you are told at once instead of waiting about a minute
  per model.
- Logos in the model picker and the first-run screen; missing agents read "Not installed".
- The Routines canvas shows times in your own clock style ("6:00 pm"), an On / Paused badge,
  arrows between steps and each coworker's role.

### Fixed

- A failed message that is resent automatically no longer shows twice for a moment after an
  automatic switch to the free model.
- Composio replies and errors are cleaned of tokens before they reach a chat.

## [0.8.1] - 2026-10-25

### Added

- An empty chat now suggests three first tasks for that coworker. One click puts the task in
  the message box.
- You can decline when a coworker asks you to take over the browser, for example to log in.
- Approvals for money, outside messages, publishing or deleting have a red edge.

### Changed

- Approval requests are in plain English ("Asha wants to save a file"). They list the files and
  the place, and fold the exact command under "Technical details".
- Sahkarmi's own tools, such as saving a memory, no longer ask for permission as commands.
- Memory screen rebuilt: matches the app, uses plain words, is translated, and has a proper
  window that Esc closes.
- An idle coworker's status reads "Available", so it no longer clashes with "Free model".

### Fixed

- Replies no longer disappear after you switch a coworker to a different AI provider.
- Antigravity helper programs now close with the app. Before, dozens could stay running and
  use a lot of memory.
- Stop now ends a task that is waiting for your approval.
- A failed message that is resent automatically no longer appears several times.
- The model menu in the header closes with Esc or a click outside it.
- The selected option is visible again in Settings, Routines and Schedules.
- The unread count on pinned coworkers shows as a badge.
- The message box shows a single focus outline.
- The app window no longer shifts and leaves a blank strip.
- A coworker's text after a tool step starts on a new line instead of joining the previous sentence.
- The task counts stay on one line in narrow windows.

## [0.8.0] - 2026-10-25

### Added

- Marketplace with 175 coworkers in 15 categories: finance, sales, marketing, writing,
  research, HR, operations, e-commerce, software and IT, design, websites, legal, education,
  personal productivity and industry specialists. Every coworker works through the same steps:
  understand, collect, plan, do the work, check it, deliver. Each one lists the inputs it needs,
  the checks it runs, what it asks approval for, when it is done and what it will not do.
- Software Engineering Team coworker. It plans the work in one file, gives each helper
  coworker its own part of the code, and needs evidence for every finished part. It deploys
  only after your approval.
- Marketplace search across names, job tasks, skills and outputs. Category filters with counts,
  plus Featured and "On my team". Grouped browsing with "Show all", and pages when filtering.
  A details window for every coworker, and Add, Open, Configure and Update buttons.
- Coworkers added from the Marketplace remember which template and version they came from.
  When a template improves, the Marketplace offers Update. If you edited the coworker's brief,
  it asks before replacing it.
- English option for activity and status lines (Settings → Activity style). It is the default
  when the app language is English.
- The browser panel shows which coworker is using it and what it is doing.

### Changed

- The twelve original Marketplace coworkers keep their names and gain detailed workflows and
  checks.
- Clearer sidebar: role labels no longer cut off, no sideways scrollbar, calmer group headers,
  and distinct names for pinned coworkers.
- Task queue: shorter readable task titles with the full text on hover, a single row with
  "Show all", and hints on Pause and Stop.
- Long messages you send fold after a few lines with "Show more". Numbered lists in your
  messages are easier to read.
- Step cards say what ran ("2 commands, 1 file") instead of "2 other". Raw shell commands stay
  out of the status line; hover to see them.

### Fixed

- Status labels now follow the activity style you choose.

## [0.7.5] - 2026-10-25

### Changed

- The coworker browser is Sahkarmi's own built-in browser again, inside the side panel. Nothing
  opens on the desktop and no Chrome window fills up with tabs. The Chrome engine from 0.7.4
  stays available with SAHKARMI_BROWSER=chrome; when used, its window takes the panel's shape so
  the live view fills the panel.

### Fixed

- Google sign-in (Gmail, YouTube and every Google service) in the built-in browser. On Google's
  sign-in pages the browser now names its Electron engine honestly, so Google shows its normal password step instead of "This browser or app may not be
  secure". Click Take over, sign in in the panel, then Hand back.

## [0.7.4] - 2026-10-25

### Changed

- Coworkers now browse in the real Google Chrome installed on the computer (Microsoft Edge when
  Chrome is not installed; the built-in browser only when neither is), in its own "Sahkarmi"
  profile that never touches your personal Chrome. Sites treat it as the ordinary browser it is,
  so pages, logins, pop-ups, downloads and file uploads behave exactly as in Chrome. The browser
  panel shows a live view of the coworker's tab; click it to bring the Chrome window forward.

### Fixed

- Google sign-in ("Couldn't sign you in · This browser or app may not be secure"). Google refuses
  every sign-in in a remote-controlled browser, so signing in now happens in a plain Chrome:
  when you click Take over, or the moment Google rejects a sign-in, the same Sahkarmi profile
  reopens as a completely normal Chrome window with nothing attached. Sign in to Google or any
  other site there (2FA, OTPs and payments too), then click Hand back or just close the window;
  the coworkers continue with every login you made.

## [0.7.3] - 2026-10-24

### Fixed

- The coworker browser can sign in to Google again. It used to pretend to be Firefox on
  accounts.google.com while everything else about it was Chromium, and Google answered
  "This browser or app may not be secure". It now presents one plain Chromium identity on every
  site, and sign-in popups ("Continue with Google", OAuth consent) open as a real popup window
  that shares the browser's session, so no login flow is blocked.
- The browser panel can no longer cover the chat header and its Browser button on narrow windows.

### Added

- A short 3D reveal of the Sahkarmi mark when the app opens (about 1.7 seconds, once per launch,
  plain fade when the system asks for reduced motion).
- The chat reacts the instant you press send ("Message bheja ja raha hai…") instead of showing
  nothing until the provider starts the turn.
- Pictures a coworker makes show in the chat: files it writes during a turn (images, PDFs,
  Word, Excel, PowerPoint, CSV, Markdown, HTML) appear under its reply as attachments, with
  image previews, and markdown images in a reply render inline.
- Attached documents are readable by every model: Sahkarmi extracts the text of PDF, Word,
  Excel, PowerPoint and text attachments into the prompt (up to 60,000 characters each), and
  sends attached pictures as image input to agents that accept images (Google Antigravity,
  OpenCode vision models).

## [0.7.2] - 2026-10-24

### Fixed

- First message on a fresh install came back "Interrupted · Send again" and the coworker stayed
  "working" with its queue stuck: the CLI/model refresh (every window focus) restarts providers that
  are not signed in, and that restart marked every other provider's running turn as "Sahkarmi
  restarted". Only deliveries left over from a previous process are reconciled now, per provider.
- A coworker on the free model could sit at "working" for ever when OpenCode's free usage limit
  was reached, because OpenCode's agent never answers in that case. A turn with no sign of life
  for 60 seconds now fails with a readable reason, and the coworker is free again.
- "AI tool update failed: EPERM/ENOTEMPTY" after a successful bundled-runtime update on Windows.

### Added

- The free model rotates: "Free model (no login)" tries OpenCode's default model first and then
  every other free model it offers. When one stops answering (its usage limit is used up), it is
  skipped for an hour and your message is sent again on the next free model by itself, with a note
  in the chat.

### Changed

- Windows-only release. The macOS and Linux builds are paused until the project has tested them on
  real hardware; the website and install guide say so. Installed 0.7.1 macOS and Linux builds keep
  working but will not find an update until those builds return.

## [0.7.1] - 2026-10-24

(0.7.0 was tagged but its Windows build did not publish; 0.7.1 is the same release.)

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

- Segregated & Organized Workspace Sidebar: compact layout featuring top search, horizontal pinned/recent coworker avatar quick-switcher bar, and collapsible workspace sections with coworker counts.
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
