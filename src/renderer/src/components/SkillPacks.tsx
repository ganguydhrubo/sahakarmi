import { createMemo, createSignal, For, Show } from "solid-js";
import type { CustomSkill, McpRecommendation } from "../../../shared/ipc";
import {
  packSkillTitle,
  parsePackSource,
  SKILL_PACKS,
  type SkillPack,
  skillPackById,
} from "../../../shared/skill-packs";
import { type MessageKey, t } from "../i18n";

/** The pack's title in the app language (its English one if a translation is missing). */
export function packTitle(pack: SkillPack): string {
  return t(`pack.${pack.id}.title` as MessageKey) || pack.title;
}

function packSummary(pack: SkillPack): string {
  return t(`pack.${pack.id}.summary` as MessageKey) || pack.summary;
}

/** Shown under an installed skill instead of where it was downloaded from. */
export function packOfSkill(skill: CustomSkill): SkillPack | undefined {
  const fromSource = parsePackSource(skill.source)?.packId;
  return skillPackById(skill.pack ?? fromSource ?? "");
}

interface SkillPacksProps {
  skills: CustomSkill[];
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<unknown>;
  onSkills: (skills: CustomSkill[]) => void;
}

/** Settings > Skills > Skill packs: one click per pack or per skill, at the pinned version. */
export function SkillPacks(props: SkillPacksProps) {
  const [open, setOpen] = createSignal<string | null>(null);
  const [installing, setInstalling] = createSignal<string | null>(null);

  const installed = createMemo(() => {
    const byPack = new Map<string, Set<string>>();
    for (const skill of props.skills) {
      const parsed = parsePackSource(skill.source);
      if (!parsed) continue;
      const set = byPack.get(parsed.packId) ?? new Set<string>();
      set.add(parsed.skill);
      byPack.set(parsed.packId, set);
    }
    return byPack;
  });

  function install(pack: SkillPack, skills?: string[]) {
    const install = window.sahkarmi.customSkills.installPack;
    if (!install) return;
    setInstalling(skills?.length === 1 ? `${pack.id}/${skills[0]}` : pack.id);
    void props
      .run(async () => props.onSkills(await install(pack.id, skills)))
      .finally(() => setInstalling(null));
  }

  return (
    <section class="skill-packs" aria-labelledby="skill-packs-heading">
      <h3 id="skill-packs-heading">{t("packsHeading")}</h3>
      <p class="settings-meta">{t("packsIntro")}</p>
      <ul class="extension-list skill-pack-list">
        <For each={SKILL_PACKS}>
          {(pack) => {
            const have = () => installed().get(pack.id) ?? new Set<string>();
            const missing = () => pack.skills.filter((skill) => !have().has(skill));
            return (
              <li class="extension-item skill-pack">
                <span class="extension-item-text">
                  <strong>{packTitle(pack)}</strong>
                  <Show when={pack.notice === "legal"}>
                    <span class="extension-badge extension-badge-warn" role="note">
                      {t("packsNotLegalAdvice")}
                    </span>
                  </Show>
                  <small>{packSummary(pack)}</small>
                  <small class="extension-source">
                    <Show
                      when={have().size > 0}
                      fallback={t("packsSkills", { count: String(pack.skills.length) })}
                    >
                      {t("packsInstalledCount", {
                        installed: String(have().size),
                        count: String(pack.skills.length),
                      })}
                    </Show>
                  </small>
                  <Show when={installing() === pack.id}>
                    <small role="status">{t("packsInstalling")}</small>
                  </Show>
                  <Show when={open() === pack.id}>
                    <ul class="skill-pack-skills">
                      <For each={pack.skills}>
                        {(skill) => (
                          <li>
                            <span>{packSkillTitle(pack, skill)}</span>
                            <Show
                              when={!have().has(skill)}
                              fallback={
                                <span class="extension-badge">{t("skillsInstalledBadge")}</span>
                              }
                            >
                              <button
                                type="button"
                                disabled={props.busy}
                                onClick={() => install(pack, [skill])}
                              >
                                {installing() === `${pack.id}/${skill}`
                                  ? t("packsInstalling")
                                  : t("packsInstallSkill")}
                              </button>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </span>
                <button
                  type="button"
                  aria-expanded={open() === pack.id}
                  onClick={() => setOpen(open() === pack.id ? null : pack.id)}
                >
                  {open() === pack.id ? t("packsHideSkills") : t("packsShowSkills")}
                </button>
                <Show
                  when={missing().length > 0}
                  fallback={<span class="extension-badge">{t("skillsInstalledBadge")}</span>}
                >
                  <button
                    type="button"
                    disabled={props.busy}
                    onClick={() => install(pack, have().size > 0 ? missing() : undefined)}
                  >
                    {have().size > 0 ? t("packsInstallRest") : t("packsInstall")}
                  </button>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
      <p class="settings-meta">{t("packsCreditsNote")}</p>
    </section>
  );
}

/** What the confirm card adds: the same JSON shape the MCP import already understands. */
export function recommendationJson(rec: McpRecommendation): string {
  const server =
    rec.transport === "http"
      ? { type: "http", url: rec.url }
      : { command: rec.command, args: rec.args ?? [] };
  return JSON.stringify({ mcpServers: { [rec.name]: server } }, null, 2);
}

function shownAddress(rec: McpRecommendation): string {
  if (rec.transport === "stdio") return [rec.command, ...(rec.args ?? [])].join(" ");
  try {
    return new URL(rec.url ?? "").host;
  } catch {
    return rec.url ?? "";
  }
}

/**
 * MCP servers that installed skills' plugins suggest. Recommendations only: Connect shows what
 * would be added and adds it only when the owner confirms, through the normal MCP import (new
 * servers are saved switched off until tested). Never connects on its own.
 */
export function McpRecommendations(props: { skills: CustomSkill[] }) {
  const [confirming, setConfirming] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const recommendations = createMemo(() => {
    const seen = new Map<string, McpRecommendation>();
    for (const skill of props.skills) {
      for (const rec of skill.mcpRecommendations ?? []) {
        if (!seen.has(rec.name)) seen.set(rec.name, rec);
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  async function add(rec: McpRecommendation) {
    setBusy(true);
    setError(null);
    try {
      const result = await window.sahkarmi.mcp.importJson(recommendationJson(rec));
      setConfirming(null);
      setNotice(
        result.added.length > 0
          ? t("mcpRecsAdded", { name: rec.name })
          : result.skipped.join("; ") || result.conflicts.join(", ") || null,
      );
    } catch (cause) {
      setError(
        (cause instanceof Error ? cause.message : String(cause)).replace(
          /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={recommendations().length > 0}>
      <section class="skill-mcp-recs" aria-labelledby="skill-mcp-recs-heading">
        <h3 id="skill-mcp-recs-heading">{t("mcpRecsHeading")}</h3>
        <p class="settings-meta">{t("mcpRecsIntro")}</p>
        <Show when={notice()}>
          <p class="settings-meta" role="status">
            {notice()}
          </p>
        </Show>
        <Show when={error()}>
          <p class="center-view-error" role="alert">
            {error()}
          </p>
        </Show>
        <ul class="extension-list">
          <For each={recommendations()}>
            {(rec) => (
              <li class="extension-item">
                <span class="extension-item-text">
                  <strong>{rec.name}</strong>
                  <small class="extension-source">{shownAddress(rec)}</small>
                  <Show when={rec.envKeys.length + rec.headerKeys.length > 0}>
                    <small>
                      {t("mcpRecsNeeds", { names: [...rec.envKeys, ...rec.headerKeys].join(", ") })}
                    </small>
                  </Show>
                  <Show when={confirming() === rec.name}>
                    <div class="extension-preview">
                      <p>{t("mcpRecsConfirm", { name: rec.name })}</p>
                      <pre class="skill-mcp-json">{recommendationJson(rec)}</pre>
                      <div class="settings-buttons">
                        <button type="button" disabled={busy()} onClick={() => void add(rec)}>
                          {t("mcpRecsAdd")}
                        </button>
                        <button type="button" onClick={() => setConfirming(null)}>
                          {t("mcpRecsCancel")}
                        </button>
                      </div>
                    </div>
                  </Show>
                </span>
                <Show when={confirming() !== rec.name}>
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() => {
                      setNotice(null);
                      setConfirming(rec.name);
                    }}
                  >
                    {t("mcpRecsConnect")}
                  </button>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
