import { describe, expect, it } from "vitest";
import { PAGE_SIZES, clampPage, pageWindow, totalPages } from "./pagination";

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

describe("PAGE_SIZES", () => {
  it("offers the three page sizes", () => {
    expect(PAGE_SIZES).toEqual([20, 50, 100]);
  });
});
