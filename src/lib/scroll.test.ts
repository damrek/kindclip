import { describe, expect, it } from "vitest";
import { hasMoreBelow } from "./scroll";

describe("hasMoreBelow", () => {
  it("is true while content extends past the visible area", () => {
    expect(hasMoreBelow({ scrollHeight: 1000, scrollTop: 0, clientHeight: 400 })).toBe(true);
    expect(hasMoreBelow({ scrollHeight: 1000, scrollTop: 300, clientHeight: 400 })).toBe(true);
  });

  it("is false once the bottom is reached", () => {
    expect(hasMoreBelow({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(false);
    expect(hasMoreBelow({ scrollHeight: 1000, scrollTop: 640, clientHeight: 400 })).toBe(false);
  });

  it("is false when everything fits", () => {
    expect(hasMoreBelow({ scrollHeight: 320, scrollTop: 0, clientHeight: 400 })).toBe(false);
    expect(hasMoreBelow({ scrollHeight: 0, scrollTop: 0, clientHeight: 0 })).toBe(false);
  });

  it("tolerates sub-pixel rounding at the end", () => {
    expect(hasMoreBelow({ scrollHeight: 1000.4, scrollTop: 600, clientHeight: 400 })).toBe(false);
  });
});
