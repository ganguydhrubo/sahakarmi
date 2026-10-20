import { For, Show } from "solid-js";
import {
  type AgentModelId,
  type AgentModelOption,
  type AgentStatus,
  PROVIDER_LABELS,
  providerForModel,
} from "../../../shared/ipc";
import type { BotProfile } from "../data";
import { type MessageKey, t } from "../i18n";
import { profileForRole, suggestModels, type TaskProfile } from "../model-profiles";

const PROFILE_KEYS: Record<TaskProfile, MessageKey> = {
  quick: "profileQuick",
  analysis: "profileAnalysis",
  writing: "profileWriting",
  general: "profileGeneral",
};

/** Suggestion-only model routing per task profile. Applying is always an explicit click. */
export function ModelSuggestions(props: {
  bots: BotProfile[];
  agentStatus: AgentStatus;
  modelOptions: AgentModelOption[];
  onApply: (botId: string, model: AgentModelId) => Promise<void>;
}) {
  const available = () =>
    (props.agentStatus.providers ?? []).filter((p) => p.state === "available").map((p) => p.id);
  const name = (model: AgentModelId) =>
    props.modelOptions.find((option) => option.id === model)?.name ??
    model.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return (
    <div class="model-suggestions">
      <p class="settings-meta">{t("suggestIntro")}</p>
      <ul>
        <For each={props.bots}>
          {(bot) => {
            const profile = () => profileForRole(bot.role);
            const result = () => suggestModels(profile(), bot.model, available());
            return (
              <li class="suggestion-row">
                <div>
                  <strong>{bot.name}</strong>{" "}
                  <span class="settings-meta">· {t(PROFILE_KEYS[profile()])}</span>
                  <p class="settings-meta">
                    {t("suggestNow", {
                      model: name(bot.model),
                      provider: PROVIDER_LABELS[providerForModel(bot.model)],
                    })}
                  </p>
                </div>
                <div class="suggestion-actions">
                  <Show
                    when={result().sameCost || result().paidAlternative}
                    fallback={<span class="settings-meta">{t("suggestKeep")}</span>}
                  >
                    <Show when={result().sameCost}>
                      {(suggestion) => (
                        <button
                          type="button"
                          onClick={() => void props.onApply(bot.id, suggestion().model)}
                        >
                          {t("suggestUse", { model: name(suggestion().model) })}
                        </button>
                      )}
                    </Show>
                    <Show when={result().paidAlternative}>
                      {(suggestion) => (
                        <button
                          type="button"
                          class="suggestion-paid"
                          onClick={() => {
                            if (
                              window.confirm(
                                t("suggestPaidConfirm", { model: name(suggestion().model) }),
                              )
                            ) {
                              void props.onApply(bot.id, suggestion().model);
                            }
                          }}
                        >
                          {t("suggestUse", { model: name(suggestion().model) })}
                          <small>{t("suggestPaid")}</small>
                        </button>
                      )}
                    </Show>
                  </Show>
                </div>
              </li>
            );
          }}
        </For>
      </ul>
    </div>
  );
}
