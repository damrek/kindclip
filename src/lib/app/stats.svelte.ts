/** Reading-stats dialog: loaded fresh each time it opens, with a request token
 * so a slow read never lands in a dialog that was closed or reopened. */
import type { DbPort } from "../db";
import { describeError } from "../errors";
import type { Translate } from "../format";
import type { Logger } from "../log";
import type { ReadingStats } from "../stats";

export interface StatsStateDeps {
  getPort: () => Promise<DbPort>;
  load: (port: DbPort) => Promise<ReadingStats>;
  t: Translate;
  log: Logger;
}

export class StatsState {
  open = $state(false);
  loading = $state(false);
  data = $state<ReadingStats | null>(null);
  error = $state<string | null>(null);
  #request = 0;

  constructor(private readonly deps: StatsStateDeps) {}

  /** Reset the dialog and load a fresh aggregate set. */
  async show(): Promise<void> {
    this.open = true;
    this.data = null;
    this.error = null;
    this.loading = true;
    const request = ++this.#request;
    try {
      const data = await this.deps.load(await this.deps.getPort());
      if (request === this.#request) {
        this.data = data;
      }
    } catch (error) {
      if (request === this.#request) {
        this.error = this.deps.t("stats.error", { message: describeError(error) });
      }
      this.deps.log.error("stats", error);
    } finally {
      if (request === this.#request) {
        this.loading = false;
      }
    }
  }

  /** Close and invalidate an in-flight load. Returns false when already closed. */
  close(): boolean {
    if (!this.open) return false;
    this.#request += 1;
    this.open = false;
    this.loading = false;
    this.error = null;
    return true;
  }
}
