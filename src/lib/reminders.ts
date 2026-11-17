/** Reminder helpers shared by the dialog, the card and the delivery state. */

/** Characters of clipping text carried in a notification body. */
export const REMINDER_EXCERPT_LENGTH = 120;

/** One-line excerpt: whitespace collapsed, code points never split. */
export function reminderExcerpt(content: string | null, fallback: string): string {
  const text = (content ?? "").replace(/\s+/g, " ").trim();
  if (text === "") {
    return fallback;
  }
  const points = Array.from(text);
  if (points.length <= REMINDER_EXCERPT_LENGTH) {
    return text;
  }
  return `${points.slice(0, REMINDER_EXCERPT_LENGTH).join("").trimEnd()}…`;
}

const pad = (value: number): string => String(value).padStart(2, "0");

/** One pending reminder, as the management panel lists it. */
export interface ReminderItem {
  clippingId: number;
  /** ISO UTC instant. */
  at: string;
  bookTitle: string;
}

/** `YYYY-MM-DD` for a native date input. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local instant from a date input value plus explicit hour and minute selects.
 * Separate controls because WebKit (the Linux/macOS webview) renders
 * `datetime-local` without a time picker. Null when any part is invalid. */
export function combineLocal(dateValue: string, hour: number, minute: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  if (match === null) {
    return null;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return null;
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  // A date input can still carry an impossible day; the constructor rolls it
  // over, so verify the components survived.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Today at 20:00, or tomorrow when that already passed. */
export function tonight(now: Date): Date {
  const date = new Date(now.getTime());
  date.setHours(20, 0, 0, 0);
  if (date.getTime() <= now.getTime()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

/** Tomorrow at 09:00. */
export function tomorrowMorning(now: Date): Date {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

/** One week from now, same clock time. */
export function inOneWeek(now: Date): Date {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + 7);
  date.setSeconds(0, 0);
  return date;
}

/** Human date for the tooltip and the dialog, in the active locale. */
export function formatReminderAt(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}
