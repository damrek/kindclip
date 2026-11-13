import { describe, expect, it } from "vitest";
import {
  dispatchEscape,
  dispatchShortcut,
  type EscapeHandlers,
  type ShortcutHandlers,
} from "./keyboard";
import type { ShortcutAction } from "../shortcuts";

function shortcutSpy() {
  const calls: string[] = [];
  const handlers: ShortcutHandlers = {
    openSearch: () => calls.push("search"),
    openPalette: () => calls.push("palette"),
    openShortcuts: () => calls.push("shortcuts"),
    toggleSidebar: () => calls.push("sidebar"),
    openFilters: () => calls.push("filters"),
    openPreferences: () => calls.push("preferences"),
    nextClipping: () => calls.push("next"),
    prevClipping: () => calls.push("prev"),
    openClipping: () => calls.push("open"),
    toggleFavorite: () => calls.push("favorite"),
    copyClipping: () => calls.push("copy"),
    copyQuote: () => calls.push("quote"),
    nextPage: () => calls.push("next-page"),
    prevPage: () => calls.push("prev-page"),
  };
  return { calls, handlers };
}

describe("dispatchShortcut", () => {
  it("routes every action to its handler exactly once", () => {
    const table: Array<[ShortcutAction, string]> = [
      ["focus-search", "search"],
      ["open-palette", "palette"],
      ["open-help", "shortcuts"],
      ["toggle-sidebar", "sidebar"],
      ["open-filters", "filters"],
      ["open-preferences", "preferences"],
      ["next-clipping", "next"],
      ["prev-clipping", "prev"],
      ["open-clipping", "open"],
      ["toggle-favorite", "favorite"],
      ["copy-clipping", "copy"],
      ["copy-quote", "quote"],
      ["next-page", "next-page"],
      ["prev-page", "prev-page"],
    ];
    for (const [action, expected] of table) {
      const { calls, handlers } = shortcutSpy();
      dispatchShortcut(action, handlers);
      expect(calls, action).toEqual([expected]);
    }
  });
});

function escapeSpy(overrides: Partial<EscapeHandlers> = {}) {
  const calls: string[] = [];
  const handlers: EscapeHandlers = {
    busy: () => ({ export: false, library: false, restore: false }),
    closePalette: () => calls.push("palette"),
    closeShortcuts: () => calls.push("shortcuts"),
    closeReset: () => calls.push("reset"),
    closeExport: () => calls.push("export"),
    closeLibrary: () => calls.push("library"),
    closeStats: () => calls.push("stats"),
    closeRestore: () => calls.push("restore"),
    closePreferences: () => calls.push("preferences"),
    closeFilters: () => calls.push("filters"),
    clearQuery: () => calls.push("query"),
    foldSearch: () => calls.push("search"),
    clearSelection: () => calls.push("selection"),
    ...overrides,
  };
  return { calls, handlers };
}

describe("dispatchEscape", () => {
  it("closes exactly one layer", () => {
    for (const layer of [
      "palette",
      "shortcuts",
      "reset",
      "export",
      "library",
      "stats",
      "restore",
      "preferences",
      "filters",
      "query",
      "search",
      "selection",
    ] as const) {
      const { calls, handlers } = escapeSpy();
      dispatchEscape(layer, handlers);
      expect(calls, layer).toEqual([layer]);
    }
  });

  it("does nothing for the reading view or a closed shell", () => {
    const { calls, handlers } = escapeSpy();
    dispatchEscape("reading", handlers);
    dispatchEscape("none", handlers);
    expect(calls).toEqual([]);
  });

  it("refuses to close a dialog whose write is in flight", () => {
    const { calls, handlers } = escapeSpy({
      busy: () => ({ export: true, library: true, restore: true }),
    });

    dispatchEscape("export", handlers);
    dispatchEscape("library", handlers);
    dispatchEscape("restore", handlers);

    expect(calls).toEqual([]);
  });
});
