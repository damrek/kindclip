import { afterEach, describe, expect, it, vi } from "vitest";
import { readStored, writeStored } from "./storage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("storage", () => {
  it("reads and writes through localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    });

    writeStored("kindclip-test", "value");

    expect(store.get("kindclip-test")).toBe("value");
    expect(readStored("kindclip-test")).toBe("value");
    expect(readStored("kindclip-missing")).toBeNull();
  });

  it("falls back to absence and swallows write failures", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage is blocked");
      },
      setItem: () => {
        throw new Error("storage is blocked");
      },
    });

    expect(readStored("kindclip-test")).toBeNull();
    expect(() => writeStored("kindclip-test", "value")).not.toThrow();
  });
});
