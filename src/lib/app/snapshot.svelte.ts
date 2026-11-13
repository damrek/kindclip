/** Snapshot flows: the manual backup, the daily automatic snapshot and the
 * restore dialog, with one owner per async path.
 *
 * Every Tauri call and every dialog the flows need is injected through
 * `SnapshotBackend`, so the state machine is unit-tested and the shell keeps
 * only the wiring. */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AsyncTask } from "../asyncTask.svelte";
import {
  AUTO_BACKUP_KEEP,
  BACKUP_EXTENSION,
  autoBackupDue,
  backupDate,
  baseName,
  inspectBackupFile,
  isBackupError,
  schemaVersion,
  selectAutoBackupsToDelete,
  type AutoBackup,
  type AutoBackupPaths,
  type AutoBackupPruneReport,
  type BackupInfo,
} from "../backup";
import { closeDb, getDb, type DbPort } from "../db";
import { commandError, describeError } from "../errors";
import type { Translate } from "../format";
import { logger, type Logger } from "../log";

/** Native seams of the snapshot flows, one method per external effect. */
export interface SnapshotBackend {
  /** Native save dialog for the manual backup; null when cancelled. */
  saveDialog: (defaultPath: string, filterName: string) => Promise<string | null>;
  /** Native open dialog for a snapshot file; null when cancelled. */
  openDialog: (filterName: string) => Promise<string | null>;
  /** Platform default directory for a suggested file name. */
  defaultPath: (fileName: string) => Promise<string>;
  /** Rust composes `kindclip-backup-<date>.db`; TS only supplies the date. */
  fileName: (date: string) => Promise<string>;
  prepare: (date: string) => Promise<AutoBackupPaths>;
  commit: (paths: AutoBackupPaths) => Promise<void>;
  list: () => Promise<AutoBackup[]>;
  prune: (candidates: string[]) => Promise<AutoBackupPruneReport>;
  clearTarget: (path: string) => Promise<void>;
  inspect: (path: string, currentSchemaVersion: number) => Promise<BackupInfo>;
  restore: (path: string) => Promise<void>;
}

export function tauriSnapshotBackend(): SnapshotBackend {
  return {
    saveDialog: async (defaultPath, filterName) => {
      const picked = await save({
        defaultPath,
        filters: [{ name: filterName, extensions: [BACKUP_EXTENSION] }],
      });
      return typeof picked === "string" ? picked : null;
    },
    openDialog: async (filterName) => {
      const picked = await open({
        multiple: false,
        filters: [{ name: filterName, extensions: [BACKUP_EXTENSION] }],
      });
      return typeof picked === "string" ? picked : null;
    },
    defaultPath: async (fileName) => {
      try {
        return await invoke<string>("export_default_path", { suggestedFileName: fileName });
      } catch {
        // Non-fatal: the bare file name is a valid default path.
        return fileName;
      }
    },
    fileName: (date) => invoke<string>("backup_file_name", { date }),
    prepare: (date) => invoke<AutoBackupPaths>("prepare_auto_backup", { date }),
    commit: (paths) =>
      invoke("commit_auto_backup", { tempPath: paths.tempPath, finalPath: paths.finalPath }),
    list: () => invoke<AutoBackup[]>("list_auto_backups"),
    prune: (candidates) => invoke<AutoBackupPruneReport>("prune_auto_backups", { keep: AUTO_BACKUP_KEEP, candidates }),
    clearTarget: (path) => invoke("clear_backup_target", { path }),
    inspect: (path, currentSchemaVersion) => inspectBackupFile(path, currentSchemaVersion),
    restore: (path) => invoke("restore_database_file", { backupPath: path }),
  };
}

export interface SnapshotDeps {
  getPort: () => Promise<DbPort>;
  closePort: () => Promise<void>;
  t: Translate;
  backend: SnapshotBackend;
  /** Reload the views after a failed restore attempt reopened the database. */
  refresh: () => Promise<void>;
  log: Logger;
}

/** Production wiring: the shared connection, the Tauri backend and the logger. */
export function createSnapshotState(deps: {
  t: Translate;
  refresh: () => Promise<void>;
}): SnapshotState {
  return new SnapshotState({
    getPort: () => getDb(),
    closePort: async () => {
      await closeDb();
    },
    t: deps.t,
    backend: tauriSnapshotBackend(),
    refresh: deps.refresh,
    log: logger,
  });
}

export class SnapshotState {
  /** Manual backup: busy, status and error live in one task. */
  readonly backup: AsyncTask;

  /** Restore dialog. */
  open = $state(false);
  busy = $state(false);
  checking = $state(false);
  path = $state<string | null>(null);
  file = $state("");
  info = $state<BackupInfo | null>(null);
  error = $state<string | null>(null);
  snapshots = $state<AutoBackup[]>([]);
  snapshotsLoading = $state(false);
  snapshotsError = $state<string | null>(null);
  #request = 0;

  constructor(private readonly deps: SnapshotDeps) {
    this.backup = new AsyncTask(deps.log.error);
  }

  get canConfirm(): boolean {
    return this.path !== null && this.info !== null && !this.busy;
  }

  /** Write a consistent snapshot (VACUUM INTO) to the picked path. */
  async save(): Promise<void> {
    await this.backup.run(async () => {
      const fileName = await this.deps.backend.fileName(backupDate());
      const defaultPath = await this.deps.backend.defaultPath(fileName);
      const path = await this.deps.backend.saveDialog(defaultPath, this.deps.t("backup.filter"));
      if (path === null) {
        this.backup.status = null;
        return false;
      }
      await this.deps.backend.clearTarget(path);
      const port = await this.deps.getPort();
      await port.execute("VACUUM INTO $1", [path]);
      this.deps.log.info(`backup: wrote ${baseName(path)}`);
      this.backup.status = this.deps.t("backup.done", { file: baseName(path) });
      return true;
    }, {
      pending: this.deps.t("backup.saving"),
      describe: (cause) => this.deps.t("backup.error", { message: describeError(cause) }),
      scope: "backup",
    });
  }

