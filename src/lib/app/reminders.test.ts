import { describe, expect, it } from "vitest";
import { REMINDER_POLL_MS, Reminders, type ReminderDeps } from "./reminders.svelte";

interface StoredRow {
  at: string;
  title: string;
  content: string | null;
  notified: string | null;
}

/** In-memory double with the same semantics as the SQL layer. */
function fakeDeps(overrides: Partial<ReminderDeps> = {}) {
  const rows = new Map<number, StoredRow>();
  const notified: Array<{ title: string; body: string }> = [];
  const removed: number[] = [];
  const calls = { pending: 0, due: 0, permission: 0, writes: 0 };
  const now = new Date("2026-11-17T10:00:00.000Z");

  const pendingRows = () =>
    [...rows.entries()]
      .filter(([, row]) => row.notified === null)
      .sort((a, b) => a[1].at.localeCompare(b[1].at))
      .map(([id, row]) => ({
        clipping_id: id,
        remind_at: row.at,
        book_title: row.title,
        content: row.content,
      }));

  const dueRows = (nowIso: string) =>
    [...rows.entries()]
      .filter(([, row]) => row.notified === null && row.at <= nowIso)
      .sort((a, b) => a[1].at.localeCompare(b[1].at))
      .map(([id, row]) => ({
        clipping_id: id,
        remind_at: row.at,
        book_title: row.title,
        content: row.content,
      }));

  const deps: ReminderDeps = {
    listPending: async () => {
      calls.pending += 1;
      return pendingRows();
    },
    listDue: async (nowIso) => {
      calls.due += 1;
      return dueRows(nowIso);
    },
    upsert: async (clippingId, remindAt) => {
      calls.writes += 1;
      const previous = rows.get(clippingId);
      rows.set(clippingId, {
        at: remindAt,
        title: previous?.title ?? "Book",
        content: previous?.content ?? null,
        notified: null,
      });
    },
    remove: async (clippingId) => {
      removed.push(clippingId);
      rows.delete(clippingId);
    },
    markNotified: async (clippingId, at) => {
      const row = rows.get(clippingId);
      if (row) rows.set(clippingId, { ...row, notified: at });
    },
    notify: (title, body) => {
      notified.push({ title, body });
    },
    permission: async () => {
      calls.permission += 1;
      return true;
    },
    now: () => new Date(now.getTime()),
    noContent: () => "Reminder",
    log: () => {},
    ...overrides,
  };

  return {
    deps,
    rows,
    notified,
    removed,
    calls,
    now,
    add(id: number, at: string, title = "Book", content: string | null = "text") {
      rows.set(id, { at, title, content, notified: null });
    },
  };
}

describe("Reminders.hydrate", () => {
  it("loads the pending rows and delivers the overdue ones", async () => {
    const db = fakeDeps();
    db.add(4, "2026-11-17T09:00:00.000Z", "Deep Work", "Focus \n is  the skill");
    db.add(9, "2026-12-01T09:00:00.000Z", "Later", null);
    const reminders = new Reminders(db.deps);

    await reminders.hydrate();

    expect(reminders.at(9)).toBe("2026-12-01T09:00:00.000Z");
    expect(reminders.at(4)).toBeNull();
    expect(db.notified).toEqual([{ title: "Deep Work", body: "Focus is the skill" }]);
    expect(reminders.pending).toEqual([
      { clippingId: 9, at: "2026-12-01T09:00:00.000Z", bookTitle: "Later" },
    ]);
  });

  it("falls back to the localized body when the clipping has no text", async () => {
    const db = fakeDeps();
    db.add(2, "2026-11-17T09:00:00.000Z", "Book", null);

    await new Reminders(db.deps).hydrate();

    expect(db.notified[0]?.body).toBe("Reminder");
  });

  it("keeps the app usable when the DB read fails", async () => {
    const logged: string[] = [];
    const db = fakeDeps({
      listPending: async () => {
        throw new Error("db down");
      },
      log: (scope) => {
        logged.push(scope);
      },
    });
    const reminders = new Reminders(db.deps);

    await expect(reminders.hydrate()).resolves.toBeUndefined();
    expect(logged).toContain("reminders-load");
    expect(reminders.scheduled).toEqual({});
    expect(reminders.pending).toEqual([]);
  });
});

