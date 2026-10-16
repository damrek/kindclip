import { formatAddedOn, formatReference } from "./library";
import type { I18nKey, TranslateParams } from "./i18n";
import type { ClippingRow } from "./types";

/** Formats offered by the export dialog (S1). */
export type ExportFormat = "markdown" | "json" | "csv";

const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  markdown: "md",
  json: "json",
  csv: "csv",
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Filesystem-safe slug: diacritics folded, anything that is not a letter or
 * a digit collapsed into single hyphens (S10 default file name). */
function slugifyTitle(title: string | null): string {
  if (title === null) {
    return "";
  }
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** `kindclip-export[-<slug>]-YYYY-MM-DD.<ext>` in the local timezone (S10). */
export function exportFileName(
  format: ExportFormat,
  bookTitle: string | null,
  now: Date = new Date(),
): string {
  const slug = slugifyTitle(bookTitle);
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const scope = slug === "" ? "kindclip-export" : `kindclip-export-${slug}`;
  return `${scope}-${date}.${EXPORT_EXTENSIONS[format]}`;
}

export interface MarkdownOptions {
  includeOriginal: boolean;
  locale: string;
  t: (key: I18nKey, params?: TranslateParams) => string;
}

function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/** `— <kind>[ · ★][ · <page/location>] · <date>` (frozen Markdown format). */
function metadataLine(row: ClippingRow, locale: string, t: MarkdownOptions["t"]): string {
  const parts = [t(`kind.${row.kind}`)];
  if (row.favorite) {
    parts.push("★");
  }
  const reference = formatReference(row.page, row.location);
  if (reference !== "") {
    parts.push(reference);
  }
  parts.push(formatAddedOn(row.added_on, row.added_on_raw, locale));
  return `— ${parts.join(" · ")}`;
}

/** Markdown file with one section per book (S8), translated labels (S6). */
export function serializeMarkdown(rows: ClippingRow[], opts: MarkdownOptions): string {
  const books = new Map<string, ClippingRow[]>();
  for (const row of rows) {
    const key = `${row.title}\u0000${row.author ?? ""}`;
    const group = books.get(key);
    if (group === undefined) {
      books.set(key, [row]);
    } else {
      group.push(row);
    }
  }

  const sections = [...books.values()].map((group) => {
    const [first] = group;
    const header =
      first.author === null ? `# ${first.title}` : `# ${first.title}\n_${first.author}_`;
    const blocks = [header];
    for (const row of group) {
      const text = row.content_edited ?? row.content;
      const meta = metadataLine(row, opts.locale, opts.t);
      blocks.push(text === null || text === "" ? meta : `${quoteBlock(text)}\n${meta}`);
      if (opts.includeOriginal && row.content_edited !== null && row.content !== null) {
        blocks.push(`${opts.t("export.originalLabel")}: ${row.content}`);
      }
    }
    return blocks.join("\n\n");
  });

  return sections.length === 0 ? "" : `${sections.join("\n\n")}\n`;
}

/** JSON payload with stable English keys (S6); `now` is injectable for tests. */
export function serializeJson(rows: ClippingRow[], opts: { now?: Date } = {}): string {
  const payload = {
    app: "kindclip",
    schema: 1,
    exported_at: (opts.now ?? new Date()).toISOString(),
    count: rows.length,
    clippings: rows.map((row) => ({
      book: row.title,
      author: row.author,
      kind: row.kind,
      page: row.page,
      location: row.location,
      added_on: row.added_on,
      added_on_raw: row.added_on_raw,
      content: row.content,
      content_edited: row.content_edited,
      edited_at: row.edited_at,
      favorite: row.favorite,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

const CSV_HEADER =
  "book,author,kind,page,location,added_on,added_on_raw,content,content_edited,favorite";

/** RFC 4180 cell: quoted when it holds a comma, a quote, CR or LF. */
function csvCell(value: string | number | null): string {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Comma-separated file with UTF-8 BOM and CRLF rows (S5). */
export function serializeCsv(rows: ClippingRow[]): string {
  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        row.title,
        row.author,
        row.kind,
        row.page,
        row.location,
        row.added_on,
        row.added_on_raw,
        row.content,
        row.content_edited,
        row.favorite ? "true" : "false",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}
