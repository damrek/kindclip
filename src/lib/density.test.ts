import { describe, expect, it } from "vitest";
import {
  applyDensity,
  DEFAULT_DENSITY,
  DENSITIES,
  isDensity,
  loadDensity,
  type Density,
} from "./density";

describe("loadDensity", () => {
  it("defaults to comfortable", () => {
    expect(loadDensity(null)).toBe("comfortable");
    expect(loadDensity("")).toBe("comfortable");
    expect(loadDensity("crowded" as Density)).toBe("comfortable");
    expect(DEFAULT_DENSITY).toBe("comfortable");
  });

  it("keeps every supported level", () => {
    expect(DENSITIES).toEqual(["compact", "comfortable", "spacious"]);
    for (const level of DENSITIES) {
      expect(loadDensity(level)).toBe(level);
    }
  });
});

describe("isDensity", () => {
  it("accepts only the known levels", () => {
    expect(isDensity("compact")).toBe(true);
    expect(isDensity("dense")).toBe(false);
    expect(isDensity(undefined)).toBe(false);
  });
});

describe("applyDensity", () => {
  it("writes the attribute the CSS variables key on", () => {
    const element = { dataset: {} } as unknown as HTMLElement;
    applyDensity(element, "spacious");
    expect(element.dataset.density).toBe("spacious");
    applyDensity(element, "compact");
    expect(element.dataset.density).toBe("compact");
  });
});
