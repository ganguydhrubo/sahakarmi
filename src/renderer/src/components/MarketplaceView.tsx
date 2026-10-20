import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import {
  MARKETPLACE_AGENTS,
  MARKETPLACE_SKILLS,
  type MarketplaceAgent,
  type SkillIcon,
} from "../../../shared/marketplace";
import type { BotProfile } from "../data";
import { t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";

type Tab = "agents" | "skills";

/**
 * Sahkarmi's own catalog of ready-made coworkers and skills. Adding an agent creates a real
 * coworker; installing a skill writes a playbook to Shared/Skills that coworkers follow.
 */
export function MarketplaceView(props: {
  bots: BotProfile[];
  onAddAgent: (agent: MarketplaceAgent) => Promise<void>;
  onOpenCoworker: (botId: string) => void;
}) {
  const [tab, setTab] = createSignal<Tab>("agents");
  const [query, setQuery] = createSignal("");
  const [installed, setInstalled] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    void window.sahkarmi.marketplace
      .installedSkills()
      .then(setInstalled)
      .catch(() => undefined);
  });

  const matches = (text: string) => text.toLowerCase().includes(query().trim().toLowerCase());
  const agents = createMemo(() =>
    MARKETPLACE_AGENTS.filter((agent) => matches(`${agent.name} ${agent.role} ${agent.summary}`)),
  );
  const skills = createMemo(() =>
    MARKETPLACE_SKILLS.filter((skill) => matches(`${skill.name} ${skill.summary}`)),
  );
  const existing = (agent: MarketplaceAgent) =>
    props.bots.find((bot) => bot.name === agent.name && bot.role === agent.role);

  async function run(id: string, action: () => Promise<void>) {
    if (busy()) return;
    setBusy(id);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section class="center-view marketplace-view" aria-labelledby="marketplace-heading">
      <header class="center-view-header window-drag">
        <h1 id="marketplace-heading">{t("navMarketplace")}</h1>
      </header>
      <div class="center-view-body">
        <div class="marketplace-toolbar">
          <div class="marketplace-tabs" role="tablist" aria-label={t("navMarketplace")}>
            <button
              type="button"
              role="tab"
              aria-selected={tab() === "agents"}
              classList={{ "marketplace-tab-active": tab() === "agents" }}
              onClick={() => setTab("agents")}
            >
              {t("marketAgents")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab() === "skills"}
              classList={{ "marketplace-tab-active": tab() === "skills" }}
              onClick={() => setTab("skills")}
            >
              {t("marketSkills")}
            </button>
          </div>
          <input
            type="search"
            class="marketplace-search"
            placeholder={t("marketSearch")}
            aria-label={t("marketSearch")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
        <p class="center-view-intro">
          {tab() === "agents" ? t("marketAgentsIntro") : t("marketSkillsIntro")}
        </p>
        <Show when={error()}>
          <p class="center-view-error" role="alert">
            {error()}
          </p>
        </Show>

        <Show when={tab() === "agents"}>
          <Show
            when={agents().length > 0}
            fallback={<p class="center-view-empty">{t("noMatches")}</p>}
          >
            <ul class="marketplace-grid">
              <For each={agents()}>
                {(agent) => (
                  <li class="marketplace-card">
                    <div class="marketplace-card-head">
                      <AgentAvatar
                        bot={undefined}
                        shape={agent.avatarShape}
                        color={agent.avatarColor}
                        class="marketplace-avatar"
                      />
                      <div class="marketplace-card-title">
                        <h3>{agent.name}</h3>
                        <small>{agent.role}</small>
                      </div>
                      <Show
                        when={existing(agent)}
                        fallback={
                          <button
                            type="button"
                            class="marketplace-action"
                            disabled={busy() !== null}
                            onClick={() => void run(agent.id, () => props.onAddAgent(agent))}
                          >
                            {busy() === agent.id ? t("marketAdding") : `+ ${t("marketAdd")}`}
                          </button>
                        }
                      >
                        {(bot) => (
                          <button
                            type="button"
                            class="marketplace-action marketplace-action-done"
                            onClick={() => props.onOpenCoworker(bot().id)}
                          >
                            {t("marketOpen")}
                          </button>
                        )}
                      </Show>
                    </div>
                    <p>{agent.summary}</p>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>

        <Show when={tab() === "skills"}>
          <Show
            when={skills().length > 0}
            fallback={<p class="center-view-empty">{t("noMatches")}</p>}
          >
            <ul class="marketplace-grid">
              <For each={skills()}>
                {(skill) => {
                  const isInstalled = () => installed().includes(skill.id);
                  return (
                    <li class="marketplace-card">
                      <div class="marketplace-card-head">
                        <span class={`marketplace-skill-icon marketplace-skill-${skill.icon}`}>
                          <SkillGlyph icon={skill.icon} />
                        </span>
                        <div class="marketplace-card-title">
                          <h3>{skill.name}</h3>
                          <Show when={isInstalled()}>
                            <small>{t("marketInstalled")}</small>
                          </Show>
                        </div>
                        <button
                          type="button"
                          class="marketplace-action"
                          classList={{ "marketplace-action-done": isInstalled() }}
                          disabled={busy() !== null}
                          aria-label={`${isInstalled() ? t("marketRemove") : t("marketInstall")} ${skill.name}`}
                          onClick={() =>
                            void run(skill.id, async () => {
                              setInstalled(
                                isInstalled()
                                  ? await window.sahkarmi.marketplace.uninstallSkill(skill.id)
                                  : await window.sahkarmi.marketplace.installSkill(skill.id),
                              );
                            })
                          }
                        >
                          {isInstalled() ? t("marketRemove") : t("marketInstall")}
                        </button>
                      </div>
                      <p>{skill.summary}</p>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </Show>
      </div>
    </section>
  );
}

function SkillGlyph(props: { icon: SkillIcon }) {
  const paths: Record<SkillIcon, string> = {
    plan: "M5 5h10M5 10h10M5 15h6",
    search: "M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm3.9 9.4L17 17",
    check: "M4 10.5 8 14.5 16 6",
    chart: "M4 16V9M10 16V4M16 16v-5",
    chat: "M4 5h12v8H9l-4 3v-3H4Z",
    bolt: "M11 2 4 11h5l-1 7 7-9h-5l1-7Z",
    code: "M7 6 3 10l4 4M13 6l4 4-4 4",
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d={paths[props.icon]} />
    </svg>
  );
}
