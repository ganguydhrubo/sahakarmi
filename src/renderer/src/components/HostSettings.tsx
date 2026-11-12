import { createEffect, createSignal, For, type JSX, onCleanup, onMount, Show } from "solid-js";
import type { HostActivity, HostDesktopApi, HostStatus } from "../../../shared/ipc";
import { type MessageKey, t } from "../i18n";

/** While a code is on screen, look for the phone every two seconds. */
const PAIRING_POLL_MS = 2_000;

const ACTIVITY_LABELS: Record<HostActivity["action"], MessageKey> = {
  paired: "hostActivityPaired",
  message: "hostActivityMessage",
  approved: "hostActivityApproved",
  rejected: "hostActivityRejected",
  routine: "hostActivityRoutine",
  unpaired: "hostActivityUnpaired",
  removed: "hostActivityRemoved",
};

/** Today: just the time. This year: day and time. Older: the full date. */
export function formatWhen(value: string | null, now = new Date()): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
  if (date.toDateString() === now.toDateString()) return time;
  if (date.getFullYear() === now.getFullYear()) {
    return `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date)}, ${time}`;
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

/** "ABCD2345" → "ABCD 2345", easier to read off the screen. */
export function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1 ");
}

export function countdown(msLeft: number): string {
  const seconds = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function PcIcon(props: { size?: number }) {
  return (
    <svg
      width={props.size ?? 34}
      height={props.size ?? 34}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 16.5v4" />
    </svg>
  );
}

function PhoneIcon(props: { size?: number }) {
  return (
    <svg
      width={props.size ?? 34}
      height={props.size ?? 34}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

function Step(props: {
  number: number;
  done: boolean;
  active: boolean;
  title: string;
  /** One line shown once the step is done, instead of its instructions. */
  summary?: string;
  /** Keep the step's content visible after it is done (pairing another phone). */
  keepOpen?: boolean;
  children: JSX.Element;
}) {
  return (
    <li
      class="host-step"
      classList={{ "host-step-done": props.done, "host-step-active": props.active }}
      aria-current={props.active ? "step" : undefined}
    >
      <span class="host-step-mark" aria-hidden="true">
        {props.done ? "✓" : props.number}
      </span>
      <div class="host-step-body">
        <h4>
          {props.title}
          <Show when={props.done}>
            <span class="host-step-done-label">{t("hostStepDone")}</span>
          </Show>
        </h4>
        <Show
          when={!props.done || props.keepOpen}
          fallback={
            <Show when={props.summary}>
              <p class="host-step-summary">{props.summary}</p>
            </Show>
          }
        >
          {props.children}
        </Show>
      </div>
    </li>
  );
}

export function HostSettings() {
  const api = window.sahkarmi?.host;
  return (
    <Show when={api} fallback={<p class="settings-meta">{t("hostOffHint")}</p>}>
      {(ready) => <HostPanel api={ready()} />}
    </Show>
  );
}

function HostPanel(props: { api: HostDesktopApi }) {
  const api = props.api;
  const [status, setStatus] = createSignal<HostStatus | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [allowHint, setAllowHint] = createSignal(false);
  const [address, setAddress] = createSignal("");
  const [now, setNow] = createSignal(Date.now());
  const [justPaired, setJustPaired] = createSignal<string | null>(null);

  async function run(name: string, action: () => Promise<HostStatus & { enableUrl?: string }>) {
    setBusy(name);
    setError(null);
    try {
      const next = await action();
      if (name === "setup") setAllowHint(Boolean(next.enableUrl));
      setStatus(next);
      return next;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
          : String(cause),
      );
      return null;
    } finally {
      setBusy(null);
    }
  }

  onMount(() => {
    void api
      .status()
      .then((value) => {
        setStatus(value);
        setAddress(value.addressFromTailscale ? "" : (value.address ?? ""));
      })
      .catch(() => undefined);
  });

  // While pairing: tick the countdown and notice the moment the phone joins.
  createEffect(() => {
    const pairing = status()?.pairing;
    if (!pairing) return;
    const before = new Set(status()?.devices.map((device) => device.id));
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    const poll = window.setInterval(() => {
      void api
        .status()
        .then((value) => {
          const added = value.devices.find((device) => !before.has(device.id));
          if (added) setJustPaired(added.name);
          setStatus(value);
        })
        .catch(() => undefined);
    }, PAIRING_POLL_MS);
    onCleanup(() => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    });
  });

  const current = () => status();
  const tailscale = () => current()?.tailscale;
  const step1Done = () => tailscale()?.connected === true || Boolean(current()?.address);
  const step2Done = () => Boolean(current()?.address);
  const step3Done = () => (current()?.devices.length ?? 0) > 0;
  const msLeft = () => {
    const pairing = current()?.pairing;
    return pairing ? Date.parse(pairing.expiresAt) - now() : 0;
  };

  return (
    <div class="host-settings">
      <header class="host-hero">
        <div class="host-hero-art" aria-hidden="true">
          <span class="host-hero-pc">
            <PcIcon />
          </span>
          <span class="host-hero-line" classList={{ "host-hero-line-on": current()?.running }} />
          <span class="host-hero-phone">
            <PhoneIcon />
          </span>
        </div>
        <div class="host-hero-copy">
          <h3>{t("hostTitle")}</h3>
          <p>{t("hostLead")}</p>
        </div>
      </header>

      <div class="host-switch-row">
        <div>
          <strong>{t("hostSwitch")}</strong>
          <span
            class="host-state"
            classList={{ "host-state-on": current()?.running === true }}
            role="status"
          >
            {busy() === "enable"
              ? t("hostStarting")
              : current()?.running
                ? t("hostOn")
                : t("hostOff")}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          class="host-switch"
          classList={{ "host-switch-on": current()?.enabled === true }}
          aria-checked={current()?.enabled === true}
          aria-label={t("hostSwitch")}
          disabled={!current() || busy() !== null}
          onClick={() => void run("enable", () => api.setEnabled(!current()?.enabled))}
        >
          <span />
        </button>
      </div>

      <Show when={error()}>
        <p class="host-error" role="alert">
          {error()}
        </p>
      </Show>
      <Show when={current()?.error && !error()}>
        <p class="host-error" role="alert">
          {current()?.error}
        </p>
      </Show>

      <Show when={current()?.enabled} fallback={<p class="host-off-hint">{t("hostOffHint")}</p>}>
        <h4 class="host-steps-title">{t("hostStepsTitle")}</h4>
        <ol class="host-steps">
          <Step
            number={1}
            done={step1Done()}
            active={!step1Done()}
            title={t("hostStep1")}
            summary={
              tailscale()?.dnsName
                ? t("hostStep1Connected", { name: tailscale()?.dnsName ?? "" })
                : undefined
            }
          >
            <div class="host-install">
              <div class="host-install-tile">
                <span class="host-install-icon">
                  <PcIcon size={26} />
                </span>
                <strong>{t("hostStep1Pc")}</strong>
                <Show
                  when={tailscale()?.installed}
                  fallback={
                    <>
                      <button
                        type="button"
                        class="button-primary"
                        onClick={() => void window.sahkarmi.openExternal("tailscale-download")}
                      >
                        {t("hostGetTailscale")}
                      </button>
                      <small>{t("hostStep1PcHint")}</small>
                    </>
                  }
                >
                  <small>{t("hostStep1SignIn")}</small>
                </Show>
              </div>
              <div class="host-install-tile">
                <span class="host-install-icon">
                  <PhoneIcon size={26} />
                </span>
                <strong>{t("hostStep1Phone")}</strong>
                <Show when={current()?.installQrSvg}>
                  {/* Drawn on this PC from Tailscale's fixed download link. */}
                  <div
                    class="host-install-qr"
                    role="img"
                    aria-label={t("hostStep1PhoneHint")}
                    innerHTML={current()?.installQrSvg ?? ""}
                  />
                </Show>
                <small>{t("hostStep1PhoneHint")}</small>
              </div>
            </div>
            <p class="host-hint">{t("hostStep1Same")}</p>
            <div class="host-actions">
              <button
                type="button"
                class="button-secondary"
                disabled={busy() !== null}
                onClick={() => void run("check", () => api.status({ refresh: true }))}
              >
                {busy() === "check" ? t("hostChecking") : t("hostCheckAgain")}
              </button>
            </div>
          </Step>

          <Step
            number={2}
            done={step2Done()}
            active={step1Done() && !step2Done()}
            title={t("hostStep2")}
            summary={t("hostStep2Summary")}
          >
            <p class="host-hint">{t("hostStep2Hint")}</p>
            <Show when={step1Done()}>
              <div class="host-actions">
                <button
                  type="button"
                  class="button-primary host-big-button"
                  disabled={busy() !== null}
                  onClick={() => void run("setup", () => api.setupTailscale())}
                >
                  {busy() === "setup" ? t("hostSettingUp") : t("hostSetUp")}
                </button>
              </div>
            </Show>
            <Show when={allowHint()}>
              <p class="host-note host-note-strong">{t("hostAllowOnce")}</p>
            </Show>
          </Step>

          <Step
            number={3}
            done={step3Done()}
            active={step2Done() && !step3Done()}
            title={t("hostStep3")}
            keepOpen
          >
            <Show when={justPaired()}>
              <p class="host-success" role="status">
                {t("hostPaired", { name: justPaired() ?? "" })}
              </p>
            </Show>
            <Show
              when={current()?.pairing && msLeft() > 0}
              fallback={
                <Show when={step2Done()}>
                  <Show when={!step3Done()}>
                    <p class="host-hint">{t("hostStep3Hint")}</p>
                  </Show>
                  <div class="host-actions">
                    <button
                      type="button"
                      classList={{
                        "button-primary": !step3Done(),
                        "host-big-button": !step3Done(),
                        "button-secondary": step3Done(),
                      }}
                      disabled={busy() !== null}
                      onClick={() => {
                        setJustPaired(null);
                        void run("pair", () => api.startPairing());
                      }}
                    >
                      {step3Done() ? t("hostPairAnother") : t("hostPair")}
                    </button>
                  </div>
                  <Show when={step3Done()}>
                    <p class="host-tip">{t("hostHomeScreen")}</p>
                  </Show>
                </Show>
              }
            >
              <div class="host-pairing">
                {/* The picture is drawn on this PC from the pairing link; nothing typed is in it. */}
                <div
                  class="host-qr"
                  role="img"
                  aria-label={t("hostStep3Hint")}
                  innerHTML={current()?.pairing?.qrSvg ?? ""}
                />
                <div class="host-pairing-copy">
                  <p class="host-pairing-lead">{t("hostStep3Hint")}</p>
                  <p class="host-expires">{t("hostPairExpires", { time: countdown(msLeft()) })}</p>
                  <details class="host-type-code">
                    <summary>{t("hostPairCode")}</summary>
                    <code class="host-pair-url">{current()?.address}</code>
                    <p class="host-code">{groupCode(current()?.pairing?.code ?? "")}</p>
                  </details>
                  <button
                    type="button"
                    class="button-secondary"
                    onClick={() => void run("cancel", () => api.cancelPairing())}
                  >
                    {t("hostPairCancel")}
                  </button>
                </div>
              </div>
            </Show>
          </Step>
        </ol>

        <section class="host-section">
          <h4>{t("hostPhones")}</h4>
          <Show
            when={(current()?.devices.length ?? 0) > 0}
            fallback={<p class="host-hint">{t("hostNoPhones")}</p>}
          >
            <ul class="host-devices">
              <For each={current()?.devices ?? []}>
                {(device) => (
                  <li>
                    <span class="host-device-icon">
                      <PhoneIcon size={22} />
                    </span>
                    <span class="host-device-copy">
                      <strong>{device.name}</strong>
                      <small>
                        {t("hostPairedOn", { when: formatWhen(device.pairedAt) })}
                        <Show when={device.lastSeenAt}>
                          {" · "}
                          {t("hostLastUsed", { when: formatWhen(device.lastSeenAt) })}
                        </Show>
                      </small>
                    </span>
                    <button
                      type="button"
                      class="button-secondary host-remove"
                      disabled={busy() !== null}
                      onClick={() => {
                        if (!window.confirm(t("hostRemoveConfirm", { name: device.name }))) return;
                        void run("remove", () => api.removeDevice(device.id));
                      }}
                    >
                      {t("hostRemove")}
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </section>

        <section class="host-section">
          <Show
            when={current()?.canStartWithWindows}
            fallback={<p class="host-hint">{t("hostStoreStartup")}</p>}
          >
            <label class="host-check">
              <input
                type="checkbox"
                checked={current()?.startWithWindows === true}
                disabled={busy() !== null}
                onChange={(event) => {
                  const box = event.currentTarget;
                  void run("startup", () => api.setStartWithWindows(box.checked)).then((next) => {
                    // Windows refused: show the real setting again.
                    if (!next) box.checked = current()?.startWithWindows === true;
                  });
                }}
              />
              <span>
                <strong>{t("hostStartWithWindows")}</strong>
                <small>{t("hostStartWithWindowsHint")}</small>
              </span>
            </label>
          </Show>
          <p class="host-hint">{t("hostTrayNote")}</p>
        </section>

        <Show when={(current()?.activity.length ?? 0) > 0}>
          <section class="host-section">
            <h4>{t("hostActivity")}</h4>
            <ul class="host-activity">
              <For each={current()?.activity ?? []}>
                {(entry) => (
                  <li>
                    <span
                      class={`host-activity-dot host-activity-${entry.action}`}
                      aria-hidden="true"
                    />
                    <span>
                      <strong>{entry.deviceName}</strong> · {t(ACTIVITY_LABELS[entry.action])}
                      <Show when={entry.detail}>: {entry.detail}</Show>
                    </span>
                    <time datetime={entry.at}>{formatWhen(entry.at)}</time>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </Show>

        <details class="host-section host-advanced">
          <summary>{t("hostAdvanced")}</summary>
          <p class="host-hint">{t("hostOwnAddressHint")}</p>
          <form
            class="host-address-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run("address", () => api.setAddress(address()));
            }}
          >
            <input
              type="url"
              value={address()}
              placeholder={t("hostAddressPlaceholder")}
              aria-label={t("hostAddress")}
              onInput={(event) => setAddress(event.currentTarget.value)}
            />
            <button type="submit" class="button-secondary" disabled={busy() !== null}>
              {t("hostSave")}
            </button>
          </form>
          <Show when={current()?.address}>
            <p class="host-address">
              <span>{t("hostAddress")}</span>
              <code>{current()?.address}</code>
            </p>
          </Show>
        </details>

        <p class="host-safety">{t("hostSafety")}</p>
      </Show>
    </div>
  );
}
