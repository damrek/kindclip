import { describe, expect, it } from "vitest";
import changelogRaw from "../../CHANGELOG.md?raw";
import packageJson from "../../package.json";
import { changelogSection } from "./changelog";

const changelog = `# Changelog

## [Unreleased]

## [2.0.0] - 2026-12-01

### Added

- **Big feature**: a sentence long enough to be wrapped across
  two source lines, with a tail.
- Short bullet.

### Fixed

- One fix that also wraps
  onto a second line.

## [1.0.0] - 2026-01-01

### Added

- First release.
`;

const section = [
  "### Added",
  "",
  "- **Big feature**: a sentence long enough to be wrapped across two source lines, with a tail.",
  "- Short bullet.",
  "",
  "### Fixed",
  "",
  "- One fix that also wraps onto a second line.",
].join("\n");

describe("changelogSection", () => {
  it("extracts one version and unwraps continuation lines", () => {
    expect(changelogSection(changelog, "2.0.0")).toBe(section);
  });

  it("accepts a leading v and stops at the next version", () => {
    expect(changelogSection(changelog, "v2.0.0")).toBe(section);
    expect(changelogSection(changelog, "1.0.0")).toBe("### Added\n\n- First release.");
  });

  it("does not match a longer version prefix", () => {
    expect(changelogSection(changelog, "2.0.0-beta.1")).toBeNull();
  });

  it("returns null for a missing, empty or absent section", () => {
    expect(changelogSection(changelog, "3.0.0")).toBeNull();
    expect(changelogSection(changelog, null)).toBeNull();
    expect(changelogSection("## [3.0.0]\n\n## [2.0.0]\n\n- Body.", "3.0.0")).toBeNull();
  });

  it("normalizes CRLF", () => {
    expect(changelogSection(changelog.replace(/\n/g, "\r\n"), "2.0.0")).toBe(section);
  });

  it("has notes for the committed version", () => {
    expect(changelogSection(changelogRaw, packageJson.version)).not.toBeNull();
  });
});
