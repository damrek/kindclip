/** The clipping list as one state machine: rows, the filter that produced
 * them, pagination, and the request token that makes a slow response lose
 * against a newer one. Extracted from App so it can be tested without a DOM. */
import { getDb, listBooks, listClippings } from "../db";
import { describeError } from "../errors";
import { logger } from "../log";
import { emptyFilter } from "../library";
import { clampPage } from "../pagination";
import { DEFAULT_CLIPPING_SORT, type ClippingSort } from "../sorting";
import type { Book, ClippingFilter, ClippingRow, PagedResult, PageRequest } from "../types";

export type PageLoader = (
  filter: ClippingFilter,
  page: PageRequest,
  sort: ClippingSort,
) => Promise<PagedResult<ClippingRow>>;

export type BookLoader = () => Promise<Book[]>;

type LogSink = (scope: string, error: unknown) => void;

/** Production wiring: the shared connection and the diagnostic logger. */
export function createClippingList(): ClippingList {
  return new ClippingList(
    async (filter, page, sort) => listClippings(await getDb(), filter, page, sort),
    logger.error,
  );
}

export class ClippingList {
  result = $state<PagedResult<ClippingRow> | null>(null);
  /** True from boot: the stored filter is applied before the first load. */
  loading = $state(true);
  error = $state<string | null>(null);
  page = $state(1);
  /** Filter and sort that produced `result`, committed atomically with it:
   * the reading view must never fetch a page with a filter other than this. */
  resultFilter = $state<ClippingFilter>(emptyFilter());
  resultSort: ClippingSort = DEFAULT_CLIPPING_SORT;
  /** Invalidates an in-flight load when a newer one starts. */
  #request = 0;

  constructor(
    private readonly loadPage: PageLoader,
    private readonly log: LogSink,
  ) {}

  /** Rows for the current page; the arguments are read synchronously so the
   * calling `$effect` tracks them before the first await. */
  async reload(filter: ClippingFilter, pageSize: number, sort: ClippingSort): Promise<void> {
    const requested = this.page;
    const request = ++this.#request;
    this.loading = true;
    this.error = null;
    try {
      const first = await this.loadPage(
        filter,
        { page: requested, pageSize },
        sort,
      );
      if (request !== this.#request) return; // Superseded by a newer list load.
      const last = clampPage(requested, first.total, pageSize);
      const next =
        last === requested
          ? first
          : await this.loadPage(filter, { page: last, pageSize }, sort);
      if (request !== this.#request) return;
      this.result = next;
      this.resultFilter = {
        ...filter,
        authors: [...filter.authors],
        kinds: [...filter.kinds],
        tagIds: [...filter.tagIds],
      };
      this.resultSort = sort;
      this.page = last;
    } catch (cause) {
      if (request === this.#request) {
        this.error = describeError(cause);
      }
      this.log("list-load", cause);
    } finally {
      if (request === this.#request) {
        this.loading = false;
      }
    }
  }

  resetPage(): void {
    this.page = 1;
  }

  /** Optimistic flip of one visible row; the caller persists it. */
  patch(id: number, update: (row: ClippingRow) => ClippingRow): void {
    if (!this.result) return;
    this.result = {
      ...this.result,
      items: this.result.items.map((row) => (row.id === id ? update(row) : row)),
    };
  }

  /** True when the current rows no longer contain the selected id. */
  lost(id: number | null): boolean {
    return id !== null && (this.result === null || !this.result.items.some((row) => row.id === id));
  }
}

/** Book list with its own loaded flag; the caller prunes a stale selection. */
export function createBookShelf(): BookShelf {
  return new BookShelf(async () => listBooks(await getDb()), logger.error);
}

export class BookShelf {
  books = $state<Book[]>([]);
  loaded = $state(false);
  private readonly log: LogSink;

  constructor(
    private readonly loadBooks: BookLoader,
    log: LogSink,
  ) {
    this.log = log;
  }

  /** Returns the failure message, or null when the shelf is current. */
  async reload(): Promise<string | null> {
    try {
      this.books = await this.loadBooks();
      this.loaded = true;
      return null;
    } catch (cause) {
      this.log("books-load", cause);
      return describeError(cause);
    }
  }

  has(id: number): boolean {
    return this.books.some((book) => book.id === id);
  }
}
