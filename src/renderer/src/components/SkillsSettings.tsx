import { createSignal, For, onMount, Show } from "solid-js";
import type { CustomSkill, GithubSkillPreview } from "../../../shared/ipc";
import { t } from "../i18n";

/** Public repos of Claude-format skills, offered as a starting point. */
const SUGGESTED_REPOS = ["https://github.com/anthropics/skills"];

export function SkillsSettings() {
  const [skills, setSkills] = createSignal<CustomSkill[]>([]);
  const [url, setUrl] = createSignal("");
  const [preview, setPreview] = createSignal<GithubSkillPreview | null>(null);
  const [picked, setPicked] = createSignal<string[]>([]);
  const [pasted, setPasted] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  onMount(() => void run(async () => setSkills(await window.sahkarmi.customSkills.list())));

  async function find(link: string) {
    setUrl(link);
    setPreview(null);
    setPicked([]);
    const found = await run(() => window.sahkarmi.customSkills.previewGithub(link));
    if (found) setPreview(found);
  }

  function toggle(path: string) {
    setPicked((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  return (
    <div class="extension-settings">
      <p class="settings-meta">{t("skillsIntro")}</p>

      <label class="extension-field">
        <span>{t("skillsGithubLabel")}</span>
        <div class="extension-row">
          <input
            type="url"
            placeholder="https://github.com/owner/repo"
            value={url()}
            onInput={(event) => setUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && url().trim()) void find(url().trim());
            }}
          />
          <button
            type="button"
            disabled={busy() || !url().trim()}
            onClick={() => void find(url().trim())}
          >
            {t("skillsFind")}
          </button>
        </div>
      </label>
      <p class="settings-meta">
        {t("skillsSuggested")}{" "}
        <For each={SUGGESTED_REPOS}>
          {(repo) => (
            <button type="button" class="extension-link" onClick={() => void find(repo)}>
              {repo.replace("https://github.com/", "")}
            </button>
          )}
        </For>
      </p>

      <Show when={preview()}>
        {(found) => (
          <div class="extension-preview">
            <p>
              <Show when={found().skills.length > 0} fallback={t("skillsNoneFound")}>
                {t("skillsFound", { count: String(found().skills.length), repo: found().repo })}
              </Show>
            </p>
            <Show when={found().truncated}>
              <p class="settings-meta">{t("skillsTruncated")}</p>
            </Show>
            <ul class="extension-list">
              <For each={found().skills}>
                {(skill) => (
                  <li>
                    <label class="extension-pick">
                      <input
                        type="checkbox"
                        disabled={skill.tooBig}
                        checked={picked().includes(skill.path)}
                        onChange={() => toggle(skill.path)}
                      />
                      <span class="extension-item-text">
                        <strong>{skill.name}</strong>
                        <Show when={skill.installed}>
                          <span class="extension-badge">{t("skillsInstalledBadge")}</span>
                        </Show>
                        <Show when={skill.tooBig}>
                          <span class="extension-badge extension-badge-warn">
                            {t("skillsTooBig")}
                          </span>
                        </Show>
                        <Show when={skill.description}>
                          <small>{skill.description}</small>
                        </Show>
                        <small class="extension-source">
                          {skill.path || "/"} · {t("skillsFiles", { count: String(skill.files) })}
                        </small>
                      </span>
                    </label>
                  </li>
                )}
              </For>
            </ul>
            <Show when={found().skills.length > 0}>
              <div class="settings-buttons">
                <button
                  type="button"
                  disabled={busy() || picked().length === 0}
                  onClick={() =>
                    void run(async () => {
                      setSkills(
                        await window.sahkarmi.customSkills.installGithub(found().url, picked()),
                      );
                      setPreview(null);
                      setPicked([]);
                    })
                  }
                >
                  {t("skillsInstall")}
                </button>
              </div>
            </Show>
          </div>
        )}
      </Show>

      <label class="extension-field">
        <span>{t("skillsPasteLabel")}</span>
        <textarea
          rows={5}
          spellcheck={false}
          placeholder={"---\nname: my-skill\ndescription: When to use it\n---\n\n1. ..."}
          value={pasted()}
          onInput={(event) => setPasted(event.currentTarget.value)}
        />
      </label>
      <div class="settings-buttons">
        <button
          type="button"
          disabled={busy() || !pasted().trim()}
          onClick={() =>
            void run(async () => {
              setSkills(await window.sahkarmi.customSkills.add(pasted()));
              setPasted("");
            })
          }
        >
          {t("skillsAdd")}
        </button>
      </div>

      <Show when={error()}>
        <p class="center-view-error" role="alert">
          {error()}
        </p>
      </Show>

      <h3>{t("skillsYours")}</h3>
      <Show when={skills().length > 0} fallback={<p class="settings-meta">{t("skillsNone")}</p>}>
        <ul class="extension-list">
          <For each={skills()}>
            {(skill) => (
              <li class="extension-item">
                <span class="extension-item-text">
                  <strong>{skill.name}</strong>
                  <Show when={skill.description}>
                    <small>{skill.description}</small>
                  </Show>
                  <small class="extension-source">{skill.source}</small>
                </span>
                <button
                  type="button"
                  disabled={busy()}
                  onClick={() =>
                    void run(async () =>
                      setSkills(await window.sahkarmi.customSkills.remove(skill.id)),
                    )
                  }
                >
                  {t("skillsRemove")}
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
      <p class="settings-meta">{t("skillsTrustNote")}</p>
    </div>
  );
}
