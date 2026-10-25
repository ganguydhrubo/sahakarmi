import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import {
  AGENT_CATEGORIES,
  type AgentCapability,
  type AgentCategory,
  agentBrief,
  agentSearchText,
  briefHash,
} from "../../../shared/agent-catalog";
import {
  MARKETPLACE_AGENTS,
  MARKETPLACE_SKILLS,
  type MarketplaceAgent,
  type SkillIcon,
} from "../../../shared/marketplace";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { AgentAvatar } from "./AgentAvatar";

type Tab = "agents" | "skills";
type Filter = "all" | "featured" | "added" | AgentCategory;

const PAGE_SIZE = 24;
const SECTION_SIZE = 6;

const CATEGORY_KEYS: Record<AgentCategory, MessageKey> = {
  finance: "categoryFinance",
  sales: "categorySales",
  marketing: "categoryMarketing",
  writing: "categoryWriting",
  research: "categoryResearch",
  hr: "categoryHr",
  operations: "categoryOperations",
  ecommerce: "categoryEcommerce",
  engineering: "categoryEngineering",
  design: "categoryDesign",
  web: "categoryWeb",
  legal: "categoryLegal",
  education: "categoryEducation",
  productivity: "categoryProductivity",
  industry: "categoryIndustry",
};

const CAPABILITY_KEYS: Record<AgentCapability, MessageKey> = {
  files: "capabilityFiles",
  documents: "capabilityDocuments",
  spreadsheets: "capabilitySpreadsheets",
  "web-research": "capabilityWebResearch",
  browser: "capabilityBrowser",
  code: "capabilityCode",
  delegation: "capabilityDelegation",
  schedule: "capabilitySchedule",
  images: "capabilityImages",
};

export const categoryLabel = (category: AgentCategory) => t(CATEGORY_KEYS[category]);

/** The coworker on the team that was added from this template, if any. */
export function coworkerForTemplate(
  bots: BotProfile[],
  agent: MarketplaceAgent,
): BotProfile | undefined {
  return (
    bots.find((bot) => bot.template?.id === agent.id) ??
    bots.find((bot) => !bot.template && bot.name === agent.name && bot.role === agent.role)
  );
}

/** A coworker made from an older template version (or before versions existed). */
export function templateUpdate(
  bot: BotProfile,
  agent: MarketplaceAgent,
): { available: boolean; customized: boolean } {
  if (!bot.template) {
    return { available: bot.description !== agentBrief(agent), customized: true };
  }
  return {
    available: bot.template.version < agent.version,
    customized: briefHash(bot.description) !== bot.template.briefHash,
  };
}

/**
 * Sahkarmi's catalog of ready-made coworkers and skills. Adding an agent creates a real
 * coworker with its full working brief; installing a skill writes a playbook to Shared/Skills.
 */
