import { describe, expect, it } from "vitest";
import { escapeLayer, type EscapeState } from "./overlays";

const closed: EscapeState = {
  reading: false,
  palette: false,
  shortcuts: false,
  reset: false,
  exportOpen: false,
  library: false,
  stats: false,
  restore: false,
  preferences: false,
  filters: false,
  query: "",
  searchExpanded: false,
  selection: false,
};

describe("escapeLayer", () => {
  it("returns none when nothing is open", () => {
    expect(escapeLayer(closed)).toBe("none");
  });

  it("closes the innermost layer first", () => {
    expect(escapeLayer({ ...closed, palette: true, library: true })).toBe("palette");
    expect(escapeLayer({ ...closed, library: true, stats: true })).toBe("library");
    expect(escapeLayer({ ...closed, filters: true, query: "aurora" })).toBe("filters");
  });

  it("leaves Escape to the reading view", () => {
    expect(escapeLayer({ ...closed, reading: true, palette: true })).toBe("reading");
  });

  it("clears the query, then folds the field, then the selection", () => {
    expect(escapeLayer({ ...closed, query: "aurora", searchExpanded: true })).toBe("query");
    expect(escapeLayer({ ...closed, searchExpanded: true, selection: true })).toBe("search");
    expect(escapeLayer({ ...closed, selection: true })).toBe("selection");
  });
});
