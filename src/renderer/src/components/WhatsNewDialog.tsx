import { createSignal, onMount, Show } from "solid-js";
import { t } from "../i18n";

export interface WhatsNewFeature {
  title: string;
  badge: string;
  desc: string;
  icon: string;
}

/** One entry per release that is worth a dialog; versions without one show nothing. */
const RELEASE_FEATURES: Record<string, WhatsNewFeature[]> = {
  "0.22.0": [
    {
      icon: "✅",
      badge: "Approvals",
      title: "One approval per task",
      desc: "Approve a post or message once and the coworker finishes that task without asking again for every click. Deleting, payments and account changes still ask each time.",
    },
    {
      icon: "🔑",
      badge: "Claude",
      title: "Sahkarmi has its own Claude sign-in",
      desc: "Claude coworkers no longer get stuck in the queue. Sahkarmi keeps its Claude account apart from Claude Code: go to Settings > AI and models and click Connect next to Claude once.",
    },
    {
      icon: "🌐",
      badge: "Browser",
      title: "Every coworker has its own browser",
      desc: "Opening one coworker's browser never shows another's pages, and each keeps its own logins, now also after a restart. Approved posts go through even when Facebook redraws the page.",
    },
    {
      icon: "🖱️",
      badge: "Desktop",
      title: "Coworkers can use your PC",
      desc: "With your permission (Settings > Permissions > Control this PC), a coworker can open apps, click, type and read windows on your desktop. Never in password fields.",
    },
    {
      icon: "⚡",
      badge: "Speed",
      title: "Lighter and quieter",
      desc: "The window no longer repaints all the time, clicking into it no longer starts a burst of checks, and old copies of AI tools are removed by themselves.",
    },
  ],
  "0.21.2": [
    {
      icon: "🔁",
      badge: "Updates",
      title: "No more restart loop",
      desc: "If an update did not install, Sahkarmi now says so and tells you to choose Yes when Windows asks for permission. After two tries it gives you the installer to run yourself.",
    },
    {
      icon: "🚪",
      badge: "Updates",
      title: "Quiet on close",
      desc: "A failed update no longer asks for permission every time you close the app.",
    },
  ],
  "0.21.1": [
    {
      icon: "📊",
      badge: "Knowledge",
      title: "Cleaner spreadsheet passages",
      desc: "Empty Excel and CSV cells no longer leave “| | |” in search results. Your existing bases re-read their files on their own after this update.",
    },
    {
      icon: "📱",
      badge: "Telegram",
      title: "Pairing code you cannot miss",
      desc: "The /start code sits in its own highlighted box with a Copy button.",
    },
    {
      icon: "✨",
      badge: "Polish",
      title: "One look on every screen",
      desc: "Multi-Agent now matches the rest of the app in light and dark, and page text shares one width and spacing everywhere.",
    },
  ],
  "0.21.0": [
    {
      icon: "🧠",
      badge: "Knowledge",
      title: "Smarter search, if you want it",
      desc: "On the Knowledge page, download one small model (30 MB, MIT) once and searches match by meaning: “holiday rules” finds the leave policy.",
    },
    {
      icon: "💻",
      badge: "Local",
      title: "Still nothing leaves your computer",
      desc: "The model is a lookup table that runs inside the app. No cloud, no native code, and it is unloaded again after ten idle minutes.",
    },
    {
      icon: "✂️",
      badge: "Search",
      title: "Word forms match",
      desc: "“registrations” finds “registration” and “running” finds “run”. Existing bases are upgraded on first open.",
    },
  ],
  "0.20.0": [
    {
      icon: "📚",
      badge: "Knowledge",
      title: "Knowledge Bases",
      desc: "Add your PDFs, Word, Excel, PowerPoint and text files on the new Knowledge page. They are indexed on this computer and never uploaded.",
    },
    {
      icon: "🔎",
      badge: "Answers",
      title: "Coworkers cite your documents",
      desc: "Every message is matched against your documents first. Replies quote the page as [S1]; click the pill to open the file.",
    },
    {
      icon: "🔐",
      badge: "Access",
      title: "You choose who may read what",
      desc: "Open a base to the whole workspace or only to chosen coworkers, or hide it while you organise it.",
    },
    {
      icon: "⚡",
      badge: "Light",
      title: "Nothing extra to download",
      desc: "Search uses SQLite full-text indexing built into the app, so the installer, start-up and memory stay as they were.",
    },
  ],
  "0.19.0": [
    {
      icon: "🏃",
      badge: "Autopilot",
      title: "Coworkers keep going",
      desc: 'A coworker that stops at a plan or asks "shall I continue?" is told to continue for you. Switch it off in Settings > Features.',
    },
    {
      icon: "📁",
      badge: "Sidebar",
      title: "Folders and branches",
      desc: "File coworkers into folders three levels deep, and branch any answer into a copy of the coworker to try another direction.",
    },
    {
      icon: "📝",
      badge: "Rules",
      title: "Instructions per coworker",
      desc: "Each coworker keeps its standing rules in AGENTS.md. Read and edit them in Settings; the coworker updates them when you ask it to remember something.",
    },
    {
      icon: "⚡",
      badge: "Speed",
      title: "Lighter browser work",
      desc: "Browser steps return a short status instead of a whole page, and you can change the model mid-turn for the next turn.",
    },
  ],
  "0.18.0": [
    {
      icon: "🧩",
      badge: "Team runs",
      title: "Team runs that really run",
      desc: "Each task goes to one of your coworkers. A run pauses for your approval and continues after a restart from the last finished step.",
    },
    {
      icon: "🪟",
      badge: "Windows",
      title: "A cleaner window",
      desc: "No menu bar pops up on Alt any more, copied chat text pastes as plain text, and quitting never hangs.",
    },
  ],
  "0.17.1": [
    {
      icon: "📝",
      badge: "Approvals",
      title: "Approvals you can understand",
      desc: "Every request now says what the coworker wants to do, why, on which site, what happens if you approve and what gets shared.",
    },
    {
      icon: "🧘",
      badge: "Fix",
      title: "A chat that stays still",
      desc: "The list of steps no longer opens and closes by itself while a coworker works. Click it whenever you want to look inside.",
    },
  ],
  "0.17.0": [
    {
      icon: "✅",
      badge: "Telegram",
      title: "Approve and reject from Telegram",
      desc: "Tap Approve or Reject in the notification. Sahkarmi updates at once, and so does the message when you decide on the computer.",
    },
    {
      icon: "👔",
      badge: "New",
      title: "A CEO for your workspace",
      desc: "Open a workspace's menu, choose Team and CEO. The CEO hands out work, collects results and reports to you. It decides approvals only if you allow it.",
    },
    {
      icon: "🌐",
      badge: "Browser",
      title: "Each coworker has its own browser",
      desc: "Sign-ins and pages stay with one coworker, and posting stops if the signed-in account is not the one you approved. Sites like WhatsApp Web may ask you to sign in once more.",
    },
    {
      icon: "🗑️",
      badge: "Fix",
      title: "Delete a workspace, and a steady approval screen",
      desc: "Workspaces can now be deleted safely, and approval cards no longer flicker or lose the note you are typing.",
    },
    {
      icon: "⚡",
      badge: "Faster",
      title: "Lighter, with fewer freezes",
      desc: "Unused pages sleep to free memory and wake when opened, still signed in. AI servers nobody is using stop too, and start again when needed.",
    },
  ],
  "0.7.3": [
    {
      icon: "✨",
      badge: "Look",
      title: "A proper opening",
      desc: "A short 3D reveal of the Sahkarmi mark when the app starts, and the chat answers the instant you press send.",
    },
    {
      icon: "🔓",
      badge: "Browser",
      title: "Google sign-in works in the coworker browser",
      desc: "One plain Chromium identity on every site and real sign-in popups: Google, Microsoft, Canva and other logins go through.",
    },
    {
      icon: "🖼️",
      badge: "Chat",
      title: "Coworker-made files show in the chat",
      desc: "Images, PDFs and documents a coworker creates appear under its reply, pictures inline.",
    },
    {
      icon: "📎",
      badge: "Chat",
      title: "Attached documents are read, not just named",
      desc: "PDF, Word, Excel, PowerPoint and text attachments are read into the conversation for every model; pictures go in as images where the model can see them.",
    },
  ],
  "0.7.2": [
    {
      icon: "🆓",
      badge: "New",
      title: "The free model rotates",
      desc: "OpenCode's free models each have a usage limit. When one stops answering, Sahkarmi skips it for an hour and sends your message again on the next free model by itself.",
    },
    {
      icon: "🩹",
      badge: "Fix",
      title: "First message no longer gets interrupted",
      desc: "Re-checking a signed-out Claude or ChatGPT used to mark another coworker's running turn as interrupted and leave it stuck. Fixed.",
    },
    {
      icon: "⏱️",
      badge: "Fix",
      title: "No more waiting for ever",
      desc: 'A coworker whose AI says nothing for 60 seconds now stops with a readable reason instead of showing "working" indefinitely.',
    },
  ],
  "0.7.1": [
    {
      icon: "🔍",
      badge: "New",
      title: "Search everything (Ctrl+K)",
      desc: "Find a coworker or any message in the workspace and jump straight to it. Ctrl+1–9 opens a coworker, Ctrl+N makes one, Ctrl+, opens Settings.",
    },
    {
      icon: "🛟",
      badge: "New",
      title: "Backup model",
      desc: "If a paid AI answers nothing or hits its quota, the coworker moves to the free model, tells you why, and sends your message again there.",
    },
    {
      icon: "↩️",
      badge: "New",
      title: "Undo delete, Send again",
      desc: "Deleting a coworker can be undone for 8 seconds, and a failed or stopped message has a Send again button.",
    },
    {
      icon: "🖥️",
      badge: "New",
      title: "Your size, your keys",
      desc: "Settings → General: Compact, Normal or Large interface; Enter or Ctrl+Enter to send. The window also opens where you left it.",
    },
    {
      icon: "⚡",
      badge: "Faster",
      title: "Ready before Google's agent",
      desc: "You can start working as soon as the quick providers are up; Antigravity finishes starting in the background.",
    },
  ],
  "0.6.3": [
    {
      icon: "🧭",
      badge: "Fix",
      title: "Honest provider status",
      desc: 'A provider that could not start says so (with the reason) instead of "Sign-in needed", and Update now is only offered for tools Sahkarmi can actually see.',
    },
  ],
  "0.6.2": [
    {
      icon: "🛠️",
      badge: "Fix",
      title: "Your AI tools are left alone",
      desc: "Sahkarmi no longer re-installs Claude Code or Codex in the background (that loop was breaking both). Only the built-in free runtime updates itself; Update now is still there for your own tools.",
    },
    {
      icon: "⏱️",
      badge: "Fix",
      title: "OpenCode no longer shows Not installed",
      desc: "A slow disk made the version check time out. It now waits long enough.",
    },
  ],
  "0.6.1": [
    {
      icon: "⏹️",
      badge: "Coworkers",
      title: "Stop really stops",
      desc: "Stopping a coworker no longer lets the old answer leak into the next one, and your next message starts straight away instead of waiting behind a paused queue.",
    },
    {
      icon: "🔄",
      badge: "Updates",
      title: "AI tool updates work on Windows",
      desc: "OpenCode and Codex updates no longer fail with a tar error when Git is installed.",
    },
    {
      icon: "🅖",
      badge: "Google Antigravity",
      title: "Clear message when Google's quota is over",
      desc: "Instead of a silent blank reply, the chat tells you the quota is used up and when it resets, so you can switch that coworker to the free model.",
    },
  ],
  "0.6.0": [
    {
      icon: "🅖",
      badge: "Google Antigravity",
      title: "One-click Google sign-in",
      desc: "Connect downloads Google's own Antigravity agent and opens the Google sign-in page in your browser, the same way Claude and Codex connect. No terminal window.",
    },
    {
      icon: "🔑",
      badge: "Google Antigravity",
      title: "API key also works",
      desc: "Paste a Google AI Studio key in Settings if you prefer not to sign in.",
    },
    {
      icon: "🧹",
      badge: "Removed",
      title: "Gemini CLI retired",
      desc: "Google moved individual use to Antigravity. Coworkers that used a Gemini model now use the free model; switch them to Google Antigravity when you are signed in.",
    },
  ],
};

