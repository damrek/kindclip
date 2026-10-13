import { describe, expect, it } from "vitest";
import { applyThemeClass, nextTheme, resolveTheme, type ThemeChoice } from "./theme";

describe("resolveTheme", () => {
  it.each([
    ["system", true, "dark"],
    ["system", false, "light"],
    ["light", true, "light"],
    ["light", false, "light"],
    ["dark", true, "dark"],
    ["dark", false, "dark"],
  ])("choice %s with systemDark=%s resolves to %s", (choice, systemDark, expected) => {
    expect(resolveTheme(choice as ThemeChoice, systemDark)).toBe(expected);
  });

  it("falls back to system on unknown stored values", () => {
    expect(resolveTheme("sepia" as ThemeChoice, true)).toBe("dark");
    expect(resolveTheme("sepia" as ThemeChoice, false)).toBe("light");
  });
});

describe("nextTheme", () => {
  it("cycles system -> light -> dark -> system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});

describe("applyThemeClass", () => {
  it("toggles the dark class on the document element", () => {
    const classes = new Set<string>();
    const element = { classList: { toggle: (name: string, force: boolean) => {
      if (force) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
    } } } as unknown as HTMLElement;
    applyThemeClass(element, "dark");
    expect(classes.has("dark")).toBe(true);
    applyThemeClass(element, "light");
    expect(classes.has("dark")).toBe(false);
  });
});
