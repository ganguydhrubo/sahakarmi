import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VoiceState } from "../../shared/ipc";
import { downloadSize, INDIC_LANGUAGES, VOICE_ENGINE, VOICE_MODELS } from "./voice-catalog";
import { VOICE_HOST_SCRIPT } from "./voice-host-script";
import { speakableText, spokenLanguage, tidyDictation, VoiceService } from "./voice-service";

const folders: string[] = [];
async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "sahkarmi-voice-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("voice catalog", () => {
  it("pins every download to https, a SHA-256 and a size", () => {
    const files = [
      VOICE_ENGINE.native,
      VOICE_ENGINE.binding,
      ...VOICE_MODELS.flatMap((model) => [
        ...(model.files ?? []),
        ...(model.archive ? [model.archive] : []),
      ]),
    ];
    for (const file of files) {
      expect(file.url).toMatch(/^https:\/\//);
      expect(file.url).not.toMatch(/\/resolve\/main\//);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it("covers all 22 scheduled Indian languages with unique ids", () => {
    expect(INDIC_LANGUAGES).toHaveLength(22);
    const ids = VOICE_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [code] of INDIC_LANGUAGES) expect(ids).toContain(`indic-${code}`);
  });

  it("adds up file sizes for a model", () => {
    const hindi = VOICE_MODELS.find((model) => model.id === "indic-hi");
    expect(hindi && downloadSize(hindi)).toBe(197_595_593 + 67_605);
  });

  it("keeps the host script free of characters that break the PowerShell here-string", () => {
    const body = VOICE_HOST_SCRIPT.slice(
      VOICE_HOST_SCRIPT.indexOf("@'") + 2,
      VOICE_HOST_SCRIPT.lastIndexOf("'@"),
    );
    expect(body).not.toContain("'@");
    expect(VOICE_HOST_SCRIPT.trimEnd().endsWith("import")).toBe(false);
  });
});

describe("spoken replies", () => {
  it("picks the language from the script", () => {
    expect(spokenLanguage("आपकी रिपोर्ट तैयार है")).toBe("hi");
    expect(spokenLanguage("আপনার রিপোর্ট তৈরি")).toBe("bn");
    expect(spokenLanguage("Your report is ready")).toBe("en");
    expect(spokenLanguage("Report ready है")).toBe("en");
  });

  it("drops code, links and markdown marks", () => {
    const text = speakableText(
      "## Done\n\n- **Saved** the [report](https://x.example/r)\n```js\nconsole.log(1)\n```\nSee `file.txt`.",
    );
    expect(text).toBe("Done Saved the report See file.txt.");
  });
});

describe("dictation text", () => {
  it("capitalises English without punctuation and leaves Indian scripts alone", () => {
    expect(tidyDictation("  send the quote  ", false, "en")).toBe("Send the quote");
    expect(tidyDictation("कोटेशन भेजो", false, "hi")).toBe("कोटेशन भेजो");
    expect(tidyDictation("Quote bhejo.", true, "hi-en")).toBe("Quote bhejo.");
  });
});

describe("VoiceService", () => {
  it("starts with safe defaults and nothing installed", async () => {
    const service = new VoiceService({ userDataPath: await tempFolder() });
    await service.initialize();
    const state = service.getState();
    expect(state.engineInstalled).toBe(false);
    expect(state.settings).toEqual({
      dictationModel: null,
      dictationLanguage: "",
      speakers: {},
      readAloud: false,
      speed: 1,
    });
    expect(state.models.every((model) => !model.installed && model.phase === "idle")).toBe(true);
  });

  it("cleans saved settings it cannot trust", async () => {
    const folder = await tempFolder();
    const service = new VoiceService({ userDataPath: folder });
    await service.initialize();
    await writeFile(
      join(folder, "voice", "settings.json"),
      JSON.stringify({
        dictationModel: "indic-hi",
        dictationLanguage: "../../x",
        speakers: { hi: 2, "../x": 1, bn: -4 },
        readAloud: "yes",
        speed: 9,
      }),
    );
    const reloaded = new VoiceService({ userDataPath: folder });
    await reloaded.initialize();
    expect(reloaded.getState().settings).toEqual({
      dictationModel: null,
      dictationLanguage: "",
      speakers: { hi: 2 },
      readAloud: false,
      speed: 1.6,
    });
  });

  it("refuses to use a model that is not downloaded", async () => {
    const service = new VoiceService({ userDataPath: await tempFolder() });
    await service.initialize();
    await expect(service.setSettings({ dictationModel: "indic-hi" })).rejects.toThrow(/Download/);
    await expect(service.transcribe(new Float32Array(16_000))).rejects.toThrow(/Download/);
    expect(await service.speak("नमस्ते")).toBeNull();
  });

  it("saves the read-aloud choice", async () => {
    const folder = await tempFolder();
    const service = new VoiceService({ userDataPath: folder });
    await service.initialize();
    await service.setSettings({ readAloud: true, speakers: { hi: 9 } });
    const saved = JSON.parse(await readFile(join(folder, "voice", "settings.json"), "utf8"));
    expect(saved.readAloud).toBe(true);
    expect(saved.speakers).toEqual({ hi: 9 });
  });

  it("rejects a damaged download and leaves nothing half-installed", async () => {
    const folder = await tempFolder();
    const fetchImpl = (async () => new Response("not the real file")) as unknown as typeof fetch;
    const service = new VoiceService({ userDataPath: folder, fetchImpl });
    await service.initialize();
    const finished = new Promise<void>((resolve) =>
      service.on("state", (state: VoiceState) => {
        if (state.models.find((model) => model.id === "indic-hi")?.phase === "failed") resolve();
      }),
    );
    await service.install("indic-hi");
    await finished;
    const hindi = service.getState().models.find((model) => model.id === "indic-hi");
    expect(hindi?.installed).toBe(false);
    expect(hindi?.message).toMatch(/damaged/);
    expect(service.getState().engineInstalled).toBe(false);
  });
});