  /**
   * Daily rotating snapshot: copy-only, one attempt per launch.
   *
   * The snapshot is written next to the live database with `VACUUM INTO` and
   * committed by Rust after checking the SQLite header, so a crash never
   * leaves a damaged file under a backup name. Failures are logged and never
   * interrupt startup; retention runs only after a successful commit.
   */
  async autoBackup(): Promise<void> {
    try {
      const date = backupDate();
      const finalName = await this.deps.backend.fileName(date);
      const existing = await this.deps.backend.list();
      if (!autoBackupDue(existing.map((snapshot) => snapshot.name), finalName)) {
        this.deps.log.info("auto-backup: today's snapshot already exists");
        return;
      }

      const paths = await this.deps.backend.prepare(date);
      const port = await this.deps.getPort();
      await port.execute("VACUUM INTO $1", [paths.tempPath]);
      await this.deps.backend.commit(paths);
      this.deps.log.info(`auto-backup: wrote ${finalName}`);

      const snapshots = await this.deps.backend.list();
      const doomed = selectAutoBackupsToDelete(snapshots.map((snapshot) => snapshot.name));
      const candidates = snapshots
        .filter((snapshot) => doomed.includes(snapshot.name))
        .map((snapshot) => snapshot.path);
      // Prune after every successful commit, even with nothing to delete:
      // the command also sweeps crash leftovers from earlier runs.
      const report = await this.deps.backend.prune(candidates);
      this.deps.log.info(
        `auto-backup: pruned ${report.deleted} snapshots (${report.failed} failed), ` +
          `removed ${report.tempsDeleted} stale temp files`,
      );
    } catch (error) {
      this.deps.log.error("auto-backup", error);
    }
  }

  /** Open the restore dialog with the automatic snapshots listed. */
  async openDialog(): Promise<void> {
    if (this.busy || this.backup.busy) return;
    this.#request += 1;
    this.open = true;
    this.path = null;
    this.file = "";
    this.info = null;
    this.error = null;
    this.checking = false;
    this.snapshots = [];
    this.snapshotsError = null;
    await this.loadSnapshots();
  }

  /** Read the automatic snapshots each time the dialog opens. */
  async loadSnapshots(): Promise<void> {
    this.snapshotsLoading = true;
    this.snapshotsError = null;
    try {
      this.snapshots = await this.deps.backend.list();
    } catch (error) {
      this.snapshotsError = this.deps.t("restore.listError", { message: describeError(error) });
      this.deps.log.error("restore-list", error);
    } finally {
      this.snapshotsLoading = false;
    }
  }

  /** Inspect one snapshot (automatic entry or picked file) before restoring. */
  async inspect(path: string): Promise<void> {
    const request = ++this.#request;
    this.path = path;
    this.file = baseName(path);
    this.info = null;
    this.error = null;
    this.checking = true;
    try {
      const port = await this.deps.getPort();
      const current = await schemaVersion(port);
      const info = await this.deps.backend.inspect(path, current);
      if (request === this.#request) {
        this.info = info;
      }
    } catch (error) {
      if (request === this.#request) {
        this.error = this.#restoreFailure(error);
      }
      this.deps.log.error("restore-inspect", error);
    } finally {
      if (request === this.#request) {
        this.checking = false;
      }
    }
  }

  /** Native file picker inside the dialog: the manual flow is unchanged. */
  async chooseFile(): Promise<void> {
    if (this.busy || this.checking) return;
    let selected: string | null;
    try {
      selected = await this.deps.backend.openDialog(this.deps.t("backup.filter"));
    } catch (error) {
      this.error = this.deps.t("restore.error", { message: describeError(error) });
      this.deps.log.error("restore-pick", error);
      return;
    }
    if (selected !== null) {
      await this.inspect(selected);
    }
  }

  /** Close the dialog; refuses while the destructive step runs. */
  close(): boolean {
    if (this.busy) return false;
    this.#request += 1;
    this.open = false;
    this.checking = false;
    return true;
  }

  /** Close the pool, replace the database file and let Rust restart the app. */
  async confirm(): Promise<void> {
    if (this.path === null || this.info === null || this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      await this.deps.closePort();
      await this.deps.backend.restore(this.path);
      // Rust restarts the app on success and never returns; reaching this
      // point means the restart did not happen.
      this.deps.log.warn("restore: the app did not restart after a successful restore");
      this.error = this.deps.t("restore.restartFailed");
    } catch (error) {
      this.error = this.#restoreFailure(error);
      this.deps.log.error("restore", error);
      try {
        await this.deps.getPort();
        await this.deps.refresh();
      } catch {
        // Keep the restore error on screen; the next launch retries the open.
      }
    } finally {
      this.busy = false;
    }
  }

  /** Map a rejected snapshot to the reason shown in the restore dialog. */
  #restoreFailure(error: unknown): string {
    if (isBackupError(error)) {
      if (error.code === "not-kindclip") return this.deps.t("restore.invalid");
      if (error.code === "newer-version") return this.deps.t("restore.newer");
      return this.deps.t("restore.corrupt", { message: error.message });
    }
    // Rust rejects a file that is not a readable SQLite database before the
    // frontend opens it; the code is stable even when the message changes.
    if (commandError(error)?.code === "invalid-backup") {
      return this.deps.t("restore.invalid");
    }
    return this.deps.t("restore.error", { message: describeError(error) });
  }
}
