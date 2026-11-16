/** Best-effort localStorage access.
 *
 * A blocked or full store (private mode, quota) must never break the app: a
 * failed read falls back to absence and a failed write is dropped. */

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Non-fatal: the value simply won't persist.
  }
}
