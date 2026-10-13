import { describe, expect, it, vi } from "vitest";
import {
  applyFavoriteToggle,
  clampPage,
  copyClippingContent,
  debounce,
  emptyFilter,
  formatAddedOn,
  formatReference,
  PAGE_SIZES,
  pageWindow,
  totalPages,
} from "./library";
import type { ClippingRow } from "./types";

describe("totalPages", () => {
  it("computes page counts", () => {
    expect(totalPages(0, 20)).toBe(0);
    expect(totalPages(1, 20)).toBe(1);
    expect(totalPages(20, 20)).toBe(1);
    expect(totalPages(21, 20)).toBe(2);
    expect(totalPages(100, 50)).toBe(2);
  });
});

describe("clampPage", () => {
  it("keeps the page inside 1..totalPages", () => {
    expect(clampPage(3, 100, 20)).toBe(3);
    expect(clampPage(9, 100, 20)).toBe(5);
    expect(clampPage(0, 100, 20)).toBe(1);
    expect(clampPage(-4, 100, 20)).toBe(1);
    expect(clampPage(1, 0, 20)).toBe(1);
  });
});

describe("pageWindow", () => {
  it("shows every page when they fit", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("collapses distant pages with ellipses", () => {
    expect(pageWindow(5, 10)).toEqual([1, 2, "…", 4, 5, 6, "…", 9, 10]);
    expect(pageWindow(1, 20)).toEqual([1, 2, "…", 19, 20]);
    expect(pageWindow(20, 20)).toEqual([1, 2, "…", 19, 20]);
  });
});

describe("debounce", () => {
  it("calls once with the latest args after the delay", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debounced = debounce(fn, 200);
      debounced("a");
      debounced("b");
      vi.advanceTimersByTime(199);
      expect(fn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith("b");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a pending call", () => {
    vi.useFakeTimers();
    try {
      const fn = vi.fn();
      const debounced = debounce(fn, 200);
      debounced("a");
      debounced.cancel();
      vi.advanceTimersByTime(500);
      expect(fn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("emptyFilter", () => {
  it("returns the default filter", () => {
    expect(emptyFilter()).toEqual({ query: "", bookId: null, kind: null, favoritesOnly: false });
  });
});

describe("PAGE_SIZES", () => {
  it("offers 20/50/100", () => {
    expect(PAGE_SIZES).toEqual([20, 50, 100]);
  });
});

describe("formatReference", () => {
  it("combines page and location", () => {
    expect(formatReference(12, "234-236")).toBe("p. 12 · pos. 234-236");
    expect(formatReference(null, "100-101")).toBe("pos. 100-101");
    expect(formatReference(3, null)).toBe("p. 3");
    expect(formatReference(null, null)).toBe("");
  });
});

describe("formatAddedOn", () => {
  it("falls back to raw when there is no normalized date", () => {
    expect(formatAddedOn(null, "raw")).toBe("raw");
    expect(formatAddedOn(null, "")).toBe("");
  });

  it("renders the normalized date with year", () => {
    expect(formatAddedOn("2020-01-06T10:15:00", "raw")).toContain("2020");
  });

  it("renders month names in the requested locale", () => {
    expect(formatAddedOn("2020-01-06T10:15:00", "raw", "en-US")).toContain("Jan");
  });

  it("falls back to raw on garbage", () => {
    expect(formatAddedOn("not-a-date", "raw")).toBe("raw");
  });
});

function row(id: number, favorite: boolean): ClippingRow {
  return {
    id,
    title: "B",
    author: null,
    kind: "highlight",
    page: null,
    location: null,
    added_on_raw: "",
    added_on: null,
    content: "c",
    content_hash: `h${id}`,
    favorite,
  };
}

describe("applyFavoriteToggle", () => {
  it("flips the favorite flag of one row, keeping the rest", () => {
    const items = [row(1, false), row(2, true)];
    expect(applyFavoriteToggle(items, 1, true)).toEqual([row(1, true), row(2, true)]);
    expect(applyFavoriteToggle(items, 2, false)).toEqual([row(1, false), row(2, false)]);
  });

  it("leaves unknown ids untouched", () => {
    const items = [row(1, false)];
    expect(applyFavoriteToggle(items, 99, true)).toEqual(items);
  });
});

describe("copyClippingContent", () => {
  it("returns true when the write succeeds", async () => {
    await expect(copyClippingContent(async () => {}, "text")).resolves.toBe(true);
  });

  it("returns false when the write fails", async () => {
    const denied = async (): Promise<void> => {
      throw new Error("denied");
    };
    await expect(copyClippingContent(denied, "text")).resolves.toBe(false);
  });
});
