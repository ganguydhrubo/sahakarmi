import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type {
  AgentModelId,
  AgentModelOption,
  AgentProviderId,
  AgentProviderStatus,
  AgentStatus,
} from "../../../shared/ipc";
import {
  ACP_AGENT_PROVIDERS,
  DEFAULT_MODEL_FOR_PROVIDER,
  PROVIDER_LABELS,
  providerForModel,
} from "../../../shared/ipc";
import { ProviderLogo } from "./ProviderLogo";

interface ProviderModelPickerProps {
  value: AgentModelId;
  modelOptions: AgentModelOption[];
  agentStatus: AgentStatus;
  variant?: "pill" | "field";
  ariaLabel?: string;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (model: AgentModelId) => void;
}

const CORE_PROVIDERS: AgentProviderId[] = ["opencode", "claude", "codex", "antigravity"];
const DEFAULT_MODELS: Record<AgentProviderId, AgentModelId> = DEFAULT_MODEL_FOR_PROVIDER;
const CLI_NAMES: Partial<Record<AgentProviderId, string>> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  antigravity: "Google Antigravity",
  opencode: "OpenCode",
};

export function ProviderModelPicker(props: ProviderModelPickerProps) {
  const [open, setOpen] = createSignal(false);
  const [placement, setPlacement] = createSignal({
    left: "0px",
    top: "0px",
    width: "380px",
    "max-height": "460px",
  });
  const [search, setSearch] = createSignal("");
  const [showAccountModels, setShowAccountModels] = createSignal(false);
  // Other agents appear once connected, so the rail never fills up with tools nobody uses.
  const PROVIDERS = (): AgentProviderId[] => [
    ...CORE_PROVIDERS,
    ...ACP_AGENT_PROVIDERS.filter(
      (provider) =>
        props.agentStatus.providers?.find((status) => status.id === provider)?.state ===
          "available" || providerForModel(props.value) === provider,
    ),
  ];
  const [railProvider, setRailProvider] = createSignal<AgentProviderId>(
    providerForModel(props.value),
  );
  const providerButtons = new Map<AgentProviderId, HTMLButtonElement>();
  const modelButtons = new Map<AgentModelId, HTMLButtonElement>();
  let root: HTMLDivElement | undefined;
  let popover: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;

  const selectedModel = createMemo(() =>
    props.modelOptions.find((option) => option.id === props.value),
  );
  const activeProvider = createMemo(() => providerForModel(props.value));
  const railModels = createMemo(() =>
    props.modelOptions
      .filter((option) => providerForModel(option.id) === railProvider())
      .filter(
        (option) =>
          railProvider() !== "opencode" ||
          showAccountModels() ||
          Boolean(search().trim()) ||
          isFreeModel(option.id) ||
          option.id === props.value,
      )
      .filter((option) =>
        `${option.name} ${option.id}`.toLowerCase().includes(search().trim().toLowerCase()),
      )
      .sort((a, b) => Number(isFreeModel(b.id)) - Number(isFreeModel(a.id))),
  );
  const railStatus = createMemo(() =>
    providerAvailability(props.agentStatus, props.modelOptions, railProvider()),
  );
  const railAvailable = createMemo(() => railStatus().state === "available");

  createEffect(() => {
    const provider = activeProvider();
    if (!open()) setRailProvider(provider);
  });

  createEffect(() => {
    if (props.disabled && open()) setOpen(false);
  });

  onMount(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        !open() ||
        root?.contains(event.target as Node) ||
        popover?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    const reposition = () => {
      if (open()) positionPopover();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    onCleanup(() => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    });
  });

  function positionPopover(): void {
    const rect = root?.getBoundingClientRect();
    if (!rect) return;
    const margin = 12;
    const gap = 8;
    const width = Math.min(400, window.innerWidth - margin * 2);
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
    const above = Math.max(0, rect.top - gap - margin);
    const upward = below < 320 && above > below;
    const height = Math.min(460, upward ? above : below);
    setPlacement({
      left: `${Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin))}px`,
      top: `${Math.max(margin, upward ? rect.top - gap - height : rect.bottom + gap)}px`,
      width: `${width}px`,
      "max-height": `${height}px`,
    });
  }

  function setPickerOpen(next: boolean): void {
    if (props.disabled) return;
    if (next) {
      setRailProvider(activeProvider());
      setSearch("");
      setShowAccountModels(false);
      positionPopover();
    }
    setOpen(next);
    if (next) requestAnimationFrame(() => searchInput?.focus());
  }

  function focusModel(model?: AgentModelId): void {
    requestAnimationFrame(() => {
      const preferred = model ? modelButtons.get(model) : undefined;
      (preferred ?? modelButtons.get(railModels()[0]?.id ?? props.value))?.focus();
    });
  }

  function moveProvider(delta: number): void {
    const list = PROVIDERS();
    const current = list.indexOf(railProvider());
    const provider = list[(current + delta + list.length) % list.length];
    if (!provider) return;
    setRailProvider(provider);
    setSearch("");
    providerButtons.get(provider)?.focus();
  }

  function moveModel(model: AgentModelId, delta: number): void {
    if (!railAvailable()) return;
    const models = railModels();
    const current = models.findIndex((option) => option.id === model);
    const next = models[(current + delta + models.length) % models.length];
    if (next) modelButtons.get(next.id)?.focus();
  }

  function selectModel(model: AgentModelId): void {
    if (!railAvailable()) return;
    setOpen(false);
    props.onChange(model);
  }

  const triggerModelName = () => displayModelName(selectedModel()?.name, props.value);
  const field = () => props.variant === "field";

  return (
    <div
      ref={(element) => (root = element)}
      class="provider-model-picker"
      classList={{ "provider-model-picker-field": field() }}
    >
      <button
        type="button"
        class="provider-model-trigger"
        classList={{ "provider-model-trigger-field": field() }}
        aria-label={`${props.ariaLabel ?? "Agent model"}: ${triggerModelName()}`}
        aria-haspopup="dialog"
        aria-expanded={open()}
        disabled={props.disabled}
        title={
          props.disabled
            ? props.disabledReason
            : `${providerName(activeProvider())} · ${triggerModelName()}`
        }
        onClick={() => setPickerOpen(!open())}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open()) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setPickerOpen(true);
          focusModel(props.value);
        }}
      >
        <Show when={field()}>
          <span class="provider-model-field-label">{props.label ?? "Model"}</span>
        </Show>
        <span class="provider-model-trigger-value">
          <ProviderMark provider={activeProvider()} />
          <span class="provider-model-trigger-name">{triggerModelName()}</span>
        </span>
        <ChevronDownIcon />
      </button>

      <Show when={open()}>
        <Portal>
          <div
            ref={popover}
            class="provider-model-popover"
            style={placement()}
            role="dialog"
            aria-label="Choose agent model"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              root?.querySelector<HTMLButtonElement>(".provider-model-trigger")?.focus();
            }}
          >
            <div
              class="provider-model-rail"
              role="tablist"
              aria-label="Model providers"
              aria-orientation="vertical"
            >
              <For each={PROVIDERS()}>
                {(provider) => {
                  const status = () =>
                    providerAvailability(props.agentStatus, props.modelOptions, provider);
                  const selected = () => railProvider() === provider;
                  return (
                    <button
                      ref={(element) => providerButtons.set(provider, element)}
                      type="button"
                      role="tab"
                      class="provider-model-rail-button"
                      classList={{
                        "provider-model-rail-button-selected": selected(),
                        "provider-model-rail-button-unavailable": status().state !== "available",
                      }}
                      aria-selected={selected()}
                      aria-controls="provider-model-panel"
                      aria-label={`${providerName(provider)}: ${providerSummary(provider, status())}`}
                      tabIndex={selected() ? 0 : -1}
                      title={`${providerName(provider)} · ${providerSummary(provider, status())}`}
                      onClick={() => {
                        setRailProvider(provider);
                        setSearch("");
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                          event.preventDefault();
                          moveProvider(1);
                        } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                          event.preventDefault();
                          moveProvider(-1);
                        }
                      }}
                    >
                      <ProviderMark provider={provider} large />
                    </button>
                  );
                }}
              </For>
            </div>

            <div
              id="provider-model-panel"
              class="provider-model-panel"
              role="tabpanel"
              aria-label={`${providerName(railProvider())} models`}
            >
              <div class="provider-model-heading">
                <strong>{providerName(railProvider())}</strong>
                <span>{providerSummary(railProvider(), railStatus())}</span>
              </div>
              <input
                ref={searchInput}
                class="provider-model-search"
                type="search"
                aria-label="Search models"
                placeholder="Search models"
                value={search()}
                onInput={(event) => setSearch(event.currentTarget.value)}
              />
              <Show when={railProvider() === "opencode"}>
                <label class="provider-model-account-toggle">
                  <input
                    type="checkbox"
                    checked={showAccountModels()}
                    onChange={(event) => setShowAccountModels(event.currentTarget.checked)}
                  />
                  Show models requiring an account or credits
                </label>
              </Show>
              <div
                class="provider-model-list"
                role="listbox"
                aria-label={`${providerName(railProvider())} models`}
              >
                <For each={railModels()}>
                  {(model, index) => {
                    const selected = () => props.value === model.id;
                    const firstFocusable = () =>
                      railAvailable() &&
                      (selected() ||
                        (!railModels().some((option) => option.id === props.value) &&
                          index() === 0));
                    return (
                      <button
                        ref={(element) => modelButtons.set(model.id, element)}
                        type="button"
                        role="option"
                        class="provider-model-option"
                        classList={{ "provider-model-option-selected": selected() }}
                        aria-label={`${displayModelName(model.name, model.id)}${
                          model.id === DEFAULT_MODELS[railProvider()] ? ", default" : ""
                        }`}
                        aria-selected={selected()}
                        disabled={!railAvailable()}
                        tabIndex={firstFocusable() ? 0 : -1}
                        onClick={() => selectModel(model.id)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            moveModel(model.id, 1);
                          } else if (event.key === "ArrowUp") {
                            event.preventDefault();
                            moveModel(model.id, -1);
                          } else if (event.key === "Home") {
                            event.preventDefault();
                            modelButtons.get(railModels()[0]?.id ?? model.id)?.focus();
                          } else if (event.key === "End") {
                            event.preventDefault();
                            modelButtons.get(railModels().at(-1)?.id ?? model.id)?.focus();
                          }
                        }}
                      >
                        <span class="provider-model-option-name">
                          <span>{displayModelName(model.name, model.id)}</span>
                          <Show when={railProvider() === "opencode"}>
                            <small>{isFreeModel(model.id) ? "Free" : "Account / credits"}</small>
                          </Show>
                          <Show when={model.id === DEFAULT_MODELS[railProvider()]}>
                            <small>default</small>
                          </Show>
                        </span>
                        <Show when={selected()}>
                          <CheckIcon />
                        </Show>
                      </button>
                    );
                  }}
                </For>
                <Show when={railModels().length === 0}>
                  <p class="provider-model-empty">No matching models.</p>
                </Show>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </div>
  );
}

