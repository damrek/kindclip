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
  "surface-active",
  "surface-inset",
  "inverse",
  "inverse-fg",
  "fg",
  "fg-muted",
  "fg-subtle",
  "fg-faint",
  "line",
  "line-subtle",
  "line-strong",
  "accent",
  "accent-hover",
  "accent-text",
  "accent-soft",
  "accent-soft-strong",
  "mark-bg",
  "selection",
  "focus-ring",
  "danger",
  "danger-solid",
  "danger-solid-hover",
  "danger-soft",
  "danger-border",
  "success",
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

/** Every foreground/background pair that the components actually render.
 *  A pair is only listed here if a component puts that text on that surface
 *  (chips on `surface-hover`, dialogs on `surface-raised`, tag chips on the
 *  accent tint, and so on). */
const TEXT_PAIRS: Array<[fg: string, bg: string, min: number]> = [
  ["fg", "surface", 4.5],
  ["fg", "surface-raised", 4.5],
  ["fg", "surface-hover", 4.5],
  ["fg-muted", "surface", 4.5],
  ["fg-muted", "surface-raised", 4.5],
  ["fg-muted", "surface-hover", 4.5],
  ["fg-muted", "surface-inset", 4.5],
  ["accent-text", "surface", 4.5],
  ["accent-text", "surface-raised", 4.5],
  ["accent-text", "accent-soft", 4.5],
  ["accent-text", "accent-soft-strong", 4.5],
  ["danger", "surface", 4.5],
  ["danger", "surface-raised", 4.5],
  ["danger", "danger-soft", 4.5],
  ["success", "surface", 4.5],
  ["success", "surface-raised", 4.5],
];

/** `accent` and friends double as UI colors (borders, rings, stars): 3:1. */
const UI_PAIRS: Array<[color: string, bg: string]> = [
  ["accent", "surface"],
  ["accent", "surface-raised"],
  ["accent", "accent-soft"],
];

/** Solid buttons put `inverse-fg` on a saturated background. New palettes must
 *  keep that readable; light is pinned to the v1.14 parity values instead. */
const SOLID_BUTTONS: Array<[bg: string]> = [
  ["inverse"],
  ["accent"],
  ["accent-hover"],
  ["danger-solid"],
  ["danger-solid-hover"],
];

describe("app.css palettes", () => {
  it.each(ALL_PALETTES)("%s defines every semantic token", (palette) => {
    const tokens = paletteTokens(palette);
    for (const token of REQUIRED_TOKENS) {
      expect(tokens[token], `--${token} in ${palette}`).toBeTruthy();
    }
  });

  it.each(ALL_PALETTES)("%s meets WCAG AA on every real text pairing", (palette) => {
    const tokens = paletteTokens(palette);
    for (const [fg, bg, min] of TEXT_PAIRS) {
      const ratio = contrast(tokens[fg]!, tokens[bg]!);
      expect(ratio, `${fg} on ${bg} in ${palette}`).toBeGreaterThanOrEqual(min);
    }
  });

  it.each(ALL_PALETTES)("%s keeps accents visible as UI colors", (palette) => {
    const tokens = paletteTokens(palette);
    for (const [color, bg] of UI_PAIRS) {
      const ratio = contrast(tokens[color]!, tokens[bg]!);
      expect(ratio, `${color} as UI on ${bg} in ${palette}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it.each(DARK_PALETTES)("%s keeps solid button labels readable", (palette) => {
    const tokens = paletteTokens(palette);
    for (const [bg] of SOLID_BUTTONS) {
      const ratio = contrast(tokens["inverse-fg"]!, tokens[bg]!);
      expect(ratio, `inverse-fg on ${bg} in ${palette}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(DARK_PALETTES)("%s keeps muted text visibly dimmer than body text", (palette) => {
    const tokens = paletteTokens(palette);
    const gap = luminance(tokens["fg"]!) - luminance(tokens["fg-muted"]!);
    // Without headroom the two levels collapse into one and the hierarchy
    // disappears; this is what forces the dark hover steps to stay subtle.
    expect(gap, "luminance gap fg - fg-muted").toBeGreaterThan(0.04);
  });

  it("keeps the light palette at the v1.14 rendering", () => {
    const tokens = paletteTokens("light");
    // Parity contract: these are the values the pre-theming app rendered.
    expect(tokens["surface"]).toBe("#ffffff");
    expect(tokens["surface-raised"]).toBe("#ffffff");
    expect(tokens["surface-hover"]).toBe("#f5f5f5");
    expect(tokens["fg"]).toBe("#171717");
    expect(tokens["fg-muted"]).toBe("#5f5f5f");
    expect(tokens["fg-subtle"]).toBe("#a1a1a1");
    expect(tokens["fg-faint"]).toBe("#d4d4d4");
    expect(tokens["accent"]).toBe("#d97706");
    expect(tokens["accent-soft"]).toBe("#fffbeb");
    expect(tokens["accent-soft-strong"]).toBe("#fef3c7");
    expect(tokens["danger-solid"]).toBe("#dc2626");
    expect(tokens["mark-bg"]).toBe("rgb(254 230 132 / 0.8)");
  });
});
