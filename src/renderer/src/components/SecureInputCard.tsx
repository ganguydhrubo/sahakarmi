import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { SecureInputKind, SecureInputRequest } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

const TITLES: Record<SecureInputKind, MessageKey> = {
  password: "secureTitlePassword",
  otp: "secureTitleOtp",
  pin: "secureTitlePin",
  other: "secureTitleOther",
};

interface SecureInputCardProps {
  request: SecureInputRequest;
  onSubmit: (id: string, value: string) => Promise<void>;
  onTakeOver: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * A coworker needs a password or OTP. The value is typed here and goes straight into the page
 * field; it is never added to the chat or shown to the coworker.
 */
export function SecureInputCard(props: SecureInputCardProps) {
  const [value, setValue] = createSignal("");
  const [revealed, setRevealed] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [preview, setPreview] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  /** The sentence around the bold origin, in whichever language puts it first or last. */
  const originParts = () => {
    const [before = "", after = ""] = t("secureSubmitOnce", { origin: "\u0000" }).split("\u0000");
    return [before, after] as const;
  };

  onMount(() => {
    input?.focus({ preventScroll: true });
    let cancelled = false;
    void window.sahkarmi.browser
      .preview(props.request.tabId)
      .then((image) => {
        if (!cancelled) setPreview(image);
      })
      .catch(() => undefined);
    onCleanup(() => {
      cancelled = true;
      // Nothing typed here outlives the card.
      setValue("");
    });
  });

  async function submit() {
    const typed = value();
    if (!typed || busy()) return;
    setBusy(true);
    setError(null);
    try {
      await props.onSubmit(props.request.id, typed);
      setValue("");
    } catch (failure) {
      setError(
        String(failure instanceof Error ? failure.message : failure).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="secure-input-card" aria-label={t(TITLES[props.request.kind])}>
      <header class="secure-input-head">
        <span class="secure-input-lock" aria-hidden="true">
          <LockIcon />
        </span>
        <div class="secure-input-heading">
          <strong>{t(TITLES[props.request.kind])}</strong>
          <span>
            {props.request.label.toLowerCase() !== props.request.kind
              ? `${props.request.label} · `
              : ""}
            {originParts()[0]}
            <b>{props.request.origin}</b>
            {originParts()[1]}
          </span>
        </div>
        <button
          type="button"
          class="secure-input-close"
          aria-label={t("secureClose")}
          onClick={() => props.onDismiss(props.request.id)}
        >
          <svg aria-hidden="true" viewBox="0 0 20 20">
            <path d="m5 5 10 10M15 5 5 15" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
      </header>
      <form
        class="secure-input-field"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <input
          ref={(element) => (input = element)}
          type={revealed() ? "text" : "password"}
          value={value()}
          placeholder={t(TITLES[props.request.kind])}
          aria-label={t(TITLES[props.request.kind])}
          autocomplete="off"
          spellcheck={false}
          inputmode={
            props.request.kind === "otp" || props.request.kind === "pin" ? "numeric" : "text"
          }
          onInput={(event) => setValue(event.currentTarget.value)}
        />
        <button
          type="button"
          class="secure-input-reveal"
          aria-pressed={revealed()}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed() ? t("secureHide") : t("secureShow")}
        </button>
      </form>
      <Show when={error()}>
        <p class="secure-input-error" role="alert">
          {error()}
        </p>
      </Show>
      <div class="secure-input-preview">
        <div class="secure-input-preview-bar">
          <span>{t("secureSignInPage")}</span>
          <span class="secure-input-preview-origin">{props.request.origin}</span>
        </div>
        <Show
          when={preview()}
          fallback={<div class="secure-input-preview-empty">{t("browserPreviewUnavailable")}</div>}
        >
          {(image) => <img src={image()} alt={t("secureSignInPage")} />}
        </Show>
      </div>
      <footer class="secure-input-foot">
        <span class="secure-input-note">
          <ShieldIcon />
          {t("secureNotInChat")}
        </span>
        <button
          type="button"
          class="secure-input-takeover"
          onClick={() => props.onTakeOver(props.request.id)}
        >
          {t("takeOver")}
        </button>
        <button
          type="button"
          class="button-primary"
          disabled={!value() || busy()}
          onClick={() => void submit()}
        >
          {t("secureSubmit")}
        </button>
      </footer>
    </section>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[16px] fill-none stroke-current">
      <rect x="4.5" y="9" width="11" height="8" rx="2" stroke-width="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" class="size-[14px] fill-none stroke-current">
      <path
        d="M10 2.5 4 5v4.5c0 3.8 2.6 6.6 6 8 3.4-1.4 6-4.2 6-8V5l-6-2.5Z"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
      <path d="m7.5 10 1.8 1.8L12.8 8" stroke-width="1.4" stroke-linecap="round" />
    </svg>
  );
}
