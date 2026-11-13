import { describe, expect, it } from "vitest";
import { StatsState, type StatsStateDeps } from "./stats.svelte";
import type { DbPort } from "../db";
import type { I18nKey, TranslateParams } from "../i18n";
import type { ReadingStats } from "../stats";

const t = (key: I18nKey, params?: TranslateParams): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const stats: ReadingStats = { total: 3, bookCount: 2, years: [], kinds: [], books: [] };

const port: DbPort = {
  select: async () => [],
  execute: async () => ({ rowsAffected: 0 }),
};

function makeState(load: StatsStateDeps["load"]) {
  const logged: string[] = [];
  return new StatsState({
    getPort: async () => port,
    load,
    t,
    log: {
      info: () => {},
      warn: () => {},
      error: (scope) => logged.push(scope),
    },
  });
}

describe("StatsState", () => {
  it("opens with a loading state and stores the aggregate", async () => {
    const state = makeState(async () => stats);

    const pending = state.show();
    expect(state.open).toBe(true);
    expect(state.loading).toBe(true);
    expect(state.data).toBeNull();
    await pending;

    expect(state.data).toEqual(stats);
    expect(state.loading).toBe(false);
  });

  it("translates a failed load and releases the flag", async () => {
    const state = makeState(async () => {
      throw new Error("database is locked");
    });

    await state.show();

    expect(state.error).toContain("stats.error");
    expect(state.error).toContain("database is locked");
    expect(state.loading).toBe(false);
  });

  it("ignores a load that finishes after the dialog closed", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = makeState(async () => {
      await gate;
      return stats;
    });
    const pending = state.show();

    expect(state.close()).toBe(true);
    release();
    await pending;

    expect(state.data).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.open).toBe(false);
  });

  it("reports an already-closed dialog so the shell keeps its focus", () => {
    const state = makeState(async () => stats);
    expect(state.close()).toBe(false);
  });
});
