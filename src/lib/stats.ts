import type { DbPort } from "./db";
import type { ClippingKind } from "./types";

/** One bucket of clippings per year; `year` is null when the date is unknown. */
export interface YearStat {
  year: string | null;
  count: number;
}

export interface KindStat {
  kind: ClippingKind;
  count: number;
}

export interface BookStat {
  title: string;
  author: string | null;
  count: number;
}

export interface ReadingStats {
  total: number;
  bookCount: number;
  years: YearStat[];
  kinds: KindStat[];
  books: BookStat[];
}

/** Books shown in the "by book" section; one row per book. */
export const TOP_BOOKS = 8;

/** Whole-library aggregates: clippings per year, kind and top books. */
export async function loadReadingStats(port: DbPort): Promise<ReadingStats> {
  const totals = await port.select<{ total: number; book_count: number }>(
    "SELECT COUNT(*) AS total, COUNT(DISTINCT book_id) AS book_count FROM clippings",
  );
  // `added_on` is `YYYY-MM-DDTHH:MM:SS`; undated clippings group under null and
  // sort last. The alias keeps the expression in one place.
  const years = await port.select<YearStat>(
    "SELECT NULLIF(substr(added_on, 1, 4), '') AS year, COUNT(*) AS count " +
      "FROM clippings GROUP BY year ORDER BY year IS NULL ASC, year DESC",
  );
  const kinds = await port.select<KindStat>(
    "SELECT kind, COUNT(*) AS count FROM clippings " +
      "GROUP BY kind ORDER BY count DESC, kind ASC",
  );
  const books = await port.select<BookStat>(
    "SELECT b.title, b.author, COUNT(c.id) AS count " +
      "FROM books b JOIN clippings c ON c.book_id = b.id " +
      "GROUP BY b.id, b.title, b.author " +
      "ORDER BY count DESC, b.title COLLATE NOCASE ASC LIMIT $1",
    [TOP_BOOKS],
  );
  return {
    total: totals[0]?.total ?? 0,
    bookCount: totals[0]?.book_count ?? 0,
    years,
    kinds,
    books,
  };
}
