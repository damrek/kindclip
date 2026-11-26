import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "./releaseNotes";

describe("parseReleaseNotes", () => {
  it("groups headings, lists and paragraphs", () => {
    const blocks = parseReleaseNotes(
      "### Changed\n\n- First item.\n- Second item.\n\nA closing paragraph.",
    );

    expect(blocks).toEqual([
      { kind: "heading", text: "Changed" },
      {
        kind: "list",
        items: [[{ kind: "text", text: "First item." }], [{ kind: "text", text: "Second item." }]],
      },
      { kind: "paragraph", content: [{ kind: "text", text: "A closing paragraph." }] },
    ]);
  });

  it("parses inline emphasis, code and links", () => {
    const blocks = parseReleaseNotes(
      "### Fixed\n\n- **Landing page**: reads `Ctrl/Cmd+P` in [the guide](https://example.com/guide).\n\n**Full changelog**: https://example.com/compare",
    );

    expect(blocks[1]).toEqual({
      kind: "list",
      items: [
        [
          { kind: "strong", text: "Landing page" },
          { kind: "text", text: ": reads " },
          { kind: "code", text: "Ctrl/Cmd+P" },
          { kind: "text", text: " in " },
          { kind: "link", text: "the guide", href: "https://example.com/guide" },
          { kind: "text", text: "." },
        ],
      ],
    });
    expect(blocks[2]).toEqual({
      kind: "paragraph",
      content: [
        { kind: "strong", text: "Full changelog" },
        { kind: "text", text: ": " },
        { kind: "link", text: "https://example.com/compare", href: "https://example.com/compare" },
      ],
    });
  });

  it("joins hard-wrapped list items and paragraphs", () => {
    const blocks = parseReleaseNotes(
      "### Changed\n\n- A sentence that wraps\n  onto a second line.\n\nA paragraph that also\nwraps.",
    );

    expect(blocks[1]).toEqual({
      kind: "list",
      items: [[{ kind: "text", text: "A sentence that wraps onto a second line." }]],
    });
    expect(blocks[2]).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", text: "A paragraph that also wraps." }],
    });
  });

  it("leaves unsafe link targets as text", () => {
    const blocks = parseReleaseNotes("[click](javascript:alert)");

    expect(blocks).toEqual([
      { kind: "paragraph", content: [{ kind: "text", text: "[click](javascript:alert)" }] },
    ]);
  });

  it("normalizes CRLF and returns no blocks for empty input", () => {
    expect(parseReleaseNotes("### Added\r\n\r\n- One thing.")).toEqual([
      { kind: "heading", text: "Added" },
      { kind: "list", items: [[{ kind: "text", text: "One thing." }]] },
    ]);
    expect(parseReleaseNotes("  \n\n")).toEqual([]);
  });
});
