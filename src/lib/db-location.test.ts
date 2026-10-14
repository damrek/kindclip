import { describe, expect, it, vi } from "vitest";
import { revealDbLocation } from "./db-location";

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

    await expect(revealDbLocation({ getPath, reveal })).resolves.toBe("/data/kindclip.db");
    expect(calls).toEqual(["getPath", "reveal:/data/kindclip.db"]);
  });

  it("propagates reveal failures so the UI can show the path", async () => {
    const failure = new Error("no explorer");
    const getPath = async (): Promise<string> => "/data/kindclip.db";
    const reveal = vi.fn().mockRejectedValue(failure);

    await expect(revealDbLocation({ getPath, reveal })).rejects.toBe(failure);
    expect(reveal).toHaveBeenCalledWith("/data/kindclip.db");
  });
});
