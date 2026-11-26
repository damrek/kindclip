/** Signed auto-update: the quiet check on launch, the manual check from
 * Preferences and the install-and-relaunch step.
 *
 * The plugin calls are injected so the panel stays testable; the production
 * wiring lives in `createUpdatePanel`. The two checks differ on purpose: the
 * launch one never surfaces a failure or an "up to date", the manual one
 * always reports what happened. */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import changelog from "../../../CHANGELOG.md?raw";
import { changelogSection } from "../changelog";
import { describeError } from "../errors";
import { logger } from "../log";
import type { Translate } from "../format";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "installing"
  | "error";

/** The slice of the plugin's `Update` the panel reads, so a test can supply
 * one without a Tauri bridge. */
export interface PendingUpdate {
  version: string;
  body?: string | null;
  downloadAndInstall: () => Promise<void>;
}

export interface UpdateDeps {
  /** Ask the endpoint for a newer release; null when already current. */
  check: () => Promise<PendingUpdate | null>;
  /** Restart into the version that was just installed. */
  relaunch: () => Promise<void>;
  currentNotes: () => string | null;
  t: Translate;
  log: (scope: string, error: unknown) => void;
}

export function createUpdatePanel(
  t: Translate,
  currentVersion: () => string | null,
): UpdatePanel {
  return new UpdatePanel({
    check: () => check() as Promise<Update | null>,
    relaunch: () => relaunch(),
    currentNotes: () => changelogSection(changelog, currentVersion()),
    t,
    log: logger.error,
  });
}

export class UpdatePanel {
  status = $state<UpdateStatus>("idle");
  version = $state<string | null>(null);
  notes = $state<string | null>(null);
  error = $state<string | null>(null);
  /** The launch prompt is open; the manual check lives in Preferences. */
  prompt = $state(false);
  /** A download or install is in flight; actions and the backdrop disable. */
  busy = $state(false);
  #pending: PendingUpdate | null = null;

  constructor(private readonly deps: UpdateDeps) {}

  get available(): boolean {
    return this.#pending !== null;
  }

  get notesToShow(): string {
    if (this.available) {
      return this.notes ?? "";
    }
    return this.status === "current" ? (this.deps.currentNotes() ?? "") : "";
  }

  /** Launch check: silent unless there is something to install, and it only
   * lights the header badge — the dialog waits for a click. */
  async checkOnLaunch(): Promise<void> {
    if (this.busy) return;
    try {
      this.#adopt(await this.deps.check());
    } catch (cause) {
      // A cold start is never interrupted: the manual check is where a
      // misconfigured endpoint or a network failure becomes visible.
      this.deps.log("update-check", cause);
    }
  }

  /** The header control: show what is pending, or look for something new.
   * Either way the dialog opens, so a click always gets an answer. */
  async open(): Promise<void> {
    if (this.#pending !== null) {
      this.prompt = true;
      return;
    }
    await this.checkNow();
  }

  /** Manual check: always reports its outcome, "up to date" included. */
  async checkNow(): Promise<void> {
    if (this.busy) return;
    this.prompt = true;
    this.status = "checking";
    this.error = null;
    try {
      const pending = await this.deps.check();
      this.#adopt(pending);
      if (pending === null) {
        this.status = "current";
      }
    } catch (cause) {
      this.status = "error";
      this.error = this.deps.t("updates.error", { message: describeError(cause) });
      this.deps.log("update-check", cause);
    }
  }

  async install(): Promise<void> {
    const pending = this.#pending;
    if (pending === null || this.busy) return;
    this.busy = true;
    this.status = "installing";
    this.error = null;
    try {
      await pending.downloadAndInstall();
      await this.deps.relaunch();
    } catch (cause) {
      this.status = "error";
      this.error = this.deps.t("updates.error", { message: describeError(cause) });
      this.deps.log("update-install", cause);
    } finally {
      this.busy = false;
    }
  }

  /** Close the launch prompt; the release stays available for a later install. */
  dismiss(): void {
    if (this.busy) return;
    this.prompt = false;
  }

  #adopt(pending: PendingUpdate | null): void {
    this.#pending = pending;
    this.version = pending?.version ?? null;
    this.notes = pending?.body ?? null;
    this.status = pending === null ? "idle" : "available";
  }
}
