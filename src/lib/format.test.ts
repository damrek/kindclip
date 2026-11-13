import { describe, expect, it } from "vitest";
import { formatAddedOn, referenceText } from "./format";
import { translate } from "./i18n";

describe("referenceText", () => {
  it("combines page and location with localized labels", () => {
    expect(referenceText(translate.bind(null, "en"), 12, "234-236")).toBe(
      "p. 12 · pos. 234-236",
    );
    expect(referenceText(translate.bind(null, "es"), 12, null)).toBe("pág. 12");
    expect(referenceText(translate.bind(null, "de"), null, "100")).toBe("Pos. 100");
    expect(referenceText(translate.bind(null, "fr"), null, null)).toBe("");
  });
});

describe("formatAddedOn", () => {
  it("falls back to raw when there is no normalized date", () => {
    expect(formatAddedOn(null, "raw")).toBe("raw");
    expect(formatAddedOn(null, "")).toBe("");
  });

  it("renders the normalized date with year", () => {
    expect(formatAddedOn("2020-01-06T10:15:00", "raw")).toContain("2020");
  });

  it("renders month names in the requested locale", () => {
    expect(formatAddedOn("2020-01-06T10:15:00", "raw", "en-US")).toContain("Jan");
  });

  it("falls back to raw on garbage", () => {
    expect(formatAddedOn("not-a-date", "raw")).toBe("raw");
  });
});
