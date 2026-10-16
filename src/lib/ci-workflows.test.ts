import { describe, expect, it } from "vitest";
import ciWorkflow from "../../.github/workflows/ci.yml?raw";
import releaseWorkflow from "../../.github/workflows/release.yml?raw";

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
    expect(releaseWorkflow).toContain("Sync version from tag");
    expect(releaseWorkflow).toContain("libwebkit2gtk-4.1-dev");
    expect(releaseWorkflow).toContain("tauri-apps/tauri-action@v0");
    expect(releaseWorkflow.indexOf("cargo test --release --workspace")).toBeGreaterThan(
      releaseWorkflow.indexOf("npm run build"),
    );
  });
});
