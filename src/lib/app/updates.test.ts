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
  currentNotes: UpdateDeps["currentNotes"] = () => null,
) {
  const logged: string[] = [];
  const value: UpdateDeps = {
    check,
    relaunch,
    currentNotes,
    t,
    log: (scope) => logged.push(scope),
  };
  return { value, logged };
}

const nothing = async (): Promise<PendingUpdate | null> => null;

describe("UpdatePanel launch check", () => {
  it("marks the release as available without opening the dialog", async () => {
    const { value } = deps(async () => pending());
    const panel = new UpdatePanel(value);

    await panel.checkOnLaunch();

    // The launch check only lights the header badge; the dialog waits for a
    // click, so a cold start is never interrupted.
    expect(panel.prompt).toBe(false);
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
    await panel.open();

    panel.dismiss();

    expect(panel.prompt).toBe(false);
    expect(panel.available).toBe(true);
  });

  it("opens the dialog from the header control without asking the endpoint again", async () => {
    const checkFn = vi.fn(async () => pending());
    const { value } = deps(checkFn);
    const panel = new UpdatePanel(value);
    await panel.checkOnLaunch();

    await panel.open();

    expect(panel.prompt).toBe(true);
    expect(checkFn).toHaveBeenCalledTimes(1);
  });

  it("looks for a release when the header control has nothing pending", async () => {
    const checkFn = vi.fn(nothing);
    const { value } = deps(checkFn);
    const panel = new UpdatePanel(value);

    await panel.open();

    expect(checkFn).toHaveBeenCalledTimes(1);
    expect(panel.prompt).toBe(true);
    expect(panel.status).toBe("current");
  });
});

describe("UpdatePanel manual check", () => {
  it("reports that the app is up to date", async () => {
    const { value } = deps(nothing);
    const panel = new UpdatePanel(value);

    await panel.checkNow();

    expect(panel.status).toBe("current");
    expect(panel.error).toBeNull();
    // A manual check always answers: the dialog says "up to date".
    expect(panel.prompt).toBe(true);
  });

  it("opens the dialog while the check is still running", async () => {
    let finish: (value: PendingUpdate | null) => void = () => {};
    const checkFn = vi.fn(
      () =>
        new Promise<PendingUpdate | null>((resolve) => {
          finish = resolve;
        }),
    );
    const { value } = deps(checkFn);
    const panel = new UpdatePanel(value);

    const opening = panel.open();

    expect(panel.prompt).toBe(true);
    expect(panel.status).toBe("checking");

    finish(null);
    await opening;
    expect(panel.status).toBe("current");
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

describe("UpdatePanel dialog notes", () => {
  it("shows the current version changelog when up to date", async () => {
    const { value } = deps(nothing, async () => {}, () => "### Fixed\n\n- One crash.");
    const panel = new UpdatePanel(value);

    await panel.checkNow();

    expect(panel.notesToShow).toBe("### Fixed\n\n- One crash.");
  });

  it("prefers the pending release notes over the current changelog", async () => {
    const { value } = deps(
      async () => pending({ body: "Faster imports." }),
      async () => {},
      () => "Current notes.",
    );
    const panel = new UpdatePanel(value);

    await panel.checkOnLaunch();

    expect(panel.notesToShow).toBe("Faster imports.");
  });

  it("does not fall back to the current changelog for a pending release without notes", async () => {
    const { value } = deps(
      async () => pending({ body: null }),
      async () => {},
      () => "Current notes.",
    );
    const panel = new UpdatePanel(value);

    await panel.checkOnLaunch();

    expect(panel.notesToShow).toBe("");
  });

  it("shows no changelog when the check fails", async () => {
    const { value } = deps(
      async () => {
        throw new Error("endpoint unreachable");
      },
      async () => {},
      () => "Current notes.",
    );
    const panel = new UpdatePanel(value);

    await panel.checkNow();

    expect(panel.notesToShow).toBe("");
  });

  it("shows no changelog when the current version has no section", async () => {
    const { value } = deps(nothing, async () => {}, () => null);
    const panel = new UpdatePanel(value);

    await panel.checkNow();

    expect(panel.notesToShow).toBe("");
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

