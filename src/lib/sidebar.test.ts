import { describe, expect, it } from "vitest";
import { loadSidebarOpen, loadSidebarView } from "./sidebar";

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

describe("loadSidebarView", () => {
  it("defaults to the flat book list when nothing is stored", () => {
    expect(loadSidebarView(null)).toBe("books");
    expect(loadSidebarView("")).toBe("books");
    expect(loadSidebarView("nope")).toBe("books");
  });

  it("keeps a stored view", () => {
    expect(loadSidebarView("books")).toBe("books");
    expect(loadSidebarView("authors")).toBe("authors");
  });
});
