import { describe, expect, it, vi } from "vitest";
import {
  AUTO_BACKUP_KEEP,
  BackupError,
  autoBackupDate,
  autoBackupDue,
  backupFileName,
  baseName,
  formatBackupSize,
  inspectBackup,
  inspectBackupFile,
  isAutoBackupName,
  schemaVersion,
  selectAutoBackupsToDelete,
  type BackupFileDeps,
} from "./backup";
import type { DbPort } from "./db";

/** Query answers keyed by a substring of the SQL, in lookup order. */
interface Answer {
  match: string;
  rows: unknown[];
}

function fakePort(answers: Answer[]): DbPort {
  return {
    async select<T>(sql: string): Promise<T[]> {
      const answer = answers.find((entry) => sql.includes(entry.match));
      if (answer === undefined) {
        throw new Error(`unexpected query: ${sql}`);
      }
      return answer.rows as T[];
    },
    async execute() {
      return {};
    },
  };
}

const REQUIRED_TABLES = [
  "files",
  "books",
  "clippings",
  "favorites",
  "tags",
  "clipping_tags",
  "settings",
  "_sqlx_migrations",
];

function tableRows(names: string[] = REQUIRED_TABLES): Answer {
  return { match: "sqlite_master", rows: names.map((name) => ({ name })) };
}

const integrityOk: Answer = { match: "integrity_check", rows: [{ integrity_check: "ok" }] };
const versionFive: Answer = { match: "MAX(version)", rows: [{ version: 5 }] };
const noFailedMigrations: Answer = { match: "success = 0", rows: [{ n: 0 }] };
const clippings: Answer = { match: "COUNT(*) AS n FROM clippings", rows: [{ n: 12 }] };
const books: Answer = { match: "COUNT(*) AS n FROM books", rows: [{ n: 3 }] };
const tags: Answer = { match: "COUNT(*) AS n FROM tags", rows: [{ n: 4 }] };

function validAnswers(overrides: Answer[] = []): Answer[] {
  const replaced = new Set(overrides.map((entry) => entry.match));
  const base = [
    integrityOk,
    tableRows(),
    versionFive,
    noFailedMigrations,
    clippings,
    books,
    tags,
  ].filter((entry) => !replaced.has(entry.match));
  return [...overrides, ...base];
}

function errorCode(error: unknown): string {
  expect(error).toBeInstanceOf(BackupError);
  return (error as BackupError).code;
}

describe("backupFileName", () => {
  it("uses the local date and the .db extension", () => {
    expect(backupFileName(new Date(2026, 10, 3))).toBe("kindclip-backup-2026-11-03.db");
    expect(backupFileName(new Date(2026, 0, 9))).toBe("kindclip-backup-2026-01-09.db");
  });
});

describe("baseName", () => {
  it("returns the last segment with either separator", () => {
    expect(baseName("/home/ana/kindclip-backup.db")).toBe("kindclip-backup.db");
    expect(baseName("C:\\Users\\ana\\kindclip-backup.db")).toBe("kindclip-backup.db");
    expect(baseName("kindclip-backup.db")).toBe("kindclip-backup.db");
  });
});

describe("schemaVersion", () => {
  it("reads the highest applied migration", async () => {
    const port = fakePort([{ match: "MAX(version)", rows: [{ version: 4 }] }]);
    await expect(schemaVersion(port)).resolves.toBe(4);
  });

  it("returns zero when the table is empty", async () => {
    const port = fakePort([{ match: "MAX(version)", rows: [{ version: null }] }]);
    await expect(schemaVersion(port)).resolves.toBe(0);
  });
});

describe("inspectBackup", () => {
  it("returns the snapshot contents when every check passes", async () => {
    const info = await inspectBackup(fakePort(validAnswers()), 5);
    expect(info).toEqual({ schemaVersion: 5, clippings: 12, books: 3, tags: 4 });
  });

  it("accepts an older snapshot that can be migrated on restart", async () => {
    const info = await inspectBackup(fakePort(validAnswers()), 7);
    expect(info.schemaVersion).toBe(5);
  });

  it("rejects a file without the kindclip tables", async () => {
    const port = fakePort(
      validAnswers([tableRows(["books", "clippings", "favorites", "settings"])]),
    );
    await expect(inspectBackup(port, 5)).rejects.toSatisfy(
      (error) => errorCode(error) === "not-kindclip",
    );
  });

  it("rejects a snapshot created by a newer app", async () => {
    const port = fakePort(validAnswers([{ match: "MAX(version)", rows: [{ version: 6 }] }]));
    await expect(inspectBackup(port, 5)).rejects.toSatisfy(
      (error) => errorCode(error) === "newer-version",
    );
  });

  it("rejects a database that failed an integrity check", async () => {
    const port = fakePort(
      validAnswers([{ match: "integrity_check", rows: [{ integrity_check: "database disk image is malformed" }] }]),
    );
    await expect(inspectBackup(port, 5)).rejects.toSatisfy(
      (error) => errorCode(error) === "corrupt",
    );
  });

  it("rejects a snapshot with a failed migration", async () => {
    const port = fakePort(validAnswers([{ match: "success = 0", rows: [{ n: 1 }] }]));
    await expect(inspectBackup(port, 5)).rejects.toSatisfy(
      (error) => errorCode(error) === "corrupt",
    );
  });

  it("rejects a database with no applied migrations", async () => {
    const port = fakePort(validAnswers([{ match: "MAX(version)", rows: [{ version: 0 }] }]));
    await expect(inspectBackup(port, 5)).rejects.toSatisfy(
      (error) => errorCode(error) === "not-kindclip",
    );
  });

  it("reports a corrupt database when the integrity query itself fails", async () => {
    const port: DbPort = {
      async select() {
        throw new Error("file is not a database");
      },
      async execute() {
        return {};
      },
    };
    await expect(inspectBackup(port, 5)).rejects.toSatisfy(
      (error) => errorCode(error) === "corrupt",
    );
  });
});

