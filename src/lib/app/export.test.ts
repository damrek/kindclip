import { describe, expect, it } from "vitest";
import {
  ExportState,
  type ExportBackend,
  type ExportFilePayload,
  type ExportStateDeps,
} from "./export.svelte";
import type { I18nKey, TranslateParams } from "../i18n";
import type { ClippingRow } from "../types";

const t = (key: I18nKey, params?: TranslateParams): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

function row(id: number, title = "Book A"): ClippingRow {
  return {
    id,
    title,
    author: "Author",
    kind: "highlight",
    page: id,
    location: null,
    added_on_raw: "",
    added_on: "2026-01-01",
    content: `row ${id}`,
    content_hash: `hash-${id}`,
    content_edited: null,
    edited_at: null,
    favorite: false,
    tags: [],
  };
}

function makeState(rows: ClippingRow[], overrides: Partial<ExportBackend> = {}) {
  const written: ExportFilePayload[][] = [];
  const files: Array<[string, string]> = [];
  const backend: ExportBackend = {
    pickFolder: async () => "/out",
    checkTargets: async () => [],
    confirmReplace: async () => true,
    writeFiles: async (_dir, payload) => {
      written.push(payload);
      return payload.length;
    },
    defaultPath: async (fileName) => `/tmp/${fileName}`,
    saveFile: async () => "/tmp/out.md",
    writeFile: async (path, contents) => {
      files.push([path, contents]);
    },
    ...overrides,
  };
  const deps: ExportStateDeps = {
    loadRows: async () => rows,
    t,
    locale: () => "en",
    count: (noun, value) => `${value} ${noun}`,
    bookId: () => null,
    bookTitle: () => null,
    canExport: () => rows.length > 0,
    now: () => new Date(2026, 10, 3),
    backend,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };
  return { state: new ExportState(deps), written, files };
}

describe("ExportState", () => {
  it("refuses to open with an empty result", () => {
    const { state } = makeState([]);
    expect(state.openDialog()).toBe(false);
    expect(state.open).toBe(false);
  });

  it("opens and clears the previous outcome", () => {
    const { state } = makeState([row(1)]);
    state.task.status = "old";

    expect(state.openDialog()).toBe(true);
    expect(state.open).toBe(true);
    expect(state.task.status).toBeNull();
  });

  it("writes one file, reports the count and closes", async () => {
    const { state, files } = makeState([row(1), row(2)]);
    state.openDialog();

    await state.run("markdown", false, false);

    expect(files).toHaveLength(1);
    expect(files[0][0]).toBe("/tmp/out.md");
    expect(files[0][1]).toContain("row 1");
    expect(state.message).toContain("export.done");
    expect(state.message).toContain('"count":2');
    expect(state.open).toBe(false);
  });

  it("keeps the dialog open when the save dialog is cancelled", async () => {
    const { state, files } = makeState([row(1)], { saveFile: async () => null });
    state.openDialog();

    await state.run("csv", false, false);

    expect(files).toEqual([]);
    expect(state.open).toBe(true);
  });

  it("writes one Markdown file per book and reports both counts", async () => {
    const rows = [row(1, "A"), row(2, "A"), row(3, "B")];
    const { state, written } = makeState(rows);
    state.openDialog();

    await state.run("markdown", true, true);

    expect(written).toHaveLength(1);
    expect(written[0].map((file) => file.name)).toEqual(["a.md", "b.md"]);
    expect(written[0][0].contents).toContain("row 1");
    expect(state.message).toContain("export.doneFolder");
    expect(state.message).toContain('"books":"2 book"');
    expect(state.open).toBe(false);
  });

  it("asks before replacing and keeps the dialog open on refusal", async () => {
    const asked: string[] = [];
    const { state, written } = makeState([row(1)], {
      checkTargets: async () => ["Book A.md"],
      confirmReplace: async (message) => {
        asked.push(message);
        return false;
      },
    });
    state.openDialog();

    await state.run("markdown", false, true);

    expect(asked[0]).toContain("export.overwrite");
    expect(written).toEqual([]);
    expect(state.open).toBe(true);
  });

  it("reports a failed export and keeps the dialog open", async () => {
    const { state } = makeState([row(1)], {
      writeFile: async () => {
        throw new Error("disk full");
      },
    });
    state.openDialog();

    await state.run("json", false, false);

    expect(state.message).toContain("export.error");
    expect(state.message).toContain("disk full");
    expect(state.task.busy).toBe(false);
    expect(state.open).toBe(true);
  });
});
