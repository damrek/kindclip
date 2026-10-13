import { describe, expect, it, vi } from "vitest";
import {
  clampPage,
  debounce,
  emptyFilter,
  formatAddedOn,
  formatReference,
  KIND_LABELS,
  PAGE_SIZES,
  pageWindow,
  totalPages,
} from "./library";

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

describe("KIND_LABELS", () => {
  it("labels every kind in Spanish", () => {
    expect(KIND_LABELS).toEqual({ highlight: "Subrayado", note: "Nota", bookmark: "Marcador" });
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

  it("falls back to raw on garbage", () => {
    expect(formatAddedOn("not-a-date", "raw")).toBe("raw");
  });
});
