import { For, Show } from "solid-js";
import { type MessageKey, t } from "../i18n";

/** One line in a drawn phone screen. Telegram and @BotFather speak English, so these are too. */
type Line =
  | { from: "me" | "them"; text: string; token?: string }
  | { start: true }
  | { typing: true }
  | { field: string; button: string };

interface Step {
  title: MessageKey;
  text: MessageKey;
  /** The chat title at the top of the drawn screen. */
  screen: string;
  lines: Line[];
}

const EXAMPLE_TOKEN = "1234567890:AAE-example-token-copy-yours";

const STEPS: Step[] = [
  {
    title: "tgGuide1Title",
    text: "tgGuide1Text",
    screen: "BotFather ✓",
    lines: [
      { from: "them", text: "BotFather can help you create and manage Telegram bots." },
      { start: true },
    ],
  },
  {
    title: "tgGuide2Title",
    text: "tgGuide2Text",
    screen: "BotFather ✓",
    lines: [
      { from: "me", text: "/newbot" },
      {
        from: "them",
        text: "Alright, a new bot. How are we going to call it? Please choose a name.",
      },
    ],
  },
  {
    title: "tgGuide3Title",
    text: "tgGuide3Text",
    screen: "BotFather ✓",
    lines: [
      { from: "me", text: "Sharma Traders Helper" },
      { from: "them", text: "Good. Now choose a username for your bot. It must end in bot." },
    ],
  },
  {
    title: "tgGuide4Title",
    text: "tgGuide4Text",
    screen: "BotFather ✓",
    lines: [
      { from: "me", text: "sharma_helper_bot" },
      {
        from: "them",
        text: "Done! Your new bot is at t.me/sharma_helper_bot. Use this token to access the HTTP API:",
        token: EXAMPLE_TOKEN,
      },
    ],
  },
  {
    title: "tgGuide5Title",
    text: "tgGuide5Text",
    screen: "Sahkarmi › Settings › Telegram",
    lines: [{ field: "••••••••••••••••", button: "Connect" }],
  },
  {
    title: "tgGuide6Title",
    text: "tgGuide6Text",
    screen: "Sharma Traders Helper",
    lines: [{ start: true }, { from: "them", text: "Paired. You are talking to Asha." }],
  },
  {
    title: "tgGuide7Title",
    text: "tgGuide7Text",
    screen: "Sharma Traders Helper",
    lines: [
      { from: "me", text: "Send me today's sales summary" },
      { typing: true },
      { from: "them", text: "Today: 14 orders, Rs. 86,400. 2 payments are pending." },
    ],
  },
];

/** A newcomer's walk-through, from making the bot to the first chat, with a drawn screen per step. */
export function TelegramGuide(props: { open: boolean }) {
  return (
    <details class="tg-guide" open={props.open}>
      <summary>{t("tgGuideShow")}</summary>
      <ol class="tg-guide-steps">
        <For each={STEPS}>
          {(step, index) => (
            <li class="tg-step">
              <div class="tg-phone" role="img" aria-label={t(step.title)}>
                <div class="tg-phone-bar">{step.screen}</div>
                <div class="tg-phone-chat">
                  <For each={step.lines}>{(line) => <PhoneLine line={line} />}</For>
                </div>
              </div>
              <div class="tg-step-text">
                <h3>
                  {index() + 1}. {t(step.title)}
                </h3>
                <p>{t(step.text)}</p>
              </div>
            </li>
          )}
        </For>
      </ol>
    </details>
  );
}

function PhoneLine(props: { line: Line }) {
  const line = props.line;
  if ("start" in line) return <div class="tg-phone-start">START</div>;
  if ("typing" in line) return <div class="tg-bubble tg-bubble-them tg-typing">typing…</div>;
  if ("field" in line) {
    return (
      <div class="tg-phone-form">
        <span>Bot token</span>
        <div class="tg-phone-field">{line.field}</div>
        <div class="tg-phone-button">{line.button}</div>
      </div>
    );
  }
  return (
    <div class={`tg-bubble tg-bubble-${line.from}`}>
      {line.text}
      <Show when={line.token}>
        <code class="tg-token">{line.token}</code>
      </Show>
    </div>
  );
}
