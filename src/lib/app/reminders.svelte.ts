/** Clipping reminders: schedule one system notification per clipping, deliver
 * the due ones while the app runs, and catch up on launch.
 *
 * The store, the notification channel and the clock arrive as dependencies so
 * every rule is testable without Tauri, a database or a real timer. */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import {
  cancelReminder,
  dueReminders,
  getDb,
  listPendingReminders,
  markReminderNotified,
  setReminder,
  type DueReminder,
} from "../db";
import { SvelteDate } from "svelte/reactivity";
import { logger } from "../log";
import { reminderExcerpt, type ReminderItem } from "../reminders";

export type ScheduleResult = "ok" | "denied" | "invalid" | "past" | "error";

export interface ReminderDeps {
  listPending: () => Promise<
    Array<{ clipping_id: number; remind_at: string; book_title: string; content: string | null }>
  >;
  listDue: (nowIso: string) => Promise<DueReminder[]>;
  upsert: (clippingId: number, remindAt: string, createdAt: string) => Promise<void>;
  remove: (clippingId: number) => Promise<void>;
  markNotified: (clippingId: number, at: string) => Promise<void>;
  /** Send a system notification. The desktop plugin reports no failure back. */
  notify: (title: string, body: string) => void;
  /** Ask for the OS notification permission (already granted on Linux). */
  permission: () => Promise<boolean>;
  now: () => Date;
  /** Body used when the clipping carries no text (localized). */
  noContent: () => string;
  log: (scope: string, error: unknown) => void;
}

export const REMINDER_POLL_MS = 30_000;

export class Reminders {
  /** Pending reminders by clipping id, as ISO UTC instants. */
  scheduled = $state<Record<number, string>>({});
  /** The same rows as a list, for the management panel. */
  pending = $state<ReminderItem[]>([]);
  /** Clipping whose reminder write is in flight, for the dialog's busy state. */
  busyId = $state<number | null>(null);
  /** A delivery pass is running; a slow one never overlaps the next tick. */
  #delivering = false;

  constructor(private readonly deps: ReminderDeps) {}

  at = (clippingId: number): string | null => this.scheduled[clippingId] ?? null;

  /** Milliseconds until the earliest pending reminder, clamped to the safety
   * poll so a due row is never late by more than a second. */
  nextDelayMs(): number {
    const nowMs = this.deps.now().getTime();
    let earliest = Number.POSITIVE_INFINITY;
    for (const item of this.pending) {
      const at = Date.parse(item.at);
      if (!Number.isNaN(at) && at < earliest) {
        earliest = at;
      }
    }
    if (!Number.isFinite(earliest)) {
      return REMINDER_POLL_MS;
    }
    return Math.min(REMINDER_POLL_MS, Math.max(1_000, earliest - nowMs));
  }

  /** Load the pending rows, then deliver anything already overdue. */
  async hydrate(): Promise<void> {
    await this.refresh();
    await this.deliverDue();
  }

  /** Re-read the pending rows; the card map and the panel stay in step. */
  async refresh(): Promise<void> {
    try {
      const rows = await this.deps.listPending();
      const scheduled: Record<number, string> = {};
      for (const row of rows) {
        scheduled[row.clipping_id] = row.remind_at;
      }
      this.scheduled = scheduled;
      this.pending = rows.map((row) => ({
        clippingId: row.clipping_id,
        at: row.remind_at,
        bookTitle: row.book_title,
      }));
    } catch (error) {
      this.deps.log("reminders-load", error);
    }
  }

  /** Deliver every reminder due at the current instant, oldest first. */
  async deliverDue(): Promise<void> {
    if (this.#delivering) {
      return;
    }
    this.#delivering = true;
    try {
      const nowIso = this.deps.now().toISOString();
      let delivered = 0;
      for (const row of await this.deps.listDue(nowIso)) {
        // Mark first: the desktop plugin reports no send failure, so a row
        // whose delivery cannot be recorded is skipped instead of notified
        // twice on the next pass.
        await this.deps.markNotified(row.clipping_id, nowIso);
        this.deps.notify(
          row.book_title,
          reminderExcerpt(row.content, this.deps.noContent()),
        );
        this.#forget(row.clipping_id);
        delivered += 1;
      }
      if (delivered > 0) {
        await this.refresh();
      }
    } catch (error) {
      this.deps.log("reminders-deliver", error);
    } finally {
      this.#delivering = false;
    }
  }

  /** Schedule (or reschedule) the clipping's reminder; a delivered one re-arms. */
  async schedule(clippingId: number, at: Date): Promise<ScheduleResult> {
    if (Number.isNaN(at.getTime())) {
      return "invalid";
    }
    const now = this.deps.now();
    if (at.getTime() <= now.getTime()) {
      return "past";
    }
    this.busyId = clippingId;
    try {
      if (!(await this.deps.permission())) {
        return "denied";
      }
      const iso = at.toISOString();
      await this.deps.upsert(clippingId, iso, now.toISOString());
      this.scheduled = { ...this.scheduled, [clippingId]: iso };
      await this.refresh();
      return "ok";
    } catch (error) {
      this.deps.log("reminders-save", error);
      return "error";
    } finally {
      this.busyId = null;
    }
  }

  /** Drop the clipping's reminder; the card goes back to no bell state. */
  async cancel(clippingId: number): Promise<boolean> {
    this.busyId = clippingId;
    try {
      await this.deps.remove(clippingId);
      this.#forget(clippingId);
      await this.refresh();
      return true;
    } catch (error) {
      this.deps.log("reminders-cancel", error);
      return false;
    } finally {
      this.busyId = null;
    }
  }

  #forget(clippingId: number): void {
    if (!(clippingId in this.scheduled)) {
      return;
    }
    const next = { ...this.scheduled };
    delete next[clippingId];
    this.scheduled = next;
  }
}

export function createReminders(noContent: () => string): Reminders {
  return new Reminders({
    listPending: async () => listPendingReminders(await getDb()),
    listDue: async (nowIso) => dueReminders(await getDb(), nowIso),
    upsert: async (clippingId, remindAt, createdAt) =>
      setReminder(await getDb(), clippingId, remindAt, createdAt),
    remove: async (clippingId) => cancelReminder(await getDb(), clippingId),
    markNotified: async (clippingId, at) =>
      markReminderNotified(await getDb(), clippingId, at),
    notify: (title, body) => {
      sendNotification({ title, body });
    },
    permission: async () => {
      if (await isPermissionGranted()) {
        return true;
      }
      return (await requestPermission()) === "granted";
    },
    now: () => new SvelteDate(),
    noContent,
    log: logger.error,
  });
}
