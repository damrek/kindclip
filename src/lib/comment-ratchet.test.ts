import { describe, expect, it } from "vitest";
import {
  compareCount,
  countComments,
  extractComments,
  initBaseline,
  lowerBaseline,
  normalizeComment,
} from "../../scripts/comments.mjs";

function texts(source: string, extension: string): string[] {
  return extractComments(source, extension).map((comment) => comment.text);
}

describe("extractComments", () => {
  it("reads line, block and trailing comments without touching strings", () => {
    const source = [
      'const url = "https://example.com/a//b";',
      "const other = `// not a comment`;",
      "// explanation",
      "const value = 1; /* trailing */",
      "/** Block",
      " * record",
      " */",
    ].join("\n");
    expect(texts(source, ".ts")).toEqual(["explanation", "trailing", "Block record"]);
  });

  it("marks tool directives as directives", () => {
    const comments = extractComments(
      "// @vitest-environment jsdom\n<!-- svelte-ignore a11y_x -->\n",
      ".svelte",
    );
    expect(comments.map((comment) => comment.directive)).toEqual([true, true]);
  });

  it("reads Rust doc comments across lifetimes and raw strings", () => {
    const source = [
      "fn parse<'a>(input: &'a str) -> &'a str {",
      '    let raw = r#"// not a comment"#;',
      "    /// Doc line",
      "    input",
      "}",
    ].join("\n");
    expect(texts(source, ".rs")).toEqual(["Doc line"]);
  });

  it("ignores heredoc bodies in shell scripts", () => {
    const source = ["cat >file <<'EOF'", "# not a comment", "EOF", "# real comment"].join("\n");
    expect(texts(source, ".sh")).toEqual(["real comment"]);
  });

  it("counts Svelte markup and style comments as well as script comments", () => {
    const source = [
      "<script>",
      "// script comment",
      "</script>",
      "<!-- markup comment -->",
      "<style>",
      "/* style comment */",
      "</style>",
    ].join("\n");
    expect(texts(source, ".svelte")).toEqual([
      "script comment",
      "style comment",
      "markup comment",
    ]);
  });
});

describe("normalizeComment", () => {
  it("collapses star padding and whitespace", () => {
    expect(normalizeComment("* first\n *   second  ")).toBe("first second");
    expect(normalizeComment("/ rust doc")).toBe("rust doc");
  });
});

describe("compareCount", () => {
  const comments = extractComments("// one\n// two\n// three\n", ".ts");

  it("passes at exactly the cap", () => {
    expect(compareCount(comments, 3)).toEqual({ count: 3, cap: 3, excess: 0, lower: 0 });
  });

  it("reports a comment beyond the cap", () => {
    expect(compareCount(comments, 1)).toEqual({ count: 3, cap: 1, excess: 2, lower: 0 });
  });

  it("reports a baseline that can be lowered", () => {
    expect(compareCount(comments, 5)).toEqual({ count: 3, cap: 5, excess: 0, lower: 2 });
  });

  it("ignores directives", () => {
    const directive = extractComments("// eslint-disable-next-line\n", ".ts");
    expect(countComments(directive)).toBe(0);
    expect(compareCount(directive, 0).excess).toBe(0);
  });
});

describe("baseline updates", () => {
  const comments = extractComments("// one\n// two\n", ".ts");

  it("lowers but never raises", () => {
    expect(lowerBaseline(5, comments)).toBe(2);
    expect(lowerBaseline(1, comments)).toBe(1);
  });

  it("init records the current count", () => {
    expect(initBaseline(comments)).toBe(2);
  });
});
