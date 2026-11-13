import { describe, expect, it } from "vitest";
import { BackupError, backupDate, type AutoBackup } from "../backup";
import type { DbPort } from "../db";
import type { I18nKey, TranslateParams } from "../i18n";
import {
  SnapshotState,
  type SnapshotBackend,
  type SnapshotDeps,
} from "./snapshot.svelte";

const t = (key: I18nKey, params?: TranslateParams): string =>
  params === undefined ? key : `${key} ${JSON.stringify(params)}`;

const today = `kindclip-backup-${backupDate()}.db`;

function snapshot(name: string): AutoBackup {
  return { name, path: `/backups/${name}`, size: 1024 };
}

function makeDeps(overrides: Partial<SnapshotBackend> = {}) {
  const executed: string[] = [];
  const cleared: string[] = [];
  const visited: string[] = [];
  let refreshes = 0;
  const port: DbPort = {
    select: async <T>() => [{ version: 5 }] as T[],
    execute: async (sql, params) => {
      executed.push(`${sql} ${String(params?.[0] ?? "")}`);
      return { rowsAffected: 1 };
    },
  };
  const backend: SnapshotBackend = {
    saveDialog: async () => "/tmp/out.db",
    openDialog: async () => null,
    defaultPath: async (fileName) => `/tmp/${fileName}`,
    fileName: async (date) => `kindclip-backup-${date}.db`,
    prepare: async (date) => {
      const finalName = `kindclip-backup-${date}.db`;
      visited.push(`prepare ${date}`);
      return {
        dir: "/backups",
        finalPath: `/backups/${finalName}`,
        tempPath: "/backups/in-flight.tmp",
      };
    },
    commit: async () => {
      visited.push("commit");
    },
    list: async () => [],
    prune: async () => {
      visited.push("prune");
      return { deleted: 0, failed: 0, tempsDeleted: 0 };
    },
    clearTarget: async (path) => {
      cleared.push(path);
    },
    inspect: async () => ({ schemaVersion: 5, clippings: 3, books: 1, tags: 2 }),
    restore: async () => {
      visited.push("restore");
    },
    ...overrides,
  };
  const logged: string[] = [];
  const deps: SnapshotDeps = {
    getPort: async () => port,
    closePort: async () => {
      visited.push("close-port");
    },
    t,
    backend,
    refresh: async () => {
      refreshes += 1;
    },
    log: {
      info: (message) => logged.push(message),
      warn: (message) => logged.push(message),
      error: (scope) => logged.push(scope),
    },
  };
  return { deps, executed, cleared, visited, logged, refreshes: () => refreshes };
}

describe("SnapshotState", () => {
  it("writes the manual backup and reports the final file name", async () => {
    const { deps, executed, cleared } = makeDeps();
    const state = new SnapshotState(deps);

    await state.save();

    expect(cleared).toEqual(["/tmp/out.db"]);
    expect(executed).toEqual(["VACUUM INTO $1 /tmp/out.db"]);
    expect(state.backup.status).toContain("backup.done");
    expect(state.backup.status).toContain("out.db");
    expect(state.backup.busy).toBe(false);
  });

  it("leaves the previous status cleared when the save dialog is cancelled", async () => {
    const { deps, executed } = makeDeps({ saveDialog: async () => null });
    const state = new SnapshotState(deps);
    state.backup.status = "old";

    await state.save();

    expect(executed).toEqual([]);
    expect(state.backup.status).toBeNull();
    expect(state.backup.error).toBeNull();
  });

  it("reports a failed manual backup without throwing", async () => {
    const { deps } = makeDeps({
      saveDialog: async () => {
        throw new Error("permission denied");
      },
    });
    const state = new SnapshotState(deps);

    await state.save();

    expect(state.backup.error).toContain("backup.error");
    expect(state.backup.error).toContain("permission denied");
    expect(state.backup.busy).toBe(false);
  });

  it("skips the automatic snapshot when today's file already exists", async () => {
    const { deps, visited } = makeDeps({ list: async () => [snapshot(today)] });
    const state = new SnapshotState(deps);

    await state.autoBackup();

    expect(visited).toEqual([]);
  });

  it("writes, commits and prunes the automatic snapshot exactly once", async () => {
    const { deps, executed, visited } = makeDeps({
      list: async () => [snapshot("kindclip-backup-2020-01-01.db")],
    });
    const state = new SnapshotState(deps);

    await state.autoBackup();

    expect(visited).toEqual([`prepare ${backupDate()}`, "commit", "prune"]);
    expect(executed).toEqual(["VACUUM INTO $1 /backups/in-flight.tmp"]);
  });

  it("logs an automatic-backup failure and never interrupts startup", async () => {
    const { deps, logged } = makeDeps({
      list: async () => {
        throw new Error("no folder");
      },
    });
    const state = new SnapshotState(deps);

    await expect(state.autoBackup()).resolves.toBeUndefined();
    expect(logged).toContain("auto-backup");
  });

  it("opens the dialog with a clean state and the snapshot list", async () => {
    const { deps } = makeDeps({ list: async () => [snapshot(today)] });
    const state = new SnapshotState(deps);
    state.error = "old";
    state.path = "/old.db";

    await state.openDialog();

    expect(state.open).toBe(true);
    expect(state.error).toBeNull();
    expect(state.path).toBeNull();
    expect(state.snapshots.map((item) => item.name)).toEqual([today]);
  });

  it("maps a rejected snapshot to its translated reason", async () => {
    const { deps } = makeDeps({
      inspect: async () => {
        throw new BackupError("newer-version", "schema 6");
      },
    });
    const state = new SnapshotState(deps);

    await state.inspect("/backups/newer.db");

    expect(state.error).toBe("restore.newer");
    expect(state.checking).toBe(false);
    expect(state.info).toBeNull();
  });

  it("keeps the newest inspection when the user picks another file quickly", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps } = makeDeps({
      inspect: async (path) => {
        if (path === "/slow.db") await gate;
        return { schemaVersion: path === "/slow.db" ? 4 : 5, clippings: 1, books: 1, tags: 0 };
      },
    });
    const state = new SnapshotState(deps);

    const slow = state.inspect("/slow.db");
    await state.inspect("/fast.db");
    release();
    await slow;

    expect(state.path).toBe("/fast.db");
    expect(state.info?.schemaVersion).toBe(5);
  });

  it("does not confirm without an inspected snapshot", async () => {
    const { deps, visited } = makeDeps();
    const state = new SnapshotState(deps);

    await state.confirm();

    expect(visited).toEqual([]);
    expect(state.busy).toBe(false);
  });

  it("closes the pool and lets Rust restart on a confirmed restore", async () => {
    const { deps, visited } = makeDeps();
    const state = new SnapshotState(deps);
    await state.inspect("/backups/ok.db");

    await state.confirm();

    expect(visited).toEqual(["close-port", "restore"]);
    // Rust never returns on success: reaching here is the restart failure.
    expect(state.error).toBe("restore.restartFailed");
    expect(state.busy).toBe(false);
  });

  it("reopens the database and reloads the views after a failed restore", async () => {
    const { deps, refreshes } = makeDeps({
      restore: async () => {
        throw new Error("cannot replace");
      },
    });
    const state = new SnapshotState(deps);
    await state.inspect("/backups/ok.db");

    await state.confirm();

    expect(state.error).toContain("restore.error");
    expect(refreshes()).toBe(1);
    expect(state.busy).toBe(false);
  });
});