describe("Reminders.schedule", () => {
  it("stores the instant, exposes it for the card and lists it in the panel", async () => {
    const db = fakeDeps();
    db.add(7, "2026-12-01T09:00:00.000Z", "Book");
    const reminders = new Reminders(db.deps);
    const at = new Date("2026-11-18T09:00:00.000Z");

    await expect(reminders.schedule(7, at)).resolves.toBe("ok");

    expect(db.calls.permission).toBe(1);
    expect(reminders.at(7)).toBe("2026-11-18T09:00:00.000Z");
    expect(reminders.pending).toEqual([
      { clippingId: 7, at: "2026-11-18T09:00:00.000Z", bookTitle: "Book" },
    ]);
    expect(reminders.busyId).toBeNull();
  });

  it("rejects a past or invalid instant without writing", async () => {
    const db = fakeDeps();
    const reminders = new Reminders(db.deps);

    await expect(reminders.schedule(7, new Date("2026-11-17T09:59:59.000Z"))).resolves.toBe(
      "past",
    );
    await expect(reminders.schedule(7, new Date("nope"))).resolves.toBe("invalid");
    expect(db.calls.writes).toBe(0);
    expect(reminders.at(7)).toBeNull();
  });

  it("reports a refused system permission instead of writing", async () => {
    const db = fakeDeps({ permission: async () => false });
    const reminders = new Reminders(db.deps);

    await expect(reminders.schedule(7, new Date("2026-11-18T09:00:00.000Z"))).resolves.toBe(
      "denied",
    );
    expect(db.calls.writes).toBe(0);
  });

  it("reports a failed write", async () => {
    const db = fakeDeps({
      upsert: async () => {
        throw new Error("db down");
      },
    });
    const reminders = new Reminders(db.deps);

    await expect(reminders.schedule(7, new Date("2026-11-18T09:00:00.000Z"))).resolves.toBe(
      "error",
    );
    expect(reminders.at(7)).toBeNull();
  });
});

describe("Reminders.cancel", () => {
  it("drops the row, the card state and the panel entry", async () => {
    const db = fakeDeps();
    db.add(7, "2026-12-01T09:00:00.000Z");
    const reminders = new Reminders(db.deps);
    await reminders.hydrate();

    await expect(reminders.cancel(7)).resolves.toBe(true);

    expect(db.removed).toEqual([7]);
    expect(reminders.at(7)).toBeNull();
    expect(reminders.pending).toEqual([]);
  });

  it("reports a failed delete and keeps the state", async () => {
    const db = fakeDeps();
    db.add(7, "2026-12-01T09:00:00.000Z");
    const reminders = new Reminders(db.deps);
    await reminders.hydrate();
    db.deps.remove = async () => {
      throw new Error("db down");
    };

    await expect(reminders.cancel(7)).resolves.toBe(false);
    expect(reminders.at(7)).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("Reminders.deliverDue", () => {
  it("never repeats a delivery after a restart", async () => {
    const db = fakeDeps();
    db.add(1, "2026-11-17T09:00:00.000Z");

    await new Reminders(db.deps).hydrate();
    // A restart reads the same store: the delivered row must not fire again.
    await new Reminders(db.deps).hydrate();
    await new Reminders(db.deps).deliverDue();

    expect(db.notified).toHaveLength(1);
    expect(db.rows.get(1)?.notified).not.toBeNull();
  });

  it("drops a delivered reminder from the panel", async () => {
    const db = fakeDeps();
    db.add(1, "2026-11-17T09:00:00.000Z");
    db.add(2, "2026-12-01T09:00:00.000Z");
    const reminders = new Reminders(db.deps);
    await reminders.hydrate();

    expect(reminders.pending.map((item) => item.clippingId)).toEqual([2]);
  });

  it("does not overlap two delivery passes", async () => {
    let queries = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = fakeDeps({
      listDue: async () => {
        queries += 1;
        await gate;
        return [];
      },
    });
    const reminders = new Reminders(db.deps);

    const first = reminders.deliverDue();
    await reminders.deliverDue(); // returns at once: a pass is already running
    expect(queries).toBe(1);

    release();
    await first;
    await reminders.deliverDue();
    expect(queries).toBe(2);
  });
});

describe("Reminders.nextDelayMs", () => {
  it("falls back to the safety poll when nothing is pending", async () => {
    const reminders = new Reminders(fakeDeps().deps);
    await reminders.refresh();
    expect(reminders.nextDelayMs()).toBe(REMINDER_POLL_MS);
  });

  it("arms for the earliest reminder instead of the fixed poll", async () => {
    const db = fakeDeps();
    db.add(1, "2026-11-17T10:05:00.000Z");
    db.add(2, "2026-11-17T10:00:03.000Z");
    const reminders = new Reminders(db.deps);
    await reminders.refresh();

    expect(reminders.nextDelayMs()).toBe(3_000);
  });

  it("clamps far reminders and never arms below a second", async () => {
    const db = fakeDeps();
    db.add(1, "2026-11-17T12:00:00.000Z");
    const reminders = new Reminders(db.deps);
    await reminders.refresh();
    expect(reminders.nextDelayMs()).toBe(REMINDER_POLL_MS);

    const soon = fakeDeps();
    soon.add(1, "2026-11-17T10:00:00.500Z");
    const near = new Reminders(soon.deps);
    await near.refresh();
    expect(near.nextDelayMs()).toBe(1_000);
  });

  it("ignores a row whose instant cannot be parsed", async () => {
    const db = fakeDeps();
    db.add(1, "not-a-date");
    const reminders = new Reminders(db.deps);
    await reminders.refresh();
    expect(reminders.nextDelayMs()).toBe(REMINDER_POLL_MS);
  });
});
