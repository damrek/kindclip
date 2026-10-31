/** Reading view (roadmap): walk one clipping full-window through the filtered list. */

import type { ClippingRow, PagedResult } from "./types";

export type ReadingDirection = "prev" | "next";

/**
 * A contiguous window of filtered rows the reading view already holds.
 * `start` is the 0-based index of `items[0]` inside the whole filtered list,
 * so the view can cross page boundaries without losing track of the position.
 */
export interface ReadingSession {
  items: ClippingRow[];
  start: number;
  index: number;
  total: number;
  pageSize: number;
}

/** Start reading at `id`, using the page currently on screen as the window. */
export function openReadingSession(
  result: PagedResult<ClippingRow>,
  id: number,
): ReadingSession | null {
  const index = result.items.findIndex((item) => item.id === id);
  if (index === -1) {
    return null;
  }
  return {
    items: result.items,
    start: (result.page - 1) * result.pageSize,
    index,
    total: result.total,
    pageSize: result.pageSize,
  };
}

/** Row being read; null only if the window is empty. */
export function readingCurrent(session: ReadingSession): ClippingRow | null {
  return session.items[session.index] ?? null;
}

/** 1-based position across the whole filtered list. */
export function readingPosition(session: ReadingSession): number {
  return session.start + session.index + 1;
}

/** 1-based page that holds the current row, to sync the list after closing. */
export function readingPage(session: ReadingSession): number {
  return Math.floor((session.start + session.index) / session.pageSize) + 1;
}

/** Whether another row exists in `dir`, inside the window or on a nearby page. */
export function canStep(session: ReadingSession, dir: ReadingDirection): boolean {
  if (dir === "next") {
    return (
      session.index < session.items.length - 1 ||
      session.start + session.items.length < session.total
    );
  }
  return session.index > 0 || session.start > 0;
}

/** Move one row inside the loaded window; null if that would leave it. */
export function stepWithinWindow(
  session: ReadingSession,
  dir: ReadingDirection,
): ReadingSession | null {
  const index = session.index + (dir === "next" ? 1 : -1);
  if (index < 0 || index >= session.items.length) {
    return null;
  }
  return { ...session, index };
}

/** Page to fetch before stepping in `dir`, or null when the window suffices. */
export function pageToLoad(
  session: ReadingSession,
  dir: ReadingDirection,
): number | null {
  if (!canStep(session, dir)) {
    return null;
  }
  if (dir === "next") {
    if (session.index < session.items.length - 1) {
      return null;
    }
    const next = session.start + session.items.length;
    return next >= session.total ? null : Math.floor(next / session.pageSize) + 1;
  }
  if (session.index > 0 || session.start <= 0) {
    return null;
  }
  return Math.floor((session.start - 1) / session.pageSize) + 1;
}

/** Extend the window with a fetched page, dropping rows already loaded. */
export function appendPage(
  session: ReadingSession,
  page: PagedResult<ClippingRow>,
): ReadingSession {
  const seen = new Set(session.items.map((item) => item.id));
  const fresh = page.items.filter((item) => !seen.has(item.id));
  if (fresh.length === 0) {
    return session;
  }
  return { ...session, items: [...session.items, ...fresh] };
}

/** Extend the window backwards, keeping the cursor on the same row. */
export function prependPage(
  session: ReadingSession,
  page: PagedResult<ClippingRow>,
): ReadingSession {
  const seen = new Set(session.items.map((item) => item.id));
  const fresh = page.items.filter((item) => !seen.has(item.id));
  if (fresh.length === 0) {
    return session;
  }
  return {
    ...session,
    items: [...fresh, ...session.items],
    start: (page.page - 1) * page.pageSize,
    index: session.index + fresh.length,
  };
}

export type ReadingPageLoader = (
  page: number,
  pageSize: number,
) => Promise<PagedResult<ClippingRow>>;

/**
 * Step one row, fetching the adjacent page only when the loaded window runs
 * out. At either end of the filtered list the same session comes back.
 */
export async function advanceReading(
  session: ReadingSession,
  dir: ReadingDirection,
  loadPage: ReadingPageLoader,
): Promise<ReadingSession> {
  const moved = stepWithinWindow(session, dir);
  if (moved) {
    return moved;
  }
  const targetPage = pageToLoad(session, dir);
  if (targetPage === null) {
    return session;
  }
  const loaded = await loadPage(targetPage, session.pageSize);
  const extended =
    dir === "next" ? appendPage(session, loaded) : prependPage(session, loaded);
  return stepWithinWindow(extended, dir) ?? extended;
}
