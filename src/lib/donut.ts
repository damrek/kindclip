/** Geometry for the reading-stats donut, in `pathLength = 100` units.
 *
 * The component rotates the circle -90° so the first slice starts at the top
 * and paints clockwise. A gap separates neighbours so the surface shows
 * between slices while every slice keeps its share of the whole. */

/** Gap between two neighbouring slices, in percentage points of the circle. */
export const DONUT_GAP = 1.4;

export interface DonutSegment {
  /** Index of this count in the input array, so the caller keeps its rows. */
  index: number;
  /** Share of the whole, in percentage points. */
  fraction: number;
  /** Painted dash length (`stroke-dasharray` first value). */
  dash: number;
  /** Value for `stroke-dashoffset`: negative so the dash starts at the slice. */
  offset: number;
}

/** Turn per-kind counts into painted arcs; empty buckets are skipped. */
export function donutSegments(counts: number[], gap = DONUT_GAP): DonutSegment[] {
  const total = counts.reduce((sum, count) => sum + Math.max(0, count), 0);
  if (total === 0) {
    return [];
  }
  const visible = counts.filter((count) => count > 0);
  const segments: DonutSegment[] = [];
  let cursor = 0;
  for (const [index, count] of counts.entries()) {
    if (count <= 0) {
      continue;
    }
    const fraction = (count / total) * 100;
    // One slice paints the whole ring; otherwise a tiny slice keeps a dash
    // even when the gap alone would swallow it.
    const spacing = visible.length > 1 ? Math.min(gap, fraction / 3) : 0;
    const start = cursor + spacing / 2;
    segments.push({
      index,
      fraction,
      dash: fraction - spacing,
      // `|| 0` keeps the first slice at +0 instead of -0.
      offset: -start || 0,
    });
    cursor += fraction;
  }
  return segments;
}
