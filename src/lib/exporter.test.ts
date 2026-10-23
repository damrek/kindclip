import { describe, expect, it } from "vitest";
import { exportFileName, serializeCsv, serializeJson, serializeMarkdown } from "./exporter";
import { formatAddedOn } from "./library";
import type { ClippingRow } from "./types";

function row(overrides: Partial<ClippingRow> = {}): ClippingRow {
  return {
    id: 1,
    title: "Meditations",
    author: "Marcus Aurelius",
    kind: "highlight",
    page: null,
    location: null,
    added_on_raw: "Monday, January 6, 2020 10:15 AM",
    added_on: "2020-01-06T10:15:00",
    content: "Waste no more time arguing.",
    content_hash: "hash-1",
    content_edited: null,
    edited_at: null,
    favorite: false,
    tags: [],
    ...overrides,
  };
}

/** Stand-in for the app dictionary: exporter code must only ask `t` for keys. */
const labels: Record<string, string> = {
  "kind.highlight": "Highlight",
  "kind.note": "Note",
  "kind.bookmark": "Bookmark",
  "export.originalLabel": "Original",
};
const t = (key: string): string => labels[key] ?? key;
const markdownOpts = { includeOriginal: false, locale: "en-US", t };

describe("serializeMarkdown", () => {
  it("renders a book header with author and a blockquote for each content line", () => {
    const markdown = serializeMarkdown(
      [row({ content: "Line one\nLine two", page: 12, location: "234-236" })],
      markdownOpts,
    );
    const date = formatAddedOn("2020-01-06T10:15:00", row().added_on_raw, "en-US");
    expect(markdown).toContain("Jan");
    expect(markdown).toBe(
      `# Meditations\n_Marcus Aurelius_\n\n> Line one\n> Line two\n— Highlight · p. 12 · pos. 234-236 · ${date}\n`,
    );
  });

  it("omits the author line, reference and formatted date when missing", () => {
    const markdown = serializeMarkdown(
      [row({ author: null, added_on: null, added_on_raw: "raw date" })],
      markdownOpts,
    );
    expect(markdown).toBe(
      "# Meditations\n\n> Waste no more time arguing.\n— Highlight · raw date\n",
    );
  });

  it("renders bookmarks without a blockquote", () => {
    const markdown = serializeMarkdown(
      [row({ kind: "bookmark", content: null, added_on: null, added_on_raw: "raw date" })],
      markdownOpts,
    );
    expect(markdown).toBe("# Meditations\n_Marcus Aurelius_\n\n— Bookmark · raw date\n");
  });

  it("marks favorites with a star", () => {
    const markdown = serializeMarkdown(
      [row({ favorite: true, added_on: null, added_on_raw: "raw date" })],
      markdownOpts,
    );
    expect(markdown).toContain("— Highlight · ★ · raw date");
  });

  it("groups clippings under their book, keeping the query order", () => {
    const markdown = serializeMarkdown(
      [
        row({ title: "Book A", author: "Author A", content: "first", added_on: null, added_on_raw: "raw" }),
        row({ id: 2, title: "Book A", author: "Author A", kind: "note", content: "second", added_on: null, added_on_raw: "raw" }),
        row({ id: 3, title: "Book B", author: "Author B", content: "third", added_on: null, added_on_raw: "raw" }),
      ],
      markdownOpts,
    );
    expect(markdown).toBe(
      "# Book A\n_Author A_\n\n> first\n— Highlight · raw\n\n> second\n— Note · raw\n\n" +
        "# Book B\n_Author B_\n\n> third\n— Highlight · raw\n",
    );
  });

  it("exports the edited note text, appending the original only when requested", () => {
    const edited = row({
      kind: "note",
      content: "First draft",
      content_edited: "Final text",
      edited_at: "2026-01-01T00:00:00",
      added_on: null,
      added_on_raw: "raw",
    });
    expect(serializeMarkdown([edited], { ...markdownOpts, includeOriginal: false })).toBe(
      "# Meditations\n_Marcus Aurelius_\n\n> Final text\n— Note · raw\n",
    );
    expect(serializeMarkdown([edited], { ...markdownOpts, includeOriginal: true })).toBe(
      "# Meditations\n_Marcus Aurelius_\n\n> Final text\n— Note · raw\n\nOriginal: First draft\n",
    );
  });

  it("does not add an original paragraph for clippings that were never edited", () => {
    const markdown = serializeMarkdown([row({ added_on: null })], {
      ...markdownOpts,
      includeOriginal: true,
    });
    expect(markdown).not.toContain("Original:");
  });

  it("returns an empty file for no rows", () => {
    expect(serializeMarkdown([], markdownOpts)).toBe("");
  });
});

