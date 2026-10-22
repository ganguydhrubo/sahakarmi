import { createSignal, onMount, Show } from "solid-js";
import { t } from "../i18n";

export interface WhatsNewFeature {
  title: string;
  badge: string;
  desc: string;
  icon: string;
}

const RELEASE_FEATURES: WhatsNewFeature[] = [
  {
    icon: "⚡",
    badge: "Engine",
    title: "Adaptive Multi-Agent DAG",
    desc: "Single-agent fast path routing for small requests and full dynamic specialist teams for complex projects with live graph visualizer.",
  },
  {
    icon: "👥",
    badge: "Coworkers",
    title: "Autonomous Dev Team Assembly",
    desc: "AI Coworkers can now autonomously assemble and configure specialist coworkers (Frontend, Backend, QA, DevOps) on user request.",
  },
  {
    icon: "🧠",
    badge: "Memory",
    title: "Persistent Coworker Memory ('Smriti')",
    desc: "Coworkers now recall key project decisions, architectural standards, and user preferences across conversation threads.",
  },
  {
    icon: "🛰️",
    badge: "Platform",
    title: "Automated Upstream Radar",
    desc: "Continuous tracking of upstream OpenBot & OpenBots innovations cleanly implemented natively for Sahkarmi.",
  },
  {
    icon: "🏎️",
    badge: "Performance",
    title: "Zero-Lag Idle CPU Polish",
    desc: "Background polling and UI loops optimized for ultra-smooth responsiveness and lightweight memory footprint.",
  },
];

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
    if (!seen || seen !== props.version) {
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
            {RELEASE_FEATURES.map((item) => (
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
