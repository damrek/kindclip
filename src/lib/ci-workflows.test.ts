import { describe, expect, it } from "vitest";
import ciWorkflow from "../../.github/workflows/ci.yml?raw";
import releaseWorkflow from "../../.github/workflows/release.yml?raw";

// These are textual guards for invariants that fail SILENTLY in CI: if the
// release and CI workflows stop sharing a rust-cache key, the tag release just
// misses the cache and compiles everything from scratch again, with no error.
const sharedKey = (workflow: string) => workflow.match(/shared-key:\s*(\S+)/)?.[1];

describe("release and CI workflow invariants", () => {
  it("keeps the same rust-cache key in both workflows", () => {
    expect(sharedKey(releaseWorkflow)).toBeDefined();
    expect(sharedKey(releaseWorkflow)).toBe(sharedKey(ciWorkflow));
    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      expect(workflow).toMatch(/workspaces: '\. -> target'/);
    }
  });

  it("builds macOS as a single universal job with both Apple targets", () => {
    for (const workflow of [ciWorkflow, releaseWorkflow]) {
      expect(workflow.match(/universal-apple-darwin/g)).toHaveLength(1);
      expect(workflow).not.toMatch(/--target aarch64-apple-darwin/);
      expect(workflow).toContain("aarch64-apple-darwin,x86_64-apple-darwin");
    }
  });

  it("restores in the release and saves only on main in CI", () => {
    expect(releaseWorkflow).toMatch(/save-if: false/);
    expect(ciWorkflow).toContain("save-if: ${{ github.ref == 'refs/heads/main' }}");
  });

  it("warms release-profile deps only on main, after build and tests", () => {
    expect(ciWorkflow).toContain("npx tauri build ${{ matrix.args }} --no-bundle");
    expect(ciWorkflow).toContain("if: github.ref == 'refs/heads/main'");
    expect(ciWorkflow.indexOf("Warm release-profile dependencies")).toBeGreaterThan(
      ciWorkflow.indexOf("cargo test --workspace"),
    );
  });

  it("keeps the release gate steps", () => {
    expect(releaseWorkflow).toContain("Sync version from tag");
    expect(releaseWorkflow).toContain("libwebkit2gtk-4.1-dev");
    expect(releaseWorkflow).toContain("tauri-apps/tauri-action@v0");
    expect(releaseWorkflow.indexOf("cargo test --workspace")).toBeGreaterThan(
      releaseWorkflow.indexOf("npm run build"),
    );
  });
});
