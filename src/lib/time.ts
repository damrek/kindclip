/** Wall-clock timestamp for persisted edits, in the format the schema stores.
 *
 * Lives in a plain module so a rune file never constructs a mutable `Date`. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Current wall clock for date-stamped renders; the caller owns the value. */
export function nowDate(): Date {
  return new Date();
}
