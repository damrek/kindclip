import { describe, expect, it } from "vitest";
import { DONUT_GAP, donutSegments } from "./donut";

describe("donutSegments", () => {
  it("returns no segments for an empty or zero total", () => {
    expect(donutSegments([])).toEqual([]);
    expect(donutSegments([0, 0])).toEqual([]);
  });

  it("paints a single bucket as the whole circle", () => {
    expect(donutSegments([7])).toEqual([
      { index: 0, fraction: 100, dash: 100, offset: 0 },
    ]);
  });

  it("splits the circle proportionally with a gap between neighbours", () => {
    const segments = donutSegments([36, 7, 6]);

    expect(segments.map((segment) => segment.index)).toEqual([0, 1, 2]);
    expect(segments[0].fraction).toBeCloseTo(73.469, 3);
    expect(segments[1].fraction).toBeCloseTo(14.286, 3);
    expect(segments[2].fraction).toBeCloseTo(12.245, 3);
    expect(segments[0].dash).toBeCloseTo(73.469 - DONUT_GAP, 3);
    expect(segments[0].offset).toBeCloseTo(-DONUT_GAP / 2, 3);
    expect(segments[1].offset).toBeCloseTo(-(73.469 + DONUT_GAP / 2), 3);
    expect(segments[2].offset).toBeCloseTo(-(87.755 + DONUT_GAP / 2), 3);
  });

  it("skips empty buckets without shifting the remaining fractions", () => {
    const segments = donutSegments([36, 0, 6]);

    expect(segments.map((segment) => segment.index)).toEqual([0, 2]);
    expect(segments[0].fraction).toBeCloseTo(85.714, 3);
    expect(segments[1].fraction).toBeCloseTo(14.286, 3);
    expect(segments[1].offset).toBeCloseTo(-(85.714 + DONUT_GAP / 2), 3);
  });

  it("keeps a visible dash for a slice smaller than the gap", () => {
    const segments = donutSegments([999, 1]);

    expect(segments[1].dash).toBeGreaterThan(0);
    expect(segments[1].dash).toBeLessThan(1);
  });

  it("ignores negative counts", () => {
    const segments = donutSegments([5, -3]);

    expect(segments).toEqual([{ index: 0, fraction: 100, dash: 100, offset: 0 }]);
  });
});
