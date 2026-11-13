import { describe, expect, it } from "vitest";
import { ReadingState } from "./reading.svelte";
import { DEFAULT_CLIPPING_SORT } from "../sorting";
import type { ClippingFilter, ClippingRow, PagedResult } from "../types";
import { emptyFilter } from "../library";

function row(id: number): ClippingRow {
  return {
    id,
    title: "Book",
    author: null,
    kind: "highlight",
    page: id,
    location: null,
    added_on_raw: "",
    added_on: null,
    content: `row ${id}`,
    content_hash: `hash-${id}`,
    content_edited: null,
    edited_at: null,
    favorite: false,
    tags: [],
  };
}

function pageOf(ids: number[], page = 1, total = ids.length): PagedResult<ClippingRow> {
  return { items: ids.map(row), total, page, pageSize: ids.length };
}

const source = { filter: emptyFilter(), sort: DEFAULT_CLIPPING_SORT };

function stateWith(loader: (page: number) => Promise<PagedResult<ClippingRow>>) {
  const calls: number[] = [];
  const state = new ReadingState(
    (_filter: ClippingFilter, request, _sort) => {
      calls.push(request.page);
      return loader(request.page);
    },
    () => {},
  );
  return { state, calls };
}

describe("ReadingState", () => {
  it("opens a list session on the requested row", () => {
    const { state } = stateWith(async (page) => pageOf([1, 2], page));
    state.openList(pageOf([1, 2, 3], 1, 40), 2, source, null);

    expect(state.session?.index).toBe(1);
    expect(state.current?.id).toBe(2);
    expect(state.position).toBe(2);
    expect(state.query).toBe("");
    expect(state.canStep("prev")).toBe(true);
  });

  it("steps inside the window without touching the loader", async () => {
    const { state, calls } = stateWith(async (page) => pageOf([1, 2, 3], page));
    state.openList(pageOf([1, 2, 3], 1, 3), 1, source, null);
    await state.step("next");

    expect(state.current?.id).toBe(2);
    expect(calls).toEqual([]);
  });

  it("fetches the adjacent page when the window runs out", async () => {
    const { state, calls } = stateWith(async (page) => pageOf([4, 5, 6], page, 6));
    state.openList(pageOf([1, 2, 3], 1, 6), 3, source, null);
    await state.step("next");

    expect(calls).toEqual([2]);
    expect(state.current?.id).toBe(4);
    expect(state.position).toBe(4);
    expect(state.loading).toBe(false);
  });

  it("reports a failed page fetch and releases the busy flag", async () => {
    const { state } = stateWith(async () => {
      throw new Error("database is locked");
    });
    state.openList(pageOf([1, 2, 3], 1, 6), 3, source, null);
    await state.step("next");

    expect(state.error).toBe("database is locked");
    expect(state.loading).toBe(false);
    expect(state.current?.id).toBe(3);
  });

  it("closes on the page where reading stopped and clears the session", async () => {
    const applied: number[] = [];
    const { state } = stateWith(async (page) => pageOf([3, 4], page, 40));
    state.openList(pageOf([3, 4], 2, 40), 3, source, null);

    await state.close((page) => applied.push(page), 1, null);

    // The row lives on page 2, so closing moves the list there.
    expect(applied).toEqual([2]);
    expect(state.session).toBeNull();
    expect(state.query).toBe("");
    expect(state.source).toBeNull();
  });

  it("never moves the list for a palette window", async () => {
    const applied: number[] = [];
    const { state } = stateWith(async (page) => pageOf([1], page));
    state.openWindow([row(1), row(2)], 1, null, "aurora");

    await state.close((page) => applied.push(page), 3, null);

    expect(applied).toEqual([]);
    expect(state.session).toBeNull();
  });
});
