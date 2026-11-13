/** Human-facing formatting shared by the components.
 *
 * Export formats keep their own stable English vocabulary (see exporter.ts);
 * anything the user reads on screen goes through the translator. */
import type { I18nKey, TranslateParams } from "./i18n";

export type Translate = (key: I18nKey, params?: TranslateParams) => string;

/** "p. 12 · pos. 234-236" in the active locale; empty when there is neither. */
export function referenceText(
  t: Translate,
  page: number | null,
  location: string | null,
): string {
  const parts: string[] = [];
  if (page !== null) {
    parts.push(t("reference.page", { n: page }));
  }
  const place = location?.trim() ?? "";
  if (place !== "") {
    parts.push(t("reference.location", { value: place }));
  }
  return parts.join(" · ");
}

/** Human date for a card in the given locale; falls back to the raw Kindle
 * string when the parsed date is missing or invalid. */
export function formatAddedOn(
  addedOn: string | null,
  raw: string,
  locale?: string,
): string {
  if (addedOn === null) {
    return raw;
  }
  const date = new Date(addedOn);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  const day = date.toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}
