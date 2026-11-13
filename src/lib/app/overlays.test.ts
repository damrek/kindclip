import { describe, expect, it } from "vitest";
import { escapeLayer, Overlays, type EscapeState, type OverlayDom } from "./overlays.svelte";

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
    expect(overlays.dialogOpen).toBe(true);
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

  it("clears a selection and drops its focus ring", () => {
    const fake = fakeDom();
    const overlays = new Overlays(fake.dom);
    overlays.select(7);

    expect(overlays.anySelected).toBe(true);
    overlays.clearSelection();

    expect(overlays.selectedId).toBeNull();
    expect(fake.blurred).toHaveLength(1);
  });

  it("treats the filter popover as open without blocking the shell", () => {
    const overlays = new Overlays(fakeDom().dom);
    overlays.openFilters();

    expect(overlays.filters).toBe(true);
    expect(overlays.dialogOpen).toBe(false);
    overlays.closeFilters();
    expect(overlays.filters).toBe(false);
  });
});
