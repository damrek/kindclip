import { describe, expect, it } from "vitest";
import type { DbPort } from "./port";
import {
  cancelReminder,
  dueReminders,
  listPendingReminders,
  markReminderNotified,
  setReminder,
} from "./reminders";

/** Records every statement and serves the rows the test scripts. */
function fakePort(rows: unknown[][] = []) {
  const selects: Array<{ sql: string; params: unknown[] }> = [];
  const executes: Array<{ sql: string; params: unknown[] }> = [];
  const port: DbPort = {
    async select<T>(sql: string, params?: unknown[]): Promise<T[]> {
      selects.push({ sql, params: params ?? [] });
      return (rows.shift() ?? []) as T[];
    },
    async execute(sql: string, params?: unknown[]) {
      executes.push({ sql, params: params ?? [] });
      return {};
    },
  };
  return { port, selects, executes };
}

describe("listPendingReminders", () => {
  it("returns pending rows with their book and text, in time order", async () => {
    const pending = [
      {
        clipping_id: 4,
        remind_at: "2026-11-18T09:00:00.000Z",
        book_title: "Deep Work",
        content: "Focus",
      },
    ];
    const { port, selects } = fakePort([pending]);

    await expect(listPendingReminders(port)).resolves.toEqual(pending);
    expect(selects[0]?.sql).toContain("notified_at IS NULL");
    expect(selects[0]?.sql).toContain("ORDER BY r.remind_at");
    expect(selects[0]?.sql).toContain("COALESCE(c.content_edited, c.content)");
  });
});

describe("setReminder", () => {
  it("upserts one row per clipping and re-arms a delivered reminder", async () => {
    const { port, executes } = fakePort();

    await setReminder(port, 7, "2026-11-18T09:00:00.000Z", "2026-11-17T10:00:00.000Z");

    expect(executes).toHaveLength(1);
    expect(executes[0]?.sql).toContain("ON CONFLICT(clipping_id) DO UPDATE");
    expect(executes[0]?.sql).toContain("notified_at = NULL");
    expect(executes[0]?.params).toEqual([
      7,
      "2026-11-18T09:00:00.000Z",
      "2026-11-17T10:00:00.000Z",
    ]);
  });
});

describe("cancelReminder", () => {
  it("deletes by clipping id", async () => {
    const { port, executes } = fakePort();

    await cancelReminder(port, 7);

    expect(executes[0]?.sql).toBe("DELETE FROM reminders WHERE clipping_id = $1");
    expect(executes[0]?.params).toEqual([7]);
  });
});

describe("dueReminders", () => {
  it("reads pending rows up to now, joined with the book title and text", async () => {
    const due = [
      { clipping_id: 4, remind_at: "2026-11-17T09:00:00.000Z", book_title: "Book", content: "txt" },
    ];
    const { port, selects } = fakePort([due]);

    await expect(dueReminders(port, "2026-11-17T10:00:00.000Z", 3)).resolves.toEqual(due);
    expect(selects[0]?.sql).toContain("notified_at IS NULL AND r.remind_at <= $1");
    expect(selects[0]?.sql).toContain("COALESCE(c.content_edited, c.content)");
    expect(selects[0]?.params).toEqual(["2026-11-17T10:00:00.000Z", 3]);
  });
});

describe("markReminderNotified", () => {
  it("records the delivery instant", async () => {
    const { port, executes } = fakePort();

    await markReminderNotified(port, 7, "2026-11-17T10:00:05.000Z");

    expect(executes[0]?.sql).toContain("SET notified_at = $2");
    expect(executes[0]?.params).toEqual([7, "2026-11-17T10:00:05.000Z"]);
  });
});
