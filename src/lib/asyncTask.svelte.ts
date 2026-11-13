/** One async user action with the three states every flow in the shell repeats:
 * busy while it runs, a translated error when it fails, and an optional status
 * line for progress and outcomes.
 *
 * `run` never throws and never reports a second failure while the first action
 * is still in flight; callers only branch on the returned outcome. */
import { describeError } from "./errors";

export type TaskOutcome<T> =
  | { status: "done"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "skipped" };

export interface TaskOptions<T> {
  /** Status shown while the action runs; omit to keep the previous line. */
  pending?: string | null;
  /** Message for `error`; defaults to `describeError`. */
  describe?: (cause: unknown) => string;
  /** Runs after a failure, before `busy` clears (e.g. reload real state). */
  afterFailure?: () => Promise<void> | void;
  /** Diagnostic scope; the injected logger records the raw cause. */
  scope?: string;
  /** Runs before `busy` clears, once the action succeeded. */
  afterSuccess?: (value: T) => void;
}

export class AsyncTask {
  busy = $state(false);
  error = $state<string | null>(null);
  status = $state<string | null>(null);

  constructor(private readonly log?: (scope: string, error: unknown) => void) {}

  clear(): void {
    this.error = null;
    this.status = null;
  }

  async run<T>(action: () => Promise<T>, options: TaskOptions<T> = {}): Promise<TaskOutcome<T>> {
    if (this.busy) return { status: "skipped" };
    this.busy = true;
    this.error = null;
    if (options.pending !== undefined) {
      this.status = options.pending;
    }
    try {
      const value = await action();
      options.afterSuccess?.(value);
      return { status: "done", value };
    } catch (error) {
      this.error = (options.describe ?? describeError)(error);
      if (options.scope !== undefined) {
        this.log?.(options.scope, error);
      }
      try {
        await options.afterFailure?.();
      } catch {
        // The original failure stays on screen; a failed recovery reload is
        // logged by the callback itself.
      }
      return { status: "failed", error };
    } finally {
      this.busy = false;
    }
  }
}
