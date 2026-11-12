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
export function slugifyTitle(title: string | null): string {
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

/** `— <kind>[ · ★][ · #tag #tag][ · <page/location>] · <date>` (frozen Markdown format). */
function metadataLine(row: ClippingRow, locale: string, t: MarkdownOptions["t"]): string {
  const parts = [t(`kind.${row.kind}`)];
  if (row.favorite) {
    parts.push("★");
  }
  if (row.tags.length > 0) {
    parts.push(row.tags.map((tag) => `#${tag.name}`).join(" "));
  }
  const reference = formatReference(row.page, row.location);
  if (reference !== "") {
    parts.push(reference);
  }
  parts.push(formatAddedOn(row.added_on, row.added_on_raw, locale));
  return `— ${parts.join(" · ")}`;
}

/** One book section, shared by the single-file and per-book serializers (S5). */
function bookSection(group: ClippingRow[], opts: MarkdownOptions): string {
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
}

/** Markdown file with one section per book (S8), translated labels (S6). */
export function serializeMarkdown(rows: ClippingRow[], opts: MarkdownOptions): string {
  const sections = groupRowsByBook(rows).map((group) => bookSection(group.rows, opts));
  return sections.length === 0 ? "" : `${sections.join("\n\n")}\n`;
}

/** One book's boundary: title and author plus the clipping blocks (S5). */
export interface BookGroup {
  title: string;
  author: string | null;
  rows: ClippingRow[];
}

/** Split a filtered view into books, preserving first-seen order. */
export function groupRowsByBook(rows: ClippingRow[]): BookGroup[] {
  const groups = new Map<string, BookGroup>();
  for (const row of rows) {
    const key = `${row.title}\u0000${row.author ?? ""}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { title: row.title, author: row.author, rows: [row] });
    } else {
      group.rows.push(row);
    }
  }
  return [...groups.values()];
}

/** Windows device names are reserved with any extension (S4). */
const RESERVED_WINDOWS_STEMS = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;
const MAX_BOOK_FILE_STEM = 80;

function bookBaseStem(title: string): string {
  const slug = slugifyTitle(title).slice(0, MAX_BOOK_FILE_STEM).replace(/-+$/, "");
  return slug === "" ? "untitled" : slug;
}

function authorStem(author: string | null): string {
  const slug = slugifyTitle(author);
  return slug === "" ? "unknown-author" : slug;
}

/** Per-book file names for a filtered view (S4): stable, collision-free and
 * safe on Windows and macOS filesystems. */
export function planBookFileNames(
  books: Array<{ title: string; author: string | null }>,
): string[] {
  const bases = books.map((book) => bookBaseStem(book.title));
  const baseCounts = new Map<string, number>();
  for (const base of bases) {
    const key = base.toLowerCase();
    baseCounts.set(key, (baseCounts.get(key) ?? 0) + 1);
  }

  const used = new Set<string>();
  return books.map((book, index) => {
    let stem = bases[index];
    if ((baseCounts.get(stem.toLowerCase()) ?? 0) > 1) {
      stem += `--${authorStem(book.author)}`;
    }
    if (RESERVED_WINDOWS_STEMS.test(stem)) {
      stem += "-book";
    }
    let candidate = stem;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${stem}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    return `${candidate}.md`;
  });
}

export interface BookMarkdownOptions extends MarkdownOptions {
  now?: Date;
}

/** Double-quoted YAML scalar: backslashes and quotes escaped, line breaks
 * collapsed into spaces (S3). */
function yamlString(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replace(/\r\n|\r|\n/g, " ")}"`;
}

/** One Obsidian-ready file for a single book (S3, S5): YAML frontmatter with
 * the frozen key order followed by the same body as the single-file export. */
export function serializeBookMarkdown(rows: ClippingRow[], opts: BookMarkdownOptions): string {
  if (rows.length === 0) {
    return "";
  }
  const [first] = rows;
  const tags = [...new Set(rows.flatMap((row) => row.tags.map((tag) => tag.name)))].sort();
  const frontmatter = [
    "---",
    `title: ${yamlString(first.title)}`,
    `author: ${first.author === null ? "null" : yamlString(first.author)}`,
    `tags: [${tags.map(yamlString).join(", ")}]`,
    `clippings: ${rows.length}`,
    `exported_at: ${yamlString((opts.now ?? new Date()).toISOString())}`,
    "---",
  ].join("\n");
  return `${frontmatter}\n${bookSection(rows, opts)}\n`;
}

/** JSON payload with stable English keys (S6); `now` is injectable for tests. */
export function serializeJson(rows: ClippingRow[], opts: { now?: Date } = {}): string {
  const payload = {
    app: "kindclip",
    schema: 2,
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
      tags: row.tags.map((tag) => tag.name),
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

const CSV_HEADER =
  "book,author,kind,page,location,added_on,added_on_raw,content,content_edited,favorite,tags";

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
        row.tags.map((tag) => tag.name).join(";"),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}