export function WhatsNewDialog(props: {
  version: string;
  forceOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpen] = createSignal(false);
  const storageKey = "sahkarmi_seen_release";

  onMount(() => {
    if (props.forceOpen) {
      setOpen(true);
      return;
    }
    const seen = localStorage.getItem(storageKey);
    if (seen !== props.version && RELEASE_FEATURES[props.version]) {
      setOpen(true);
    }
  });

  const dismiss = () => {
    localStorage.setItem(storageKey, props.version);
    setOpen(false);
    props.onClose?.();
  };

  return (
    <Show when={open()}>
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
        <div class="bg-[#181B26] border border-[#2D3142] text-white rounded-2xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header decorative glow */}
          <div class="absolute -top-12 -right-12 w-36 h-36 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />

          <div class="flex items-center justify-between pb-4 border-b border-[#2D3142]">
            <div class="flex items-center gap-2.5">
              <span class="text-2xl">🎉</span>
              <div>
                <h3 class="font-bold text-lg text-white leading-tight">{t("whatsNewTitle")}</h3>
                <span class="text-xs text-amber-400 font-medium">
                  v{props.version} · Latest Update
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              class="text-gray-400 hover:text-white p-1 rounded-lg transition-colors"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div class="py-4 space-y-3 overflow-y-auto pr-1 flex-1">
            {(RELEASE_FEATURES[props.version] ?? []).map((item) => (
              <div class="bg-[#1F2333] border border-[#2B3044] rounded-xl p-3 flex gap-3 items-start hover:border-amber-500/40 transition-colors">
                <span class="text-xl p-1.5 bg-[#181B26] rounded-lg border border-[#2B3044] flex-shrink-0">
                  {item.icon}
                </span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h4 class="text-sm font-semibold text-gray-100">{item.title}</h4>
                    <span class="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {item.badge}
                    </span>
                  </div>
                  <p class="text-xs text-gray-300 mt-1 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div class="pt-3 border-t border-[#2D3142] flex justify-end">
            <button
              type="button"
              onClick={dismiss}
              class="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold text-sm transition-all shadow-lg shadow-amber-500/20 cursor-pointer"
            >
              {t("whatsNewDismiss")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
