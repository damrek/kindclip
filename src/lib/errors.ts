/** Readable text for a thrown value; callers only pass messages, never content.
 *
 * Lives outside log.ts so pure modules (data layer, backup, components) can
 * format an error without pulling in the Tauri logging plugin. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
