import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { VoiceModelInfo, VoiceSettings, VoiceState } from "../../shared/ipc";
import {
  downloadSize,
  SHERPA_VERSION,
  VOICE_ENGINE,
  VOICE_MODELS,
  type VoiceArchive,
  type VoiceFile,
  type VoiceModel,
  voiceModel,
} from "./voice-catalog";
import { VOICE_HOST_SCRIPT } from "./voice-host-script";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  dictationModel: null,
  dictationLanguage: "",
  speakers: {},
  readAloud: false,
  speed: 1,
};

const IDLE_SHUTDOWN_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_SPOKEN_CHARS = 1_500;

export interface VoiceServiceOptions {
  /** Folder that holds voice/engine, voice/models and voice/settings.json. */
  userDataPath: string;
  fetchImpl?: typeof fetch;
  /** Windows' bsdtar unpacks .tar.bz2 and .zip; Git's GNU tar does not do zip. */
  tarPath?: string;
  powershellPath?: string;
}

interface Progress {
  phase: VoiceModelInfo["phase"];
  received: number;
  message: string | null;
  abort?: AbortController;
}

interface HostRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** Scripts we can read aloud with the Indian voices, by Unicode block. */
const SCRIPT_LANGUAGES: [RegExp, string][] = [
  [/[\u0980-\u09FF]/, "bn"],
  [/[\u0A00-\u0A7F]/, "pa"],
  [/[\u0A80-\u0AFF]/, "gu"],
  [/[\u0B00-\u0B7F]/, "or"],
  [/[\u0B80-\u0BFF]/, "ta"],
  [/[\u0C00-\u0C7F]/, "te"],
  [/[\u0C80-\u0CFF]/, "kn"],
  [/[\u0D00-\u0D7F]/, "ml"],
  [/[\u0900-\u097F]/, "hi"],
];

/** The language a reply is written in, judged by its script ("en" for Latin text). */
export function spokenLanguage(text: string): string {
  let best = "en";
  let bestCount = 0;
  for (const [pattern, code] of SCRIPT_LANGUAGES) {
    const count = text.match(new RegExp(pattern.source, "g"))?.length ?? 0;
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return bestCount > latin / 3 ? best : "en";
}

/** Turns a chat reply into something worth hearing: no code, links or markdown marks. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPOKEN_CHARS);
}

/** Indian scripts have no capitals; end the sentence the way the script does. */
export function tidyDictation(text: string, punctuates: boolean, language: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || punctuates) return clean;
  if (language === "en") return clean.charAt(0).toUpperCase() + clean.slice(1);
  return clean;
}

export class VoiceService extends EventEmitter {
  readonly #root: string;
  readonly #fetch: typeof fetch;
  readonly #tar: string;
  readonly #powershell: string;
  #settings: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS };
  #installed = new Set<string>();
  #engineInstalled = false;
  readonly #progress = new Map<string, Progress>();
  #host: ChildProcessWithoutNullStreams | null = null;
  #hostReady: Promise<void> | null = null;
  readonly #pending = new Map<number, HostRequest>();
  #nextId = 1;
  #idleTimer: NodeJS.Timeout | null = null;
  #engineInstall: Promise<void> | null = null;

