/** The full-window reading session: the row on screen, the page it came from,
 * the query to highlight, and the arrow navigation that fetches an adjacent
 * list page only when the in-memory window runs out.
 *
 * Closing returns focus to the opener when it is still mounted, or parks it on
 * the list when a page change unmounted the card. */
import { tick } from "svelte";
import { describeError } from "../errors";
import {
  advanceReading,
  canStep,
  openReadingSession,
  openWindowSession,
  pageToLoad,
  readingCurrent,
  readingPage,
  readingPosition,
  stepWithinWindow,
  type ReadingDirection,
  type ReadingSession,
} from "../reading";
import type { ClippingFilter, ClippingRow, PagedResult, PageRequest } from "../types";
import type { ClippingSort } from "../sorting";

export interface ReadingSource {
  filter: ClippingFilter;
  sort: ClippingSort;
}

export type ReadingPageLoader = (
  filter: ClippingFilter,
  page: PageRequest,
  sort: ClippingSort,
) => Promise<PagedResult<ClippingRow>>;

type LogSink = (scope: string, error: unknown) => void;

export class ReadingState {
  /** Full-window session; null when closed. */
  session = $state<ReadingSession | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  /** Search text the view highlights. */
  query = $state("");
  /** Filter/sort the arrows fetch adjacent pages with; null for palette rows. */
  source = $state<ReadingSource | null>(null);
  #opener: HTMLElement | null = null;
  #request = 0;

  constructor(
    private readonly loadPage: ReadingPageLoader,
    private readonly log: LogSink,
  ) {}

  get current(): ClippingRow | null {
    return this.session === null ? null : readingCurrent(this.session);
  }

  get position(): number {
    return this.session === null ? 0 : readingPosition(this.session);
  }

  canStep(direction: ReadingDirection): boolean {
    return this.session !== null && canStep(this.session, direction);
  }

  /** Open on one row of the visible list page. */
  openList(items: PagedResult<ClippingRow>, id: number, source: ReadingSource, opener: HTMLElement | null): void {
    const session = openReadingSession(items, id);
    if (!session) return;
    this.#mount(session, source, opener, source.filter.query);
  }

  /** Open a palette result list that has no adjacent list pages. */
  openWindow(items: ClippingRow[], id: number, opener: HTMLElement | null, query: string): void {
    const session = openWindowSession(items, id);
    if (!session) return;
    this.#mount(session, null, opener, query);
  }

  /** Step one row; fetch the adjacent page only when the window runs out. */
  async step(direction: ReadingDirection): Promise<void> {
    const session = this.session;
    if (!session || this.loading) return;
    const moved = stepWithinWindow(session, direction);
    if (moved) {
      // A successful step dismisses a banner left over from a failed fetch.
      this.error = null;
      this.session = moved;
      return;
    }
    const source = this.source;
    if (!source || pageToLoad(session, direction) === null) return;
    const request = ++this.#request;
    this.loading = true;
    this.error = null;
    try {
      const next = await advanceReading(session, direction, (page, pageSize) =>
        this.loadPage(source.filter, { page, pageSize }, source.sort),
      );
      if (request !== this.#request) return; // Closed or reopened while loading.
      this.session = next;
    } catch (cause) {
      if (request === this.#request) {
        this.error = describeError(cause);
      }
      this.log("reading-load", cause);
    } finally {
      // Replacing the session on success must still release the busy flag.
      if (request === this.#request) {
        this.loading = false;
      }
    }
  }

  /** Close and leave the list on the page where reading stopped. */
  async close(applyPage: (page: number) => void, currentPage: number, listRegion: HTMLElement | null): Promise<void> {
    const session = this.session;
    if (!session) return;
    // Palette windows are not part of the list, so they never move its page.
    const targetPage = this.source === null ? currentPage : readingPage(session);
    const opener = this.#opener;
    this.#request += 1;
    this.session = null;
    this.loading = false;
    this.error = null;
    this.source = null;
    this.query = "";
    this.#opener = null;
    const pageChanged = targetPage !== currentPage;
    if (pageChanged) {
      applyPage(targetPage);
    }
    // Hand focus back. On the same page the opener is still mounted, so focus
    // returns to it; a page change reloads the list and unmounts it, so focus
    // parks on the list itself instead of dropping to <body>.
    await tick();
    const target = !pageChanged && opener !== null && opener.isConnected ? opener : listRegion;
    target?.focus();
  }

  #mount(
    session: ReadingSession,
    source: ReadingSource | null,
    opener: HTMLElement | null,
    query: string,
  ): void {
    this.#request += 1;
    this.error = null;
    this.loading = false;
    this.source = source;
    this.query = query;
    this.#opener = opener;
    this.session = session;
  }
}
