/** Font-size accessibility control: a five-step root scaling. */
import { writeStored } from "./storage";

export type FontScale = "xs" | "small" | "medium" | "large" | "xl";

export const FONT_SCALES: FontScale[] = ["xs", "small", "medium", "large", "xl"];

const STORAGE_KEY = "kindclip-font-scale";

/** Equal 12.5-point steps; the three original values keep their exact size. */
const PERCENTS: Record<FontScale, number> = {
  xs: 75,
  small: 87.5,
  medium: 100,
  large: 112.5,
  xl: 125,
};

export function resolveFontPercent(scale: FontScale): number {
  return PERCENTS[scale] ?? 100;
}

export function nextFontScale(scale: FontScale): FontScale {
  const index = FONT_SCALES.indexOf(scale);
  return FONT_SCALES[(index + 1) % FONT_SCALES.length] ?? "medium";
}

/** Set the root font size so every rem-based style scales with it. */
export function applyFontScale(element: HTMLElement, scale: FontScale): void {
  element.style.fontSize = `${resolveFontPercent(scale)}%`;
}

export function loadFontScale(stored: string | null): FontScale {
  return FONT_SCALES.find((scale) => scale === stored) ?? "medium";
}

export function saveFontScale(scale: FontScale): void {
  writeStored(STORAGE_KEY, scale);
}
