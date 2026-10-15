-- kindclip note editing (V2): overlay columns keep `content` (the
-- original parsed text backing the dedupe hash) untouched.
ALTER TABLE clippings ADD COLUMN content_edited TEXT;
ALTER TABLE clippings ADD COLUMN edited_at TEXT;
