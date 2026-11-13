/** Row actions that write through the database and patch the visible list:
 * copy, favorite, tags, note edits and the reset confirmation.
 *
 * Every optimistic patch keeps the previous chips so a failed write restores
 * exactly what was on screen, and a write that removes a row from the active
 * filter reloads the list instead of leaving a stale card behind. */
import { describeError } from "../errors";
import {
  addClippingTag,
  getDb,
  ensureTag,
  listTags,
  removeClippingTag,
  resetNote,
  toggleFavorite,
  updateNote,
  type DbPort,
  type TagCount,
} from "../db";
import {
  applyFavoriteToggle,
  applyNoteEdit,
  copyClippingContent,
  formatQuoteCitation,
  withTag,
  withoutTag,
} from "../library";
import { nowIso } from "../time";
import type { ClippingRow, Tag } from "../types";
import type { ClippingList } from "./catalog.svelte";

export interface CopyFlash {
  id: number;
  kind: "content" | "quote";
}

export interface ClippingActionsDeps {
  getPort: () => Promise<DbPort>;
  /** Visible list the actions patch in place. */
  list: ClippingList;
  /** Reload the current page (filter and sort included). */
  reload: () => Promise<void>;
  favoritesOnly: () => boolean;
  editedOnly: () => boolean;
  selectedTagIds: () => number[];
  /** Row shown in the reading view, for its quote button. */
  readingRow: () => ClippingRow | null;
  /** Fresh tag counts after a tag write. */
  setTags: (tags: TagCount[]) => void;
  /** Clipboard write; the default talks to the Tauri plugin. */
  copyText?: (text: string) => Promise<void>;
}

const writeClipboard = async (text: string): Promise<void> => {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
  await writeText(text);
};

/** Production wiring: the shared connection; the rest stays injectable. */
export function createClippingActions(
  deps: Omit<ClippingActionsDeps, "getPort">,
): ClippingActions {
  return new ClippingActions({ ...deps, getPort: () => getDb() });
}

