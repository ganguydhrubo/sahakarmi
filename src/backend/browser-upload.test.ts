import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getName: () => "Sahkarmi" } }));

const { checkUploadFiles, uploadThroughCdp } = await import("./browser-host");

const dir = mkdtempSync(join(tmpdir(), "sahkarmi-upload-"));
const photo = join(dir, "banner.png");
const second = join(dir, "second.png");
writeFileSync(photo, "png");
writeFileSync(second, "png");

type Listener = (method: string, params: Record<string, unknown>) => void;

function fakeCdp(options: { directInput: boolean; multiple?: boolean; chooser?: boolean }) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const listeners = new Set<Listener>();
  const send = async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === "Runtime.evaluate" && params.returnByValue === false) {
      return options.directInput
        ? { result: { type: "object", objectId: "input-1" } }
        : { result: { type: "object", subtype: "null", value: null } };
    }
    if (method === "Runtime.evaluate") return { result: { value: { x: 40, y: 50 } } };
    if (method === "Runtime.callFunctionOn")
      return { result: { value: options.multiple === true } };
    if (
      method === "Input.dispatchMouseEvent" &&
      params.type === "mouseReleased" &&
      options.chooser
    ) {
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener("Page.fileChooserOpened", { backendNodeId: 77, mode: "selectSingle" });
        }
      });
    }
    return {};
  };
  const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { cdp: { send, subscribe }, calls, listeners };
}

describe("checkUploadFiles", () => {
  it("accepts existing files by full path", () => {
    expect(checkUploadFiles([photo])).toEqual([photo]);
  });

  it("rejects relative paths, missing files, folders and too many files", () => {
    expect(() => checkUploadFiles(["banner.png"])).toThrow(/full path/);
    expect(() => checkUploadFiles([join(dir, "missing.png")])).toThrow(/not found/);
    expect(() => checkUploadFiles([dir])).toThrow(/Not a file/);
    expect(() => checkUploadFiles(Array(11).fill(photo))).toThrow(/at most 10/);
    expect(() => checkUploadFiles([])).toThrow(/at least one/);
  });
});

describe("uploadThroughCdp", () => {
  it("sets files directly on a file input, one file unless it accepts several", async () => {
    const { cdp, calls } = fakeCdp({ directInput: true });
    await expect(uploadThroughCdp(cdp, "3:7", [photo, second])).resolves.toBe(1);
    expect(calls.find((call) => call.method === "DOM.setFileInputFiles")?.params).toEqual({
      files: [photo],
      objectId: "input-1",
    });
    expect(calls.some((call) => call.method === "Input.dispatchMouseEvent")).toBe(false);
  });

  it("passes every file to an input that accepts several", async () => {
    const { cdp, calls } = fakeCdp({ directInput: true, multiple: true });
    await expect(uploadThroughCdp(cdp, "3:7", [photo, second])).resolves.toBe(2);
    expect(calls.find((call) => call.method === "DOM.setFileInputFiles")?.params.files).toEqual([
      photo,
      second,
    ]);
  });

  it("clicks a button with the file picker intercepted and fills the picker's input", async () => {
    const { cdp, calls, listeners } = fakeCdp({ directInput: false, chooser: true });
    await expect(uploadThroughCdp(cdp, "3:9", [photo])).resolves.toBe(1);
    const methods = calls.map((call) => call.method);
    expect(methods).toContain("Input.dispatchMouseEvent");
    expect(calls.find((call) => call.method === "DOM.setFileInputFiles")?.params).toEqual({
      files: [photo],
      backendNodeId: 77,
    });
    const intercepts = calls.filter((call) => call.method === "Page.setInterceptFileChooserDialog");
    expect(intercepts.map((call) => call.params.enabled)).toEqual([true, false]);
    expect(listeners.size).toBe(0);
  });

  it("explains when the click opens no file picker and turns interception off", async () => {
    vi.useFakeTimers();
    try {
      const { cdp, calls } = fakeCdp({ directInput: false, chooser: false });
      const result = uploadThroughCdp(cdp, "3:9", [photo]);
      const assertion = expect(result).rejects.toThrow(/did not open a file picker/);
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
      const last = calls
        .filter((call) => call.method === "Page.setInterceptFileChooserDialog")
        .at(-1);
      expect(last?.params.enabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
