/** The scroll geometry the bottom fade needs; a real element or a plain object. */
export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/**
 * True while `element` still has content below the fold, which is when a
 * bottom fade is honest. One pixel of tolerance absorbs sub-pixel rounding at
 * the end, so the fade actually leaves once the last row is fully visible.
 */
export function hasMoreBelow(element: ScrollMetrics): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight > 1;
}
