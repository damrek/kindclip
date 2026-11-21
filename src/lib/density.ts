/** How much air the clipping list spends per card.
 *
 * The choice is one attribute on the document element (`data-density`); app.css
 * maps each level to the spacing variables the list and the cards read. */
import { writeStored } from "./storage";

export type Density = "compact" | "comfortable" | "spacious";

export const DENSITIES: Density[] = ["compact", "comfortable", "spacious"];

export const DEFAULT_DENSITY: Density = "comfortable";

/** Cache key the pre-paint script reads; the DB copy is the source of truth. */
export const DENSITY_STORAGE_KEY = "kindclip-density";

export function isDensity(value: unknown): value is Density {
  return typeof value === "string" && (DENSITIES as readonly string[]).includes(value);
}

export function loadDensity(stored: string | null): Density {
  return isDensity(stored) ? stored : DEFAULT_DENSITY;
}

export function saveDensity(level: Density): void {
  writeStored(DENSITY_STORAGE_KEY, level);
}

export function applyDensity(element: HTMLElement, level: Density): void {
  element.dataset.density = level;
}
