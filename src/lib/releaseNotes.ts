export type ReleaseNoteSegment =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

export type ReleaseNoteBlock =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: ReleaseNoteSegment[][] }
  | { kind: "paragraph"; content: ReleaseNoteSegment[] };

const INLINE =
  /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s<>()]+)/g;

function parseInline(text: string): ReleaseNoteSegment[] {
  const segments: ReleaseNoteSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ kind: "text", text: text.slice(last, index) });
    }
    if (match[1] !== undefined && match[2] !== undefined) {
      if (/^https?:\/\//i.test(match[2])) {
        segments.push({ kind: "link", text: match[1], href: match[2] });
      } else {
        segments.push({ kind: "text", text: match[0] });
      }
    } else if (match[3] !== undefined) {
      segments.push({ kind: "strong", text: match[3] });
    } else if (match[4] !== undefined) {
      segments.push({ kind: "code", text: match[4] });
    } else if (match[5] !== undefined) {
      segments.push({ kind: "link", text: match[5], href: match[5] });
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: "text", text: text.slice(last) });
  }
  return segments;
}

export function parseReleaseNotes(markdown: string): ReleaseNoteBlock[] {
  const blocks: ReleaseNoteBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length === 0) return;
    blocks.push({ kind: "list", items: list.map(parseInline) });
    list = [];
  };
  const flush = (): void => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flush();
      continue;
    }

    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", text: heading[1].trim() });
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet !== null) {
      flushParagraph();
      list.push(bullet[1].trim());
      continue;
    }

    if (line.startsWith("  ") && (list.length > 0 || paragraph.length > 0)) {
      if (list.length > 0) {
        list[list.length - 1] = `${list[list.length - 1]} ${line.trim()}`;
      } else {
        paragraph[paragraph.length - 1] = `${paragraph[paragraph.length - 1]} ${line.trim()}`;
      }
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}
