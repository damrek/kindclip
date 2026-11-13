import { describeError } from "../errors";
import { foldText } from "../library";
import type { Book, ClippingDto } from "../types";
import type { DbPort } from "./port";

export type RenameBookResult =
  | { status: "renamed" }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "merge-required"; existingBookId: number };

export type MergeBooksResult =
  | { status: "merged"; moved: number }
  | { status: "missing" };

export const LIST_BOOKS_SQL =
  "SELECT b.id, b.title, b.author, COUNT(c.id) AS clipping_count " +
  "FROM books b JOIN clippings c ON c.book_id = b.id " +
  "GROUP BY b.id, b.title, b.author ORDER BY b.title COLLATE NOCASE";

/** Every book with its clipping count. The sidebar sorts the result in memory
 * (sortBooks), so SQL only fixes a deterministic base order. */
export async function listBooks(port: DbPort): Promise<Book[]> {
  return port.select<Book>(LIST_BOOKS_SQL);
}

/** Book id for a (title, author) pair, creating the row when it is new. */
export async function resolveBookId(port: DbPort, clip: ClippingDto): Promise<number> {
  const existing = await port.select<{ id: number }>(
    "SELECT id FROM books WHERE title = $1 AND COALESCE(author, '') = COALESCE($2, '')",
    [clip.title, clip.author],
  );
  if (existing.length > 0) {
    return existing[0].id;
  }
  const created = await port.execute(
    "INSERT INTO books (title, author, title_folded, author_folded) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
    [clip.title, clip.author, foldText(clip.title), foldText(clip.author ?? "")],
  );
  if (created.lastInsertId !== undefined && created.lastInsertId > 0) {
    return created.lastInsertId;
  }
  const raced = await port.select<{ id: number }>(
    "SELECT id FROM books WHERE title = $1 AND COALESCE(author, '') = COALESCE($2, '')",
    [clip.title, clip.author],
  );
  return raced[0]?.id ?? -1;
}

/** Find the book that already owns a (title, author) pair, if any. */
async function findBookByPair(
  port: DbPort,
  title: string,
  author: string | null,
  excludeId: number,
): Promise<number | null> {
  const rows = await port.select<{ id: number }>(
    "SELECT id FROM books WHERE title = $1 AND COALESCE(author, '') = COALESCE($2, '') AND id <> $3",
    [title, author, excludeId],
  );
  return rows[0]?.id ?? null;
}

/** Update a book's title/author without moving its clippings. A duplicate
 * pair is reported as `merge-required`, never as a raw UNIQUE failure. */
export async function renameBook(
  port: DbPort,
  bookId: number,
  title: string,
  author: string | null,
): Promise<RenameBookResult> {
  const cleanTitle = title.trim();
  if (cleanTitle === "") {
    return { status: "invalid" };
  }
  const cleanAuthor = author?.trim() ? author.trim() : null;

  const existing = await findBookByPair(port, cleanTitle, cleanAuthor, bookId);
  if (existing !== null) {
    return { status: "merge-required", existingBookId: existing };
  }

  try {
    const result = await port.execute(
      "UPDATE books SET title = $1, author = $2, title_folded = $3, author_folded = $4 " +
        "WHERE id = $5",
      [cleanTitle, cleanAuthor, foldText(cleanTitle), foldText(cleanAuthor ?? ""), bookId],
    );
    return (result.rowsAffected ?? 0) > 0 ? { status: "renamed" } : { status: "missing" };
  } catch (error) {
    const message = describeError(error);
    if (!message.includes("UNIQUE constraint failed")) {
      throw error;
    }
    const raced = await findBookByPair(port, cleanTitle, cleanAuthor, bookId);
    if (raced === null) {
      throw error;
    }
    return { status: "merge-required", existingBookId: raced };
  }
}

/** Move every clipping to the target book, then delete the source row.
 * Clipping ids (and their favorites) survive the move. */
export async function mergeBooks(
  port: DbPort,
  sourceId: number,
  targetId: number,
): Promise<MergeBooksResult> {
  if (sourceId === targetId) {
    return { status: "merged", moved: 0 };
  }
  const target = await port.select<{ id: number }>("SELECT id FROM books WHERE id = $1", [
    targetId,
  ]);
  if (target.length === 0) {
    return { status: "missing" };
  }
  const moved = await port.execute("UPDATE clippings SET book_id = $1 WHERE book_id = $2", [
    targetId,
    sourceId,
  ]);
  await port.execute("DELETE FROM books WHERE id = $1", [sourceId]);
  return { status: "merged", moved: moved.rowsAffected ?? 0 };
}

/** Delete a book with its clippings and favorites, children first. Returns the
 * number of clippings removed. */
export async function deleteBook(port: DbPort, bookId: number): Promise<number> {
  const rows = await port.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM clippings WHERE book_id = $1",
    [bookId],
  );
  const clippings = Number(rows[0]?.n ?? 0);

  await port.execute(
    "DELETE FROM favorites WHERE clipping_id IN (SELECT id FROM clippings WHERE book_id = $1)",
    [bookId],
  );
  await port.execute("DELETE FROM clippings WHERE book_id = $1", [bookId]);
  await port.execute("DELETE FROM books WHERE id = $1", [bookId]);
  return clippings;
}