  constructor(options: VoiceServiceOptions) {
    super();
    this.#root = join(options.userDataPath, "voice");
    this.#fetch = options.fetchImpl ?? fetch;
    const system = process.env.SystemRoot ?? "C:\\Windows";
    this.#tar = options.tarPath ?? join(system, "System32", "tar.exe");
    this.#powershell =
      options.powershellPath ??
      join(system, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }

  get #engineDir(): string {
    return join(this.#root, "engine", SHERPA_VERSION);
  }

  #modelDir(id: string): string {
    return join(this.#root, "models", id);
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.#root, "models"), { recursive: true });
    try {
      const saved = JSON.parse(await readFile(join(this.#root, "settings.json"), "utf8"));
      this.#settings = sanitizeSettings(saved);
    } catch {
      this.#settings = { ...DEFAULT_VOICE_SETTINGS };
    }
    this.#engineInstalled = await exists(join(this.#engineDir, "ready.json"));
    for (const model of VOICE_MODELS) {
      if (await exists(join(this.#modelDir(model.id), "ready.json"))) this.#installed.add(model.id);
    }
    if (this.#settings.dictationModel && !this.#installed.has(this.#settings.dictationModel)) {
      this.#settings.dictationModel = null;
    }
  }

  getState(): VoiceState {
    return {
      engineInstalled: this.#engineInstalled,
      engineSizeBytes: VOICE_ENGINE.native.size + VOICE_ENGINE.binding.size,
      settings: { ...this.#settings, speakers: { ...this.#settings.speakers } },
      models: VOICE_MODELS.map((model) => this.#info(model)),
    };
  }

  #info(model: VoiceModel): VoiceModelInfo {
    const progress = this.#progress.get(model.id);
    return {
      id: model.id,
      type: model.type,
      group: model.type === "speech" ? "speech" : model.group,
      name: model.name,
      summary: model.summary,
      licence: model.licence,
      languages: model.languages,
      sizeBytes: downloadSize(model),
      punctuates: model.type === "dictation" ? model.punctuates : false,
      speakers: model.type === "speech" ? model.speakers : [],
      installed: this.#installed.has(model.id),
      phase: progress?.phase ?? "idle",
      receivedBytes: progress?.received ?? 0,
      message: progress?.message ?? null,
    };
  }

  #emit(): void {
    this.emit("state", this.getState());
  }

  async setSettings(patch: Partial<VoiceSettings>): Promise<VoiceState> {
    const next = sanitizeSettings({ ...this.#settings, ...patch });
    if (next.dictationModel && !this.#installed.has(next.dictationModel)) {
      throw new Error("Download that model first.");
    }
    this.#settings = next;
    await writeFile(join(this.#root, "settings.json"), JSON.stringify(next, null, 2), "utf8");
    this.#emit();
    return this.getState();
  }

  /** Downloads the engine (once) and a model, checking every file's SHA-256. */
  async install(id: string): Promise<VoiceState> {
    const model = voiceModel(id);
    if (!model) throw new Error("Unknown voice model.");
    if (this.#installed.has(id)) return this.getState();
    const running = this.#progress.get(id);
    if (running && (running.phase === "downloading" || running.phase === "installing")) {
      return this.getState();
    }
    const abort = new AbortController();
    this.#progress.set(id, { phase: "downloading", received: 0, message: null, abort });
    this.#emit();
    void this.#runInstall(model, abort).catch(() => undefined);
    return this.getState();
  }

  async #runInstall(model: VoiceModel, abort: AbortController): Promise<void> {
    const progress = this.#progress.get(model.id);
    if (!progress) return;
    const report = (received: number) => {
      progress.received = received;
      this.#emitThrottled();
    };
    try {
      await this.#ensureEngine(abort.signal);
      const target = this.#modelDir(model.id);
      const work = `${target}.partial`;
      await rm(work, { recursive: true, force: true });
      await mkdir(work, { recursive: true });
      if (model.archive) {
        await this.#installArchive(model.archive, work, abort.signal, report, () => {
          progress.phase = "installing";
          this.#emit();
        });
      } else {
        let done = 0;
        for (const file of model.files ?? []) {
          await this.#downloadFile(file, join(work, file.path), abort.signal, (received) =>
            report(done + received),
          );
          done += file.size;
        }
      }
      await writeFile(
        join(work, "ready.json"),
        JSON.stringify({ id: model.id, installedAt: new Date().toISOString() }),
        "utf8",
      );
      await rm(target, { recursive: true, force: true });
      await rename(work, target);
      this.#installed.add(model.id);
      this.#progress.delete(model.id);
      if (model.type === "dictation" && !this.#settings.dictationModel) {
        await this.setSettings({ dictationModel: model.id });
      }
      this.#emit();
    } catch (error) {
      await rm(`${this.#modelDir(model.id)}.partial`, { recursive: true, force: true });
      if (abort.signal.aborted) {
        this.#progress.delete(model.id);
      } else {
        progress.phase = "failed";
        progress.message = friendlyError(error);
      }
      this.#emit();
    }
  }

  #lastEmit = 0;
  #emitThrottled(): void {
    const now = Date.now();
    if (now - this.#lastEmit < 250) return;
    this.#lastEmit = now;
    this.#emit();
  }

  async cancel(id: string): Promise<VoiceState> {
    this.#progress.get(id)?.abort?.abort();
    return this.getState();
  }

  async remove(id: string): Promise<VoiceState> {
    await this.#stopHost();
    await rm(this.#modelDir(id), { recursive: true, force: true });
    this.#installed.delete(id);
    this.#progress.delete(id);
    if (this.#settings.dictationModel === id) {
      const fallback = VOICE_MODELS.find(
        (m) => m.type === "dictation" && this.#installed.has(m.id),
      );
      await this.setSettings({ dictationModel: fallback?.id ?? null });
    }
    this.#emit();
    return this.getState();
  }

  async #ensureEngine(signal: AbortSignal): Promise<void> {
    if (this.#engineInstalled) return;
    this.#engineInstall ??= this.#installEngine(signal).finally(() => {
      this.#engineInstall = null;
    });
    await this.#engineInstall;
  }

  async #installEngine(signal: AbortSignal): Promise<void> {
    const work = `${this.#engineDir}.partial`;
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    await this.#installArchive(
      VOICE_ENGINE.native,
      work,
      signal,
      () => undefined,
      () => undefined,
    );
    const nupkg = join(work, "binding.zip");
    await this.#downloadFile(
      { path: "binding.zip", ...VOICE_ENGINE.binding },
      nupkg,
      signal,
      () => undefined,
    );
    await this.#untar(nupkg, join(work, "binding"));
    await rm(nupkg, { force: true });
    await writeFile(join(work, "ready.json"), JSON.stringify({ version: SHERPA_VERSION }), "utf8");
    await rm(this.#engineDir, { recursive: true, force: true });
    await rename(work, this.#engineDir);
    this.#engineInstalled = true;
  }

  async #installArchive(
    archive: VoiceArchive,
    work: string,
    signal: AbortSignal,
    report: (received: number) => void,
    onUnpack: () => void,
  ): Promise<void> {
    const file = join(work, basename(new URL(archive.url).pathname));
    await this.#downloadFile({ path: basename(file), ...archive }, file, signal, report);
    onUnpack();
    await this.#untar(file, work);
    await rm(file, { force: true });
    // Lift the archive's top folder so the model files sit directly in the model folder.
    const inner = join(work, archive.folder);
    if (await exists(inner)) {
      for (const entry of await readdir(inner)) await rename(join(inner, entry), join(work, entry));
      await rm(inner, { recursive: true, force: true });
    }
  }

  async #downloadFile(
    file: VoiceFile,
    destination: string,
    signal: AbortSignal,
    report: (received: number) => void,
  ): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    const response = await this.#fetch(file.url, { signal, redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (${response.status}) for ${basename(file.path)}.`);
    }
    const hash = createHash("sha256");
    let received = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        received += chunk.length;
        report(received);
        callback(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      meter,
      createWriteStream(destination),
      { signal },
    );
    if (hash.digest("hex") !== file.sha256) {
      await rm(destination, { force: true });
      throw new Error(`${basename(file.path)} was damaged while downloading. Try again.`);
    }
  }

  /** bsdtar with relative paths: it handles .tar.bz2 and .zip alike. */
  #untar(archive: string, directory: string): Promise<void> {
    return mkdir(directory, { recursive: true }).then(
      () =>
        new Promise<void>((resolvePromise, reject) => {
          execFile(
            this.#tar,
            ["-xf", archive, "-C", directory],
            { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
            (error) =>
              error
                ? reject(new Error(`Could not unpack ${basename(archive)}: ${error.message}`))
                : resolvePromise(),
          );
        }),
    );
  }

  // ---------------------------------------------------------------- speech-to-text

  async transcribe(samples: Float32Array): Promise<{ text: string; modelId: string }> {
    const id = this.#settings.dictationModel;
    const model = id ? voiceModel(id) : undefined;
    if (model?.type !== "dictation" || !this.#installed.has(model.id)) {
      throw new Error("Download a dictation model first: Settings → Voice.");
    }
    if (samples.length < 1_600) return { text: "", modelId: model.id };
    const dir = this.#modelDir(model.id);
    const asr =
      model.kind === "nemo-ctc"
        ? {
            kind: "nemo-ctc",
            model: join(dir, "model.int8.onnx"),
            tokens: join(dir, "tokens.txt"),
            threads: threads(),
          }
        : {
            kind: "whisper",
            encoder: join(dir, "encoder.int8.onnx"),
            decoder: join(dir, "decoder.int8.onnx"),
            tokens: join(dir, "tokens.txt"),
            language:
              model.id === "whisper-turbo"
                ? this.#settings.dictationLanguage
                : (model.whisperLanguage ?? ""),
            threads: threads(),
          };
    const clip = join(this.#root, "tmp", `clip-${Date.now()}-${this.#nextId}.f32`);
    await mkdir(dirname(clip), { recursive: true });
    await writeFile(clip, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
    try {
      const reply = await this.#request({ op: "transcribe", asr, pcm: clip });
      const text = typeof reply.text === "string" ? reply.text : "";
      return {
        text: tidyDictation(text, model.punctuates, model.languages[0] ?? ""),
        modelId: model.id,
      };
    } finally {
      await rm(clip, { force: true });
    }
  }

  // ---------------------------------------------------------------- text-to-speech

  /** Reads text aloud with the installed voice that fits its script; null when none fits. */
  async speak(raw: string): Promise<Uint8Array | null> {
    const text = speakableText(raw);
    if (!text) return null;
    const language = spokenLanguage(text);
    const voice =
      VOICE_MODELS.find(
        (m) => m.type === "speech" && this.#installed.has(m.id) && m.languages.includes(language),
      ) ?? null;
    if (voice?.type !== "speech") return null;
    const dir = this.#modelDir(voice.id);
    const tts =
      voice.kind === "vits"
        ? {
            kind: "vits",
            model: join(dir, "model.onnx"),
            tokens: join(dir, "tokens.txt"),
            threads: threads(),
          }
        : {
            kind: "kokoro",
            model: join(dir, "model.int8.onnx"),
            voices: join(dir, "voices.bin"),
            tokens: join(dir, "tokens.txt"),
            lexicon: join(dir, "lexicon-us-en.txt"),
            threads: threads(),
          };
    const speaker =
      this.#settings.speakers[language] ??
      voice.speakers.find((s) => s.languages.includes(language))?.id ??
      voice.speakers[0]?.id ??
      0;
    // Sentence-final marks make the Indian voices add a burst of noise at the end.
    const spoken = voice.kind === "vits" ? text.replace(/[.?!।]+\s*$/u, "") : text;
    const out = join(this.#root, "tmp", `speech-${Date.now()}-${this.#nextId}.wav`);
    await mkdir(dirname(out), { recursive: true });
    try {
      await this.#request({
        op: "speak",
        tts,
        text: spoken,
        sid: speaker,
        speed: this.#settings.speed,
        out,
      });
      return new Uint8Array(await readFile(out));
    } finally {
      await rm(out, { force: true });
    }
  }

  // ---------------------------------------------------------------- the host process

  async #startHost(): Promise<void> {
    if (!this.#engineInstalled) throw new Error("The voice engine is not downloaded yet.");
    const script = join(this.#root, "voice-host.ps1");
    // A byte-order mark makes Windows PowerShell 5.1 read the script as UTF-8.
    await writeFile(script, `\uFEFF${VOICE_HOST_SCRIPT}`, "utf8");
    const lib = join(this.#engineDir, "lib");
    const binding = join(this.#engineDir, "binding", ...VOICE_ENGINE.binding.entry.split("/"));
    const child = spawn(
      this.#powershell,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Lib",
        lib,
        "-Binding",
        binding,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    this.#host = child;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    await new Promise<void>((resolvePromise, reject) => {
      const lines = createInterface({ input: child.stdout });
      let ready = false;
      lines.on("line", (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line);
        } catch {
          return;
        }
        if (!ready && message.ready === true) {
          ready = true;
          resolvePromise();
          return;
        }
        const id = typeof message.id === "number" ? message.id : -1;
        const request = this.#pending.get(id);
        if (!request) return;
        this.#pending.delete(id);
        clearTimeout(request.timer);
        if (message.ok === true) request.resolve(message);
        else request.reject(new Error(String(message.error ?? "The voice engine failed.")));
      });
      child.on("exit", (code) => {
        this.#host = null;
        this.#hostReady = null;
        const reason = new Error(
          `The voice engine stopped (code ${code ?? "?"}). ${lastUsefulLine(stderr)}`.trim(),
        );
        if (!ready) reject(reason);
        for (const request of this.#pending.values()) {
          clearTimeout(request.timer);
          request.reject(reason);
        }
        this.#pending.clear();
      });
      child.on("error", (error) => reject(error));
    });
  }

  async #request(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.#hostReady ??= this.#startHost().catch((error) => {
      this.#hostReady = null;
      throw error;
    });
    await this.#hostReady;
    const host = this.#host;
    if (!host) throw new Error("The voice engine is not running.");
    this.#touch();
    const id = this.#nextId++;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error("The voice engine took too long. Try a shorter clip."));
        void this.#stopHost();
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve: resolvePromise, reject, timer });
      host.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
    });
  }

  #touch(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => void this.#stopHost(), IDLE_SHUTDOWN_MS);
    this.#idleTimer.unref?.();
  }

  async #stopHost(): Promise<void> {
    const host = this.#host;
    this.#host = null;
    this.#hostReady = null;
    if (!host) return;
    host.stdin.end();
    await new Promise<void>((resolvePromise) => {
      const timer = setTimeout(() => {
        host.kill();
        resolvePromise();
      }, 3_000);
      host.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }

  async dispose(): Promise<void> {
    for (const progress of this.#progress.values()) progress.abort?.abort();
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    await this.#stopHost();
  }
}

function sanitizeSettings(input: unknown): VoiceSettings {
  const value = (input && typeof input === "object" ? input : {}) as Partial<VoiceSettings>;
  const speakers: Record<string, number> = {};
  if (value.speakers && typeof value.speakers === "object") {
    for (const [language, id] of Object.entries(value.speakers)) {
      if (/^[a-z]{2,3}$/.test(language) && Number.isInteger(id) && id >= 0 && id < 1024) {
        speakers[language] = id;
      }
    }
  }
  const speed = typeof value.speed === "number" && Number.isFinite(value.speed) ? value.speed : 1;
  return {
    dictationModel:
      typeof value.dictationModel === "string" && voiceModel(value.dictationModel)
        ? value.dictationModel
        : null,
    dictationLanguage:
      typeof value.dictationLanguage === "string" && /^[a-z]{0,3}$/.test(value.dictationLanguage)
        ? value.dictationLanguage
        : "",
    speakers,
    readAloud: value.readAloud === true,
    speed: Math.min(1.6, Math.max(0.7, speed)),
  };
}

function threads(): number {
  return 4;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function lastUsefulLine(output: string): string {
  return (
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !/^at |^\+|CategoryInfo|FullyQualifiedErrorId/.test(line))
      .at(-1) ?? ""
  ).slice(0, 240);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOSPC/.test(message)) return "Not enough free disk space for this model.";
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(message)) {
    return "Could not reach the download server. Check the internet and try again.";
  }
  return message.slice(0, 240);
}
