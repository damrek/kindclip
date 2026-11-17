import { describe, expect, it } from "vitest";
import {
  combineLocal,
  formatReminderAt,
  inOneWeek,
  REMINDER_EXCERPT_LENGTH,
  reminderExcerpt,
  toDateInput,
  tomorrowMorning,
  tonight,
} from "./reminders";

describe("reminderExcerpt", () => {
  it("collapses whitespace and falls back when there is no text", () => {
    expect(reminderExcerpt("  one\n\ntwo\t three  ", "fallback")).toBe("one two three");
    expect(reminderExcerpt(null, "fallback")).toBe("fallback");
    expect(reminderExcerpt("   ", "fallback")).toBe("fallback");
  });

  it("caps at the excerpt length without splitting a code point", () => {
    const text = "🙂".repeat(REMINDER_EXCERPT_LENGTH + 5);
    const excerpt = reminderExcerpt(text, "fallback");
    expect(Array.from(excerpt)).toHaveLength(REMINDER_EXCERPT_LENGTH + 1);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.includes("\uFFFD")).toBe(false);
  });
});

describe("date and time controls", () => {
  it("formats the local date for the input", () => {
    expect(toDateInput(new Date(2026, 10, 17, 23, 59))).toBe("2026-11-17");
  });

  it("combines a date with explicit hour and minute selects", () => {
    const date = combineLocal("2026-11-17", 18, 30);
    expect(date?.getTime()).toBe(new Date(2026, 10, 17, 18, 30).getTime());
  });

  it("rejects malformed dates, impossible days and out-of-range times", () => {
    expect(combineLocal("", 9, 0)).toBeNull();
    expect(combineLocal("17/11/2026", 9, 0)).toBeNull();
    expect(combineLocal("2026-02-31", 9, 0)).toBeNull();
    expect(combineLocal("2026-11-17", 24, 0)).toBeNull();
    expect(combineLocal("2026-11-17", 9, 60)).toBeNull();
    expect(combineLocal("2026-11-17", 9.5, 0)).toBeNull();
  });
});

describe("presets", () => {
  it("puts tonight at 20:00, moving to tomorrow once that passed", () => {
    const evening = tonight(new Date(2026, 10, 17, 18, 30));
    expect(evening.getDate()).toBe(17);
    expect(evening.getHours()).toBe(20);

    const late = tonight(new Date(2026, 10, 17, 21, 0));
    expect(late.getDate()).toBe(18);
    expect(late.getHours()).toBe(20);
  });

  it("puts tomorrow morning at 09:00 and one week out at the same time", () => {
    const now = new Date(2026, 10, 17, 18, 30);
    const morning = tomorrowMorning(now);
    expect(morning.getDate()).toBe(18);
    expect(morning.getHours()).toBe(9);

    const week = inOneWeek(now);
    expect(week.getDate()).toBe(24);
    expect(week.getHours()).toBe(18);
  });
});

describe("formatReminderAt", () => {
  it("renders a readable date instead of the raw instant", () => {
    const text = formatReminderAt("2026-11-18T09:00:00.000Z", "en");
    expect(text).not.toBe("2026-11-18T09:00:00.000Z");
    expect(text.length).toBeGreaterThan(4);
  });

  it("keeps an unparseable value as-is", () => {
    expect(formatReminderAt("garbage", "en")).toBe("garbage");
  });
});
