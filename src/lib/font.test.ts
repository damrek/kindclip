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
    expect(resolveFontPercent("small")).toBe(87.5);
    expect(resolveFontPercent("medium")).toBe(100);
    expect(resolveFontPercent("large")).toBe(112.5);
  });

  it("falls back to 100 on unknown stored values", () => {
    expect(resolveFontPercent("huge" as FontScale)).toBe(100);
  });
});

describe("nextFontScale", () => {
  it("cycles small -> medium -> large -> small", () => {
    expect(nextFontScale("small")).toBe("medium");
    expect(nextFontScale("medium")).toBe("large");
    expect(nextFontScale("large")).toBe("small");
  });

  it("exposes the three supported scales in order", () => {
    expect(FONT_SCALES).toEqual(["small", "medium", "large"]);
  });
});

describe("loadFontScale", () => {
  it("defaults to medium", () => {
    expect(loadFontScale(null)).toBe("medium");
    expect(loadFontScale("huge")).toBe("medium");
    expect(loadFontScale("")).toBe("medium");
  });

  it("keeps a supported stored choice", () => {
    expect(loadFontScale("large")).toBe("large");
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
