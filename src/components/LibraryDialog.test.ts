// @vitest-environment jsdom
/** Wiring of the library dialog: which control runs which write, and the
 * panel exclusion between the book list and the imported files.
 *
 * These behaviours live in the component template and its local panels, so no
 * unit test could reach them before this file: svelte-check types the handlers
 * but never proves that a button calls the action it looks like it calls. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  setup,
  waitFor,
  within,
} from "@testing-library/svelte";
import type { RenameBookResult, RenameTagResult } from "../lib/db";
import type { ImportedFile, TagCount } from "../lib/db";
import type { Book } from "../lib/types";
import { I18N_CONTEXT_KEY } from "../lib/i18n";
import { installDomStubs, testI18n } from "../test/component";
import LibraryDialog from "./LibraryDialog.svelte";

interface DialogProps {
  books: Book[];
  files: ImportedFile[];
  tags: TagCount[];
  busy: boolean;
  status: string | null;
  error: string | null;
  onClose: () => void;
  onRename: (bookId: number, title: string, author: string) => Promise<RenameBookResult | null>;
  onMerge: (sourceId: number, targetId: number) => Promise<boolean>;
  onDeleteBook: (book: Book) => Promise<boolean>;
  onRemoveFile: (file: ImportedFile) => Promise<boolean>;
  onRenameTag: (tagId: number, name: string) => Promise<RenameTagResult | null>;
  onMergeTags: (sourceId: number, targetId: number) => Promise<boolean>;
  onDeleteTag: (tag: TagCount) => Promise<boolean>;
}

const books: Book[] = [
  { id: 1, title: "Alpha", author: "Ann", clipping_count: 3 },
  { id: 2, title: "Beta", author: null, clipping_count: 1 },
];
const files: ImportedFile[] = [
  { id: 10, path: "/tmp/alpha.txt", imported_at: "2026-01-02T03:04:05Z", clipping_count: 3 },
];
const tags: TagCount[] = [
  { id: 5, name: "focus", clipping_count: 2 },
  { id: 6, name: "later", clipping_count: 1 },
];

/** Render the dialog with every write stubbed; each test overrides what it needs. */
function renderDialog(overrides: Partial<DialogProps> = {}) {
  const mocks = {
    onClose: vi.fn((): void => {}),
    onRename: vi.fn(async (): Promise<RenameBookResult | null> => ({ status: "renamed" })),
    onMerge: vi.fn(async (): Promise<boolean> => true),
    onDeleteBook: vi.fn(async (): Promise<boolean> => true),
    onRemoveFile: vi.fn(async (): Promise<boolean> => true),
    onRenameTag: vi.fn(async (): Promise<RenameTagResult | null> => ({ status: "renamed" })),
    onMergeTags: vi.fn(async (): Promise<boolean> => true),
    onDeleteTag: vi.fn(async (): Promise<boolean> => true),
  };
  const props = {
    books,
    files,
    tags,
    busy: false,
    status: null,
    error: null,
    ...mocks,
    ...overrides,
  };
  render(LibraryDialog, { props, context: new Map([[I18N_CONTEXT_KEY, testI18n()]]) });
  return mocks;
}

function rowOf(text: string): HTMLElement {
  return screen.getByTitle(text).closest("li") as HTMLElement;
}

beforeAll(installDomStubs);
beforeEach(async () => {
  await setup();
});
afterEach(cleanup);