export function MarketplaceView(props: {
  bots: BotProfile[];
  onAddAgent: (agent: MarketplaceAgent) => Promise<void>;
  onUpdateAgent: (botId: string, agent: MarketplaceAgent) => Promise<void>;
  onOpenCoworker: (botId: string) => void;
  onConfigureCoworker: (botId: string) => void;
}) {
  const [tab, setTab] = createSignal<Tab>("agents");
  const [query, setQuery] = createSignal("");
  const [filter, setFilter] = createSignal<Filter>("all");
  const [limit, setLimit] = createSignal(PAGE_SIZE);
  const [detailId, setDetailId] = createSignal<string | null>(null);
  const [confirmId, setConfirmId] = createSignal<string | null>(null);
  const [installed, setInstalled] = createSignal<string[]>([]);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    void window.sahkarmi.marketplace
      .installedSkills()
      .then(setInstalled)
      .catch(() => undefined);
  });

  const terms = createMemo(() => query().trim().toLowerCase().split(/\s+/).filter(Boolean));
  const searchable = createMemo(
    () => new Map(MARKETPLACE_AGENTS.map((agent) => [agent.id, agentSearchText(agent)])),
  );
  const searching = () => terms().length > 0;

  const agents = createMemo(() => {
    const words = terms();
    const current = filter();
    return MARKETPLACE_AGENTS.filter((agent) => {
      if (current === "featured" && !agent.featured) return false;
      if (current === "added" && !coworkerForTemplate(props.bots, agent)) return false;
      if (current !== "all" && current !== "featured" && current !== "added") {
        if (agent.category !== current) return false;
      }
      const text = searchable().get(agent.id) ?? "";
      return words.every((word) => text.includes(word));
    });
  });
  const counts = createMemo(() => {
    const result = new Map<AgentCategory, number>();
    for (const agent of MARKETPLACE_AGENTS) {
      result.set(agent.category, (result.get(agent.category) ?? 0) + 1);
    }
    return result;
  });
  /** Browsing everything without a search: one short section per category. */
  const grouped = () => filter() === "all" && !searching();
  const skills = createMemo(() =>
    MARKETPLACE_SKILLS.filter((skill) => {
      const text = `${skill.name} ${skill.summary}`.toLowerCase();
      return terms().every((word) => text.includes(word));
    }),
  );
  const detail = createMemo(() => MARKETPLACE_AGENTS.find((agent) => agent.id === detailId()));

  function choose(next: Filter) {
    setFilter(next);
    setLimit(PAGE_SIZE);
  }

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

  function update(bot: BotProfile, agent: MarketplaceAgent) {
    if (templateUpdate(bot, agent).customized && confirmId() !== agent.id) {
      setConfirmId(agent.id);
      return;
    }
    setConfirmId(null);
    void run(agent.id, () => props.onUpdateAgent(bot.id, agent));
  }

  function AgentActions(actionProps: { agent: MarketplaceAgent }) {
    const agent = actionProps.agent;
    const bot = () => coworkerForTemplate(props.bots, agent);
    return (
      <div class="marketplace-actions">
        <button
          type="button"
          class="marketplace-action marketplace-action-quiet"
          aria-label={`${t("marketDetails")}: ${agent.name}`}
          onClick={() => setDetailId(agent.id)}
        >
          {t("marketDetails")}
        </button>
        <Show
          when={bot()}
          fallback={
            <button
              type="button"
              class="marketplace-action marketplace-action-primary"
              disabled={busy() !== null}
              aria-label={`${t("marketAdd")} ${agent.name}`}
              onClick={() => void run(agent.id, () => props.onAddAgent(agent))}
            >
              {busy() === agent.id ? t("marketAdding") : `+ ${t("marketAdd")}`}
            </button>
          }
        >
          {(added) => (
            <>
              <Show when={templateUpdate(added(), agent).available}>
                <button
                  type="button"
                  class="marketplace-action"
                  disabled={busy() !== null}
                  title={t("marketUpdateAvailable")}
                  onClick={() => update(added(), agent)}
                >
                  {busy() === agent.id ? t("marketUpdating") : t("marketUpdate")}
                </button>
              </Show>
              <button
                type="button"
                class="marketplace-action marketplace-action-done"
                aria-label={`${t("marketOpen")} ${agent.name}`}
                onClick={() => props.onOpenCoworker(added().id)}
              >
                {t("marketOpen")}
              </button>
            </>
          )}
        </Show>
      </div>
    );
  }

  function AgentCard(cardProps: { agent: MarketplaceAgent }) {
    const agent = cardProps.agent;
    return (
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
            <small>{categoryLabel(agent.category)}</small>
          </div>
          <Show when={agent.availability === "needs-setup"}>
            <span class="marketplace-badge marketplace-badge-setup">{t("marketNeedsSetup")}</span>
          </Show>
        </div>
        <p>{agent.summary}</p>
        <ul class="marketplace-tags" aria-label={t("marketTools")}>
          <For each={agent.capabilities.slice(0, 4)}>
            {(capability) => <li>{t(CAPABILITY_KEYS[capability])}</li>}
          </For>
        </ul>
        <Show when={confirmId() === agent.id}>
          <div class="marketplace-confirm" role="alert">
            <span>{t("marketUpdateCustomized")}</span>
            <div class="marketplace-actions">
              <button type="button" class="marketplace-action" onClick={() => setConfirmId(null)}>
                {t("cancel")}
              </button>
              <button
                type="button"
                class="marketplace-action marketplace-action-primary"
                onClick={() => {
                  const bot = coworkerForTemplate(props.bots, agent);
                  if (bot) update(bot, agent);
                }}
              >
                {t("marketUpdate")}
              </button>
            </div>
          </div>
        </Show>
        <AgentActions agent={agent} />
      </li>
    );
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
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setLimit(PAGE_SIZE);
            }}
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
          <div class="marketplace-filters" role="toolbar" aria-label={t("marketCovers")}>
            <For each={["all", "featured", "added"] as const}>
              {(option) => (
                <button
                  type="button"
                  class="marketplace-filter"
                  aria-pressed={filter() === option}
                  onClick={() => choose(option)}
                >
                  {option === "all"
                    ? t("marketAll")
                    : option === "featured"
                      ? t("marketFeatured")
                      : t("marketAddedFilter")}
                </button>
              )}
            </For>
            <For each={AGENT_CATEGORIES.filter((category) => counts().has(category))}>
              {(category) => (
                <button
                  type="button"
                  class="marketplace-filter"
                  aria-pressed={filter() === category}
                  onClick={() => choose(category)}
                >
                  {categoryLabel(category)}
                  <span class="marketplace-filter-count">{counts().get(category)}</span>
                </button>
              )}
            </For>
          </div>

          <Show
            when={agents().length > 0}
            fallback={
              <p class="center-view-empty">
                {searching()
                  ? t("marketNoResults", { query: query().trim() })
                  : filter() === "added"
                    ? t("marketNoneAdded")
                    : t("noMatches")}
              </p>
            }
          >
            <Show
              when={grouped()}
              fallback={
                <>
                  <p class="marketplace-count">
                    {t("marketCount", { count: String(agents().length) })}
                  </p>
                  <ul class="marketplace-grid">
                    <For each={agents().slice(0, limit())}>
                      {(agent) => <AgentCard agent={agent} />}
                    </For>
                  </ul>
                  <Show when={agents().length > limit()}>
                    <button
                      type="button"
                      class="marketplace-more"
                      onClick={() => setLimit((current) => current + PAGE_SIZE)}
                    >
                      {t("marketShowMore")}
                    </button>
                  </Show>
                </>
              }
            >
              <For each={AGENT_CATEGORIES.filter((category) => counts().has(category))}>
                {(category) => {
                  const members = () => agents().filter((agent) => agent.category === category);
                  return (
                    <section class="marketplace-section" aria-label={categoryLabel(category)}>
                      <header class="marketplace-section-head">
                        <h2>{categoryLabel(category)}</h2>
                        <Show when={members().length > SECTION_SIZE}>
                          <button
                            type="button"
                            class="marketplace-link"
                            onClick={() => choose(category)}
                          >
                            {t("marketShowAll", { count: String(members().length) })}
                          </button>
                        </Show>
                      </header>
                      <ul class="marketplace-grid">
                        <For each={members().slice(0, SECTION_SIZE)}>
                          {(agent) => <AgentCard agent={agent} />}
                        </For>
                      </ul>
                    </section>
                  );
                }}
              </For>
            </Show>
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

      <Show when={detail()}>
        {(agent) => (
          // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: clicking the dimmed backdrop closes the dialog; Escape and the Close button do the same from the keyboard
          <div class="marketplace-detail-backdrop" onClick={() => setDetailId(null)}>
            <div
              class="marketplace-detail"
              role="dialog"
              aria-modal="true"
              aria-labelledby="marketplace-detail-title"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") setDetailId(null);
              }}
            >
              <header class="marketplace-card-head">
                <AgentAvatar
                  bot={undefined}
                  shape={agent().avatarShape}
                  color={agent().avatarColor}
                  class="marketplace-avatar"
                />
                <div class="marketplace-card-title">
                  <h2 id="marketplace-detail-title">{agent().name}</h2>
                  <small>
                    {categoryLabel(agent().category)} ·{" "}
                    {agent().availability === "ready" ? t("marketReady") : t("marketNeedsSetup")}
                  </small>
                </div>
                <button
                  type="button"
                  class="marketplace-action marketplace-action-quiet"
                  ref={(element) => queueMicrotask(() => element.focus())}
                  onClick={() => setDetailId(null)}
                >
                  {t("marketClose")}
                </button>
              </header>
              <p>{agent().summary}</p>
              <dl class="marketplace-facts">
                <dt>{t("marketCovers")}</dt>
                <dd>{agent().jobFunctions.join(", ")}</dd>
                <dt>{t("marketNeeds")}</dt>
                <dd>
                  {agent().requiredInputs.join("; ")}
                  <Show when={agent().optionalInputs.length > 0}>
                    <span class="marketplace-muted">
                      {" "}
                      ({t("marketHelpful")}: {agent().optionalInputs.join("; ")})
                    </span>
                  </Show>
                </dd>
                <dt>{t("marketHowItWorks")}</dt>
                <dd>
                  <ol>
                    <For each={agent().workflow}>{(step) => <li>{step}</li>}</For>
                  </ol>
                </dd>
                <dt>{t("marketDelivers")}</dt>
                <dd>{agent().outputs.join("; ")}</dd>
                <dt>{t("marketChecks")}</dt>
                <dd>{agent().validation.join("; ")}</dd>
                <Show when={agent().approvals.length > 0}>
                  <dt>{t("marketAsksFirst")}</dt>
                  <dd>{agent().approvals.join("; ")}</dd>
                </Show>
                <Show when={agent().integrations.length > 0}>
                  <dt>{t("marketServices")}</dt>
                  <dd>
                    {agent()
                      .integrations.map(
                        (service) =>
                          `${service.name} (${
                            service.via === "browser"
                              ? t("marketServiceBrowser")
                              : service.via === "files"
                                ? t("marketServiceFiles")
                                : t("marketServiceSetup")
                          })`,
                      )
                      .join("; ")}
                  </dd>
                </Show>
                <dt>{t("marketTools")}</dt>
                <dd>
                  {agent()
                    .capabilities.map((capability) => t(CAPABILITY_KEYS[capability]))
                    .join(", ")}
                </dd>
                <dt>{t("marketDoneWhen")}</dt>
                <dd>{agent().completion}</dd>
                <Show when={agent().limits}>
                  <dt>{t("marketLimits")}</dt>
                  <dd>{agent().limits}</dd>
                </Show>
              </dl>
              <footer class="marketplace-detail-actions">
                <Show when={coworkerForTemplate(props.bots, agent())}>
                  {(bot) => (
                    <button
                      type="button"
                      class="marketplace-action"
                      onClick={() => {
                        setDetailId(null);
                        props.onConfigureCoworker(bot().id);
                      }}
                    >
                      {t("marketConfigure")}
                    </button>
                  )}
                </Show>
                <AgentActions agent={agent()} />
              </footer>
            </div>
          </div>
        )}
      </Show>
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
