import { describe, expect, it, vi } from "vitest";
import { revealDbLocation, type DbLocationDeps } from "./db-location";

function deps(overrides: Partial<DbLocationDeps> = {}): DbLocationDeps {
  return {
    getPath: async () => "/data/kindclip.db",
    reveal: async () => {},
    openDir: async () => {},
    ...overrides,
  };
}

describe("revealDbLocation", () => {
  it("resolves the path and reveals it in the file explorer", async () => {
    const calls: string[] = [];
    const getPath = async (): Promise<string> => {
      calls.push("getPath");
      return "/data/kindclip.db";
    };
    const reveal = async (path: string): Promise<void> => {
      calls.push(`reveal:${path}`);
    };

    await expect(revealDbLocation(deps({ getPath, reveal }))).resolves.toBe("/data/kindclip.db");
    expect(calls).toEqual(["getPath", "reveal:/data/kindclip.db"]);
  });

  it("propagates failures so the UI can show the path", async () => {
    const failure = new Error("no explorer");
    const reveal = vi.fn().mockRejectedValue(new Error("os error 2"));
    const openDir = vi.fn().mockRejectedValue(failure);

    await expect(
      revealDbLocation(deps({ getPath: async () => "/data/kindclip.db", reveal, openDir })),
    ).rejects.toBe(failure);
    expect(reveal).toHaveBeenCalledWith("/data/kindclip.db");
  });

  it("opens the parent folder when revealing the file fails", async () => {
    const openDir = vi.fn().mockResolvedValue(undefined);

    await expect(
      revealDbLocation(
        deps({
          getPath: async () => "/data/kindclip.db",
          reveal: async () => {
            throw new Error("os error 2");
          },
          openDir,
        }),
      ),
    ).resolves.toBe("/data/kindclip.db");
    expect(openDir).toHaveBeenCalledWith("/data");
  });

  it("supports Windows-style parent folders in the fallback", async () => {
    const openDir = vi.fn().mockResolvedValue(undefined);

    await expect(
      revealDbLocation(
        deps({
          getPath: async () => "C:\\Users\\ana\\AppData\\kindclip.db",
          reveal: async () => {
            throw new Error("os error 2");
          },
          openDir,
        }),
      ),
    ).resolves.toBe("C:\\Users\\ana\\AppData\\kindclip.db");
    expect(openDir).toHaveBeenCalledWith("C:\\Users\\ana\\AppData");
  });

  it("rejects only when both reveal and folder fallback fail", async () => {
    const failure = new Error("no explorer at all");
    const reveal = vi.fn().mockRejectedValue(new Error("os error 2"));
    const openDir = vi.fn().mockRejectedValue(failure);

    await expect(revealDbLocation(deps({ reveal, openDir }))).rejects.toBe(failure);
  });
});
