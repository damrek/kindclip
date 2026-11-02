import { describe, expect, it } from "vitest";
import { highlightSegments, searchTerms } from "./search";

describe("searchTerms", () => {
  it("splits on any whitespace and folds every word", () => {
    expect(searchTerms("  Stoic   CAFÉ\tNIÑO \n")).toEqual(["stoic", "cafe", "nino"]);
  });

  it("drops empty and duplicate terms", () => {
    expect(searchTerms("the the THE")).toEqual(["the"]);
  });

  it("keeps punctuation and wildcard characters as literal terms", () => {
    expect(searchTerms("100% a_b")).toEqual(["100%", "a_b"]);
  });

  it("returns an empty list for an empty or blank query", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms(" \t\n")).toEqual([]);
  });
});

describe("highlightSegments", () => {
  it("returns the whole text unmatched when the query is empty", () => {
    expect(highlightSegments("some text", "")).toEqual([{ text: "some text", match: false }]);
    expect(highlightSegments("some text", "   ")).toEqual([
      { text: "some text", match: false },
    ]);
  });

  it("marks one word case-insensitively", () => {
    expect(highlightSegments("A Stoic mind", "stoic")).toEqual([
      { text: "A ", match: false },
      { text: "Stoic", match: true },
      { text: " mind", match: false },
    ]);
  });

  it("marks every occurrence of a repeated term", () => {
    expect(highlightSegments("a a a", "a")).toEqual([
      { text: "a", match: true },
      { text: " ", match: false },
      { text: "a", match: true },
      { text: " ", match: false },
      { text: "a", match: true },
    ]);
  });

  it("marks each word of a multi-word query in any order", () => {
    expect(highlightSegments("Stoic Aurora", "aurora stoic")).toEqual([
      { text: "Stoic", match: true },
      { text: " ", match: false },
      { text: "Aurora", match: true },
    ]);
  });

  it("matches accents and case the same way the search does", () => {
    expect(highlightSegments("A Café morning", "cafe")).toEqual([
      { text: "A ", match: false },
      { text: "Café", match: true },
      { text: " morning", match: false },
    ]);
  });

  it("highlights the original letters when folding changes their length", () => {
    expect(highlightSegments("Straße", "strasse")).toEqual([
      { text: "Straße", match: true },
    ]);
  });

  it("merges overlapping and adjacent matches", () => {
    expect(highlightSegments("abcde", "abc cde")).toEqual([
      { text: "abcde", match: true },
    ]);
    expect(highlightSegments("abcde", "abc de")).toEqual([
      { text: "abcde", match: true },
    ]);
  });

  it("treats regex and LIKE special characters literally", () => {
    expect(highlightSegments("100% a_b.c", "100% a_b.c")).toEqual([
      { text: "100%", match: true },
      { text: " ", match: false },
      { text: "a_b.c", match: true },
    ]);
    expect(highlightSegments("123", ".")).toEqual([{ text: "123", match: false }]);
  });

  it("keeps the original text untouched around astral characters", () => {
    expect(highlightSegments("📚 Café", "cafe")).toEqual([
      { text: "📚 ", match: false },
      { text: "Café", match: true },
    ]);
  });

  it("never drops or rewrites text when nothing matches", () => {
    const text = "Nothing here";
    expect(highlightSegments(text, "absent")).toEqual([{ text, match: false }]);
  });
});
