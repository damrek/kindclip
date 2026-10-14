import { invoke } from "@tauri-apps/api/core";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

/** Seams of the reveal flow, injectable for tests. */
export interface DbLocationDeps {
  getPath: () => Promise<string>;
  reveal: (path: string) => Promise<void>;
  openDir: (path: string) => Promise<void>;
}

/** Parent folder of a file path, supporting both `/` and `\` separators. */
export function parentDir(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : path;
}

/**
 * Resolve the DB path and reveal it in the system file explorer. When the
 * file itself cannot be revealed (e.g. it does not exist yet), fall back to
 * opening its parent folder. Returns the DB path. Rejects only when both
 * attempts fail, so the UI can show the error.
 */
export async function revealDbLocation(deps: DbLocationDeps): Promise<string> {
  const path = await deps.getPath();
  try {
    await deps.reveal(path);
  } catch {
    await deps.openDir(parentDir(path));
  }
  return path;
}

/** Production deps backed by the Tauri runtime (command + opener plugin). */
export function tauriDbLocationDeps(): DbLocationDeps {
  return {
    getPath: () => invoke<string>("db_file_path"),
    reveal: (path) => revealItemInDir(path),
    openDir: (path) => openPath(path),
  };
}
