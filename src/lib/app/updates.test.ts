import { describe, expect, it, vi } from "vitest";
import { UpdatePanel, type PendingUpdate, type UpdateDeps } from "./updates.svelte";
import type { I18nKey, TranslateParams } from "../i18n";

/** Render the key with its params so a test can assert what the line says. */
const t = (key: I18nKey, params?: TranslateParams): string => {
  const pairs = Object.entries(params ?? {}).map(([name, value]) => `${name}=${String(value)}`);
  return pairs.length === 0 ? `${key}()` : `${key}(${pairs.join(",")})`;
};

function pending(overrides: Partial<PendingUpdate> = {}): PendingUpdate {
  return {
    version: "2.1.0",
    body: "Faster imports.",
    downloadAndInstall: async () => {},
    ...overrides,
  };
}

function deps(
  check: UpdateDeps["check"],
  relaunch: UpdateDeps["relaunch"] = async () => {},
) {
  const logged: string[] = [];
  const value: UpdateDeps = {
    check,
    relaunch,
    t,
    log: (scope) => logged.push(scope),
  };
  return { value, logged };
}

const nothing = async (): Promise<PendingUpdate | null> => null;

describe("UpdatePanel launch check", () => {
  it("opens the prompt when a newer release exists", async () => {
    const { value } = deps(async () => pending());
    const panel = new UpdatePanel(value);

    await panel.checkOnLaunch();

    expect(panel.prompt).toBe(true);
    expect(panel.status).toBe("available");
    expect(panel.version).toBe("2.1.0");
    expect(panel.notes).toBe("Faster imports.");
    expect(panel.available).toBe(true);
  });

  it("stays invisible when the app is already current", async () => {
    const { value } = deps(nothing);
    const panel = new UpdatePanel(value);

    await panel.checkOnLaunch();

    expect(panel.prompt).toBe(false);
    expect(panel.status).toBe("idle");
    expect(panel.error).toBeNull();
  });

  it("swallows a launch failure instead of interrupting the cold start", async () => {
    const { value, logged } = deps(async () => {
      throw new Error("endpoint unreachable");
    });
    const panel = new UpdatePanel(value);

    await panel.checkOnLaunch();

    expect(panel.prompt).toBe(false);
    expect(panel.status).toBe("idle");
    expect(panel.error).toBeNull();
    expect(logged).toEqual(["update-check"]);
  });

  it("closes the prompt without losing the pending release", async () => {
    const { value } = deps(async () => pending());
    const panel = new UpdatePanel(value);
    await panel.checkOnLaunch();

    panel.dismiss();

    expect(panel.prompt).toBe(false);
    expect(panel.available).toBe(true);
  });
});

describe("UpdatePanel manual check", () => {
  it("reports that the app is up to date", async () => {
    const { value } = deps(nothing);
    const panel = new UpdatePanel(value);

    await panel.checkNow();

    expect(panel.status).toBe("current");
    expect(panel.error).toBeNull();
    expect(panel.prompt).toBe(false);
  });

  it("surfaces a failure with the translated message", async () => {
    const { value, logged } = deps(async () => {
      throw new Error("endpoint unreachable");
    });
    const panel = new UpdatePanel(value);

    await panel.checkNow();

    expect(panel.status).toBe("error");
    expect(panel.error).toContain("updates.error");
    expect(panel.error).toContain("endpoint unreachable");
    expect(logged).toEqual(["update-check"]);
  });

  it("clears a previous error before the next attempt", async () => {
    let fail = true;
    const { value } = deps(async () => {
      if (fail) throw new Error("endpoint unreachable");
      return null;
    });
    const panel = new UpdatePanel(value);
    await panel.checkNow();

    fail = false;
    await panel.checkNow();

    expect(panel.status).toBe("current");
    expect(panel.error).toBeNull();
  });
});

describe("UpdatePanel install", () => {
  it("installs the pending release and restarts into it", async () => {
    const downloadAndInstall = vi.fn(async () => {});
    const relaunch = vi.fn(async () => {});
    const { value } = deps(async () => pending({ downloadAndInstall }), relaunch);
    const panel = new UpdatePanel(value);
    await panel.checkOnLaunch();

    await panel.install();

    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(panel.busy).toBe(false);
  });

  it("keeps the app running and reports the failure when the install breaks", async () => {
    const relaunch = vi.fn(async () => {});
    const { value, logged } = deps(
      async () =>
        pending({
          downloadAndInstall: async () => {
            throw new Error("signature mismatch");
          },
        }),
      relaunch,
    );
    const panel = new UpdatePanel(value);
    await panel.checkOnLaunch();

    await panel.install();

    expect(relaunch).not.toHaveBeenCalled();
    expect(panel.status).toBe("error");
    expect(panel.error).toContain("signature mismatch");
    expect(panel.busy).toBe(false);
    expect(logged).toEqual(["update-install"]);
  });

  it("does nothing when no release was found", async () => {
    const relaunch = vi.fn(async () => {});
    const { value } = deps(nothing, relaunch);
    const panel = new UpdatePanel(value);
    await panel.checkNow();

    await panel.install();

    expect(relaunch).not.toHaveBeenCalled();
    expect(panel.status).toBe("current");
  });

  it("ignores a second check while an install is in flight", async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkFn = vi.fn(async () => pending({ downloadAndInstall: () => blocked }));
    const { value } = deps(checkFn);
    const panel = new UpdatePanel(value);
    await panel.checkOnLaunch();

    const installing = panel.install();
    await panel.checkNow();
    release();
    await installing;

    // The install's own check plus the launch one; the manual one was ignored.
    expect(checkFn).toHaveBeenCalledTimes(1);
  });
});
