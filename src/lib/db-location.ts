import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

/** Seams of the reveal flow, injectable for tests. */
export interface DbLocationDeps {
  getPath: () => Promise<string>;
  reveal: (path: string) => Promise<void>;
  /** Opens the database folder; Rust resolves the path itself. */
  openDir: () => Promise<void>;
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
    await deps.openDir();
  }
  return path;
}

/** Production deps backed by the Tauri runtime (commands + opener plugin). */
export function tauriDbLocationDeps(): DbLocationDeps {
  return {
    getPath: () => invoke<string>("db_file_path"),
    reveal: (path) => revealItemInDir(path),
    openDir: () => invoke("open_db_dir"),
  };
}
