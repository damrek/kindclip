import { describe, expect, it } from "vitest";
import { pickDroppedFile, runImportFlow, runImportFromPath, type ImportDeps } from "./importer";
import type { ClippingDto } from "./types";
import type { DbPort } from "./db";

function dto(hash: string): ClippingDto {
  return {
    title: "B",
    author: null,
    kind: "highlight",
    page: 1,
    location: "1",
    added_on_raw: "r",
    added_on: null,
    content: "c",
    content_hash: hash,
  };
}

/** Fake port backing the import orchestration (empty library). */
function fakePort(): DbPort {
  let nextId = 1;
  return {
    select: async () => [],
    execute: async () => ({ lastInsertId: nextId++, rowsAffected: 1 }),
  };
}

describe("runImportFlow", () => {
  it("returns cancelled when no file is picked", async () => {
    const deps: ImportDeps = {
      pickFile: async () => null,
      parseFile: async () => {
        throw new Error("must not be called");
      },
      getPort: async () => fakePort(),
    };
    await expect(runImportFlow(deps, () => {})).resolves.toEqual({ status: "cancelled" });
  });

  it("returns empty when the file has no clippings", async () => {
    const deps: ImportDeps = {
      pickFile: async () => "/tmp/empty.txt",
      parseFile: async (path) => ({ path, fileHash: "h", clippings: [], skipped: 0 }),
      getPort: async () => fakePort(),
    };
    await expect(runImportFlow(deps, () => {})).resolves.toEqual({
      status: "empty",
      path: "/tmp/empty.txt",
      skipped: 0,
    });
  });

  it("reports the skipped count on an empty import", async () => {
    const deps: ImportDeps = {
      pickFile: async () => "/tmp/unreadable.txt",
      parseFile: async (path) => ({ path, fileHash: "h", clippings: [], skipped: 12 }),
      getPort: async () => fakePort(),
    };
    await expect(runImportFlow(deps, () => {})).resolves.toEqual({
      status: "empty",
      path: "/tmp/unreadable.txt",
      skipped: 12,
    });
  });

  it("imports parsed clippings and reports progress", async () => {
    const progress: Array<[number, number]> = [];
    const deps: ImportDeps = {
      pickFile: async () => "/tmp/My Clippings.txt",
      parseFile: async (path) => ({
        path,
        fileHash: "h",
        clippings: [dto("a"), dto("b")],
        skipped: 3,
      }),
      getPort: async () => fakePort(),
    };
    const outcome = await runImportFlow(deps, (done, total) => progress.push([done, total]));
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.report.inserted).toBe(2);
      expect(outcome.report.total).toBe(2);
      expect(outcome.report.skipped).toBe(3);
    }
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("propagates parse errors", async () => {
    const deps: ImportDeps = {
      pickFile: async () => "/tmp/broken.txt",
      parseFile: async () => {
        throw new Error("cannot read file");
      },
      getPort: async () => fakePort(),
    };
    await expect(runImportFlow(deps, () => {})).rejects.toThrow("cannot read file");
  });
});

describe("runImportFromPath", () => {
  it("imports the given path without opening the picker", async () => {
    const picked: string[] = [];
    const deps: ImportDeps = {
      pickFile: async () => {
        picked.push("picker");
        return null;
      },
      parseFile: async (path) => ({ path, fileHash: "h", clippings: [dto("a")], skipped: 0 }),
      getPort: async () => fakePort(),
    };
    const outcome = await runImportFromPath(deps, "/tmp/dropped.txt", () => {});
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.report.inserted).toBe(1);
    }
    expect(picked).toEqual([]);
  });

  it("reports an empty dropped file with its path", async () => {
    const deps: ImportDeps = {
      pickFile: async () => null,
      parseFile: async (path) => ({ path, fileHash: "h", clippings: [], skipped: 4 }),
      getPort: async () => fakePort(),
    };
    await expect(runImportFromPath(deps, "/tmp/dropped.txt", () => {})).resolves.toEqual({
      status: "empty",
      path: "/tmp/dropped.txt",
      skipped: 4,
    });
  });
});

describe("pickDroppedFile", () => {
  it("returns the first .txt path, ignoring other files", () => {
    expect(
      pickDroppedFile(["/tmp/cover.jpg", "/tmp/My Clippings.txt", "/tmp/other.txt"]),
    ).toBe("/tmp/My Clippings.txt");
  });

  it("matches the .txt extension case-insensitively", () => {
    expect(pickDroppedFile(["/tmp/My Clippings.TXT"])).toBe("/tmp/My Clippings.TXT");
  });

  it("returns null when the drop carries no text file", () => {
    expect(pickDroppedFile(["/tmp/cover.jpg", "/tmp/notes.md"])).toBeNull();
  });

  it("returns null for an empty drop", () => {
    expect(pickDroppedFile([])).toBeNull();
  });
});