export class ClippingActions {
  /** Which copy action just succeeded, for its 1.5 s check mark. */
  copyFlash = $state<CopyFlash | null>(null);
  /** Note pending reset confirmation (dialog rendered at app root). */
  resetTarget = $state<ClippingRow | null>(null);
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ClippingActionsDeps) {}

  async copyContent(id: number): Promise<void> {
    const target = this.deps.list.result?.items.find((item) => item.id === id);
    const text = target ? (target.content_edited ?? target.content) : null;
    if (!text) return;
    const ok = await copyClippingContent(this.#copy(), text);
    if (ok) {
      this.#flash(id, "content");
    }
  }

  /** Markdown quote with author, book and page, for the clipboard. */
  async copyQuote(id: number): Promise<void> {
    const target =
      this.deps.list.result?.items.find((item) => item.id === id) ??
      (this.deps.readingRow()?.id === id ? this.deps.readingRow() : null);
    if (!target) return;
    const text = formatQuoteCitation(target);
    if (text === null) return;
    const ok = await copyClippingContent(this.#copy(), text);
    if (ok) {
      this.#flash(id, "quote");
    }
  }

  copyReadingQuote(): void {
    const row = this.deps.readingRow();
    if (row) {
      void this.copyQuote(row.id);
    }
  }

  async toggleStar(id: number): Promise<void> {
    const list = this.deps.list;
    const current = list.result?.items.find((item) => item.id === id);
    if (!current || !list.result) return;
    const next = !current.favorite;
    list.result = { ...list.result, items: applyFavoriteToggle(list.result.items, id, next) };
    try {
      const port = await this.deps.getPort();
      const confirmed = await toggleFavorite(port, id);
      if (list.result) {
        list.result = {
          ...list.result,
          items: applyFavoriteToggle(list.result.items, id, confirmed),
        };
      }
      if (this.deps.favoritesOnly() && !confirmed) {
        // The unstarred card no longer belongs to this view.
        await this.deps.reload();
      }
    } catch (error) {
      if (list.result) {
        list.result = {
          ...list.result,
          items: applyFavoriteToggle(list.result.items, id, current.favorite),
        };
      }
      list.error = describeError(error);
    }
  }

  /** Assign a tag to a clipping, creating it by name when needed (S3). */
  async addTag(id: number, name: string): Promise<boolean> {
    const current = this.deps.list.result?.items.find((item) => item.id === id);
    const clean = name.trim();
    if (!current || clean === "") return false;
    if (current.tags.some((tag) => tag.name.toLowerCase() === clean.toLowerCase())) {
      return false;
    }
    const before = current.tags;
    const tempId = -Date.now();
    this.#patchTags(id, (tags) => withTag(tags, { id: tempId, name: clean }));
    try {
      const port = await this.deps.getPort();
      const tagId = await ensureTag(port, clean);
      if (tagId === null) {
        this.#patchTags(id, () => before);
        return false;
      }
      await addClippingTag(port, id, tagId);
      const tags = await listTags(port);
      this.deps.setTags(tags);
      const canonical = tags.find((tag) => tag.id === tagId)?.name ?? clean;
      this.#patchTags(id, (tags2) =>
        withTag(withoutTag(tags2, tempId), { id: tagId, name: canonical }),
      );
      return true;
    } catch (error) {
      this.#patchTags(id, () => before);
      this.deps.list.error = describeError(error);
      return false;
    }
  }

  /** Remove one tag from a clipping, reverting the chip on failure (S3). */
  async removeTag(id: number, tagId: number): Promise<boolean> {
    const current = this.deps.list.result?.items.find((item) => item.id === id);
    if (!current || !current.tags.some((tag) => tag.id === tagId)) return false;
    const before = current.tags;
    this.#patchTags(id, (tags) => withoutTag(tags, tagId));
    try {
      const port = await this.deps.getPort();
      await removeClippingTag(port, id, tagId);
      this.deps.setTags(await listTags(port));
      if (this.deps.selectedTagIds().includes(tagId)) {
        // The card no longer carries every selected tag.
        await this.deps.reload();
      }
      return true;
    } catch (error) {
      this.#patchTags(id, () => before);
      this.deps.list.error = describeError(error);
      return false;
    }
  }

  /** Overlay note edit (V2): reconciled write, then patch the visible row. */
  async editNote(id: number, content: string): Promise<boolean> {
    const list = this.deps.list;
    if (!list.result) return false;
    try {
      const port = await this.deps.getPort();
      const confirmed = await updateNote(port, id, content);
      if (confirmed && list.result) {
        list.result = {
          ...list.result,
          items: applyNoteEdit(list.result.items, id, {
            content_edited: content,
            edited_at: nowIso(),
          }),
        };
      }
      return confirmed;
    } catch (error) {
      list.error = describeError(error);
      return false;
    }
  }

  async resetNoteToOriginal(id: number): Promise<boolean> {
    const list = this.deps.list;
    if (!list.result) return false;
    try {
      const port = await this.deps.getPort();
      const confirmed = await resetNote(port, id);
      if (confirmed && list.result) {
        list.result = {
          ...list.result,
          items: applyNoteEdit(list.result.items, id, { content_edited: null, edited_at: null }),
        };
        if (this.deps.editedOnly()) {
          // The reset note no longer belongs to this view.
          await this.deps.reload();
        }
      }
      return confirmed;
    } catch (error) {
      list.error = describeError(error);
      return false;
    }
  }

  /** Open the reset confirmation dialog for a note (rendered at app root). */
  requestReset(id: number): void {
    this.resetTarget = this.deps.list.result?.items.find((item) => item.id === id) ?? null;
  }

  /** Close the dialog without writing. Returns false when already closed. */
  closeReset(): boolean {
    if (this.resetTarget === null) return false;
    this.resetTarget = null;
    return true;
  }

  async confirmReset(): Promise<void> {
    const target = this.resetTarget;
    if (target === null) return;
    if (await this.resetNoteToOriginal(target.id)) {
      this.resetTarget = null;
    }
  }

  #copy(): (text: string) => Promise<void> {
    return this.deps.copyText ?? writeClipboard;
  }

  #flash(id: number, kind: CopyFlash["kind"]): void {
    this.copyFlash = { id, kind };
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.copyFlash = null;
      this.#timer = null;
    }, 1500);
  }

  /** Patch the tag chips of one visible row, leaving the rest untouched. */
  #patchTags(id: number, update: (tags: Tag[]) => Tag[]): void {
    const list = this.deps.list;
    if (!list.result) return;
    list.result = {
      ...list.result,
      items: list.result.items.map((item) =>
        item.id === id ? { ...item, tags: update(item.tags) } : item,
      ),
    };
  }
}
