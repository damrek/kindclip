-- kindclip initial schema (S5, S6).
-- Applied once by tauri-plugin-sql migrations; IF NOT EXISTS keeps
-- manual sqlite3 testing idempotent.

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  file_hash TEXT NOT NULL UNIQUE,
  clipping_count INTEGER NOT NULL DEFAULT 0,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT
);
-- Expression index: SQLite treats NULL authors as distinct in plain
-- UNIQUE constraints, so COALESCE keeps (title, no-author) unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_title_author
  ON books(title, COALESCE(author, ''));

CREATE TABLE IF NOT EXISTS clippings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id),
  file_id INTEGER NOT NULL REFERENCES files(id),
  kind TEXT NOT NULL,
  page INTEGER,
  location TEXT,
  added_on_raw TEXT NOT NULL DEFAULT '',
  added_on TEXT,
  content TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clippings_book ON clippings(book_id);
CREATE INDEX IF NOT EXISTS idx_clippings_file ON clippings(file_id);
CREATE INDEX IF NOT EXISTS idx_clippings_added ON clippings(added_on);

CREATE TABLE IF NOT EXISTS favorites (
  clipping_id INTEGER PRIMARY KEY REFERENCES clippings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