describe("serializeJson", () => {
  it("writes the frozen payload shape with indent 2, trailing newline and injected date", () => {
    const now = new Date("2026-10-16T12:30:00.000Z");
    const json = serializeJson(
      [row({ id: 3, favorite: true, page: 12, location: "234-236" })],
      { now },
    );
    expect(json).toBe(
      JSON.stringify(
        {
          app: "kindclip",
          schema: 1,
          exported_at: "2026-10-16T12:30:00.000Z",
          count: 1,
          clippings: [
            {
              book: "Meditations",
              author: "Marcus Aurelius",
              kind: "highlight",
              page: 12,
              location: "234-236",
              added_on: "2020-01-06T10:15:00",
              added_on_raw: "Monday, January 6, 2020 10:15 AM",
              content: "Waste no more time arguing.",
              content_edited: null,
              edited_at: null,
              favorite: true,
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    expect(json.endsWith("}\n")).toBe(true);
  });

  it("keeps the original content and the overlay side by side, nulls included", () => {
    const now = new Date("2026-10-16T12:30:00.000Z");
    const payload = JSON.parse(
      serializeJson(
        [
          row({
            kind: "note",
            content: "First draft",
            content_edited: "Final text",
            edited_at: "2026-01-01T00:00:00",
            author: null,
            page: null,
            location: null,
            added_on: null,
            favorite: false,
          }),
        ],
        { now },
      ),
    ) as { count: number; clippings: Array<Record<string, unknown>> };
    expect(payload.count).toBe(1);
    expect(payload.clippings[0]).toEqual({
      book: "Meditations",
      author: null,
      kind: "note",
      page: null,
      location: null,
      added_on: null,
      added_on_raw: "Monday, January 6, 2020 10:15 AM",
      content: "First draft",
      content_edited: "Final text",
      edited_at: "2026-01-01T00:00:00",
      favorite: false,
    });
  });

  it("stamps the current time when no date is injected", () => {
    const payload = JSON.parse(serializeJson([])) as { exported_at: string };
    expect(Number.isNaN(Date.parse(payload.exported_at))).toBe(false);
  });
});

describe("serializeCsv", () => {
  it("writes a UTF-8 BOM, the frozen header and CRLF line endings", () => {
    expect(serializeCsv([])).toBe(
      "\ufeffbook,author,kind,page,location,added_on,added_on_raw,content,content_edited,favorite\r\n",
    );
  });

  it("renders nulls as empty cells and favorites as true/false", () => {
    const csv = serializeCsv([
      row({ author: null, page: null, location: null, added_on: null, favorite: false }),
      row({ id: 2, favorite: true }),
    ]);
    expect(csv).toBe(
      "\ufeffbook,author,kind,page,location,added_on,added_on_raw,content,content_edited,favorite\r\n" +
        'Meditations,,highlight,,,,"Monday, January 6, 2020 10:15 AM",Waste no more time arguing.,,false\r\n' +
        'Meditations,Marcus Aurelius,highlight,,,2020-01-06T10:15:00,"Monday, January 6, 2020 10:15 AM",Waste no more time arguing.,,true\r\n',
    );
  });

  it("quotes commas, doubled quotes and newlines per RFC 4180", () => {
    const csv = serializeCsv([row({ content: 'He said "hello", then\nleft' })]);
    const record = csv.split("\r\n")[1];
    expect(record).toContain('"He said ""hello"", then\nleft"');
  });
});

describe("exportFileName", () => {
  const now = new Date(2026, 9, 16, 13, 45);

  it("builds the frozen name with the per-format extension", () => {
    expect(exportFileName("markdown", "Meditations", now)).toBe(
      "kindclip-export-meditations-2026-10-16.md",
    );
    expect(exportFileName("json", "Meditations", now)).toBe(
      "kindclip-export-meditations-2026-10-16.json",
    );
    expect(exportFileName("csv", "Meditations", now)).toBe(
      "kindclip-export-meditations-2026-10-16.csv",
    );
  });

  it("folds diacritics and collapses unsafe characters into single hyphens", () => {
    expect(exportFileName("markdown", "Cien años de soledad", now)).toBe(
      "kindclip-export-cien-anos-de-soledad-2026-10-16.md",
    );
    expect(exportFileName("csv", 'El Quijote: Parte 1/2 "Revisada"', now)).toBe(
      "kindclip-export-el-quijote-parte-1-2-revisada-2026-10-16.csv",
    );
  });

  it("drops the slug for null or slug-less titles", () => {
    expect(exportFileName("json", null, now)).toBe("kindclip-export-2026-10-16.json");
    expect(exportFileName("json", "", now)).toBe("kindclip-export-2026-10-16.json");
    expect(exportFileName("json", "¿?", now)).toBe("kindclip-export-2026-10-16.json");
  });
});
