import { describe, expect, it } from "vitest";
import { escapeLayer, Overlays, type EscapeState, type OverlayDom } from "./overlays.svelte";

const closed: EscapeState = {
  reading: false,
  palette: false,
  shortcuts: false,
  updates: false,
  reset: false,
  exportOpen: false,
  reminder: false,
  reminderList: false,
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
    expect(escapeLayer({ ...closed, reminder: true, library: true })).toBe("reminder");
    expect(escapeLayer({ ...closed, reminder: true, reminderList: true })).toBe("reminder");
    expect(escapeLayer({ ...closed, reminderList: true, library: true })).toBe(
      "reminderList",
    );
    expect(escapeLayer({ ...closed, filters: true, query: "aurora" })).toBe("filters");
  });

  it("leaves Escape to the reading view", () => {
    expect(escapeLayer({ ...closed, reading: true, palette: true })).toBe("reading");
  });

  it("closes the update dialog before the layers behind it", () => {
    expect(escapeLayer({ ...closed, updates: true })).toBe("updates");
    expect(escapeLayer({ ...closed, updates: true, selection: true })).toBe("updates");
    expect(escapeLayer({ ...closed, updates: true, preferences: true })).toBe("updates");
    // A dialog opened on top with the keyboard still closes first.
    expect(escapeLayer({ ...closed, updates: true, palette: true })).toBe("palette");
    expect(escapeLayer({ ...closed, updates: true, shortcuts: true })).toBe("shortcuts");
  });

  it("clears the query, then folds the field, then the selection", () => {
    expect(escapeLayer({ ...closed, query: "aurora", searchExpanded: true })).toBe("query");
    expect(escapeLayer({ ...closed, searchExpanded: true, selection: true })).toBe("search");
    expect(escapeLayer({ ...closed, selection: true })).toBe("selection");
  });
});

function fakeDom() {
  const focused: Array<HTMLElement | null> = [];
  const blurred: number[] = [];
  let active: HTMLElement | null = null;
  let renders = 0;
  const element = { isConnected: true, focus: () => {} } as unknown as HTMLElement;
  const dom: OverlayDom = {
    activeElement: () => active,
    focus: (target) => {
      focused.push(target);
    },
    blurActive: () => {
      blurred.push(1);
    },
    afterRender: async () => {
      renders += 1;
    },
  };
  return {
    dom,
    element,
    focused,
    blurred,
    renders: () => renders,
    setActive: (next: HTMLElement | null) => {
      active = next;
    },
  };
}

describe("Overlays", () => {
  it("opens one dialog at a time and remembers the opener", () => {
    const fake = fakeDom();
    const overlays = new Overlays(fake.dom);
    fake.setActive(fake.element);

    overlays.openPalette(false);
    overlays.openPalette(false);
    overlays.openShortcuts();

    expect(overlays.palette).toBe(true);
    expect(overlays.shortcuts).toBe(true);
    expect(fake.renders()).toBe(0);
  });

  it("refuses the palette while another dialog blocks it", () => {
    const overlays = new Overlays(fakeDom().dom);
    overlays.openPalette(true);
    expect(overlays.palette).toBe(false);
  });

  it("restores focus to the opener after the render", async () => {
    const fake = fakeDom();
    const overlays = new Overlays(fake.dom);
    fake.setActive(fake.element);
    overlays.openPalette(false);

    overlays.closePalette(null);
    await Promise.resolve();

    expect(overlays.palette).toBe(false);
    expect(fake.focused).toEqual([fake.element]);
  });

  it("falls back to the list when the opener unmounted", async () => {
    const fake = fakeDom();
    const overlays = new Overlays(fake.dom);
    const stale = { isConnected: false } as HTMLElement;
    fake.setActive(stale);
    const fallback = { isConnected: true, focus: () => {} } as unknown as HTMLElement;
    overlays.openPreferences();

    overlays.closePreferences(fallback);
    await Promise.resolve();

    expect(fake.focused).toEqual([fallback]);
  });

  it("keeps the opener when another dialog takes over", async () => {
    const fake = fakeDom();
    const overlays = new Overlays(fake.dom);
    fake.setActive(fake.element);
    overlays.openPreferences();

    overlays.closePreferences(null, false);
    await Promise.resolve();

    expect(fake.focused).toEqual([]);
    // The next dialog still returns focus to the original opener.
    overlays.openShortcuts();
    overlays.closeShortcuts(null);
    await Promise.resolve();
    expect(fake.focused).toEqual([fake.element]);
  });

  it("returns to the preferences dialog when the list came from there", async () => {
    const fake = fakeDom();
    const overlays = new Overlays(fake.dom);
    fake.setActive(fake.element);
    overlays.openPreferences();
    overlays.closePreferences(null, false);

    overlays.openShortcuts("preferences");
    expect(overlays.shortcutsFromPreferences).toBe(true);

    overlays.closeShortcuts(null);
    await Promise.resolve();

    expect(overlays.shortcuts).toBe(false);
    expect(overlays.preferences).toBe(true);
    // The stack still owns the opener; the shell gets it back at the end.
    expect(fake.focused).toEqual([]);

    overlays.closePreferences(null);
    await Promise.resolve();
    expect(fake.focused).toEqual([fake.element]);
  });

  it("does not claim a return path when the list opens on its own", () => {
    const overlays = new Overlays(fakeDom().dom);
    overlays.openShortcuts();

    expect(overlays.shortcutsFromPreferences).toBe(false);
  });

  it("clears a selection and drops its focus ring", () => {
    const fake = fakeDom();
    const overlays = new Overlays(fake.dom);
    overlays.select(7);

    overlays.clearSelection();

    expect(overlays.selectedId).toBeNull();
    expect(fake.blurred).toHaveLength(1);
  });

  it("opens and closes the filter popover", () => {
    const overlays = new Overlays(fakeDom().dom);
    overlays.openFilters();

    expect(overlays.filters).toBe(true);
    overlays.closeFilters();
    expect(overlays.filters).toBe(false);
  });
});
