import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomSkill } from "../../../shared/ipc";
import { OPEN_SOURCE_CREDITS } from "../../../shared/open-source-credits";
import { SKILL_PACKS } from "../../../shared/skill-packs";
import { OpenSourceCredits } from "./OpenSourceCredits";
import { McpRecommendations, SkillPacks } from "./SkillPacks";

const UPSTREAM = /anthropic|claude|corey|mohit|nextlevel|evolsb|mukul|tuanductran|github\.com/i;

function installedSkill(overrides: Partial<CustomSkill>): CustomSkill {
  return {
    id: "invoice-chase",
    name: "invoice-chase",
    description: "",
    source: "pack:small-business/invoice-chase",
    installedAt: "2026-11-08T00:00:00.000Z",
    sharedPath: "Skills/Custom/invoice-chase/SKILL.md",
    pack: "small-business",
    ...overrides,
  };
}

function stubApi() {
  const installPack = vi.fn(async () => [installedSkill({})]);
  const importJson = vi.fn(async () => ({
    servers: [],
    added: ["quickbooks"],
    skipped: [],
    conflicts: [],
  }));
  const openUrl = vi.fn(async () => undefined);
  Object.defineProperty(window, "sahkarmi", {
    value: { customSkills: { installPack }, mcp: { importJson }, openUrl },
    configurable: true,
    writable: true,
  });
  return { installPack, importJson, openUrl };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SkillPacks", () => {
  it("lists every pack under a Sahkarmi name with no upstream names, and installs one", async () => {
    const { installPack } = stubApi();
    const onSkills = vi.fn();
    const { container } = render(() => (
      <SkillPacks
        skills={[installedSkill({})]}
        busy={false}
        run={async (action) => action()}
        onSkills={onSkills}
      />
    ));
    for (const pack of SKILL_PACKS) expect(screen.getByText(pack.title)).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(UPSTREAM);
    expect(screen.getAllByText("Not legal advice — check with a lawyer")).toHaveLength(3);
    expect(screen.getByText("1 of 44 installed")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Install pack" })[0] as HTMLElement);
    await waitFor(() => expect(installPack).toHaveBeenCalledWith("sales", undefined));
    expect(onSkills).toHaveBeenCalled();
  });
});

describe("McpRecommendations", () => {
  it("adds a suggested server only after the owner confirms", async () => {
    const { importJson } = stubApi();
    const skill = installedSkill({
      mcpRecommendations: [
        {
          name: "quickbooks",
          transport: "http",
          url: "https://mcp.quickbooks.example/v1/mcp",
          envKeys: [],
          headerKeys: ["Authorization"],
        },
      ],
    });
    render(() => <McpRecommendations skills={[skill, { ...skill, id: "other" }]} />);
    expect(screen.getAllByText("quickbooks")).toHaveLength(1);
    expect(screen.getByText("Needs: Authorization")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    expect(importJson).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add to MCP servers" }));
    await waitFor(() => expect(importJson).toHaveBeenCalledTimes(1));
    const sent = JSON.parse(String((importJson.mock.calls[0] as unknown[])[0]));
    expect(sent).toEqual({
      mcpServers: { quickbooks: { type: "http", url: "https://mcp.quickbooks.example/v1/mcp" } },
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Added/));
  });

  it("shows nothing when no installed skill suggests a server", () => {
    stubApi();
    const { container } = render(() => <McpRecommendations skills={[installedSkill({})]} />);
    expect(container.textContent).toBe("");
  });
});

describe("OpenSourceCredits", () => {
  it("renders every credit with its URL, licence, copyright and NOTICE state", () => {
    const { openUrl } = stubApi();
    render(() => <OpenSourceCredits />);
    for (const credit of OPEN_SOURCE_CREDITS) {
      expect(screen.getByText(credit.name)).toBeTruthy();
      expect(screen.getByText(credit.url)).toBeTruthy();
      expect(
        screen.getAllByText(new RegExp(credit.copyright.replace(/[()[\].,]/g, "\\$&"))).length,
      ).toBeGreaterThan(0);
    }
    const apache = OPEN_SOURCE_CREDITS.filter((credit) => credit.licence === "Apache-2.0").length;
    expect(screen.getAllByText("This project publishes no NOTICE file.")).toHaveLength(apache);
    fireEvent.click(screen.getAllByRole("button", { name: "Open project page" })[0] as HTMLElement);
    expect(openUrl).toHaveBeenCalledWith(OPEN_SOURCE_CREDITS[0]?.url);
  });

  it("is data-driven: an appended entry shows up with its NOTICE text", () => {
    stubApi();
    const { container } = render(() => (
      <OpenSourceCredits
        credits={[
          {
            name: "example/mcp-preset",
            url: "https://example.org/preset",
            licence: "Apache-2.0",
            copyright: "Copyright 2026 Example",
            notice: "Example preset\nCopyright 2026 Example",
          },
        ]}
      />
    ));
    expect(screen.getByText("example/mcp-preset")).toBeTruthy();
    expect(screen.getByText("NOTICE")).toBeTruthy();
    expect(container.querySelector(".open-source-notice")?.textContent).toMatch(/Example preset/);
    expect(screen.queryByText("This project publishes no NOTICE file.")).toBeNull();
  });
});
