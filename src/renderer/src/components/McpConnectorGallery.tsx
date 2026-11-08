import { createSignal, For, Show } from "solid-js";
import type { McpConnectorCheck, McpConnectorMissing, McpServerSummary } from "../../../shared/ipc";
import { CONNECTOR_PRESETS, type ConnectorPreset } from "../../../shared/mcp-presets";
import { CONNECTOR_MARKS } from "../connector-marks";
import { t } from "../i18n";

/** The pinned version in plain form (no package names on cards). */
export function pinnedVersion(preset: ConnectorPreset): string {
  const pin = preset.pin;
  switch (pin.kind) {
    case "npm":
    case "pypi":
      return pin.version;
    case "git":
      return pin.commit.slice(0, 7);
    case "release":
      return pin.tag.replace(/^[a-z-]*v(?=\d)/i, "");
    case "remote":
      return t("mcpcHosted");
  }
}

function missingText(entry: McpConnectorMissing): string {
  switch (entry.requirement) {
    case "node":
      return entry.foundVersion !== undefined
        ? t("mcpcNeedsNodeFound", {
            min: String(entry.minVersion ?? ""),
            found: String(entry.foundVersion),
          })
        : t("mcpcNeedsNode", { min: String(entry.minVersion ?? 20) });
    case "uv":
      return t("mcpcNeedsUv");
    case "git":
      return t("mcpcNeedsGit");
    case "chrome":
      return t("mcpcNeedsChrome");
  }
}

/** The service's own logo (or a plain icon), drawn like the AI engines' logos. */
function ConnectorLogo(props: { id: string }) {
  const mark = () => CONNECTOR_MARKS[props.id];
  return (
    <Show when={mark()}>
      {(brand) => (
        <span class="provider-logo" style={{ "--provider-logo-size": "18px" }} aria-hidden="true">
          <svg viewBox="0 0 24 24" width={18} height={18} role="presentation">
            <path d={brand().path} fill={brand().color ?? "currentColor"} />
          </svg>
        </span>
      )}
    </Show>
  );
}

interface Props {
  busy: boolean;
  run: (action: () => Promise<void>) => void;
  onServers: (servers: McpServerSummary[], name: string) => void;
}

/**
 * Settings › MCP servers › Ready-made connectors. Opening it only looks at this PC; Add saves the
 * server switched off through the normal save. The owner tests it and turns it on in the list.
 */
