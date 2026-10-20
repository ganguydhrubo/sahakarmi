# Hinglish agent activity system — report

Branch: `feat/workspace-upgrade` (on top of the workspace upgrade). Not released.

## About "Groq"

Sahkarmi has **no direct Groq integration**: it has no Groq SDK or Groq API key. Its agents run
through four providers (Codex, Claude Code, Gemini CLI and bundled OpenCode), and all of them feed
one event pipeline. Groq models can be used today only through OpenCode: run
`opencode auth login`, pick Groq, then choose "Your OpenCode model" for a coworker. The activity
system is built on that shared pipeline, so it works the same for Groq-via-OpenCode as for the
other providers. Hidden chain-of-thought is never assumed or shown. No extra model calls are made.

## 1. What changed

- **Live activity line** under the conversation, replacing the English "Working •••" bubble. It
  shows a spinner, a **primary line** (changes only on a real event), a **secondary line** (rotates
  every 4 s within that event's own vocabulary), the real tool detail (for example `npm test`) and
  the elapsed time. After 20 s without a new event it rotates honest long-wait lines that never say
  "almost done". On completion, cancellation or failure the spinner stops, the real outcome shows
  for 3 s, then it hides and all timers stop. It uses fixed height (no layout shift), a subtle fade
  and shimmer, light and dark themes, reduced-motion support (no animation), and one screen-reader
  announcement per real event (rotations are not announced).
- **State machine** (`activity.ts`, pure): idle, queued, paused, initializing, thinking, generating,
  researching, executing_tool, processing_result, waiting_approval, waiting_user, retrying,
  finalizing, completed, cancelled, failed.
- **Vocabulary** (`activity-hinglish.ts`): about 130 Roman-script Hinglish lines in a neutral voice
  ("ho raha hai"), so they read right for every coworker (Asha, Vikram, …). Categories: thinking,
  generating, research, browser, code, tests, command, files read/write, coworker hand-off,
  approvals, long waits and final answer, plus outcome, retry and error titles.
- **Real retry signals (new):** Claude Agent SDK `system/api_retry` (attempt, max, delay) and Codex
  `error` with `willRetry: true` become a `turn-retrying` event. Previously a Codex auto-retry
  showed as an error bubble. The line shows "Ek baar phir try ho raha hai…" with "Koshish 2/10".

## 2. How each status maps to a real event

| Status (Hinglish primary) | Real event that triggers it |
| --- | --- |
| Request line mein hai… / Queue abhi ruki hui hai | delivery `queued` (queue paused) |
| Request receive ho gayi… | delivery `starting`, no turn yet |
| Request par kaam chal raha hai… | `turn-started`, no output yet; or reasoning summary items (Codex) |
| Web par information dhoondhi ja rahi hai… | a running tool of kind `web` (or browser search) |
| Browser mein page khola ja raha hai… | a running Sahkarmi browser tool |
| Tests aur build check ho rahe hain… / Code par kaam chal raha hai… / Command chal rahi hai… | a running command tool, classified by its real command text |
| Files padhi ja rahi hain… / Files mein changes ho rahe hain… | a running file tool (read vs edit) |
| Tool se mila result process ho raha hai… / Tool se error aaya… | the last tool finished (or failed) and nothing newer has arrived |
| Jawab likha ja raha hai… | assistant text streaming |
| Final jawab taiyar ho raha hai… | streaming item is the `final_answer` |
| Aapki manzoori ka intezaar hai | a paused tool call is pending in Approvals |
| Aapke jawab ka intezaar hai | the coworker asked a question (prompt) |
| Ek baar phir try ho raha hai… | provider retry event (above) |
| Kaam poora ho gaya! / Task cancel kar diya gaya hai. / Task complete nahi ho paya… | `turn-completed` with `completed` / `interrupted` / `failed` |

Time alone never changes the primary line; it only rotates secondary wording or switches to
long-wait wording.

## 3. English labels converted to Hinglish

- Activity bubble "Working" / "Queued" and its screen-reader label "X is working".
- Coworker status: Idle / Working / Waiting for you / Needs attention → Free hai / Kaam chal raha
  hai / Aapka intezaar hai / Dhyan dijiye.
- Tool cards: Running / Done / Failed → Chal raha hai / Ho gaya / Nahi ho paya.
- Task strip: queued / running / done / paused → line mein / chal rahe / poore / Ruka hua.
- Thinking disclosure: "Thinking", "N steps" → "Soch-vichaar", "N kadam".
- Browser control labels (Opening a page…, Clicking…, Typing…, 12 total) → Hinglish.
- Message states: Queued #n / Cancelled / Failed / Stopped → Line mein #n / Cancel kar diya gaya /
  Poora nahi ho paya / Beech mein rok diya gaya.
- Error notice titles (Error, Send failed, Load failed … 12) → for example "Kuch gadbad ho gayi",
  "Message nahi ja paya".
- "Connecting to agent CLIs…", "Starting local agent CLIs…" and the "wait for current work" model
  tooltip → Hinglish.

Unchanged on purpose: code identifiers, protocol fields, logs, provider error text (shown verbatim)
and non-activity UI such as Settings and menus, which keep the app language (EN/HI/BN).

## 4. Tests and build

- `vitest`: **222 passed, 3 skipped** (was 205). New tests:
  - `activity.test.ts` (12): every lifecycle transition; research only for a real web tool;
    waiting, retry and outcome priority; tool classification; no consecutive repeats; long-wait
    switch; "done" wording only when done; Roman script only (no Devanagari or Bengali); no
    English-only lines; every sentence has Hindi grammar.
  - `ActivityIndicator.test.tsx` (2): the line stays stable between rotations while the clock ticks
    (regression for a bug found during visual testing), and the spinner stops on failure.
  - App test: a real tool event shows the tests line with `npm test`; a retry event shows
    "Koshish 2/10"; another coworker's activity doesn't leak; interruption shows cancel.
  - Backend: a Codex `willRetry` error becomes a retry, not an error; Claude `api_retry` is
    forwarded.
  - Updated: existing tests that asserted the old English labels ("Chief is working", "Waiting for
    you", "Thinking", …). The completion test now also checks the real outcome line and that the
    indicator hides afterwards.
- Biome, both `tsc` projects, production build: clean.
- Visual check (Chromium, mock data): light, dark, and the 960 px minimum window width. Screenshots
  are `docs/screenshots/hinglish-activity-*.jpg`.

## 5. Limitations

- No live provider run from this sandbox (provider hosts are blocked). The event wiring is
  verified with protocol-level fakes.
- Gemini CLI and OpenCode do not report retries over ACP, so a retry is shown only for Claude and
  Codex.
- Provider error messages are shown verbatim (usually English) under a Hinglish title.
- Activity text is always Hinglish, even when the app language is हिन्दी or বাংলা, as requested.
