import { describe, expect, it } from "vitest";
import {
  applyFontScale,
  FONT_SCALES,
  loadFontScale,
  nextFontScale,
  resolveFontPercent,
  type FontScale,
} from "./font";

describe("resolveFontPercent", () => {
  it("maps each scale to a root percentage", () => {
    expect(resolveFontPercent("xs")).toBe(75);
    expect(resolveFontPercent("small")).toBe(87.5);
    expect(resolveFontPercent("medium")).toBe(100);
    expect(resolveFontPercent("large")).toBe(112.5);
    expect(resolveFontPercent("xl")).toBe(125);
  });

  it("falls back to 100 on unknown stored values", () => {
    expect(resolveFontPercent("huge" as FontScale)).toBe(100);
  });
});

describe("nextFontScale", () => {
  it("cycles through the five steps and wraps around", () => {
    expect(nextFontScale("xs")).toBe("small");
    expect(nextFontScale("small")).toBe("medium");
    expect(nextFontScale("medium")).toBe("large");
    expect(nextFontScale("large")).toBe("xl");
    expect(nextFontScale("xl")).toBe("xs");
  });

  it("exposes the five supported scales in order", () => {
    expect(FONT_SCALES).toEqual(["xs", "small", "medium", "large", "xl"]);
  });
});

describe("loadFontScale", () => {
  it("defaults to medium", () => {
    expect(loadFontScale(null)).toBe("medium");
    expect(loadFontScale("huge")).toBe("medium");
    expect(loadFontScale("")).toBe("medium");
  });

  it("keeps every supported stored choice", () => {
    for (const scale of FONT_SCALES) {
      expect(loadFontScale(scale)).toBe(scale);
    }
  });
});

describe("applyFontScale", () => {
  it("sets the root font size as a percentage", () => {
    const style: Record<string, string> = {};
    const element = { style } as unknown as HTMLElement;
    applyFontScale(element, "large");
    expect(style.fontSize).toBe("112.5%");
    applyFontScale(element, "medium");
    expect(style.fontSize).toBe("100%");
  });
});
