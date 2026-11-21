import { describe, expect, it } from "vitest";
import ciWorkflowRaw from "../../.github/workflows/ci.yml?raw";
import releaseWorkflowRaw from "../../.github/workflows/release.yml?raw";
import tauriConfigRaw from "../../src-tauri/tauri.conf.json?raw";

// A Windows checkout converts these files to CRLF and ?raw hands the bytes over
// unchanged, so normalize once and keep every guard below written for plain LF.
const ciWorkflow = ciWorkflowRaw.replace(/\r\n/g, "\n");
const releaseWorkflow = releaseWorkflowRaw.replace(/\r\n/g, "\n");
const tauriConfig = tauriConfigRaw.replace(/\r\n/g, "\n");

// Textual guards for invariants that fail SILENTLY: a wrong release profile or a
// per-arch macOS split leaves CI green while paying for the same compile twice.
describe("release and CI workflow invariants", () => {
  it("builds macOS as a single universal job with both Apple targets", () => {
    expect(releaseWorkflow.match(/universal-apple-darwin/g)).toHaveLength(1);
    expect(releaseWorkflow).not.toMatch(/--target aarch64-apple-darwin/);
    expect(releaseWorkflow).toContain("aarch64-apple-darwin,x86_64-apple-darwin");
  });

  it("skips the Rust test compile on macOS, where nothing can reuse it", () => {
    // Linux and Windows build their release test into target/release, which
    // tauri-action reuses; macOS builds into target/<triple>/release, which
    // nothing reads. ci.yml runs it on macOS for the PR and the merged commit.
    const rustTests = releaseWorkflow.slice(releaseWorkflow.indexOf("Test Rust workspace"));
    expect(rustTests).toMatch(/if: matrix\.platform != 'macos-latest'/);
    expect(rustTests).toMatch(/cargo test --release --workspace/);
    expect(releaseWorkflow).not.toMatch(/cargo test --workspace/);
  });

  it("keeps the Rust cache out of the tag-scoped release workflow", () => {
    // A tag run reads only its own tag's cache or the default branch's, never
    // another tag's, so a cache here is a no-op that only churns storage.
    expect(releaseWorkflow).not.toContain("rust-cache");
  });

  it("caches Rust builds in CI, saved only from main", () => {
    // Branch-scoped instead: a PR restores main's cache and never writes one
    // back, so save-if keeps per-PR archives out of the 10 GB cap.
    expect(ciWorkflow).toContain("Swatinem/rust-cache@v2");
    expect(ciWorkflow).toContain("save-if: ${{ github.ref == 'refs/heads/main' }}");
  });

  it("bounds the apt step and falls back when the Azure mirror is down", () => {
    // azure.archive.ubuntu.com has been unreachable for hours twice, hanging
    // the leg until the job timeout. Both workflows carry the same fallback,
    // so a fix applied to one cannot silently miss the other.
    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      expect(workflow).toContain("Acquire::http::Timeout=20");
      expect(workflow).toContain("Acquire::Retries=1");
      expect(workflow).toContain("s|azure\\.archive\\.ubuntu\\.com|archive.ubuntu.com|g");
      expect(workflow).toContain("install_dependencies");
    }
  });

  it("gates pull requests and also validates the commit that lands on main", () => {
    // pull_request only tests a synthetic merge preview (refs/pull/N/merge), a
    // commit that never lands. The commit main receives — the one a release
    // tags — is a different SHA that nothing else builds.
    expect(ciWorkflow).toMatch(/pull_request:/);
    expect(ciWorkflow).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(ciWorkflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
    );
    expect(ciWorkflow).not.toContain("tauri build");
  });

  it("skips CI only for docs-only pushes to main, never for a pull request", () => {
    // A skipped pull_request run reports no required checks and the PR can never
    // merge, so the filter lives on push only, over exactly these passive paths.
    const pushStart = ciWorkflow.search(/^ {2}push:$/m);
    const pushEnd = ciWorkflow.search(/^ {2}workflow_dispatch:$/m);
    const pushBlock = ciWorkflow.slice(pushStart, pushEnd);
    const filter = pushBlock.slice(pushBlock.indexOf("paths-ignore:"));
    const globs = filter.match(/^\s+- .+$/gm)?.map((line) => line.trim().slice(2)) ?? [];
    expect(globs).toEqual(['"**.md"', '"docs/**"', '"LICENSE"']);
    expect(ciWorkflow.slice(0, pushStart)).not.toMatch(/^\s+paths(-ignore)?:/m);
    expect(ciWorkflow).not.toMatch(/^\s+paths:/m);
  });

  it("keeps the release gate steps, tests after the frontend build", () => {
    expect(releaseWorkflow).toContain("Sync version from resolved release");
    expect(releaseWorkflow).toContain("libwebkit2gtk-4.1-dev");
    expect(releaseWorkflow).toContain("tauri-apps/tauri-action@v0");
    expect(releaseWorkflow.indexOf("cargo test --release --workspace")).toBeGreaterThan(
      releaseWorkflow.indexOf("npm run build"),
    );
  });
});