function providerAvailability(
  status: AgentStatus,
  models: AgentModelOption[],
  provider: AgentProviderId,
): AgentProviderStatus {
  const explicit = status.providers?.find((item) => item.id === provider);
  if (explicit) return explicit;
  if (status.phase === "starting" || status.phase === "restarting") {
    return { id: provider, state: "checking", version: null, message: null };
  }
  const available = models.some((model) => providerForModel(model.id) === provider);
  return {
    id: provider,
    state: available ? "available" : "error",
    version: null,
    message: available ? null : `${providerName(provider)} is unavailable.`,
  };
}

function providerSummary(provider: AgentProviderId, status: AgentProviderStatus): string {
  if (status.state === "available") {
    return status.version
      ? `${status.version} (${CLI_NAMES[provider] ?? PROVIDER_LABELS[provider]})`
      : `${CLI_NAMES[provider] ?? PROVIDER_LABELS[provider]} ready`;
  }
  return status.message ?? providerStatusLabel(status.state);
}

function providerStatusLabel(state: AgentProviderStatus["state"]): string {
  if (state === "sign-in-required") return "Sign in required";
  if (state === "not-installed") return "Not installed";
  if (state === "outdated") return "Update required";
  if (state === "error") return "Unavailable";
  return "Checking";
}

function providerName(provider: AgentProviderId): string {
  return PROVIDER_LABELS[provider];
}

function displayModelName(name: string | undefined, fallback: string): string {
  return name?.replace(/^OpenCode\//i, "").replace(/^[\s:–—-]+/, "") || fallback;
}

export function isFreeModel(id: string): boolean {
  return id === "opencode-free" || /^opencode:opencode\/(?:big-pickle|[^/]+-free)$/.test(id);
}

function ProviderMark(props: { provider: AgentProviderId; large?: boolean }) {
  return (
    <span
      class={`provider-model-mark provider-model-brand provider-model-mark-${props.provider}`}
      classList={{ "provider-model-mark-large": props.large }}
    >
      <ProviderLogo provider={props.provider} size={props.large ? 18 : 14} />
    </span>
  );
}

function ChevronDownIcon() {
  return (
    <svg class="provider-model-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg class="provider-model-check" viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3 8.25 3.1 3.1L13 4.8" />
    </svg>
  );
}
