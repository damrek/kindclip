import { describe, expect, it } from "vitest";
import { runImportFlow, type ImportDeps } from "./importer";
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
      parseFile: async (path) => ({ path, fileHash: "h", clippings: [] }),
      getPort: async () => fakePort(),
    };
    await expect(runImportFlow(deps, () => {})).resolves.toEqual({
      status: "empty",
      path: "/tmp/empty.txt",
    });
  });

  it("imports parsed clippings and reports progress", async () => {
    const progress: Array<[number, number]> = [];
    const deps: ImportDeps = {
      pickFile: async () => "/tmp/My Clippings.txt",
      parseFile: async (path) => ({ path, fileHash: "h", clippings: [dto("a"), dto("b")] }),
      getPort: async () => fakePort(),
    };
    const outcome = await runImportFlow(deps, (done, total) => progress.push([done, total]));
    expect(outcome.status).toBe("done");
    if (outcome.status === "done") {
      expect(outcome.report.inserted).toBe(2);
      expect(outcome.report.total).toBe(2);
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
