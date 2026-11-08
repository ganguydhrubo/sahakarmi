// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACP_AGENT_PROVIDERS,
  type AgentProviderStatus,
  DEFAULT_MODEL_FOR_PROVIDER,
  isAgentModel,
  PROVIDER_LABELS,
  providerFeatureId,
  providerForModel,
  SWITCHED_PROVIDERS,
} from "../shared/ipc";
import { PROVIDER_CATALOG } from "../shared/provider-catalog";
import {
  ACP_AGENT_SPECS,
  createAcpAgentClient,
  extraSearchFolders,
  findAcpAgentExecutable,
  notInstalledMessage,
  resolveAcpAgentCli,
} from "./acp-agents";
import { BUILT_IN_FEATURES, FeatureRegistry } from "./feature-registry";
import { UsageService } from "./usage-service";

const saved = {
  PATH: process.env.PATH,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  override: process.env.SAHKARMI_OPENMODEL_PATH,
};
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "sahkarmi-open-model-"));
  delete process.env.SAHKARMI_OPENMODEL_PATH;
});

afterEach(async () => {
  process.env.PATH = saved.PATH;
  process.env.LOCALAPPDATA = saved.LOCALAPPDATA;
  if (saved.override === undefined) delete process.env.SAHKARMI_OPENMODEL_PATH;
  else process.env.SAHKARMI_OPENMODEL_PATH = saved.override;
  await rm(root, { recursive: true, force: true });
});

const programName = process.platform === "win32" ? "interpreter.exe" : "interpreter";

describe("open-model engine: registration", () => {
  it("is an ACP engine under its real name, with its own default model", () => {
    expect(ACP_AGENT_PROVIDERS).toContain("openmodel");
    expect(PROVIDER_LABELS.openmodel).toBe("Open Interpreter");
    const entry = PROVIDER_CATALOG.find((candidate) => candidate.id === "openmodel");
    expect(entry?.name).toBe("Open Interpreter");
    expect(entry?.kind).toBe("agent");
    // Only the install hint may name the program the owner installs.
    // Owner rule: engines show their real name and mark, like Claude, Codex and Cline.
    expect(entry?.name).toBe("Open Interpreter");
    expect(DEFAULT_MODEL_FOR_PROVIDER.openmodel).toBe("openmodel:default");
    expect(isAgentModel("openmodel:default")).toBe(true);
    expect(providerForModel("openmodel:default")).toBe("openmodel");
  });

  it("starts the program's ACP server with `interpreter acp` and never installs it", () => {
    const spec = ACP_AGENT_SPECS.openmodel;
    expect(spec.commands).toEqual(["interpreter"]);
    expect(spec.args).toEqual(["acp"]);
    expect(spec.install).toBeUndefined();
    expect(spec.installHint?.url).toMatch(/^https:\/\//);
  });

  it("sits behind its own feature switch, off by default", async () => {
    expect(SWITCHED_PROVIDERS).toEqual({ openmodel: "engine-open-model" });
    expect(providerFeatureId("openmodel")).toBe("engine-open-model");
    expect(providerFeatureId("cline")).toBeNull();
    const definition = BUILT_IN_FEATURES.find((feature) => feature.id === "engine-open-model");
    expect(definition?.defaultEnabled).toBe(false);
    expect(definition?.canDisable).toBe(true);
    expect(definition?.name).toBe("Open Interpreter engine");
    const registry = new FeatureRegistry(root);
    await registry.initialize();
    expect(registry.isEnabled("engine-open-model")).toBe(false);
    await registry.setEnabled("engine-open-model", true);
    expect(registry.isEnabled("engine-open-model")).toBe(true);
  });

  it("creates a client that asks for permission through Sahkarmi like other ACP engines", () => {
    const client = createAcpAgentClient(
      "openmodel",
      { executable: join(root, programName), version: "1.0.0", bundled: false },
      root,
    );
    expect(client).toBeTruthy();
  });

  it("gets no usage row while switched off (no status), and one once it reports a status", async () => {
    const usage = new UsageService(root, () => new Date("2026-11-08T10:00:00Z"));
    await usage.initialize();
    const base: AgentProviderStatus[] = [
      { id: "codex", state: "available", version: "1", message: null },
    ];
    const ids = (statuses: AgentProviderStatus[]) =>
      usage.overview(statuses).providers.map((summary) => summary.provider);
    expect(ids(base)).not.toContain("openmodel");
    expect(ids(base)).toContain("cline");
    expect(
      ids([...base, { id: "openmodel", state: "not-installed", version: null, message: null }]),
    ).toContain("openmodel");
  });
});

describe("open-model engine: finding the program", () => {
  it("finds it on PATH", async () => {
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, programName), "");
    process.env.PATH = bin;
    process.env.LOCALAPPDATA = join(root, "empty-local");
    expect(await findAcpAgentExecutable(ACP_AGENT_SPECS.openmodel)).toBe(join(bin, programName));
  });

  it.runIf(process.platform === "win32")(
    "finds it in the installer's folder under %LOCALAPPDATA% when PATH misses it",
    async () => {
      const local = join(root, "Local");
      const bin = join(local, "Programs", "Open Interpreter", "bin");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, "interpreter.exe"), "");
      process.env.PATH = join(root, "nothing-here");
      process.env.LOCALAPPDATA = local;
      expect(extraSearchFolders(join(root, "home"))).toContain(bin);
      expect(await findAcpAgentExecutable(ACP_AGENT_SPECS.openmodel)).toBe(
        join(bin, "interpreter.exe"),
      );
    },
  );

  it("is unavailable with a plain install hint and link when missing", async () => {
    process.env.PATH = join(root, "nothing-here");
    process.env.LOCALAPPDATA = join(root, "empty-local");
    process.env.SAHKARMI_OPENMODEL_PATH = join(root, "missing.exe");
    expect(await findAcpAgentExecutable(ACP_AGENT_SPECS.openmodel)).toBeNull();
    await expect(resolveAcpAgentCli("openmodel")).rejects.toThrow(
      /Open Interpreter is a free program that is not installed.*Install it yourself from https:\/\/www\.openinterpreter\.com/,
    );
  });

  it("keeps the old message for engines without an install hint", () => {
    expect(notInstalledMessage(ACP_AGENT_SPECS.kimi, "Kimi Code")).toBe(
      "Kimi Code is not installed on this computer.",
    );
  });
});

describe("existing coding engine (already shipped)", () => {
  it("keeps starting its ACP mode with `cline --acp`", () => {
    expect(ACP_AGENT_SPECS.cline.commands).toEqual(["cline"]);
    expect(ACP_AGENT_SPECS.cline.args).toEqual(["--acp"]);
  });
});
