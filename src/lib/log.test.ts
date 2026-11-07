import { describe, expect, it, vi } from "vitest";
import { createLogger, describeError, type LogSink } from "./log";

function sink(): LogSink & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return {
    info: vi.fn(() => Promise.resolve()),
    warn: vi.fn(() => Promise.resolve()),
    error: vi.fn(() => Promise.resolve()),
  };
}

describe("describeError", () => {
  it("uses the message of an Error", () => {
    expect(describeError(new Error("disk full"))).toBe("disk full");
  });

  it("keeps a thrown string as-is", () => {
    expect(describeError("boom")).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(describeError(404)).toBe("404");
    expect(describeError(null)).toBe("null");
  });
});

describe("createLogger", () => {
  it("forwards messages to the matching sink level", async () => {
    const target = sink();
    const logger = createLogger(target);

    logger.info("imported 3 clippings");
    logger.warn("slow read");
    logger.error("backup", new Error("disk full"));

    expect(target.info).toHaveBeenCalledWith("imported 3 clippings");
    expect(target.warn).toHaveBeenCalledWith("slow read");
    expect(target.error).toHaveBeenCalledWith("[backup] disk full");
  });

  it("never throws when the sink rejects", async () => {
    const target = sink();
    target.info.mockRejectedValue(new Error("no bridge"));
    const logger = createLogger(target);

    expect(() => logger.info("still safe")).not.toThrow();
  });

  it("never throws when the sink throws synchronously", () => {
    const target = sink();
    target.warn.mockImplementation(() => {
      throw new Error("not in Tauri");
    });
    const logger = createLogger(target);

    expect(() => logger.warn("still safe")).not.toThrow();
  });
});
