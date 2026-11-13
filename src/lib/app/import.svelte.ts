/** Import flow: the picker, a native file drop, the progress line and the
 * outcome message. The shell owns the status bar; this module only decides
 * what it should say and when the views must reload. */
import {
  pickDroppedFile,
  runImportFromPath,
  tauriImportDeps,
  type ImportDeps,
  type ImportOutcome,
} from "../importer";
import type { Translate } from "../format";
import type { CountText } from "../i18n";
import { describeError } from "../errors";
import { logger, type Logger } from "../log";

export type ImportRunner = (
  deps: ImportDeps,
  onProgress: (done: number, total: number) => void,
) => Promise<ImportOutcome>;

export interface ImportStateDeps {
  t: Translate;
  /** `3 clippings`, `1 libro`, … for the outcome line. */
  count: CountText;
  /** Production import seams (picker, Rust parser, database port). */
  makeDeps: () => ImportDeps;
  /** Reload the shelf and the list after a successful import. */
  refresh: () => Promise<void>;
  log: Logger;
}

/** Production wiring: the Tauri seams and the diagnostic logger. */
export function createImportState(deps: {
  t: Translate;
  count: CountText;
  refresh: () => Promise<void>;
}): ImportState {
  return new ImportState({ ...deps, makeDeps: tauriImportDeps, log: logger });
}

export class ImportState {
  busy = $state(false);
  /** Files are being dragged over the window (native Tauri drag & drop). */
  dragActive = $state(false);

  constructor(private readonly deps: ImportStateDeps) {}

  /** One import run for both the picker and a native file drop. Every path
   * reports the line the status bar should show; null clears it. */
  async run(
    run: ImportRunner,
    onProgress: (message: string | null) => void,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    onProgress(this.deps.t("import.reading"));
    try {
      const outcome = await run(this.deps.makeDeps(), (done, total) => {
        onProgress(this.deps.t("import.progress", { done, total }));
      });
      if (outcome.status === "cancelled") {
        onProgress(null);
        return;
      }
      if (outcome.status === "empty") {
        this.deps.log.info(`import: no clippings, ${outcome.skipped} skipped`);
        onProgress(
          outcome.skipped > 0
            ? this.deps.t("import.emptySkipped", {
                path: outcome.path,
                skipped: this.deps.count("skipped", outcome.skipped),
              })
            : this.deps.t("import.empty", { path: outcome.path }),
        );
        return;
      }
      const report = outcome.report;
      this.deps.log.info(
        `import: ${report.inserted} inserted, ${report.duplicates} duplicates, ` +
          `${report.skipped} skipped, ${report.bookCount} books`,
      );
      await this.deps.refresh();
      if (report.alreadyImported && report.skipped === 0) {
        onProgress(this.deps.t("import.duplicate"));
        return;
      }
      onProgress(
        report.skipped > 0
          ? this.deps.t("import.doneSkipped", {
              inserted: report.inserted,
              total: report.total,
              duplicates: this.deps.count("duplicate", report.duplicates),
              skipped: this.deps.count("skipped", report.skipped),
              books: this.deps.count("book", report.bookCount),
            })
          : this.deps.t("import.done", {
              inserted: report.inserted,
              total: report.total,
              duplicates: this.deps.count("duplicate", report.duplicates),
              books: this.deps.count("book", report.bookCount),
            }),
      );
    } catch (error) {
      this.deps.log.error("import", error);
      onProgress(this.deps.t("import.error", { message: describeError(error) }));
    } finally {
      this.busy = false;
    }
  }

  /** A native file drop imports the first `.txt` it carries. */
  async drop(
    paths: string[],
    blocked: boolean,
    onProgress: (message: string | null) => void,
  ): Promise<void> {
    if (this.busy || blocked) return;
    const path = pickDroppedFile(paths);
    if (path === null) {
      onProgress(this.deps.t("import.notTxt"));
      return;
    }
    await this.run(
      (deps, progress) => runImportFromPath(deps, path, progress),
      onProgress,
    );
  }
}
