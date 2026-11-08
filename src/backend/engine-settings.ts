import { totalmem } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ENGINE_SETTINGS,
  ENGINE_SETTINGS_LIMITS,
  type EngineSettings,
  MIN_MEMORY_LIMIT_MB,
} from "../shared/ipc";
import { JsonFile } from "./json-file";
import { isRecord } from "./protocol";

function clamp(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

/** Any stored or requested value, made safe: unknown keys dropped, numbers kept in range. */
export function normaliseEngineSettings(
  value: unknown,
  base: EngineSettings = DEFAULT_ENGINE_SETTINGS,
): EngineSettings {
  const input = isRecord(value) ? value : {};
  return {
    maxConcurrentTurns: clamp(
      input.maxConcurrentTurns,
      ENGINE_SETTINGS_LIMITS.maxConcurrentTurns,
      base.maxConcurrentTurns,
    ),
    watchdogMinutes: clamp(
      input.watchdogMinutes,
      ENGINE_SETTINGS_LIMITS.watchdogMinutes,
      base.watchdogMinutes,
    ),
    memoryLimitMb: memoryLimit(input.memoryLimitMb, base.memoryLimitMb),
    memoryWarnPercent: clamp(
      input.memoryWarnPercent,
      ENGINE_SETTINGS_LIMITS.memoryWarnPercent,
      base.memoryWarnPercent ?? DEFAULT_ENGINE_SETTINGS.memoryWarnPercent,
    ),
    maxStepsPerTurn: clamp(
      input.maxStepsPerTurn,
      ENGINE_SETTINGS_LIMITS.maxStepsPerTurn,
      base.maxStepsPerTurn ?? DEFAULT_ENGINE_SETTINGS.maxStepsPerTurn,
    ),
  };
}

/** 0 (Automatic), or between 1 GB and the PC's installed RAM. */
function memoryLimit(value: unknown, fallback: number | undefined): number {
  const base = fallback ?? DEFAULT_ENGINE_SETTINGS.memoryLimitMb;
  if (typeof value !== "number" || !Number.isFinite(value)) return base;
  if (value <= 0) return 0;
  const ramMb = Math.floor(totalmem() / (1024 * 1024));
  return Math.round(
    Math.min(Math.max(value, MIN_MEMORY_LIMIT_MB), Math.max(ramMb, MIN_MEMORY_LIMIT_MB)),
  );
}

function isStored(value: unknown): value is EngineSettings {
  return isRecord(value);
}

/** The owner's engine limits, in <userData>/engine-settings.json. Read once, then from memory. */
export class EngineSettingsStore {
  readonly #file: JsonFile<EngineSettings>;
  #current: EngineSettings = { ...DEFAULT_ENGINE_SETTINGS };

  constructor(userDataPath: string) {
    this.#file = new JsonFile<EngineSettings>(join(userDataPath, "engine-settings.json"));
  }

  async initialize(): Promise<void> {
    const stored = await this.#file
      .read(() => ({ ...DEFAULT_ENGINE_SETTINGS }), isStored)
      .catch(() => ({ ...DEFAULT_ENGINE_SETTINGS }));
    this.#current = normaliseEngineSettings(stored);
  }

  get(): EngineSettings {
    return { ...this.#current };
  }

  async update(input: unknown): Promise<EngineSettings> {
    this.#current = normaliseEngineSettings(input, this.#current);
    await this.#file.write(this.#current);
    return this.get();
  }
}
