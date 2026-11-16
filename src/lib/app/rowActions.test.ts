import { describe, expect, it, vi } from "vitest";
import { RowActions, type RenameOutcome } from "./rowActions.svelte";

interface Row {
  id: number;
  name: string;
  extra: string;
}

interface Draft {
  name: string;
  extra: string;
}

const row = (id: number, name: string, extra = ""): Row => ({ id, name, extra });

function make(
  script: Partial<{
    rename: (target: Row, draft: Draft) => Promise<RenameOutcome | null>;
    merge: (sourceId: number, targetId: number) => Promise<boolean>;
    remove: (target: Row) => Promise<boolean>;
    onCancel: () => void;
  }> = {},
) {
  const rename = vi.fn(script.rename ?? (async () => ({ status: "renamed" as const })));
  const merge = vi.fn(script.merge ?? (async () => true));
  const remove = vi.fn(script.remove ?? (async () => true));
  const onCancel = vi.fn(script.onCancel ?? (() => {}));
  const actions = new RowActions<Row, Draft>({
    draftOf: (target) => ({ name: target.name, extra: target.extra }),
    rename,
    merge,
    remove,
    onCancel,
  });
  return { actions, rename, merge, remove, onCancel };
}

describe("RowActions", () => {
  it("seeds the draft and closes the other row panels on rename", () => {
    const { actions } = make();
    actions.startMerge(row(2, "otro"));

    actions.startRename(row(1, "Uno", "Autor"));

    expect(actions.renameTarget?.id).toBe(1);
    expect(actions.draft).toEqual({ name: "Uno", extra: "Autor" });
    expect(actions.mergeSourceId).toBeNull();
    expect(actions.deleteTarget).toBeNull();
  });

  it("closes the form after a successful rename", async () => {
    const { actions, rename } = make();
    actions.startRename(row(1, "Uno"));

    await actions.saveRename();

    expect(rename).toHaveBeenCalledWith(row(1, "Uno"), { name: "Uno", extra: "" });
    expect(actions.renameTarget).toBeNull();
  });

  it("turns a taken name into a merge offer and closes the form", async () => {
    const { actions } = make({
      rename: async () => ({ status: "merge-required", existingId: 7 }),
    });
    actions.startRename(row(1, "Uno"));

    await actions.saveRename();

    expect(actions.renameTarget).toBeNull();
    expect(actions.mergeOffer).toEqual({ sourceId: 1, targetId: 7 });
  });

  it("keeps the form open when the write is refused or cancelled", async () => {
    for (const outcome of [null, { status: "invalid" } as RenameOutcome]) {
      const { actions } = make({ rename: async () => outcome });
      actions.startRename(row(1, "Uno"));

      await actions.saveRename();

      expect(actions.renameTarget?.id).toBe(1);
      expect(actions.mergeOffer).toBeNull();
    }
  });

  it("drops the merge offer only when the merge lands", async () => {
    const { actions, merge } = make({ merge: async () => false });
    actions.mergeOffer = { sourceId: 1, targetId: 7 };

    await actions.confirmMergeOffer();

    expect(merge).toHaveBeenCalledWith(1, 7);
    expect(actions.mergeOffer).toEqual({ sourceId: 1, targetId: 7 });
  });

  it("needs a merge target and clears both ids when the merge lands", async () => {
    const { actions, merge } = make();
    actions.startMerge(row(1, "Uno"));
    await actions.confirmMerge();
    expect(merge).not.toHaveBeenCalled();

    actions.mergeTargetId = 2;
    await actions.confirmMerge();

    expect(merge).toHaveBeenCalledWith(1, 2);
    expect(actions.mergeSourceId).toBeNull();
    expect(actions.mergeTargetId).toBeNull();
  });

  it("keeps the row visible when its delete fails", async () => {
    const { actions, remove } = make({ remove: async () => false });
    actions.startDelete(row(3, "Tres"));

    await actions.confirmDelete();

    expect(remove).toHaveBeenCalledWith(row(3, "Tres"));
    expect(actions.deleteTarget?.id).toBe(3);
  });

  it("closes the caller's extra panels on cancel and after a successful rename", async () => {
    const { actions, onCancel } = make();
    actions.startRename(row(1, "Uno"));

    await actions.saveRename();
    expect(onCancel).toHaveBeenCalledTimes(1);

    actions.startRename(row(2, "Dos"));
    actions.cancel();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("leaves the caller's extra panels alone when the rename is refused", async () => {
    const { actions, onCancel } = make({
      rename: async () => ({ status: "merge-required", existingId: 2 }),
    });
    actions.startRename(row(1, "Uno"));

    await actions.saveRename();

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("ignores a second submit while the first write is in flight", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { actions, rename } = make({
      rename: async () => {
        await gate;
        return { status: "renamed" };
      },
    });
    actions.startRename(row(1, "Uno"));

    const first = actions.saveRename();
    const second = actions.saveRename();
    expect(actions.busy).toBe(true);
    release();
    await Promise.all([first, second]);

    expect(rename).toHaveBeenCalledTimes(1);
    expect(actions.busy).toBe(false);
  });
});