// v1.9.0 shipped as TWO releases for the same tag, each holding a subset of the
// assets, because every matrix leg ran tauri-action with tagName and two legs
// created a release before seeing each other's. These guards keep creation in
// one unmatrixed job and keep the legs uploading by id.
describe("release workflow: one release object per tag", () => {
  it("creates the release once, before the build matrix", () => {
    expect(releaseWorkflow.match(/gh release create/g)).toHaveLength(1);
    expect(releaseWorkflow).toMatch(/\n {2}create-release:\n/);
    expect(releaseWorkflow).toMatch(/needs: \[prepare, create-release\]/);
  });

  it("picks the notes flags before the single creation call", () => {
    const start = releaseWorkflow.indexOf("NOTES_ARGS=(--generate-notes)");
    const end = releaseWorkflow.indexOf("release_id=$(gh release view");
    const block = releaseWorkflow.slice(start, end);
    expect(block).toContain('case "$NOTES_STATUS" in');
    expect(block).toContain('0) NOTES_ARGS=(--notes-file "$NOTES_FILE") ;;');
    expect(block).toContain('exit "$NOTES_STATUS"');
    expect(block).toContain('"${NOTES_ARGS[@]}"');
    const caseBody = block.slice(block.indexOf('case "$NOTES_STATUS" in'), block.indexOf("esac"));
    expect(caseBody).not.toContain("gh release create");
    expect(releaseWorkflow.match(/gh release create/g)).toHaveLength(1);
  });

  it("gives gh and the notes script the repository explicitly", () => {
    // Both calls read the repository from the env instead of trusting the
    // checkout's git remote; GITHUB_REPOSITORY alone is not enough for gh.
    expect(releaseWorkflow).toMatch(/GH_REPO: \$\{\{ github\.repository \}\}/);
  });

  it("uploads by release id instead of letting each leg create by tag", () => {
    expect(releaseWorkflow).toContain(
      "releaseId: ${{ needs.create-release.outputs.release_id }}",
    );
    expect(releaseWorkflow).not.toMatch(/tagName:/);
    expect(releaseWorkflow).not.toMatch(/releaseName:/);
  });

  it("fails instead of uploading with an empty release id", () => {
    // tauri-action only logs "No releaseId or tagName provided, skipping all
    // uploads..." and still exits green, so this has to be caught here.
    expect(releaseWorkflow).toContain('if [ -z "$release_id" ]');
    expect(releaseWorkflow).toContain("Could not resolve the release id for $TAG");
  });

  it("generates the notes once, at creation, with draft defaulting to false", () => {
    expect(releaseWorkflow).toContain("--generate-notes");
    expect(releaseWorkflow).not.toMatch(/generateReleaseNotes:/);
    expect(releaseWorkflow).not.toMatch(/releaseDraft:/);
  });
});

