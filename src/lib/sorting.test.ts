import { describe, expect, it } from "vitest";
import { sortBooks } from "./sorting";
import type { Book } from "./types";

function book(title: string, author: string | null): Book {
  return { id: title.length + (author?.length ?? 0), title, author, clipping_count: 0 };
}

describe("sortBooks", () => {
  it("sorts by title ascending", () => {
    const books = [book("Zebra", "A"), book("apple", "B"), book("Mango", "C")];
    expect(sortBooks(books, "title", "asc").map((b) => b.title)).toEqual([
      "apple",
      "Mango",
      "Zebra",
    ]);
  });

  it("ignores case when comparing", () => {
    const books = [book("the Hobbit", "A"), book("Dune", "B"), book("atomic", "C")];
    expect(sortBooks(books, "title", "asc").map((b) => b.title)).toEqual([
      "atomic",
      "Dune",
      "the Hobbit",
    ]);
  });

  it("sorts by author and keeps unknown authors first", () => {
    const books = [book("B", "Zed"), book("A", null), book("C", "Ana")];
    expect(sortBooks(books, "author", "asc").map((b) => b.title)).toEqual(["A", "C", "B"]);
  });

  it("reverses on descending", () => {
    const books = [book("A", "x"), book("B", "y")];
    expect(sortBooks(books, "title", "desc").map((b) => b.title)).toEqual(["B", "A"]);
  });

  it("does not mutate the input array", () => {
    const books = [book("B", "x"), book("A", "y")];
    const order = books.map((b) => b.title);
    sortBooks(books, "title", "asc");
    expect(books.map((b) => b.title)).toEqual(order);
  });
});
