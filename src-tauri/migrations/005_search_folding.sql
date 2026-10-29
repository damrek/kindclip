-- Accent- and case-insensitive search: shadow columns hold the folded form
-- of every searchable string. The frontend writes them with foldText()
-- (src/lib/library.ts) and backfills existing rows once after migrating.

ALTER TABLE clippings ADD COLUMN content_folded TEXT;
ALTER TABLE clippings ADD COLUMN content_edited_folded TEXT;
ALTER TABLE books ADD COLUMN title_folded TEXT;
ALTER TABLE books ADD COLUMN author_folded TEXT;