// workflow_dispatch runs from any branch, and a tag can be pushed on an
// unmerged commit. Both used to publish bytes that never reached main, so the
// guards below fail loudly in `prepare`, before any artifact is built.
describe("release workflow: refuses unreleasable commits", () => {
  it("requires the released commit to be an ancestor of main", () => {
    expect(releaseWorkflow).toContain(
      "if: steps.version.outputs.should_release == 'true'",
    );
    expect(releaseWorkflow).toContain(
      "git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main",
    );
    expect(releaseWorkflow).toContain(
      'git merge-base --is-ancestor "$GITHUB_SHA" refs/remotes/origin/main',
    );
    expect(releaseWorkflow).toContain("is not on main");
  });

  it("requires every committed version file to match the resolved version", () => {
    // The runner rewrites the version files for the build only; the tag still
    // points at the commit, so a forgotten bump would ship disagreeing sources.
    expect(releaseWorkflow).toContain("expect_version package.json");
    expect(releaseWorkflow).toContain("src-tauri/tauri.conf.json");
    expect(releaseWorkflow).toContain("src-tauri/Cargo.toml");
    expect(releaseWorkflow).toContain("crates/clippings-parser/Cargo.toml");
    expect(releaseWorkflow).toContain("Commit the bump");
  });
});

// "all" silently bundles every target the OS supports. Windows' default set is
// [msi, nsis], so the WiX installer comes back without anyone asking for it.
describe("bundle targets", () => {
  it("bundles exactly the six supported targets and no WiX/Msi", () => {
    const targets: string[] = JSON.parse(tauriConfig).bundle.targets;
    // Order-independent and exact: an extra or duplicated target fails too.
    expect([...targets].sort()).toEqual(["app", "appimage", "deb", "dmg", "nsis"]);
    expect(tauriConfig).not.toContain('"msi"');
    // No rpm: the updater would hand an rpm install the AppImage fallback.
  });
});

// The updater fails in ways nothing else would catch: a manifest with one
// platform leaves every other user on an old build, and a missing signature
// only shows up when a real install refuses to update. These guards keep the
// signing key, artifacts, endpoint and manifest from drifting apart.
describe("signed auto-update", () => {
  const config = JSON.parse(tauriConfig);

  it("signs every bundle and pins the public key the app verifies", () => {
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.plugins.updater.pubkey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(config.plugins.updater.endpoints).toEqual([
      "https://github.com/damrek/kindclip/releases/latest/download/latest.json",
    ]);
  });

  it("keeps the v2 updater artifacts the manifest check expects", () => {
    // `true` reuses the AppImage and NSIS installer in place; "v1Compatible"
    // would wrap them in .tar.gz/.zip and the manifest check would fail.
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(tauriConfig).not.toContain("v1Compatible");
  });

  it("hands the signing key to the build and drops a stale manifest first", () => {
    expect(releaseWorkflow).toContain(
      "TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}",
    );
    expect(releaseWorkflow).toContain("TAURI_SIGNING_PRIVATE_KEY_PASSWORD");
    expect(releaseWorkflow).not.toMatch(/generateReleaseNotes:/);
    // latest.json is left to tauri-action. The trap: on a re-release the
    // action merges into the manifest it finds and keeps a platform entry it
    // cannot re-resolve, so the 2.1.0 macOS signature pointed at a bundle that
    // had already been replaced. create-release drops the old file first.
    expect(releaseWorkflow).not.toMatch(/^\s*(include|upload)UpdaterJson:\s*false/m);
    expect(releaseWorkflow).toContain('gh release delete-asset "$TAG" latest.json --yes');
  });

  it("adds the notes and checks the manifest after every leg has uploaded", () => {
    const job = releaseWorkflow.slice(
      releaseWorkflow.indexOf("\n  finalize-updater-manifest:\n"),
    );
    expect(job.length).toBeGreaterThan(0);
    expect(job).toMatch(/needs: \[prepare, create-release, release\]/);
    expect(job).toContain("check-updater-manifest.sh");
    expect(job).toContain('--pattern \'*.sig\'');
    // The action knows only the release id, so it writes no notes: without
    // this the update dialog shows nothing.
    expect(job).toContain('gh release view "$TAG" --json body -q .body > notes.md');
    expect(job).toContain('gh release upload "$TAG" latest.json --clobber');
  });

  it("tests the manifest check in CI", () => {
    expect(ciWorkflow).toContain("bash .github/scripts/check-updater-manifest.test.sh");
  });
});
