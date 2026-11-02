import { foldText } from "./library";

/** Words of a query, folded and deduplicated; empty for a blank query. */
export function searchTerms(query: string): string[] {
  const terms = query
    .split(/\s+/u)
    .map((term) => foldText(term))
    .filter((term) => term !== "");
  return [...new Set(terms)];
}

/** One rendered run of text; `match` marks the spans the query hit. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Fold one code point the same way `foldText` folds the whole string.
 * `foldText` lowercases whole strings, which additionally maps a final Σ to
 * ς; per-character folding cannot see that context, so a Greek query ending
 * in sigma may search but not highlight. */
function foldChar(char: string): string {
  return char
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/đ|ð/g, "d")
    .replace(/þ/g, "th")
    .replace(/ħ/g, "h")
    .replace(/ı/g, "i");
}

/** Folded text plus, per folded code unit, the index of the source character
 * that produced it, so matches can be mapped back to the original string. */
function foldWithOrigin(text: string): { folded: string; origin: number[] } {
  const origin: number[] = [];
  let folded = "";
  let index = 0;
  for (const char of text) {
    const piece = foldChar(char);
    for (let offset = 0; offset < piece.length; offset += 1) {
      origin.push(index);
    }
    folded += piece;
    index += char.length;
  }
  return { folded, origin };
}

/** UTF-16 width of the code point starting at `index`. */
function charWidthAt(text: string, index: number): number {
  return (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
}

/** Split `text` into unmatched runs and the spans matched by any query word,
 * using the same folding as the SQL search. Concatenating the segments always
 * yields `text` unchanged. */
export function highlightSegments(
  text: string | null | undefined,
  query: string,
): HighlightSegment[] {
  const value = text ?? "";
  const terms = searchTerms(query);
  if (value === "" || terms.length === 0) {
    return [{ text: value, match: false }];
  }

  const { folded, origin } = foldWithOrigin(value);
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at === -1) {
        break;
      }
      const last = at + term.length - 1;
      const start = origin[at];
      const end = origin[last] + charWidthAt(value, origin[last]);
      ranges.push([start, end]);
      from = at + 1;
    }
  }
  if (ranges.length === 0) {
    return [{ text: value, match: false }];
  }

  ranges.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: value.slice(cursor, start), match: false });
    }
    segments.push({ text: value.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor), match: false });
  }
  return segments;
}
