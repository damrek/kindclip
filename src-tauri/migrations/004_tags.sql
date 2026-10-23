-- Clipping tags (S1): user-defined labels, many-to-many with clippings.
-- Names are unique ignoring case; both foreign keys cascade so deleting a
-- book, an import or a tag never leaves links behind.

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name ON tags(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS clipping_tags (
  clipping_id INTEGER NOT NULL REFERENCES clippings(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (clipping_id, tag_id)
);
-- Tag-first index for the intersection filter and the per-tag counts.
CREATE INDEX IF NOT EXISTS idx_clipping_tags_tag ON clipping_tags(tag_id, clipping_id);
