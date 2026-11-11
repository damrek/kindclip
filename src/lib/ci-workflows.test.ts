import { describe, expect, it } from "vitest";
import ciWorkflowRaw from "../../.github/workflows/ci.yml?raw";
import releaseWorkflowRaw from "../../.github/workflows/release.yml?raw";
import tauriConfigRaw from "../../src-tauri/tauri.conf.json?raw";

// A Windows checkout converts these files to CRLF and ?raw hands the bytes over
// unchanged, so normalize once and keep every guard below written for plain LF.
const ciWorkflow = ciWorkflowRaw.replace(/\r\n/g, "\n");
const releaseWorkflow = releaseWorkflowRaw.replace(/\r\n/g, "\n");
const tauriConfig = tauriConfigRaw.replace(/\r\n/g, "\n");

// Textual guards for invariants that fail SILENTLY: a wrong release profile, a
// per-arch macOS split, or a re-added tag-scoped cache all leave CI green while
// paying for the same compilation twice, with no error anywhere to warn you.
describe("release and CI workflow invariants", () => {
  it("builds macOS as a single universal job with both Apple targets", () => {
    expect(releaseWorkflow.match(/universal-apple-darwin/g)).toHaveLength(1);
    expect(releaseWorkflow).not.toMatch(/--target aarch64-apple-darwin/);
    expect(releaseWorkflow).toContain("aarch64-apple-darwin,x86_64-apple-darwin");
  });

  it("tests in release mode only where tauri-action reads the same target/", () => {
    // Linux and Windows build into target/release, so the release test compile
    // feeds tauri-action. macOS builds --target universal-apple-darwin into
    // target/<triple>/release, which never reads target/release: release mode
    // there is a duplicate compile nothing reuses.
    const rustTests = releaseWorkflow.slice(releaseWorkflow.indexOf("Test Rust workspace"));
    expect(rustTests).toMatch(/= "macos-latest"[\s\S]{0,200}cargo test --workspace/);
    expect(rustTests).toMatch(/else[\s\S]{0,200}cargo test --release --workspace/);
  });

  it("does not reintroduce a Rust cache a tag run could never reuse", () => {
    // GitHub scopes caches to a ref: a tag run can read the default-branch cache
    // (which no longer exists) but never another tag's. Any cache here would be
    // a silent no-op that only churns storage.
    expect(releaseWorkflow).not.toContain("rust-cache");
    expect(ciWorkflow).not.toContain("rust-cache");
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
    expect(releaseWorkflow).toMatch(/\n  create-release:\n/);
    expect(releaseWorkflow).toMatch(/needs: \[prepare, create-release\]/);
  });

  it("gives gh a repository context in the job that has no checkout", () => {
    // gh resolves owner/repo from a git remote and ignores GITHUB_REPOSITORY;
    // without GH_REPO every call fails before the API and no release is made.
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
    expect([...targets].sort()).toEqual(["app", "appimage", "deb", "dmg", "nsis", "rpm"]);
    expect(tauriConfig).not.toContain('"msi"');
  });
});
