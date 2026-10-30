import { describe, expect, it } from "vitest";
import ciWorkflowRaw from "../../.github/workflows/ci.yml?raw";
import releaseWorkflowRaw from "../../.github/workflows/release.yml?raw";

// A Windows checkout converts these files to CRLF and ?raw hands the bytes over
// unchanged, so normalize once and keep every guard below written for plain LF.
const ciWorkflow = ciWorkflowRaw.replace(/\r\n/g, "\n");
const releaseWorkflow = releaseWorkflowRaw.replace(/\r\n/g, "\n");

// Textual guards for invariants that fail SILENTLY: a wrong release profile, a
// per-arch macOS split, or a re-added tag-scoped cache all leave CI green while
// paying for the same compilation twice, with no error anywhere to warn you.
describe("release and CI workflow invariants", () => {
  it("builds macOS as a single universal job with both Apple targets", () => {
    expect(releaseWorkflow.match(/universal-apple-darwin/g)).toHaveLength(1);
    expect(releaseWorkflow).not.toMatch(/--target aarch64-apple-darwin/);
    expect(releaseWorkflow).toContain("aarch64-apple-darwin,x86_64-apple-darwin");
  });

  it("compiles the Rust workspace once, in release mode", () => {
    // Release profile so the test build and the tauri-action build share the
    // same artifacts. A debug `cargo test` would compile the whole graph twice.
    expect(releaseWorkflow).toContain("cargo test --release --workspace");
    expect(releaseWorkflow).not.toContain("cargo test --workspace");
  });

  it("does not reintroduce a Rust cache a tag run could never reuse", () => {
    // GitHub scopes caches to a ref: a tag run can read the default-branch cache
    // (which no longer exists) but never another tag's. Any cache here would be
    // a silent no-op that only churns storage.
    expect(releaseWorkflow).not.toContain("rust-cache");
    expect(ciWorkflow).not.toContain("rust-cache");
  });

  it("keeps CI as a pre-merge gate, with no main trigger and no release build", () => {
    expect(ciWorkflow).toMatch(/on:\s*\n\s*pull_request:/);
    expect(ciWorkflow).not.toMatch(/branches: \[main\]/);
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
