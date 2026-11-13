/** Export flow: the dialog state and the two native writes (one file, or one
 * Markdown file per book), with the overwrite confirmation and the outcome
 * line in one place. */
import { save } from "@tauri-apps/plugin-dialog";
import { AsyncTask } from "../asyncTask.svelte";
import { describeError } from "../errors";
import {
  EXPORT_EXTENSIONS,
  exportFileName,
  groupRowsByBook,
  planBookFileNames,
  serializeBookMarkdown,
  serializeCsv,
  serializeJson,
  serializeMarkdown,
  type ExportFormat,
} from "../exporter";
import type { Translate } from "../format";
import type { Locale } from "../i18n";
import type { Logger } from "../log";
import type { ClippingRow } from "../types";

/** One native write the per-book export performs. */
export interface ExportFilePayload {
  name: string;
  contents: string;
}

/** Native seams of the export flow, one method per external effect. */
export interface ExportBackend {
  pickFolder: (title: string) => Promise<string | null>;
  checkTargets: (dir: string, names: string[]) => Promise<string[]>;
  confirmReplace: (message: string, title: string) => Promise<boolean>;
  writeFiles: (dir: string, files: ExportFilePayload[]) => Promise<number>;
  defaultPath: (fileName: string) => Promise<string>;
  saveFile: (defaultPath: string, extension: string) => Promise<string | null>;
  writeFile: (path: string, contents: string) => Promise<void>;
}

/** Wrap the plugin save dialog; the other seams come straight from the shell. */
export function saveDialog(
  defaultPath: string,
  extension: string,
): Promise<string | null> {
  return save({
    defaultPath,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  }).then((path) => (typeof path === "string" ? path : null));
}

export interface ExportStateDeps {
  /** Rows the export writes, already filtered and sorted. */
  loadRows: () => Promise<ClippingRow[]>;
  t: Translate;
  locale: () => Locale;
  /** Book that scopes the export, when the sidebar has one selected. */
  bookId: () => number | null;
  /** Title of that book, used in the suggested file name. */
  bookTitle: (bookId: number | null) => string | null;
  /** False when the current result holds no rows. */
  canExport: () => boolean;
  now: () => Date;
  backend: ExportBackend;
  log: Logger;
}

export class ExportState {
  open = $state(false);
  readonly task: AsyncTask;

  constructor(private readonly deps: ExportStateDeps) {
    this.task = new AsyncTask(deps.log.error);
  }

  /** Status line: a failure wins over the last success message. */
  get message(): string | null {
    return this.task.error ?? this.task.status;
  }

  /** Open the export dialog from the header (clears the previous outcome). */
  openDialog(): boolean {
    if (!this.deps.canExport()) return false;
    this.task.clear();
    this.open = true;
    return true;
  }

  close(): void {
    this.open = false;
  }

  /** Filtered rows → serializer → native save dialog → Rust write. */
  async run(format: ExportFormat, includeOriginal: boolean, perBook: boolean): Promise<void> {
    await this.task.run(async () => {
      const rows = await this.deps.loadRows();
      if (format === "markdown" && perBook) {
        await this.#oneFilePerBook(rows, includeOriginal);
        return;
      }
      const bookId = this.deps.bookId();
      const fileName = exportFileName(format, this.deps.bookTitle(bookId));
      const text =
        format === "markdown"
          ? serializeMarkdown(rows, {
              includeOriginal,
              locale: this.deps.locale(),
              t: this.deps.t,
            })
          : format === "json"
            ? serializeJson(rows)
            : serializeCsv(rows);
      const extension = EXPORT_EXTENSIONS[format];
      const defaultPath = await this.deps.backend.defaultPath(fileName);
      const path = await this.deps.backend.saveFile(defaultPath, extension);
      if (path === null) return; // Cancelled: the dialog stays open.
      await this.deps.backend.writeFile(path, text);
      this.deps.log.info(`export: wrote ${format} with ${rows.length} clippings`);
      this.task.status = this.deps.t("export.done", { count: rows.length, file: fileName });
      this.close();
    }, {
      describe: (cause) => this.deps.t("export.error", { message: describeError(cause) }),
      scope: "export",
    });
  }

  /** S6/S7: one Markdown file per book into a chosen folder. */
  async #oneFilePerBook(rows: ClippingRow[], includeOriginal: boolean): Promise<void> {
    const groups = groupRowsByBook(rows);
    if (groups.length === 0) return;
    const names = planBookFileNames(groups);
    const folder = await this.deps.backend.pickFolder(this.deps.t("export.folderPrompt"));
    if (folder === null) return; // Cancelled: the dialog stays open.
    const existing = await this.deps.backend.checkTargets(folder, names);
    if (existing.length > 0) {
      const replace = await this.deps.backend.confirmReplace(
        this.deps.t("export.overwrite", { count: existing.length }),
        this.deps.t("export.title"),
      );
      if (!replace) return;
    }
    const now = this.deps.now();
    const files = groups.map((group, index) => ({
      name: names[index],
      contents: serializeBookMarkdown(group.rows, {
        includeOriginal,
        locale: this.deps.locale(),
        t: this.deps.t,
        now,
      }),
    }));
    await this.deps.backend.writeFiles(folder, files);
    this.deps.log.info(
      `export: wrote ${groups.length} per-book markdown files with ${rows.length} clippings to '${folder}'`,
    );
    this.task.status = this.deps.t("export.doneFolder", {
      count: rows.length,
      books: groups.length,
      folder,
    });
    this.close();
  }
}
