import Database from "@tauri-apps/plugin-sql";
import { backfillSearchFolding } from "./backfill";
import type { DbPort } from "./port";

const DB_URL = "sqlite:kindclip.db";

let dbPromise: Promise<DbPort> | null = null;
let dbHandle: Database | null = null;

/** Shared plugin-sql connection (preloaded + migrated at startup). */
export function getDb(): Promise<DbPort> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then(async (db) => {
      dbHandle = db;
      const port: DbPort = {
        select: <T>(sql: string, params?: unknown[]) => db.select<T>(sql, params),
        execute: (sql: string, params?: unknown[]) => db.execute(sql, params),
      };
      await backfillSearchFolding(port);
      return port;
    });
  }
  return dbPromise;
}

/** Close the shared pool so the database file can be replaced by a restore;
 * the next `getDb()` opens a fresh connection. */
export async function closeDb(): Promise<void> {
  const handle = dbHandle;
  dbHandle = null;
  dbPromise = null;
  if (handle) {
    await handle.close();
  }
}
