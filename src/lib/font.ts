/** Font-size accessibility control (V1.2): small/medium/large root scaling. */

export type FontScale = "small" | "medium" | "large";

export const FONT_SCALES: FontScale[] = ["small", "medium", "large"];

const STORAGE_KEY = "kindclip-font-scale";

const PERCENTS: Record<FontScale, number> = {
  small: 87.5,
  medium: 100,
  large: 112.5,
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
  if (stored === "small" || stored === "medium" || stored === "large") {
    return stored;
  }
  return "medium";
}

export function saveFontScale(scale: FontScale): void {
  try {
    localStorage.setItem(STORAGE_KEY, scale);
  } catch {
    // Non-fatal: the font size simply won't persist.
  }
}