describe("LibraryDialog book and file wiring", () => {
  it("seeds the book rename form from the row and saves through onRename", async () => {
    const mocks = renderDialog();
    const row = rowOf("Alpha");

    await fireEvent.click(within(row).getByRole("button", { name: "Rename" }));

    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Alpha");
    expect((screen.getByLabelText("Author") as HTMLInputElement).value).toBe("Ann");

    await fireEvent.input(screen.getByLabelText("Title"), { target: { value: "Alpha II" } });
    await fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.onRename).toHaveBeenCalledWith(1, "Alpha II", "Ann"));
    await waitFor(() => expect(screen.queryByLabelText("Title")).toBeNull());
  });

  it("closes the file-removal panel when a book rename succeeds", async () => {
    renderDialog();
    const row = rowOf("Alpha");
    await fireEvent.click(within(row).getByRole("button", { name: "Rename" }));

    await fireEvent.click(screen.getByRole("button", { name: "Imported files" }));
    await fireEvent.click(
      within(screen.getByTitle("/tmp/alpha.txt").closest("li") as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    );
    expect(screen.getByText(/Remove the import of \/tmp\/alpha.txt/)).not.toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Books" }));
    // Switching tabs unmounts the row, so find the reopened form by its button.
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByText(/Remove the import of/)).toBeNull());
  });

  it("closes the tag delete panel when a file removal starts", async () => {
    renderDialog();
    await fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    await fireEvent.click(within(rowOf("focus")).getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/Delete the tag “focus”/)).not.toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Imported files" }));
    await fireEvent.click(
      within(screen.getByTitle("/tmp/alpha.txt").closest("li") as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    );

    expect(screen.queryByText(/Delete the tag “focus”/)).toBeNull();
    expect(screen.getByText(/Remove the import of/)).not.toBeNull();
  });

  it("closes the book delete panel when a file removal starts", async () => {
    renderDialog();
    await fireEvent.click(within(rowOf("Alpha")).getByRole("button", { name: "Delete" }));
    expect(screen.getByText(/Delete “Alpha”/)).not.toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Imported files" }));
    await fireEvent.click(
      within(screen.getByTitle("/tmp/alpha.txt").closest("li") as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    );

    expect(screen.queryByText(/Delete “Alpha”/)).toBeNull();
    expect(screen.getByText(/Remove the import of/)).not.toBeNull();
  });

  it("offers a merge when the rename collides and merges into the existing book", async () => {
    const onRename = vi.fn(async (): Promise<RenameBookResult | null> => ({
      status: "merge-required",
      existingBookId: 2,
    }));
    const mocks = renderDialog({ onRename });

    const row = rowOf("Alpha");
    await fireEvent.click(within(row).getByRole("button", { name: "Rename" }));
    await fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("A book with that title and author already exists.")).not.toBeNull(),
    );
    expect(screen.queryByLabelText("Title")).toBeNull();

    await fireEvent.click(screen.getByRole("button", { name: "Merge into that book" }));

    await waitFor(() => expect(mocks.onMerge).toHaveBeenCalledWith(1, 2));
    await waitFor(() =>
      expect(screen.queryByText("A book with that title and author already exists.")).toBeNull(),
    );
  });

  it("merges a book into the picked target", async () => {
    const mocks = renderDialog();

    await fireEvent.click(within(rowOf("Alpha")).getByRole("button", { name: "Merge" }));
    const picker = screen.getByLabelText("Merge into");
    await fireEvent.change(picker, { target: { value: "2" } });
    const panel = picker.parentElement?.parentElement as HTMLElement;
    await fireEvent.click(within(panel).getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(mocks.onMerge).toHaveBeenCalledWith(1, 2));
  });

  it("deletes the book behind the confirmation panel", async () => {
    const mocks = renderDialog();

    await fireEvent.click(within(rowOf("Alpha")).getByRole("button", { name: "Delete" }));
    const panel = screen.getByText(/Delete “Alpha”/).closest("div") as HTMLElement;
    await fireEvent.click(within(panel).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.onDeleteBook).toHaveBeenCalledWith(books[0]));
    await waitFor(() => expect(screen.queryByText(/Delete “Alpha”/)).toBeNull());
  });

  it("removes the imported file behind its confirmation panel", async () => {
    const mocks = renderDialog();
    await fireEvent.click(screen.getByRole("button", { name: "Imported files" }));

    const row = screen.getByTitle("/tmp/alpha.txt").closest("li") as HTMLElement;
    await fireEvent.click(within(row).getByRole("button", { name: "Remove" }));
    const panel = screen.getByText(/Remove the import of/).closest("div") as HTMLElement;
    await fireEvent.click(within(panel).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.onRemoveFile).toHaveBeenCalledWith(files[0]));
    await waitFor(() => expect(screen.queryByText(/Remove the import of/)).toBeNull());
  });
});

