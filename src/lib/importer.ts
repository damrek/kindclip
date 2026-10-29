import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getDb, importParsedClippings, type DbPort } from "./db";
import type { ClippingDto, ImportReport } from "./types";

/** Seams of the import flow, injectable for tests. */
export interface ImportDeps {
  pickFile: () => Promise<string | null>;
  parseFile: (path: string) => Promise<ParsedFileDto>;
  getPort: () => Promise<DbPort>;
}

/** A parsed file as returned by the `parse_clippings_file` command. */
export interface ParsedFileDto {
  path: string;
  fileHash: string;
  clippings: ClippingDto[];
  skipped: number;
}

export type ImportOutcome =
  | { status: "cancelled" }
  | { status: "empty"; path: string; skipped: number }
  | { status: "done"; report: ImportReport };

/** S1+S5: pick a file, parse it in Rust, persist fresh clippings with dedupe. */
export async function runImportFlow(
  deps: ImportDeps,
  onProgress: (done: number, total: number) => void,
): Promise<ImportOutcome> {
  const path = await deps.pickFile();
  if (path === null) {
    return { status: "cancelled" };
  }
  const parsed = await deps.parseFile(path);
  if (parsed.clippings.length === 0) {
    return { status: "empty", path, skipped: parsed.skipped };
  }
  const port = await deps.getPort();
  const report = await importParsedClippings(
    port,
    { path: parsed.path, fileHash: parsed.fileHash, clippings: parsed.clippings, skipped: parsed.skipped },
    onProgress,
  );
  return { status: "done", report };
}

/** Production deps backed by the Tauri runtime (dialog + Rust command). */
export function tauriImportDeps(): ImportDeps {
  return {
    pickFile: async () => {
      const selected = await open({
        multiple: false,
        title: "Importar My Clippings.txt",
        filters: [{ name: "Texto", extensions: ["txt"] }],
      });
      return typeof selected === "string" ? selected : null;
    },
    parseFile: async (path: string) => {
      const parsed = await invoke<{
        path: string;
        file_hash: string;
        clippings: ClippingDto[];
        skipped: number;
      }>("parse_clippings_file", { path });
      return { path: parsed.path, fileHash: parsed.file_hash, clippings: parsed.clippings, skipped: parsed.skipped };
    },
    getPort: () => getDb(),
  };
}
