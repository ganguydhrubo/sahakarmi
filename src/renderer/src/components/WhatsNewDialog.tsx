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
  "0.7.0": [
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
