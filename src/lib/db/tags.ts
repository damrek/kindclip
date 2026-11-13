import type { Tag } from "../types";
import type { DbPort } from "./port";

/** A tag plus how many clippings carry it (0 for orphans). */
export interface TagCount extends Tag {
  clipping_count: number;
}

export type RenameTagResult =
  | { status: "renamed" }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "merge-required"; existingTagId: number };

export type MergeTagsResult =
  | { status: "merged"; moved: number }
  | { status: "missing" };

/** Every tag with a live clipping count, ordered like the book sidebar. */
export async function listTags(port: DbPort): Promise<TagCount[]> {
  return port.select<TagCount>(
    "SELECT t.id, t.name, COUNT(ct.clipping_id) AS clipping_count " +
      "FROM tags t LEFT JOIN clipping_tags ct ON ct.tag_id = t.id " +
      "GROUP BY t.id, t.name ORDER BY t.name COLLATE NOCASE",
  );
}

async function findTagId(port: DbPort, name: string): Promise<number | null> {
  const rows = await port.select<{ id: number }>(
    "SELECT id FROM tags WHERE name = $1 COLLATE NOCASE",
    [name],
  );
  return rows[0]?.id ?? null;
}

async function findOtherTagId(
  port: DbPort,
  name: string,
  excludeId: number,
): Promise<number | null> {
  const rows = await port.select<{ id: number }>(
    "SELECT id FROM tags WHERE name = $1 COLLATE NOCASE AND id <> $2",
    [name, excludeId],
  );
  return rows[0]?.id ?? null;
}

/** Reuse an existing tag by name (case-insensitive) or create it. Returns
 * null for a blank name. */
export async function ensureTag(port: DbPort, name: string): Promise<number | null> {
  const clean = name.trim();
  if (clean === "") {
    return null;
  }
  const existing = await findTagId(port, clean);
  if (existing !== null) {
    return existing;
  }
  try {
    const result = await port.execute("INSERT INTO tags (name, created_at) VALUES ($1, $2)", [
      clean,
      new Date().toISOString(),
    ]);
    return result.lastInsertId ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("UNIQUE constraint failed")) {
      throw error;
    }
    return findTagId(port, clean);
  }
}

/** Rename a tag; a name already taken by another tag is reported as
 * `merge-required`, never as a raw UNIQUE failure. */
export async function renameTag(
  port: DbPort,
  tagId: number,
  name: string,
): Promise<RenameTagResult> {
  const clean = name.trim();
  if (clean === "") {
    return { status: "invalid" };
  }
  const existing = await findOtherTagId(port, clean, tagId);
  if (existing !== null) {
    return { status: "merge-required", existingTagId: existing };
  }
  try {
    const result = await port.execute("UPDATE tags SET name = $1 WHERE id = $2", [
      clean,
      tagId,
    ]);
    return (result.rowsAffected ?? 0) > 0 ? { status: "renamed" } : { status: "missing" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("UNIQUE constraint failed")) {
      throw error;
    }
    const raced = await findOtherTagId(port, clean, tagId);
    if (raced === null) {
      throw error;
    }
    return { status: "merge-required", existingTagId: raced };
  }
}

/** Move every link to the target tag, then delete the source tag. Clipping
 * ids and favorites survive the move. */
export async function mergeTags(
  port: DbPort,
  sourceId: number,
  targetId: number,
): Promise<MergeTagsResult> {
  if (sourceId === targetId) {
    return { status: "merged", moved: 0 };
  }
  const target = await port.select<{ id: number }>("SELECT id FROM tags WHERE id = $1", [
    targetId,
  ]);
  if (target.length === 0) {
    return { status: "missing" };
  }
  const moved = await port.execute(
    "INSERT OR IGNORE INTO clipping_tags (clipping_id, tag_id, created_at) " +
      "SELECT clipping_id, $1, $2 FROM clipping_tags WHERE tag_id = $3",
    [targetId, new Date().toISOString(), sourceId],
  );
  await port.execute("DELETE FROM tags WHERE id = $1", [sourceId]);
  return { status: "merged", moved: moved.rowsAffected ?? 0 };
}

/** Delete a tag; the links go with it through the FK cascade. */
export async function deleteTag(port: DbPort, tagId: number): Promise<boolean> {
  const result = await port.execute("DELETE FROM tags WHERE id = $1", [tagId]);
  return (result.rowsAffected ?? 0) > 0;
}

/** Assign a tag to a clipping; assigning twice is a no-op. */
export async function addClippingTag(
  port: DbPort,
  clippingId: number,
  tagId: number,
): Promise<void> {
  await port.execute(
    "INSERT OR IGNORE INTO clipping_tags (clipping_id, tag_id, created_at) VALUES ($1, $2, $3)",
    [clippingId, tagId, new Date().toISOString()],
  );
}

/** Remove one tag from one clipping; removing an absent link is a no-op. */
export async function removeClippingTag(
  port: DbPort,
  clippingId: number,
  tagId: number,
): Promise<void> {
  await port.execute("DELETE FROM clipping_tags WHERE clipping_id = $1 AND tag_id = $2", [
    clippingId,
    tagId,
  ]);
}
