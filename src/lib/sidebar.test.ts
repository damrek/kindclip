import { describe, expect, it } from "vitest";
import { loadSidebarOpen } from "./sidebar";

describe("loadSidebarOpen", () => {
  it("defaults to open when nothing is stored", () => {
    expect(loadSidebarOpen(null)).toBe(true);
    expect(loadSidebarOpen("")).toBe(true);
    expect(loadSidebarOpen("nope")).toBe(true);
  });

  it("keeps a stored open state", () => {
    expect(loadSidebarOpen("open")).toBe(true);
  });

  it("keeps a stored closed state", () => {
    expect(loadSidebarOpen("closed")).toBe(false);
  });
});
