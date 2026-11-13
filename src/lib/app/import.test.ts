import { describe, expect, it } from "vitest";
import { ImportState, type ImportStateDeps } from "./import.svelte";
import type { ImportDeps, ImportOutcome } from "../importer";
import type { I18nKey, TranslateParams } from "../i18n";
import type { ImportReport } from "../types";

const t = (key: I18nKey, params?: TranslateParams): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const deps: ImportDeps = {
  pickFile: async () => null,
  parseFile: async () => {
    throw new Error("unused");
  },
  getPort: async () => {
    throw new Error("unused");
  },
};

function report(overrides: Partial<ImportReport> = {}): ImportReport {
  return {
    fileId: 1,
    inserted: 2,
    total: 3,
    duplicates: 1,
    skipped: 0,
    bookCount: 1,
    alreadyImported: false,
    ...overrides,
  };
}

function makeState() {
  let refreshes = 0;
  const logged: string[] = [];
  const value: ImportStateDeps = {
    t,
    count: (noun, value) => `${value} ${noun}`,
    makeDeps: () => deps,
    refresh: async () => {
      refreshes += 1;
    },
    log: {
      info: (message) => logged.push(message),
      warn: (message) => logged.push(message),
      error: (scope) => logged.push(scope),
    },
  };
  return { state: new ImportState(value), logged, refreshes: () => refreshes };
}

describe("ImportState", () => {
  it("returns the outcome line and reloads the views after an import", async () => {
    const { state, refreshes } = makeState();
    const progress: string[] = [];
    const outcome: ImportOutcome = { status: "done", report: report() };

    await state.run(
      async (received) => {
        expect(received).toBe(deps);
        return outcome;
      },
      (message) => progress.push(message ?? "cleared"),
    );

    expect(progress.at(-1)).toContain("import.done");
    expect(progress.at(-1)).toContain('"inserted":2');
    expect(refreshes()).toBe(1);
    expect(progress[0]).toBe("import.reading");
    expect(state.busy).toBe(false);
  });

  it("reports a duplicate file without inserting", async () => {
    const { state } = makeState();
    const outcome: ImportOutcome = {
      status: "done",
      report: report({ inserted: 0, duplicates: 3, alreadyImported: true }),
    };

    let line: string | null = null;
    await state.run(async () => outcome, (message) => {
      line = message;
    });

    expect(line).toBe("import.duplicate");
  });

  it("keeps the previous line when the picker is cancelled", async () => {
    const { state, refreshes } = makeState();
    let line: string | null = "reading";
    await state.run(async () => ({ status: "cancelled" }), (message) => {
      line = message;
    });

    expect(line).toBeNull();
    expect(refreshes()).toBe(0);
    expect(state.busy).toBe(false);
  });

  it("reports an empty file with its skipped blocks", async () => {
    const { state } = makeState();
    let line: string | null = null;
    await state.run(
      async () => ({ status: "empty", path: "/a.txt", skipped: 4 }),
      (message) => {
        line = message;
      },
    );

    expect(line).toContain("import.emptySkipped");
    expect(line).toContain('"skipped":"4 skipped"');
  });

  it("turns a thrown import into an error line and releases the flag", async () => {
    const { state, logged } = makeState();
    let line: string | null = null;
    await state.run(async () => {
      throw new Error("database is locked");
    }, (message) => {
      line = message;
    });

    expect(line).toContain("import.error");
    expect(line).toContain("database is locked");
    expect(logged).toContain("import");
    expect(state.busy).toBe(false);
  });

  it("ignores a drop without a text file", async () => {
    const { state } = makeState();
    let line: string | null = null;
    await state.drop(["/a.pdf"], false, (message) => {
      line = message;
    });

    expect(line).toBe("import.notTxt");
  });

  it("ignores a drop while a modal is open or an import runs", async () => {
    const { state } = makeState();

    let calls = 0;
    await state.drop(["/a.txt"], true, () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});
