import { describe, expect, it } from "vitest";
import {
  commandKeyLabel,
  isInteractiveTarget,
  isMacPlatform,
  isPaletteCombo,
  isTypingTarget,
  resolveShortcut,
  stepSelection,
  type KeyEventLike,
  type ShortcutContext,
} from "./shortcuts";

function key(pressed: string, overrides: Partial<KeyEventLike> = {}): KeyEventLike {
  return {
    key: pressed,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    ...overrides,
  };
}

const context: ShortcutContext = {
  typing: false,
  interactive: false,
  overlay: false,
  hasLibrary: true,
  hasResults: true,
  hasSelection: true,
  canPrevPage: true,
  canNextPage: true,
};

function resolve(pressed: string, overrides: Partial<KeyEventLike> = {}, ctx: Partial<ShortcutContext> = {}) {
  return resolveShortcut(key(pressed, overrides), { ...context, ...ctx });
}

describe("isTypingTarget", () => {
  it("treats text fields, selects and contenteditable as typing", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "input" })).toBe(true);
  });

  it("does not treat buttons, cards or nothing as typing", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "ARTICLE" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
  });
});

describe("isInteractiveTarget", () => {
  it("recognises controls that own Enter and Space", () => {
    expect(isInteractiveTarget({ tagName: "BUTTON" })).toBe(true);
    expect(isInteractiveTarget({ tagName: "A" })).toBe(true);
    expect(isInteractiveTarget({ tagName: "SUMMARY" })).toBe(true);
    expect(
      isInteractiveTarget({
        tagName: "DIV",
        getAttribute: (name) => (name === "role" ? "button" : null),
      }),
    ).toBe(true);
  });

  it("leaves cards and plain containers alone", () => {
    expect(isInteractiveTarget({ tagName: "ARTICLE" })).toBe(false);
    expect(isInteractiveTarget({ tagName: "DIV" })).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});

describe("resolveShortcut — search", () => {
  it("focuses search from / and the command combos", () => {
    expect(resolve("/")).toBe("focus-search");
    expect(resolve("k", { ctrlKey: true })).toBe("focus-search");
    expect(resolve("k", { metaKey: true })).toBe("focus-search");
    expect(resolve("f", { ctrlKey: true })).toBe("focus-search");
    expect(resolve("f", { metaKey: true })).toBe("focus-search");
  });

  it("keeps the bare f key for the filters menu", () => {
    expect(resolve("f")).toBe("open-filters");
  });

  it("still focuses search from a text field with the command combo", () => {
    expect(resolve("k", { ctrlKey: true }, { typing: true })).toBe("focus-search");
  });

  it("opens the global palette with the command combo", () => {
    expect(resolve("p", { ctrlKey: true })).toBe("open-palette");
    expect(resolve("p", { metaKey: true })).toBe("open-palette");
    expect(resolve("P", { ctrlKey: true, shiftKey: true })).toBe("open-palette");
    expect(resolve("p", { ctrlKey: true }, { typing: true })).toBe("open-palette");
    // Bare p stays the previous-page key.
    expect(resolve("p")).toBe("prev-page");
  });

  it("does nothing while typing a bare /", () => {
    expect(resolve("/", {}, { typing: true })).toBeNull();
  });
});

describe("resolveShortcut — help and shell", () => {
  it("opens the shortcut list with ?", () => {
    expect(resolve("?")).toBe("open-help");
    expect(resolve("?", { shiftKey: true })).toBe("open-help");
  });

  it("opens the filters only when a library exists", () => {
    expect(resolve("f")).toBe("open-filters");
    expect(resolve("f", {}, { hasLibrary: false })).toBeNull();
  });

  it("toggles the sidebar only when a library exists", () => {
    expect(resolve("s")).toBe("toggle-sidebar");
    expect(resolve("S")).toBe("toggle-sidebar");
    expect(resolve("s", {}, { hasLibrary: false })).toBeNull();
  });

  it("opens preferences with the command combo", () => {
    expect(resolve(",", { ctrlKey: true })).toBe("open-preferences");
    expect(resolve(",", { metaKey: true })).toBe("open-preferences");
  });
});

describe("resolveShortcut — list navigation", () => {
  it("moves the selection with j/k and the arrow keys", () => {
    expect(resolve("j")).toBe("next-clipping");
    expect(resolve("J")).toBe("next-clipping");
    expect(resolve("ArrowDown")).toBe("next-clipping");
    expect(resolve("k")).toBe("prev-clipping");
    expect(resolve("ArrowUp")).toBe("prev-clipping");
  });

  it("needs visible rows to navigate", () => {
    expect(resolve("j", {}, { hasResults: false })).toBeNull();
    expect(resolve("k", {}, { hasResults: false })).toBeNull();
  });

  it("opens the selected clipping with Enter or o", () => {
    expect(resolve("Enter")).toBe("open-clipping");
    expect(resolve("o")).toBe("open-clipping");
    expect(resolve("Enter", {}, { hasSelection: false })).toBeNull();
  });

  it("never hijacks Enter on a native control", () => {
    expect(resolve("Enter", {}, { interactive: true })).toBeNull();
    expect(resolve("o", {}, { interactive: true })).toBe("open-clipping");
  });

  it("changes page with n/p and PageDown/PageUp", () => {
    expect(resolve("n")).toBe("next-page");
    expect(resolve("PageDown")).toBe("next-page");
    expect(resolve("p")).toBe("prev-page");
    expect(resolve("PageUp")).toBe("prev-page");
    expect(resolve("n", {}, { canNextPage: false })).toBeNull();
    expect(resolve("p", {}, { canPrevPage: false })).toBeNull();
  });
});

describe("resolveShortcut — actions", () => {
  it("toggles favorite and copies the selection", () => {
    expect(resolve("*")).toBe("toggle-favorite");
    expect(resolve("c")).toBe("copy-clipping");
    expect(resolve("*", {}, { hasSelection: false })).toBeNull();
    expect(resolve("c", {}, { hasSelection: false })).toBeNull();
  });
});

describe("resolveShortcut — guard rails", () => {
  it("ignores every shortcut while a modal or the reading view is open", () => {
    for (const pressed of ["/", "?", "j", "k", "n", "s", "f", "Enter", "c", "*"]) {
      expect(resolve(pressed, {}, { overlay: true })).toBeNull();
    }
    expect(resolve("k", { ctrlKey: true }, { overlay: true })).toBeNull();
    expect(resolve("p", { ctrlKey: true }, { overlay: true })).toBeNull();
  });

  it("ignores typing for single keys", () => {
    for (const pressed of ["?", "j", "k", "n", "p", "s", "f", "c", "*", "Enter"]) {
      expect(resolve(pressed, {}, { typing: true })).toBeNull();
    }
  });

  it("ignores Alt combinations and handled events", () => {
    expect(resolve("j", { altKey: true })).toBeNull();
    expect(resolve("k", { ctrlKey: true, altKey: true })).toBeNull();
    expect(resolve("j", { defaultPrevented: true })).toBeNull();
  });

  it("leaves unmapped keys and Escape to their owners", () => {
    expect(resolve("x")).toBeNull();
    expect(resolve("Escape")).toBeNull();
    expect(resolve("ArrowLeft")).toBeNull();
    expect(resolve("k", { ctrlKey: true, shiftKey: true })).toBe("focus-search");
  });
});

describe("isPaletteCombo", () => {
  it("matches the command combo on every platform spelling", () => {
    expect(isPaletteCombo(key("p", { ctrlKey: true }))).toBe(true);
    expect(isPaletteCombo(key("p", { metaKey: true }))).toBe(true);
    expect(isPaletteCombo(key("P", { ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("leaves bare p and other combos alone", () => {
    expect(isPaletteCombo(key("p"))).toBe(false);
    expect(isPaletteCombo(key("k", { ctrlKey: true }))).toBe(false);
    expect(isPaletteCombo(key("p", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteCombo(key("ArrowLeft", { ctrlKey: true }))).toBe(false);
  });
});

describe("stepSelection", () => {
  const rows = [{ id: 10 }, { id: 20 }, { id: 30 }];

  it("starts at the first row going forward and the last going back", () => {
    expect(stepSelection(rows, null, "next")).toBe(10);
    expect(stepSelection(rows, null, "prev")).toBe(30);
  });

  it("walks the visible rows", () => {
    expect(stepSelection(rows, 10, "next")).toBe(20);
    expect(stepSelection(rows, 20, "next")).toBe(30);
    expect(stepSelection(rows, 30, "prev")).toBe(20);
    expect(stepSelection(rows, 20, "prev")).toBe(10);
  });

  it("stays on the boundary row", () => {
    expect(stepSelection(rows, 30, "next")).toBe(30);
    expect(stepSelection(rows, 10, "prev")).toBe(10);
  });

  it("recovers from a row that is no longer visible", () => {
    expect(stepSelection(rows, 99, "next")).toBe(10);
    expect(stepSelection(rows, 99, "prev")).toBe(30);
  });

  it("returns null for an empty list", () => {
    expect(stepSelection([], null, "next")).toBeNull();
    expect(stepSelection([], 10, "prev")).toBeNull();
  });
});

describe("platform labels", () => {
  it("detects macOS from the user agent", () => {
    expect(isMacPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe(true);
    expect(isMacPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isMacPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
    expect(isMacPlatform("")).toBe(false);
  });

  it("labels the command key for the platform", () => {
    expect(commandKeyLabel(true)).toBe("⌘");
    expect(commandKeyLabel(false)).toBe("Ctrl");
  });
});