describe("inspectBackupFile", () => {
  function deps(
    port: DbPort,
    overrides: Partial<BackupFileDeps> = {},
  ): BackupFileDeps & { close: ReturnType<typeof vi.fn> } {
    const close = vi.fn().mockResolvedValue(true);
    return {
      check: vi.fn().mockResolvedValue(1024),
      load: vi.fn().mockResolvedValue({ ...port, close }),
      close,
      ...overrides,
    };
  }

  it("checks the file, opens it as a separate database and closes it", async () => {
    const fake = deps(fakePort(validAnswers()));
    const info = await inspectBackupFile("/tmp/kindclip-backup.db", 5, fake);

    expect(info.clippings).toBe(12);
    expect(fake.check).toHaveBeenCalledWith("/tmp/kindclip-backup.db");
    expect(fake.load).toHaveBeenCalledWith("sqlite:/tmp/kindclip-backup.db");
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it("closes the database when validation fails", async () => {
    const fake = deps(fakePort(validAnswers([{ match: "MAX(version)", rows: [{ version: 9 }] }])));

    await expect(inspectBackupFile("/tmp/newer.db", 5, fake)).rejects.toBeInstanceOf(BackupError);
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  it("does not open a database when the file check already failed", async () => {
    const fake = deps(fakePort(validAnswers()), {
      check: vi.fn().mockRejectedValue(new Error("not a SQLite database")),
    });

    await expect(inspectBackupFile("/tmp/notes.txt", 5, fake)).rejects.toThrow(
      "not a SQLite database",
    );
    expect(fake.load).not.toHaveBeenCalled();
  });
});

describe("isAutoBackupName", () => {
  it("accepts only the dated automatic snapshot name", () => {
    expect(isAutoBackupName("kindclip-backup-2026-11-03.db")).toBe(true);
    expect(isAutoBackupName("kindclip-backup-2026-01-09.db")).toBe(true);
    expect(isAutoBackupName("kindclip.db")).toBe(false);
    expect(isAutoBackupName("kindclip.db.before-restore")).toBe(false);
    expect(isAutoBackupName("kindclip-backup-2026-11-3.db")).toBe(false);
    expect(isAutoBackupName("kindclip-backup-2026-11-03.db.tmp")).toBe(false);
    expect(isAutoBackupName("kindclip-backup-today.db")).toBe(false);
  });
});

describe("autoBackupDue", () => {
  const now = new Date(2026, 10, 3);

  it("is due when today's snapshot is missing", () => {
    expect(autoBackupDue([], now)).toBe(true);
    expect(autoBackupDue(["kindclip-backup-2026-11-02.db"], now)).toBe(true);
  });

  it("is not due when today's snapshot already exists", () => {
    expect(
      autoBackupDue(
        ["kindclip-backup-2026-11-02.db", "kindclip-backup-2026-11-03.db"],
        now,
      ),
    ).toBe(false);
  });

  it("ignores unrelated files in the folder", () => {
    expect(autoBackupDue(["kindclip-backup.db", "notes.txt"], now)).toBe(true);
  });
});

describe("selectAutoBackupsToDelete", () => {
  function names(count: number): string[] {
    return Array.from({ length: count }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      return `kindclip-backup-2026-01-${day}.db`;
    });
  }

  it("keeps exactly the newest seven snapshots", () => {
    const all = names(10);
    expect(selectAutoBackupsToDelete(all)).toEqual([all[0], all[1], all[2]]);
    expect(AUTO_BACKUP_KEEP).toBe(7);
  });

  it("does not delete anything below the keep count", () => {
    expect(selectAutoBackupsToDelete(names(7))).toEqual([]);
  });

  it("ignores files that do not match the snapshot name", () => {
    const all = [...names(8), "kindclip.db", "kindclip.db-wal", "notes.txt"];
    expect(selectAutoBackupsToDelete(all)).toEqual([all[0]]);
  });

  it("never selects the newest snapshot, even with a keep count of zero", () => {
    const all = names(3);
    expect(selectAutoBackupsToDelete(all, 0)).toEqual([all[0], all[1]]);
  });

  it("orders by date, not by array order", () => {
    const all = names(10).reverse();
    expect(selectAutoBackupsToDelete(all)).toEqual([all[9], all[8], all[7]]);
  });
});

describe("autoBackupDate", () => {
  it("reads the date out of the snapshot name", () => {
    expect(autoBackupDate("kindclip-backup-2026-11-03.db")).toBe("2026-11-03");
  });

  it("returns an empty label for an unrelated name", () => {
    expect(autoBackupDate("notes.txt")).toBe("");
  });
});

describe("formatBackupSize", () => {
  it("uses bytes, kilobytes and megabytes with a readable precision", () => {
    expect(formatBackupSize(0)).toBe("0 B");
    expect(formatBackupSize(512)).toBe("512 B");
    expect(formatBackupSize(1024)).toBe("1 KB");
    expect(formatBackupSize(1536)).toBe("2 KB");
    expect(formatBackupSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatBackupSize(1024 * 1024)).toBe("1.0 MB");
  });
});
