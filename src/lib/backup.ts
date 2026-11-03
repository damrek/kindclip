import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import type { DbPort } from "./db";

/** File extension offered by the native backup and restore dialogs. */
export const BACKUP_EXTENSION = "db";

/** `kindclip-backup-YYYY-MM-DD.db` in the local timezone. */
export function backupFileName(now: Date = new Date()): string {
  const pad2 = (value: number): string => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return `kindclip-backup-${date}.${BACKUP_EXTENSION}`;
}

/** Last segment of a path, supporting both `/` and `\` separators. */
export function baseName(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

/** What a validated snapshot holds, shown before the destructive step. */
export interface BackupInfo {
  schemaVersion: number;
  clippings: number;
  books: number;
  tags: number;
}

export type BackupErrorCode = "not-kindclip" | "newer-version" | "corrupt";

/** A rejected snapshot; `code` lets the UI pick the translated reason. */
export class BackupError extends Error {
  readonly code: BackupErrorCode;

  constructor(code: BackupErrorCode, message: string) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

export function isBackupError(error: unknown): error is BackupError {
  return error instanceof BackupError;
}

/** Tables every kindclip snapshot carries (plugin-sql adds the migrations table). */
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function countRows(port: DbPort, table: string): Promise<number> {
  const rows = await port.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

/** Highest applied migration; zero for an empty migrations table. */
export async function schemaVersion(port: DbPort): Promise<number> {
  const rows = await port.select<{ version: number | null }>(
    "SELECT MAX(version) AS version FROM _sqlx_migrations WHERE success = 1",
  );
  return Number(rows[0]?.version ?? 0);
}

/**
 * Validate an opened snapshot and read what it holds.
 *
 * The running app's schema version is the ceiling: an older snapshot is
 * accepted because the next launch runs the pending migrations, but a newer
 * one would be opened by code that does not know its schema yet.
 */
export async function inspectBackup(
  port: DbPort,
  currentSchemaVersion: number,
): Promise<BackupInfo> {
  let integrity: { integrity_check: string }[];
  try {
    integrity = await port.select<{ integrity_check: string }>("PRAGMA integrity_check");
  } catch (error) {
    throw new BackupError("corrupt", messageOf(error));
  }
  if (integrity.length !== 1 || integrity[0]?.integrity_check !== "ok") {
    throw new BackupError(
      "corrupt",
      integrity.map((row) => row.integrity_check).join("; ") || "integrity check failed",
    );
  }

  const tables = await port.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  const present = new Set(tables.map((row) => row.name));
  const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new BackupError("not-kindclip", `missing tables: ${missing.join(", ")}`);
  }

  const failed = await port.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM _sqlx_migrations WHERE success = 0",
  );
  if (Number(failed[0]?.n ?? 0) > 0) {
    throw new BackupError("corrupt", "the snapshot has a failed migration");
  }

  const version = await schemaVersion(port);
  if (version < 1) {
    throw new BackupError("not-kindclip", "the snapshot has no applied migrations");
  }
  if (version > currentSchemaVersion) {
    throw new BackupError(
      "newer-version",
      `snapshot schema ${version} is newer than ${currentSchemaVersion}`,
    );
  }

  return {
    schemaVersion: version,
    clippings: await countRows(port, "clippings"),
    books: await countRows(port, "books"),
    tags: await countRows(port, "tags"),
  };
}

/** Open connection to a snapshot; closeable so validation never leaks a pool. */
export interface BackupDb extends DbPort {
  close(): Promise<boolean>;
}

/** Seams of the snapshot inspection, injectable for tests. */
export interface BackupFileDeps {
  check: (path: string) => Promise<number>;
  load: (url: string) => Promise<BackupDb>;
}

/** Production deps: Rust header check + a second plugin-sql connection. */
export function tauriBackupFileDeps(): BackupFileDeps {
  return {
    check: (path) => invoke<number>("validate_backup_file", { path }),
    load: (url) => Database.load(url),
  };
}

/**
 * Validate a snapshot file the user picked, without touching the live
 * database: the Rust command rejects non-SQLite files first (so plugin-sql
 * never creates an empty database), then the file is opened read-only in
 * practice and always closed.
 */
export async function inspectBackupFile(
  path: string,
  currentSchemaVersion: number,
  deps: BackupFileDeps = tauriBackupFileDeps(),
): Promise<BackupInfo> {
  await deps.check(path);
  const db = await deps.load(`sqlite:${path}`);
  try {
    return await inspectBackup(db, currentSchemaVersion);
  } finally {
    await db.close();
  }
}