export function McpConnectorGallery(props: Props) {
  const [checks, setChecks] = createSignal<McpConnectorCheck[]>([]);
  const [open, setOpen] = createSignal<string | null>(null);
  const [name, setName] = createSignal("");
  const [values, setValues] = createSignal<Record<string, string>>({});

  const [loaded, setLoaded] = createSignal(false);
  // Looked up only when the owner opens the list (it reads PATH and asks node for its version).
  const load = () =>
    props.run(async () => {
      setChecks(await window.sahkarmi.mcp.connectors());
      setLoaded(true);
    });

  const checkOf = (id: string) => checks().find((entry) => entry.id === id);

  function start(preset: ConnectorPreset) {
    setOpen(preset.id);
    setName(preset.serverName);
    setValues({});
  }

  function add(preset: ConnectorPreset) {
    const chosen = name().trim() || preset.serverName;
    props.run(async () => {
      const servers = await window.sahkarmi.mcp.addConnector(preset.id, chosen, values());
      setOpen(null);
      setValues({});
      props.onServers(servers, chosen);
      setChecks(await window.sahkarmi.mcp.connectors());
    });
  }

  const setValue = (key: string, value: string) => setValues({ ...values(), [key]: value });

  return (
    <details
      class="mcp-connectors"
      onToggle={(event) => {
        if (event.currentTarget.open && !loaded()) load();
      }}
    >
      <summary>{t("mcpcTitle")}</summary>
      <p class="settings-meta">{t("mcpcIntro")}</p>
      <div class="settings-buttons">
        <button type="button" disabled={props.busy} onClick={load}>
          {t("mcpxRecheck")}
        </button>
      </div>
      <ul class="extension-list">
        <For each={CONNECTOR_PRESETS}>
          {(preset) => {
            const check = () => checkOf(preset.id);
            const missing = () => check()?.missing ?? [];
            return (
              <li class="mcp-card">
                <h4 class="mcp-connector-title">
                  <ConnectorLogo id={preset.id} />
                  {preset.title}
                </h4>
                <p class="settings-meta">{preset.summary}</p>
                <small class="settings-meta">
                  {t(
                    preset.runtime === "remote"
                      ? "mcpcRuntimeRemote"
                      : preset.runtime === "program"
                        ? "mcpcRuntimeProgram"
                        : preset.runtime === "python"
                          ? "mcpcRuntimePython"
                          : "mcpcRuntimeNode",
                  )}
                  {" · "}
                  {t("mcpcVersion", { version: pinnedVersion(preset) })}
                </small>
                <ul class="mcp-steps">
                  <For each={preset.safety}>{(line) => <li>{line}</li>}</For>
                </ul>
                <Show when={preset.fields.some((field) => field.required)}>
                  <small class="settings-meta">
                    {t("mcpcNeedsKeys", {
                      keys: preset.fields
                        .filter((field) => field.required)
                        .map((field) => field.label)
                        .join(", "),
                    })}
                  </small>
                </Show>
                <For each={missing()}>
                  {(entry) => (
                    <p class="extension-warning">
                      {missingText(entry)} {t("mcpcInstallHint")}{" "}
                      <button
                        type="button"
                        class="link-button"
                        onClick={() => void window.sahkarmi.openUrl(entry.link)}
                      >
                        {t("mcpcGetIt")}
                      </button>
                    </p>
                  )}
                </For>
                <Show
                  when={open() === preset.id}
                  fallback={
                    <div class="settings-buttons">
                      <Show
                        when={check()?.addedAs}
                        fallback={
                          <button
                            type="button"
                            disabled={props.busy || missing().length > 0}
                            onClick={() => start(preset)}
                          >
                            {t("mcpcAdd")}
                          </button>
                        }
                      >
                        <small class="settings-meta">
                          {t("mcpcAlreadyAdded", { name: check()?.addedAs ?? "" })}
                        </small>
                      </Show>
                    </div>
                  }
                >
                  <div class="extension-form">
                    <label class="extension-field">
                      <span>{t("mcpName")}</span>
                      <input
                        value={name()}
                        onInput={(event) => setName(event.currentTarget.value)}
                      />
                    </label>
                    <For each={preset.fields}>
                      {(field) => (
                        <div class="mcp-connector-field">
                          <Show
                            when={field.kind === "accept"}
                            fallback={
                              <label class="extension-field">
                                <span>
                                  {field.label}
                                  {field.required ? ` (${t("mcpxRequired")})` : ""}
                                </span>
                                <input
                                  type={field.secret ? "password" : "text"}
                                  autocomplete="off"
                                  spellcheck={false}
                                  value={values()[field.key] ?? ""}
                                  onInput={(event) =>
                                    setValue(field.key, event.currentTarget.value)
                                  }
                                />
                              </label>
                            }
                          >
                            <label class="extension-pick">
                              <input
                                type="checkbox"
                                checked={values()[field.key] === "true"}
                                onChange={(event) =>
                                  setValue(field.key, event.currentTarget.checked ? "true" : "")
                                }
                              />
                              <span>{field.label}</span>
                            </label>
                          </Show>
                          <small class="settings-meta">{field.hint}</small>
                          <Show when={field.setupUrl}>
                            <button
                              type="button"
                              class="link-button"
                              onClick={() => void window.sahkarmi.openUrl(field.setupUrl as string)}
                            >
                              {t("mcpcSetup")}
                            </button>
                          </Show>
                        </div>
                      )}
                    </For>
                    <p class="settings-meta">{t("mcpcAddNote")}</p>
                    <div class="settings-buttons">
                      <button type="button" disabled={props.busy} onClick={() => add(preset)}>
                        {t("mcpcAddOff")}
                      </button>
                      <button type="button" disabled={props.busy} onClick={() => setOpen(null)}>
                        {t("mcpCancel")}
                      </button>
                    </div>
                  </div>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
    </details>
  );
}
