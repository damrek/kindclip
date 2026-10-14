import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

/** Seams of the reveal flow, injectable for tests. */
export interface DbLocationDeps {
  getPath: () => Promise<string>;
  reveal: (path: string) => Promise<void>;
}

/** Resolve the DB path and reveal it in the system file explorer. Returns the path. */
export async function revealDbLocation(deps: DbLocationDeps): Promise<string> {
  const path = await deps.getPath();
  await deps.reveal(path);
  return path;
}

/** Production deps backed by the Tauri runtime (command + opener plugin). */
export function tauriDbLocationDeps(): DbLocationDeps {
  return {
    getPath: () => invoke<string>("db_file_path"),
    reveal: (path) => revealItemInDir(path),
  };
}
