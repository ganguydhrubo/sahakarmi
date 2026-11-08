import { Show } from "solid-js";
import type { BotAvatarColor, BotAvatarShape, CrewAvatar } from "../../../shared/ipc";
import { crewMember } from "../crew";
import type { BotProfile } from "../data";
import { AgentMark } from "./AgentMark";

/** Reduced motion: robots show one still frame and never load the animated loops. */
const STILL = (() => {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
})();

interface AgentAvatarProps {
  bot?: Pick<BotProfile, "avatarShape" | "avatarColor" | "accent" | "avatarModel">;
  shape?: BotAvatarShape;
  color?: BotAvatarColor;
  /** A 3D crew robot; null forces the drawn shape even when the bot has a robot. */
  model?: CrewAvatar | null;
  class?: string;
  style?: Record<string, string>;
}

export function AgentAvatar(props: AgentAvatarProps) {
  const shape = () => props.shape ?? props.bot?.avatarShape ?? "blob";
  const color = () => props.color ?? props.bot?.avatarColor ?? "orange";
  const robot = () => crewMember(props.model !== undefined ? props.model : props.bot?.avatarModel);
  return (
    <Show
      when={robot()}
      fallback={
        <span
          class={`bot-avatar bot-avatar-${props.bot?.accent ?? "neutral"} bot-avatar-shape-${shape()} bot-avatar-color-${color()} ${props.class ?? ""}`}
          style={props.style}
          aria-hidden="true"
        >
          <AgentMark shape={shape()} color={color()} />
        </span>
      }
    >
      {(member) => (
        <span
          class={`bot-avatar crew-avatar ${props.class ?? ""}`}
          style={{ ...props.style, "--crew-halo": member().halo }}
          data-crew={member().id}
          aria-hidden="true"
        >
          <Show
            when={!STILL}
            fallback={
              <img class="crew-avatar-still" src={member().still} alt="" draggable={false} />
            }
          >
            <img class="crew-avatar-idle" src={member().idle} alt="" draggable={false} />
            <img
              class="crew-avatar-wave"
              src={member().wave}
              alt=""
              draggable={false}
              loading="lazy"
            />
          </Show>
        </span>
      )}
    </Show>
  );
}