describe("LibraryDialog tag wiring", () => {
  it("seeds the tag rename form and saves through onRenameTag", async () => {
    const mocks = renderDialog();
    await fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    const row = rowOf("focus");

    await fireEvent.click(within(row).getByRole("button", { name: "Rename" }));
    expect((screen.getByLabelText("Tag") as HTMLInputElement).value).toBe("focus");
    await fireEvent.input(screen.getByLabelText("Tag"), { target: { value: "deep work" } });
    await fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.onRenameTag).toHaveBeenCalledWith(5, "deep work"));
    await waitFor(() => expect(screen.queryByLabelText("Tag")).toBeNull());
  });

  it("offers the tag merge when the name collides and merges into the existing tag", async () => {
    const onRenameTag = vi.fn(async (): Promise<RenameTagResult | null> => ({
      status: "merge-required",
      existingTagId: 6,
    }));
    const mocks = renderDialog({ onRenameTag });
    await fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    const row = rowOf("focus");

    await fireEvent.click(within(row).getByRole("button", { name: "Rename" }));
    await fireEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText("A tag with that name already exists.")).not.toBeNull(),
    );
    await fireEvent.click(screen.getByRole("button", { name: "Merge into that tag" }));

    await waitFor(() => expect(mocks.onMergeTags).toHaveBeenCalledWith(5, 6));
    await waitFor(() =>
      expect(screen.queryByText("A tag with that name already exists.")).toBeNull(),
    );
  });

  it("deletes the tag behind the confirmation panel", async () => {
    const mocks = renderDialog();
    await fireEvent.click(screen.getByRole("button", { name: "Tags" }));

    await fireEvent.click(within(rowOf("focus")).getByRole("button", { name: "Delete" }));
    const panel = screen.getByText(/Delete the tag “focus”/).closest("div") as HTMLElement;
    await fireEvent.click(within(panel).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mocks.onDeleteTag).toHaveBeenCalledWith(tags[0]));
    await waitFor(() => expect(screen.queryByText(/Delete the tag “focus”/)).toBeNull());
  });
});

describe("LibraryDialog book start paths close the file panel", () => {
  async function openFileRemove(): Promise<void> {
    await fireEvent.click(screen.getByRole("button", { name: "Imported files" }));
    await fireEvent.click(
      within(screen.getByTitle("/tmp/alpha.txt").closest("li") as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    );
    expect(screen.getByText(/Remove the import of \/tmp\/alpha.txt/)).not.toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Books" }));
  }

  it("closes the file-removal panel when a book rename starts", async () => {
    renderDialog();
    await openFileRemove();

    await fireEvent.click(within(rowOf("Alpha")).getByRole("button", { name: "Rename" }));

    expect(screen.queryByText(/Remove the import of/)).toBeNull();
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Alpha");
  });

  it("closes the file-removal panel when a book merge starts", async () => {
    renderDialog();
    await openFileRemove();

    await fireEvent.click(within(rowOf("Alpha")).getByRole("button", { name: "Merge" }));

    expect(screen.queryByText(/Remove the import of/)).toBeNull();
    expect(screen.getByLabelText("Merge into")).not.toBeNull();
  });

  it("closes the file-removal panel when a book delete starts", async () => {
    renderDialog();
    await openFileRemove();

    await fireEvent.click(within(rowOf("Alpha")).getByRole("button", { name: "Delete" }));

    expect(screen.queryByText(/Remove the import of/)).toBeNull();
    expect(screen.getByText(/Delete “Alpha”/)).not.toBeNull();
  });
});

describe("LibraryDialog tag actions close the file panel", () => {
  async function openFileRemove(): Promise<void> {
    await fireEvent.click(screen.getByRole("button", { name: "Imported files" }));
    await fireEvent.click(
      within(screen.getByTitle("/tmp/alpha.txt").closest("li") as HTMLElement).getByRole("button", {
        name: "Remove",
      }),
    );
    expect(screen.getByText(/Remove the import of \/tmp\/alpha.txt/)).not.toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Tags" }));
  }

  it("closes the file-removal panel when a tag rename succeeds", async () => {
    renderDialog();
    await fireEvent.click(screen.getByRole("button", { name: "Tags" }));
    await fireEvent.click(within(rowOf("focus")).getByRole("button", { name: "Rename" }));

    await openFileRemove();
    await fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByText(/Remove the import of/)).toBeNull());
  });

  it("closes the file-removal panel when a tag rename starts", async () => {
    renderDialog();
    await openFileRemove();

    await fireEvent.click(within(rowOf("focus")).getByRole("button", { name: "Rename" }));

    expect(screen.queryByText(/Remove the import of/)).toBeNull();
    expect((screen.getByLabelText("Tag") as HTMLInputElement).value).toBe("focus");
  });

  it("closes the file-removal panel when a tag merge starts", async () => {
    renderDialog();
    await openFileRemove();

    await fireEvent.click(within(rowOf("focus")).getByRole("button", { name: "Merge" }));

    expect(screen.queryByText(/Remove the import of/)).toBeNull();
    expect(screen.getByLabelText("Merge into")).not.toBeNull();
  });

  it("closes the file-removal panel when a tag delete starts", async () => {
    renderDialog();
    await openFileRemove();

    await fireEvent.click(within(rowOf("focus")).getByRole("button", { name: "Delete" }));

    expect(screen.queryByText(/Remove the import of/)).toBeNull();
    expect(screen.getByText(/Delete the tag “focus”/)).not.toBeNull();
  });
});
