/** Clipping reminders: one scheduled notification per clipping.
 *
 * `remind_at` is an ISO-8601 UTC instant, so plain string comparison orders and
 * compares due rows without parsing. `notified_at` marks a delivery so the
 * catch-up scan never repeats it. */
import type { DbPort } from "./port";

export interface PendingReminder {
  clipping_id: number;
  remind_at: string;
  /** Book title; the management panel and the notification title. */
  book_title: string;
  /** Edited note text when present, otherwise the original. */
  content: string | null;
}

export interface DueReminder {
  clipping_id: number;
  remind_at: string;
  /** Book title; the notification title. */
  book_title: string;
  /** Edited note text when present, otherwise the original. */
  content: string | null;
}

export const LIST_PENDING_REMINDERS_SQL =
  "SELECT r.clipping_id, r.remind_at, b.title AS book_title, " +
  "COALESCE(c.content_edited, c.content) AS content " +
  "FROM reminders r " +
  "JOIN clippings c ON c.id = r.clipping_id " +
  "JOIN books b ON b.id = c.book_id " +
  "WHERE r.notified_at IS NULL ORDER BY r.remind_at";

export async function listPendingReminders(port: DbPort): Promise<PendingReminder[]> {
  return port.select<PendingReminder>(LIST_PENDING_REMINDERS_SQL);
}

export const SET_REMINDER_SQL =
  "INSERT INTO reminders (clipping_id, remind_at, created_at, notified_at) " +
  "VALUES ($1, $2, $3, NULL) " +
  "ON CONFLICT(clipping_id) DO UPDATE SET remind_at = excluded.remind_at, " +
  "created_at = excluded.created_at, notified_at = NULL";

/** Schedule or reschedule the clipping's single reminder; re-arms a delivered one. */
export async function setReminder(
  port: DbPort,
  clippingId: number,
  remindAt: string,
  createdAt: string,
): Promise<void> {
  await port.execute(SET_REMINDER_SQL, [clippingId, remindAt, createdAt]);
}

export const CANCEL_REMINDER_SQL = "DELETE FROM reminders WHERE clipping_id = $1";

export async function cancelReminder(port: DbPort, clippingId: number): Promise<void> {
  await port.execute(CANCEL_REMINDER_SQL, [clippingId]);
}

export const DUE_REMINDERS_SQL =
  "SELECT r.clipping_id, r.remind_at, b.title AS book_title, " +
  "COALESCE(c.content_edited, c.content) AS content " +
  "FROM reminders r " +
  "JOIN clippings c ON c.id = r.clipping_id " +
  "JOIN books b ON b.id = c.book_id " +
  "WHERE r.notified_at IS NULL AND r.remind_at <= $1 " +
  "ORDER BY r.remind_at LIMIT $2";

/** Pending reminders at or before `nowIso`, oldest first, capped by `limit`. */
export async function dueReminders(
  port: DbPort,
  nowIso: string,
  limit = 5,
): Promise<DueReminder[]> {
  return port.select<DueReminder>(DUE_REMINDERS_SQL, [nowIso, limit]);
}

export const MARK_REMINDER_NOTIFIED_SQL =
  "UPDATE reminders SET notified_at = $2 WHERE clipping_id = $1";

export async function markReminderNotified(
  port: DbPort,
  clippingId: number,
  notifiedAt: string,
): Promise<void> {
  await port.execute(MARK_REMINDER_NOTIFIED_SQL, [clippingId, notifiedAt]);
}
