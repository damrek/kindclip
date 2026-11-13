/** The library-management dialog: imported files, book/tag rename, merge and
 * delete, with one busy/error policy for all of them.
 *
 * Every mutation is a children-first multi-step write, so a failure reloads
 * the real state before reporting it; the caller supplies the refresh that
 * touches the books, the list and the tags. */
import {
  deleteBook,
  deleteTag,
  listImportedFiles,
  mergeBooks,
  mergeTags,
  removeImportedFile,
  renameBook,
  renameTag,
  type DbPort,
  type ImportedFile,
  type RenameBookResult,
  type RenameTagResult,
  type TagCount,
} from "../db";
import { describeError } from "../errors";
import type { Translate } from "../format";
import type { Book } from "../types";

export interface LibraryDeps {
  getPort: () => Promise<DbPort>;
  t: Translate;
  /** Reload the views a mutation can affect: books, list and tags. */
  refresh: () => Promise<void>;
  /** Drop a tag id from the active filter after a merge or a delete. */
  onTagRemoved: (tagId: number) => void;
  log: (scope: string, error: unknown) => void;
}

export class LibraryPanel {
  open = $state(false);
  busy = $state(false);
  files = $state<ImportedFile[]>([]);
  status = $state<string | null>(null);
  error = $state<string | null>(null);

  constructor(private readonly deps: LibraryDeps) {}

  async show(): Promise<void> {
    this.status = null;
    this.error = null;
    this.open = true;
    await this.loadFiles();
  }

  close(): void {
    this.open = false;
  }

  async loadFiles(): Promise<void> {
    try {
      const port = await this.deps.getPort();
      this.files = await listImportedFiles(port);
    } catch (cause) {
      this.error = this.deps.t("library.error", { message: describeError(cause) });
      this.deps.log("library-load", cause);
    }
  }

  async rename(
    bookId: number,
    title: string,
    author: string,
  ): Promise<RenameBookResult | null> {
    const result = await this.#run((port) => renameBook(port, bookId, title, author));
    if (result?.status === "renamed") {
      this.status = this.deps.t("library.statusRenamed");
      await this.#refresh();
    }
    return result;
  }

  async merge(sourceId: number, targetId: number): Promise<boolean> {
    const result = await this.#run((port) => mergeBooks(port, sourceId, targetId));
    if (result?.status !== "merged") {
      return false;
    }
    this.status = this.deps.t("library.statusMerged", { count: result.moved });
    await this.#refresh();
    return true;
  }

  async removeBook(book: Book): Promise<boolean> {
    const removed = await this.#run((port) => deleteBook(port, book.id));
    if (removed === null) {
      return false;
    }
    this.status = this.deps.t("library.statusDeleted", { count: removed });
    await this.#refresh();
    return true;
  }

  async removeFile(file: ImportedFile): Promise<boolean> {
    const result = await this.#run((port) => removeImportedFile(port, file.id));
    if (result === null) {
      return false;
    }
    this.status = this.deps.t("library.statusRemoved", {
      clippings: result.clippings,
      books: result.books,
    });
    await this.#refresh();
    return true;
  }

  async renameTag(tagId: number, name: string): Promise<RenameTagResult | null> {
    const result = await this.#run((port) => renameTag(port, tagId, name));
    if (result?.status === "renamed") {
      this.status = this.deps.t("library.statusTagRenamed");
      await this.#refresh();
    }
    return result;
  }

  async mergeTags(sourceId: number, targetId: number): Promise<boolean> {
    const result = await this.#run((port) => mergeTags(port, sourceId, targetId));
    if (result?.status !== "merged") {
      return false;
    }
    this.status = this.deps.t("library.statusTagsMerged", { count: result.moved });
    // The source tag is gone: it must leave the active filter too.
    this.deps.onTagRemoved(sourceId);
    await this.#refresh();
    return true;
  }

  async removeTag(tag: TagCount): Promise<boolean> {
    const done = await this.#run(async (port) => {
      await deleteTag(port, tag.id);
      return true;
    });
    if (done === null) {
      return false;
    }
    this.status = this.deps.t("library.statusTagDeleted");
    // A deleted tag must leave the active filter too.
    this.deps.onTagRemoved(tag.id);
    await this.#refresh();
    return true;
  }

  /** One policy for every mutation: busy flag, translated error, and a reload
   * after a failure so a partially applied write shows the real state. */
  async #run<T>(action: (port: DbPort) => Promise<T>): Promise<T | null> {
    this.busy = true;
    this.error = null;
    try {
      return await action(await this.deps.getPort());
    } catch (cause) {
      this.error = this.deps.t("library.error", { message: describeError(cause) });
      await this.#refresh();
      return null;
    } finally {
      this.busy = false;
    }
  }

  async #refresh(): Promise<void> {
    await this.deps.refresh();
    await this.loadFiles();
  }
}
