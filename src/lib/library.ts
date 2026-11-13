import type { Book, ClippingFilter, ClippingRow, Tag } from "./types";

export function emptyFilter(): ClippingFilter {
  return {
    query: "",
    bookId: null,
    authors: [],
    kinds: [],
    favoritesOnly: false,
    editedOnly: false,
    tagIds: [],
  };
}

/** Library-wide clipping count for the "All books" badge (not the filtered total). */
export function totalClippings(books: Book[]): number {
  return books.reduce((sum, book) => sum + book.clipping_count, 0);
}

/** Case- and diacritic-insensitive text used for search and book matching.
 *
 * NFD splits a precomposed letter into its base plus a combining mark, so
 * dropping the marks folds every accented letter (including Vietnamese and
 * Cyrillic). The explicit replacements cover the letters Unicode does not
 * decompose: ß, æ, œ, ø, ł, đ/ð, þ, ħ and ı. */
export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ|ð/g, "d")
    .replace(/þ/g, "th")
    .replace(/ħ/g, "h")
    .replace(/ı/g, "i");
}

/** Books whose title or author contains the query, in incoming order. */
export function filterBooks(books: Book[], query: string): Book[] {
  const needle = foldText(query.trim());
  if (needle === "") {
    return books;
  }
  return books.filter(
    (book) =>
      foldText(book.title).includes(needle) ||
      foldText(book.author ?? "").includes(needle),
  );
}

/** One author group shared by the Filters menu and the grouped sidebar (S5). */
export interface AuthorGroup {
  /** Folded author key; the empty key is the unknown author. */
  key: string;
  /** Most frequent exact spelling in the group; null for the unknown author. */
  name: string | null;
  books: Book[];
  clippingCount: number;
  bookCount: number;
}

/**
 * Group the already-sorted books by folded author, preserving book order
 * inside each group. Groups sort by folded key ascending, unknown last.
 */
export function groupBooksByAuthor(books: Book[]): AuthorGroup[] {
  const byKey = new Map<string, Book[]>();
  for (const book of books) {
    const key = foldText(book.author ?? "");
    const group = byKey.get(key);
    if (group) {
      group.push(book);
    } else {
      byKey.set(key, [book]);
    }
  }

  const groups: AuthorGroup[] = [];
  for (const [key, groupBooks] of byKey) {
    let name: string | null = null;
    if (key !== "") {
      const spellings = new Map<string, number>();
      for (const book of groupBooks) {
        if (book.author) {
          spellings.set(book.author, (spellings.get(book.author) ?? 0) + 1);
        }
      }
      let best = 0;
      for (const [candidate, count] of spellings) {
        if (count > best || (count === best && name !== null && candidate < name)) {
          name = candidate;
          best = count;
        }
      }
    }
    groups.push({
      key,
      name,
      books: groupBooks,
      clippingCount: groupBooks.reduce((sum, book) => sum + book.clipping_count, 0),
      bookCount: groupBooks.length,
    });
  }

  return groups.sort((a, b) => {
    if (a.key === "") return b.key === "" ? 0 : 1;
    if (b.key === "") return -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * Drop selected author keys that no longer exist in the book list (S6).
 * Returns the same array when nothing was pruned, so callers can skip a
 * needless filter write.
 */
export function pruneAuthors(authors: string[], books: Book[]): string[] {
  const known = new Set(books.map((book) => foldText(book.author ?? "")));
  const next = authors.filter((key) => known.has(key));
  return next.length === authors.length ? authors : next;
}

export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel: () => void;
}

/** Trailing-edge debounce for the search input. */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Args): void => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
  debounced.cancel = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return debounced;
}

/** The clipping fields needed to build a cited quote. */
export type QuotableClipping = Pick<
  ClippingRow,
  "title" | "author" | "page" | "location" | "content" | "content_edited"
>;

/** Markdown blockquote with a citation, for "copy as quote".
 *
 * Every line of the effective text is quoted; the attribution follows a blank
 * quote line and cites author, book title and page (or the location when the
 * clipping has no page). Returns null when there is no text to quote. */
export function formatQuoteCitation(clipping: QuotableClipping): string | null {
  const text = (clipping.content_edited ?? clipping.content ?? "").replace(/\r\n?/g, "\n");
  if (text.trim() === "") {
    return null;
  }
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  const quote = lines.map((line) => (line.trim() === "" ? ">" : `> ${line}`)).join("\n");
  const author = clipping.author?.trim() ?? "";
  const book = author === "" ? `*${clipping.title}*` : `${author}, *${clipping.title}*`;
  const location = clipping.location?.trim() ?? "";
  const reference =
    clipping.page !== null
      ? `p. ${clipping.page}`
      : location === ""
        ? ""
        : `pos. ${location}`;
  const citation = reference === "" ? `— ${book}` : `— ${book}, ${reference}`;
  return `${quote}\n>\n> ${citation}`;
}

/** Optimistic favorite flip for the visible page (T6). */
export function applyFavoriteToggle(
  items: ClippingRow[],
  id: number,
  favorite: boolean,
): ClippingRow[] {
  return items.map((item) => (item.id === id ? { ...item, favorite } : item));
}

/** Overlay patch (note edit or reset) for the visible page (V2). */
export function applyNoteEdit(
  items: ClippingRow[],
  id: number,
  patch: { content_edited: string | null; edited_at: string | null },
): ClippingRow[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

/** Tag chips shown before the +N toggle (S3). */
export const TAG_CHIP_LIMIT = 3;

/** Append a tag to one clipping's chips, ignoring a duplicate id or name. */
export function withTag(tags: Tag[], tag: Tag): Tag[] {
  if (tags.some((current) => current.id === tag.id)) {
    return tags;
  }
  const name = tag.name.toLowerCase();
  if (tags.some((current) => current.name.toLowerCase() === name)) {
    return tags;
  }
  return [...tags, tag];
}

/** Drop one tag chip by id; unknown ids leave the list untouched. */
export function withoutTag(tags: Tag[], tagId: number): Tag[] {
  return tags.filter((tag) => tag.id !== tagId);
}

/** Drop one tag id from the selected filter (a deleted or merged tag). */
export function withoutTagId(tagIds: number[], tagId: number): number[] {
  return tagIds.filter((id) => id !== tagId);
}

/** Chips to render and how many stay behind the +N toggle. */
export function tagOverflow(
  tags: Tag[],
  limit = TAG_CHIP_LIMIT,
): { visible: Tag[]; hidden: number } {
  return { visible: tags.slice(0, limit), hidden: Math.max(0, tags.length - limit) };
}

/** Copy card content to the clipboard; `false` when the write fails (T9). */
export async function copyClippingContent(
  write: (text: string) => Promise<void>,
  text: string,
): Promise<boolean> {
  try {
    await write(text);
    return true;
  } catch {
    return false;
  }
}

