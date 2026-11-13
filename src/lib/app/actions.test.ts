import { describe, expect, it, vi } from "vitest";
import { ClippingActions, type ClippingActionsDeps } from "./actions.svelte";
import { ClippingList } from "./catalog.svelte";
import type { DbPort, TagCount } from "../db";
import type { ClippingRow } from "../types";

function row(id: number, overrides: Partial<ClippingRow> = {}): ClippingRow {
  return {
    id,
    title: "Book",
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
    ...overrides,
  };
}

function makeList(rows: ClippingRow[]): ClippingList {
  const list = new ClippingList(async () => ({ items: [], total: 0, page: 1, pageSize: 20 }), () => {});
  list.result = { items: rows, total: rows.length, page: 1, pageSize: 20 };
  return list;
}

function makePort(overrides: Partial<DbPort> = {}): DbPort {
  const tags: TagCount[] = [{ id: 9, name: "canonical", clipping_count: 1 }];
  return {
    select: async <T>(sql: string) =>
      (sql.includes("GROUP BY t.id") ? tags : []) as T[],
    execute: async () => ({ rowsAffected: 1, lastInsertId: 9 }),
    ...overrides,
  };
}

function makeActions(
  list: ClippingList,
  overrides: Partial<ClippingActionsDeps> = {},
  port: DbPort = makePort(),
) {
  const written: string[] = [];
  const setTags = vi.fn();
  let reloads = 0;
  const deps: ClippingActionsDeps = {
    getPort: async () => port,
    list,
    reload: async () => {
      reloads += 1;
    },
    favoritesOnly: () => false,
    editedOnly: () => false,
    selectedTagIds: () => [],
    readingRow: () => null,
    setTags,
    copyText: async (text) => {
      written.push(text);
    },
    ...overrides,
  };
  return { actions: new ClippingActions(deps), written, setTags, reloads: () => reloads };
}

describe("ClippingActions", () => {
  it("copies the edited text and flashes the check mark for 1.5 s", async () => {
    vi.useFakeTimers();
    const list = makeList([row(1, { content: "original", content_edited: "edited" })]);
    const { actions, written } = makeActions(list);

    await actions.copyContent(1);
    expect(written).toEqual(["edited"]);
    expect(actions.copyFlash).toEqual({ id: 1, kind: "content" });

    vi.advanceTimersByTime(1500);
    expect(actions.copyFlash).toBeNull();
    vi.useRealTimers();
  });

  it("copies a Markdown quote from the reading row", async () => {
    const list = makeList([]);
    const reading = row(7, { page: 12, location: null });
    const { actions, written } = makeActions(list, { readingRow: () => reading });

    await actions.copyQuote(7);

    expect(written[0]).toContain("row 7");
    expect(actions.copyFlash).toEqual({ id: 7, kind: "quote" });
  });

  it("stars optimistically and keeps the confirmed state", async () => {
    const list = makeList([row(1)]);
    const { actions } = makeActions(list);

    await actions.toggleStar(1);

    expect(list.result?.items[0].favorite).toBe(true);
    expect(list.error).toBeNull();
  });

  it("reverts the star and reports the failure", async () => {
    const list = makeList([row(1)]);
    const port = makePort({
      execute: async () => {
        throw new Error("database is locked");
      },
    });
    const { actions } = makeActions(list, {}, port);

    await actions.toggleStar(1);

    expect(list.result?.items[0].favorite).toBe(false);
    expect(list.error).toBe("database is locked");
  });

  it("reloads after unstarring the last card of the favorites view", async () => {
    const list = makeList([row(1, { favorite: true })]);
    const port = makePort({
      select: async <T>(sql: string) =>
        (sql.includes("FROM favorites") ? [{ clipping_id: 1 }] : []) as T[],
      execute: async () => ({ rowsAffected: 1 }),
    });
    const { actions, reloads } = makeActions(list, { favoritesOnly: () => true }, port);

    await actions.toggleStar(1);

    expect(reloads()).toBe(1);
    expect(list.result?.items[0].favorite).toBe(false);
  });

  it("adds a tag optimistically and adopts the canonical name", async () => {
    const list = makeList([row(1)]);
    const { actions, setTags } = makeActions(list);

    const ok = await actions.addTag(1, "  canonical ");

    expect(ok).toBe(true);
    expect(list.result?.items[0].tags).toEqual([{ id: 9, name: "canonical" }]);
    expect(setTags).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate tag without writing", async () => {
    const list = makeList([row(1, { tags: [{ id: 9, name: "Canonical" }] })]);
    const { actions, setTags } = makeActions(list);

    expect(await actions.addTag(1, "canonical")).toBe(false);
    expect(setTags).not.toHaveBeenCalled();
  });

  it("restores the chips when adding a tag fails", async () => {
    const before = [{ id: 3, name: "old" }];
    const list = makeList([row(1, { tags: before })]);
    const port = makePort({
      execute: async () => {
        throw new Error("disk full");
      },
    });
    const { actions } = makeActions(list, {}, port);

    expect(await actions.addTag(1, "new")).toBe(false);
    expect(list.result?.items[0].tags).toEqual(before);
    expect(list.error).toBe("disk full");
  });

  it("reloads after removing the tag that scopes the view", async () => {
    const list = makeList([row(1, { tags: [{ id: 5, name: "tag" }] })]);
    const { actions, reloads } = makeActions(list, { selectedTagIds: () => [5] });

    expect(await actions.removeTag(1, 5)).toBe(true);
    expect(reloads()).toBe(1);
    expect(list.result?.items[0].tags).toEqual([]);
  });

  it("patches an edited note and reloads when the view only shows edits", async () => {
    const list = makeList([row(1, { kind: "note" })]);
    const { actions, reloads } = makeActions(list, { editedOnly: () => true });

    expect(await actions.editNote(1, "new text")).toBe(true);
    expect(list.result?.items[0].content_edited).toBe("new text");
    expect(reloads()).toBe(0);
  });

  it("closes the reset dialog after the note is restored", async () => {
    const list = makeList([row(1, { kind: "note", content_edited: "edited" })]);
    const { actions } = makeActions(list);

    actions.requestReset(1);
    expect(actions.resetTarget?.id).toBe(1);
    await actions.confirmReset();

    expect(actions.resetTarget).toBeNull();
    expect(list.result?.items[0].content_edited).toBeNull();
  });
});
