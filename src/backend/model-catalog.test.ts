// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAgentModel, modelIdForProvider, modelWireId, providerForModel } from "../shared/ipc";
import { ModelRefreshLoop, mergeProviderCatalog } from "./model-catalog";

afterEach(() => vi.useRealTimers());

describe("provider model catalogs", () => {
  it("accepts new provider-reported IDs without an app release and keeps provider routing", () => {
    for (const provider of ["codex", "claude", "gemini", "opencode"] as const) {
      const wire = "vendor/future-model-v2";
      const models = mergeProviderCatalog(
        provider,
        {
          data: [
            {
              model: wire,
              displayName: "Future model",
              supportedReasoningEfforts: [{ reasoningEffort: "high" }],
            },
            { model: "hidden-model", hidden: true },
            { model: "bad id" },
          ],
        },
        [],
        [],
      );
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({
        id: `${provider}:${wire}`,
        name: "Future model",
        supportedReasoningEfforts: ["high"],
      });
      expect(providerForModel(models[0].id)).toBe(provider);
      expect(modelWireId(models[0].id)).toBe(wire);
      expect(isAgentModel(JSON.parse(JSON.stringify(models[0].id)))).toBe(true);
    }
    expect(modelIdForProvider("codex", "gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(modelIdForProvider("opencode", "gpt-5.6-luna")).toBe("opencode:gpt-5.6-luna");
    expect(isAgentModel("other:new")).toBe(false);
    expect(isAgentModel("codex:bad\nmodel")).toBe(false);
  });

  it("retains a working list for empty, malformed and offline responses", () => {
    const previous = mergeProviderCatalog(
      "codex",
      { data: [{ model: "future", displayName: "Future" }] },
      [],
      [],
    );
    for (const response of [null, {}, { data: [] }, { data: [{ model: 12 }] }]) {
      expect(mergeProviderCatalog("codex", response, [], previous)).toEqual(previous);
    }
  });
});

describe("automatic model refresh", () => {
  it("refreshes periodically, throttles focus, coalesces work and stops cleanly", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const loop = new ModelRefreshLoop(refresh, 1000, 100);
    loop.start();
    await loop.request();
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    const pending = loop.request();
    expect(loop.request(true)).toBe(pending);
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await pending;
    await vi.advanceTimersByTimeAsync(900);
    expect(refresh).toHaveBeenCalledTimes(2);
    release();
    await Promise.resolve();
    loop.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await loop.request(true);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed refresh", async () => {
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const loop = new ModelRefreshLoop(refresh);
    loop.start();
    await loop.request(true);
    await loop.request(true);
    expect(refresh).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});
