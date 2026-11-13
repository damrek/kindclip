/** Wall-clock timestamp for persisted edits, in the format the schema stores.
 *
 * Lives in a plain module so a rune file never constructs a mutable `Date`. */
export function nowIso(): string {
  return new Date().toISOString();
}
