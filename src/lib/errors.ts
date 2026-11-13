/** Readable text for a thrown value; callers only pass messages, never content.
 *
 * Lives outside log.ts so pure modules (data layer, backup, components) can
 * format an error without pulling in the Tauri logging plugin. */

/** The `{ code, message }` envelope every Rust command rejects with. */
export interface CommandErrorEnvelope {
  code: string;
  message: string;
}

/** Narrow a rejected command to its envelope; null for any other throw. */
export function commandError(error: unknown): CommandErrorEnvelope | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string" && typeof candidate.message === "string") {
    return { code: candidate.code, message: candidate.message };
  }
  return null;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const envelope = commandError(error);
  if (envelope !== null) return envelope.message;
  return String(error);
}
