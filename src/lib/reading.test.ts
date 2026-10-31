import { describe, expect, it, vi } from "vitest";
import {
  advanceReading,
  appendPage,
  canStep,
  openReadingSession,
  pageToLoad,
  prependPage,
  readingPage,
  readingPosition,
  stepWithinWindow,
  type ReadingSession,
} from "./reading";
import type { ClippingRow, PagedResult } from "./types";

function row(id: number): ClippingRow {
  return {
    id,
    title: `Book ${id}`,
    author: null,
    kind: "highlight",
    page: id,
    location: null,
    added_on_raw: "",
    added_on: null,
    content: `Text ${id}`,
    content_hash: `hash-${id}`,
    favorite: false,
    content_edited: null,
    edited_at: null,
    tags: [],
  };
}

function page(
  firstId: number,
  count: number,
  pageNumber: number,
  pageSize: number,
  total: number,
): PagedResult<ClippingRow> {
  return {
    items: Array.from({ length: count }, (_, index) => row(firstId + index)),
    total,
    page: pageNumber,
    pageSize,
  };
}

/** Session whose window starts at `start` and holds `items` contiguous rows. */
function sessionAt(
  start: number,
  index: number,
  items = 20,
  total = 137,
  pageSize = 20,
): ReadingSession {
  return {
    items: Array.from({ length: items }, (_, offset) => row(start + offset + 1)),
    start,
    index,
    total,
    pageSize,
  };
}

describe("openReadingSession", () => {
  it("starts on the clicked row of the current page", () => {
    const session = openReadingSession(page(21, 20, 2, 20, 137), 23);
    expect(session).not.toBeNull();
    expect(session?.start).toBe(20);
    expect(session?.index).toBe(2);
    expect(session?.total).toBe(137);
    expect(session?.pageSize).toBe(20);
    expect(session && readingPosition(session)).toBe(23);
    expect(session && readingPage(session)).toBe(2);
  });

  it("returns null when the row is not on the page", () => {
    expect(openReadingSession(page(21, 20, 2, 20, 137), 999)).toBeNull();
  });
});

describe("readingPosition and readingPage", () => {
  it("counts from the start of the filtered list, not the page", () => {
    expect(readingPosition(sessionAt(20, 5))).toBe(26);
    expect(readingPage(sessionAt(20, 5))).toBe(2);
  });

  it("reports the first row of a page as that page", () => {
    const session = sessionAt(40, 0);
    expect(readingPosition(session)).toBe(41);
    expect(readingPage(session)).toBe(3);
  });
});

describe("canStep and pageToLoad", () => {
  it("moves inside the loaded window without loading a page", () => {
    const session = sessionAt(40, 5);
    expect(canStep(session, "next")).toBe(true);
    expect(canStep(session, "prev")).toBe(true);
    expect(pageToLoad(session, "next")).toBeNull();
    expect(pageToLoad(session, "prev")).toBeNull();
  });

  it("asks for the next page at the end of the window", () => {
    const session = sessionAt(40, 19);
    expect(canStep(session, "next")).toBe(true);
    expect(pageToLoad(session, "next")).toBe(4);
  });

  it("asks for the previous page at the start of the window", () => {
    const session = sessionAt(40, 0);
    expect(canStep(session, "prev")).toBe(true);
    expect(pageToLoad(session, "prev")).toBe(2);
  });

  it("stops at both ends of the filtered list", () => {
    const first = sessionAt(0, 0);
    const last = sessionAt(120, 16, 17);
    expect(canStep(first, "prev")).toBe(false);
    expect(pageToLoad(first, "prev")).toBeNull();
    expect(canStep(last, "next")).toBe(false);
    expect(pageToLoad(last, "next")).toBeNull();
  });
});

describe("stepWithinWindow", () => {
  it("advances and goes back one row", () => {
    expect(stepWithinWindow(sessionAt(40, 5), "next")?.index).toBe(6);
    expect(stepWithinWindow(sessionAt(40, 5), "prev")?.index).toBe(4);
  });

  it("returns null instead of leaving the window", () => {
    expect(stepWithinWindow(sessionAt(40, 0), "prev")).toBeNull();
    expect(stepWithinWindow(sessionAt(40, 19), "next")).toBeNull();
  });
});

describe("appendPage", () => {
  it("extends the window without moving the cursor", () => {
    const grown = appendPage(sessionAt(20, 19), page(41, 20, 3, 20, 137));
    expect(grown.items).toHaveLength(40);
    expect(grown.index).toBe(19);
    expect(grown.start).toBe(20);
    expect(stepWithinWindow(grown, "next")?.items[20].id).toBe(41);
  });

  it("ignores rows already loaded", () => {
    const session = sessionAt(20, 5);
    const grown = appendPage(session, page(21, 20, 2, 20, 137));
    expect(grown.items).toHaveLength(20);
    expect(new Set(grown.items.map((item) => item.id)).size).toBe(20);
  });
});

describe("prependPage", () => {
  it("extends the window backwards and keeps the cursor on the same row", () => {
    const grown = prependPage(sessionAt(40, 0), page(21, 20, 2, 20, 137));
    expect(grown.items).toHaveLength(40);
    expect(grown.start).toBe(20);
    expect(grown.index).toBe(20);
    expect(grown.items[20].id).toBe(41);
    expect(stepWithinWindow(grown, "prev")?.items[19].id).toBe(40);
  });

  it("ignores rows already loaded", () => {
    const session = sessionAt(20, 5);
    const grown = prependPage(session, page(21, 20, 2, 20, 137));
    expect(grown.items).toHaveLength(20);
    expect(grown.index).toBe(5);
  });
});

describe("advanceReading", () => {
  it("steps inside the window without loading a page", async () => {
    const load = vi.fn();
    const next = await advanceReading(sessionAt(20, 5), "next", load);
    expect(next.index).toBe(6);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads the next page at the window end and lands on its first row", async () => {
    const load = vi.fn(async () => page(41, 20, 3, 20, 137));
    const next = await advanceReading(sessionAt(20, 19), "next", load);
    expect(load).toHaveBeenCalledWith(3, 20);
    expect(readingPosition(next)).toBe(41);
    expect(stepWithinWindow(next, "next")?.index).toBe(21);
  });

  it("loads the previous page at the window start and lands on its last row", async () => {
    const load = vi.fn(async () => page(21, 20, 2, 20, 137));
    const next = await advanceReading(sessionAt(40, 0), "prev", load);
    expect(load).toHaveBeenCalledWith(2, 20);
    expect(readingPosition(next)).toBe(40);
    expect(next.index).toBe(19);
    expect(next.items[next.index].id).toBe(40);
  });

  it("stays put at the end of the filtered list", async () => {
    const load = vi.fn();
    const last = sessionAt(120, 16, 17);
    expect(await advanceReading(last, "next", load)).toBe(last);
    expect(load).not.toHaveBeenCalled();
  });
});
