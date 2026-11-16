/** Rename, merge and delete state for one list of rows in the library dialog.
 *
 * Books and tags run the same review flow over different entities: seed a
 * draft, submit the rename, offer a merge when the name is taken, confirm the
 * merge, confirm a delete. Only the row type, the draft shape and the three
 * writes differ, so the flow lives here once and each list supplies its
 * wiring. The extra field of the draft (a book's author) stays owned by the
 * caller through its draft type. */

/** Normalized rename result; the caller maps its own result shape onto it. */
export type RenameOutcome =
  | { status: "renamed" }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "merge-required"; existingId: number };

export interface MergeOffer {
  sourceId: number;
  targetId: number;
}

export interface RowActionsConfig<T extends { id: number }, D> {
  /** Draft shown in the rename form for one row. */
  draftOf: (row: T) => D;
  rename: (row: T, draft: D) => Promise<RenameOutcome | null>;
  merge: (sourceId: number, targetId: number) => Promise<boolean>;
  remove: (row: T) => Promise<boolean>;
  /** Caller-owned panels a cancel must close too (e.g. the file list). */
  onCancel?: () => void;
}

export class RowActions<T extends { id: number }, D> {
  /** Row whose rename form is open; null when the form is closed. */
  renameTarget = $state<T | null>(null);
  /** Live form draft; seeded by `startRename` before the form renders. */
  draft = $state<D>({} as D);
  /** Row picked as the merge source; its row shows the target picker. */
  mergeSourceId = $state<number | null>(null);
  mergeTargetId = $state<number | null>(null);
  /** Rename hit an existing name: the panel offers to merge into it. */
  mergeOffer = $state<MergeOffer | null>(null);
  /** Row behind the delete confirmation panel. */
  deleteTarget = $state<T | null>(null);
  /** One write at a time, whatever its kind. */
  busy = $state(false);

  constructor(private readonly config: RowActionsConfig<T, D>) {}

  startRename(row: T): void {
    this.renameTarget = row;
    this.draft = this.config.draftOf(row);
    this.mergeSourceId = null;
    this.mergeTargetId = null;
    this.mergeOffer = null;
    this.deleteTarget = null;
  }

  /** Close every row panel; `onCancel` closes the caller's own extras. */
  cancel(): void {
    this.renameTarget = null;
    this.mergeSourceId = null;
    this.mergeTargetId = null;
    this.mergeOffer = null;
    this.deleteTarget = null;
    this.config.onCancel?.();
  }

  async saveRename(): Promise<void> {
    const target = this.renameTarget;
    if (target === null || this.busy) return;
    this.busy = true;
    try {
      const result = await this.config.rename(target, this.draft);
      if (result === null) return;
      if (result.status === "merge-required") {
        this.mergeOffer = { sourceId: target.id, targetId: result.existingId };
        this.renameTarget = null;
        return;
      }
      if (result.status === "renamed") {
        this.cancel();
      }
    } finally {
      this.busy = false;
    }
  }

  async confirmMergeOffer(): Promise<void> {
    const offer = this.mergeOffer;
    if (offer === null || this.busy) return;
    this.busy = true;
    try {
      if (await this.config.merge(offer.sourceId, offer.targetId)) {
        this.mergeOffer = null;
      }
    } finally {
      this.busy = false;
    }
  }

  startMerge(row: T): void {
    this.mergeSourceId = row.id;
    this.mergeTargetId = null;
    this.renameTarget = null;
    this.deleteTarget = null;
  }

  async confirmMerge(): Promise<void> {
    const sourceId = this.mergeSourceId;
    const targetId = this.mergeTargetId;
    if (sourceId === null || targetId === null || this.busy) return;
    this.busy = true;
    try {
      if (await this.config.merge(sourceId, targetId)) {
        this.mergeSourceId = null;
        this.mergeTargetId = null;
      }
    } finally {
      this.busy = false;
    }
  }

  startDelete(row: T): void {
    this.deleteTarget = row;
    this.renameTarget = null;
    this.mergeSourceId = null;
    this.mergeTargetId = null;
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget;
    if (target === null || this.busy) return;
    this.busy = true;
    try {
      if (await this.config.remove(target)) {
        this.deleteTarget = null;
      }
    } finally {
      this.busy = false;
    }
  }
}
