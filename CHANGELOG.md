# Changelog

All notable changes to Sahkarmi are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
