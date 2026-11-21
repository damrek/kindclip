-- Clipping reminders: one scheduled notification per clipping.
-- Rewriting a reminder replaces the row; delivered rows keep `notified_at` so
-- a delivery is never repeated. Deleting the clipping removes its reminder.

CREATE TABLE IF NOT EXISTS reminders (
  clipping_id INTEGER PRIMARY KEY REFERENCES clippings(id) ON DELETE CASCADE,
  remind_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notified_at TEXT
);
-- Due scan: pending rows ordered by time.
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(remind_at);
