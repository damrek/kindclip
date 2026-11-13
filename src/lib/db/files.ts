import { foldText } from "../library";
import type { ClippingDto, ImportReport } from "../types";
import { resolveBookId } from "./books";
import type { DbPort } from "./port";

/** One row of the imported-files list (library management). */
export interface ImportedFile {
  id: number;
  path: string;
  imported_at: string;
  clipping_count: number;
}

export interface RemoveFileResult {
  clippings: number;
  books: number;
}

export interface ImportInput {
  path: string;
  fileHash: string;
  clippings: ClippingDto[];
  skipped: number;
}

/** Clippings are inserted in batches of this size: 500 rows stay well below
 * SQLite's 32,766 bound-parameter limit (500 × 11 = 5,500). */
const BATCH = 500;

const bookKey = (clip: ClippingDto): string => JSON.stringify([clip.title, clip.author ?? ""]);

/** Content hashes of one batch that already exist, via the unique index. */
async function knownHashes(port: DbPort, rows: ClippingDto[]): Promise<Set<string>> {
  const placeholders = rows.map((_, index) => `$${index + 1}`).join(", ");
  const found = await port.select<{ content_hash: string }>(
    `SELECT content_hash FROM clippings WHERE content_hash IN (${placeholders})`,
    rows.map((row) => row.content_hash),
  );
  return new Set(found.map((row) => row.content_hash));
}

export async function importParsedClippings(
  port: DbPort,
  input: ImportInput,
  onProgress: (done: number, total: number) => void,
): Promise<ImportReport> {
  const total = input.clippings.length;

  const knownFileRows = await port.select<{ id: number }>(
    "SELECT id FROM files WHERE file_hash = $1",
    [input.fileHash],
  );
  const knownFile = knownFileRows[0] ?? null;
  const now = new Date().toISOString();

  let fileId: number;
  if (knownFile) {
    fileId = knownFile.id;
  } else {
    const created = await port.execute(
      "INSERT INTO files (path, file_hash, clipping_count, imported_at) VALUES ($1, $2, 0, $3) ON CONFLICT(file_hash) DO NOTHING",
      [input.path, input.fileHash, now],
    );
    fileId = created.lastInsertId ?? -1;
    if (fileId <= 0) {
      // A concurrent import won the insert: reuse its row.
      const raced = await port.select<{ id: number }>(
        "SELECT id FROM files WHERE file_hash = $1",
        [input.fileHash],
      );
      fileId = raced[0]?.id ?? -1;
    }
  }

  const bookIds = new Map<string, number>();
  let inserted = 0;
  let batch: ClippingDto[] = [];

  /** One statement per batch. The unique content_hash rejects a duplicate row
   * (already imported or repeated inside the batch) instead of failing, so a
   * retried import converges. Parameter numbers advance with every row: sqlx
   * binds `$N` by its numeric name, so reusing `$1..$11` would feed the first
   * row's values to the whole batch. */
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const rows = batch;
    batch = [];
    const known = await knownHashes(port, rows);
    const fresh = rows.filter((clip) => {
      if (known.has(clip.content_hash)) return false;
      known.add(clip.content_hash); // repeated inside the same batch
      return true;
    });
    if (fresh.length === 0) return;
    for (const clip of fresh) {
      const key = bookKey(clip);
      if (bookIds.has(key)) continue;
      bookIds.set(key, await resolveBookId(port, clip));
    }
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let param = 1;
    for (const clip of fresh) {
      const row = [
        bookIds.get(bookKey(clip)),
        fileId,
        clip.kind,
        clip.page,
        clip.location,
        clip.added_on_raw,
        clip.added_on,
        clip.content,
        clip.content_hash,
        now,
        foldText(clip.content ?? ""),
      ];
      placeholders.push(`(${row.map(() => `$${param++}`).join(", ")})`);
      values.push(...row);
    }
    const result = await port.execute(
      "INSERT INTO clippings (book_id, file_id, kind, page, location, added_on_raw, added_on, content, content_hash, created_at, content_folded) " +
        `VALUES ${placeholders.join(", ")} ON CONFLICT(content_hash) DO NOTHING`,
      values,
    );
    inserted += result.rowsAffected ?? fresh.length;
  };

  for (let index = 0; index < total; index += 1) {
    batch.push(input.clippings[index]);
    if (batch.length === BATCH) {
      await flush();
    }
    onProgress(index + 1, total);
  }
  await flush();

  if (inserted > 0 || knownFile === null) {
    // Derived count: a retried import cannot leave clipping_count behind.
    await port.execute(
      "UPDATE files SET clipping_count = (SELECT COUNT(*) FROM clippings WHERE file_id = $1), path = $2, imported_at = $3 WHERE id = $1",
      [fileId, input.path, now],
    );
  }

  return {
    fileId,
    total,
    inserted,
    duplicates: total - inserted,
    skipped: input.skipped,
    bookCount: bookIds.size,
    alreadyImported: knownFile !== null && inserted === 0,
  };
}

/** Imported files, newest first, with the clippings still attached to each.
 * Live count: `files.clipping_count` is import-time metadata only. */
export async function listImportedFiles(port: DbPort): Promise<ImportedFile[]> {
  return port.select<ImportedFile>(
    "SELECT f.id, f.path, f.imported_at, " +
      "(SELECT COUNT(*) FROM clippings c WHERE c.file_id = f.id) AS clipping_count " +
      "FROM files f ORDER BY f.imported_at DESC, f.id DESC",
  );
}

/** Undo one import: delete its clippings and favorites, drop books left empty,
 * then delete the file row. Re-importing the file restores the clippings. */
export async function removeImportedFile(
  port: DbPort,
  fileId: number,
): Promise<RemoveFileResult> {
  const rows = await port.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM clippings WHERE file_id = $1",
    [fileId],
  );
  const clippings = Number(rows[0]?.n ?? 0);

  await port.execute(
    "DELETE FROM favorites WHERE clipping_id IN (SELECT id FROM clippings WHERE file_id = $1)",
    [fileId],
  );
  await port.execute("DELETE FROM clippings WHERE file_id = $1", [fileId]);
  const books = await port.execute(
    "DELETE FROM books WHERE NOT EXISTS (SELECT 1 FROM clippings c WHERE c.book_id = books.id)",
  );
  await port.execute("DELETE FROM files WHERE id = $1", [fileId]);
  return { clippings, books: books.rowsAffected ?? 0 };
}
