import type { DbPort } from "./port";
import { getSetting, setSetting, SETTINGS_KEYS } from "./settings";
import { foldText } from "../library";

/** Fill the folded search columns once per database, then set the marker.
 * The marker is written only after both passes finish, so a failure midway
 * leaves it unset and the next launch retries the whole backfill. */
export async function backfillSearchFolding(port: DbPort): Promise<void> {
  if ((await getSetting(port, SETTINGS_KEYS.searchFolding)) !== null) {
    return;
  }

  let clippingCursor = 0;
  for (;;) {
    const rows = await port.select<{
      id: number;
      content: string | null;
      content_edited: string | null;
    }>(
      "SELECT id, content, content_edited FROM clippings WHERE id > $1 ORDER BY id LIMIT 100",
      [clippingCursor],
    );
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      await port.execute(
        "UPDATE clippings SET content_folded = $1, content_edited_folded = $2 WHERE id = $3",
        [
          foldText(row.content ?? ""),
          row.content_edited === null ? null : foldText(row.content_edited),
          row.id,
        ],
      );
    }
    clippingCursor = rows[rows.length - 1].id;
  }

  let bookCursor = 0;
  for (;;) {
    const rows = await port.select<{
      id: number;
      title: string;
      author: string | null;
    }>("SELECT id, title, author FROM books WHERE id > $1 ORDER BY id LIMIT 100", [bookCursor]);
    if (rows.length === 0) {
      break;
    }
    for (const row of rows) {
      await port.execute("UPDATE books SET title_folded = $1, author_folded = $2 WHERE id = $3", [
        foldText(row.title),
        foldText(row.author ?? ""),
        row.id,
      ]);
    }
    bookCursor = rows[rows.length - 1].id;
  }

  await setSetting(port, SETTINGS_KEYS.searchFolding, "1");
}
