import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyTheme,
  DARK_PALETTES,
  DEFAULT_DARK_PALETTE,
  isDarkPalette,
  isThemeMode,
  resolveTheme,
  type ThemeMode,
  type ThemePalette,
} from "./theme";

const ALL_PALETTES: ThemePalette[] = ["light", ...DARK_PALETTES];

const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");

/** Pull every `--token: value` pair out of the block for one palette id. */
function paletteTokens(id: ThemePalette): Record<string, string> {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = match;
    if (!selector?.includes(`[data-palette="${id}"]`)) continue;
    const tokens: Record<string, string> = {};
    for (const token of (body ?? "").matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) {
      tokens[token[1]!] = token[2]!.trim();
    }
    return tokens;
  }
  throw new Error(`No palette block found for "${id}" in app.css`);
}

const REQUIRED_TOKENS = [
  "surface",
  "surface-raised",
  "surface-hover",
  "inverse",
  "inverse-fg",
  "fg",
  "fg-muted",
  "fg-subtle",
  "line",
  "line-subtle",
  "line-strong",
  "accent",
  "accent-text",
  "accent-soft",
  "mark-bg",
  "selection",
  "focus-ring",
  "danger",
  "danger-soft",
  "danger-border",
];

function luminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/../g)!
    .map((pair) => Number.parseInt(pair, 16) / 255)
    .map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("resolveTheme", () => {
  it.each([
    ["system", true, "dark"],
    ["system", false, "light"],
    ["light", true, "light"],
    ["light", false, "light"],
    ["dark", true, "dark"],
    ["dark", false, "dark"],
  ])("mode %s with systemDark=%s resolves to %s", (mode, systemDark, expected) => {
    expect(resolveTheme(mode as ThemeMode, systemDark, "nord").mode).toBe(expected);
  });

  it("uses the chosen palette only when the result is dark", () => {
    expect(resolveTheme("dark", false, "darcula")).toEqual({
      mode: "dark",
      palette: "darcula",
    });
    expect(resolveTheme("system", true, "solarized-dark")).toEqual({
      mode: "dark",
      palette: "solarized-dark",
    });
    expect(resolveTheme("light", true, "nord")).toEqual({
      mode: "light",
      palette: "light",
    });
    expect(resolveTheme("system", false, "nord")).toEqual({
      mode: "light",
      palette: "light",
    });
  });

  it("falls back to system on unknown stored values", () => {
    expect(isThemeMode("sepia")).toBe(false);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode(null)).toBe(false);
  });
});

describe("isDarkPalette", () => {
  it("accepts only known palette ids", () => {
    for (const palette of DARK_PALETTES) {
      expect(isDarkPalette(palette)).toBe(true);
    }
    expect(isDarkPalette("light")).toBe(false);
    expect(isDarkPalette("dracula")).toBe(false);
    expect(isDarkPalette(undefined)).toBe(false);
  });

  it("defaults to Atom One Dark", () => {
    expect(DEFAULT_DARK_PALETTE).toBe("atom-one-dark");
    expect(DARK_PALETTES).toHaveLength(4);
  });
});

describe("applyTheme", () => {
  it("writes both attributes on the element", () => {
    const element = { dataset: {} } as unknown as HTMLElement;
    applyTheme(element, { mode: "dark", palette: "nord" });
    expect(element.dataset.mode).toBe("dark");
    expect(element.dataset.palette).toBe("nord");
    applyTheme(element, { mode: "light", palette: "light" });
    expect(element.dataset.mode).toBe("light");
    expect(element.dataset.palette).toBe("light");
  });
});

describe("app.css palettes", () => {
  it.each(ALL_PALETTES)("%s defines every semantic token", (palette) => {
    const tokens = paletteTokens(palette);
    for (const token of REQUIRED_TOKENS) {
      expect(tokens[token], `--${token} in ${palette}`).toBeTruthy();
    }
  });

  it.each(ALL_PALETTES)("%s meets WCAG AA for text on every surface", (palette) => {
    const tokens = paletteTokens(palette);
    const ratio = (fg: string, bg: string): number =>
      contrast(tokens[fg]!, tokens[bg]!);

    expect(ratio("fg", "surface"), "fg on surface").toBeGreaterThanOrEqual(4.5);
    expect(ratio("fg", "surface-raised"), "fg on raised").toBeGreaterThanOrEqual(4.5);
    expect(ratio("fg-muted", "surface"), "muted on surface").toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      ratio("accent-text", "surface"),
      "accent-text on surface",
    ).toBeGreaterThanOrEqual(4.5);
    expect(ratio("danger", "surface"), "danger on surface").toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ratio("accent", "surface"), "accent as UI color").toBeGreaterThanOrEqual(
      3,
    );
  });
});
