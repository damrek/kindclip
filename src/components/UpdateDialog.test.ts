// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, setup } from "@testing-library/svelte";
import { I18N_CONTEXT_KEY } from "../lib/i18n";
import type { UpdateStatus } from "../lib/app/updates.svelte";
import { installDomStubs, testI18n } from "../test/component";
import UpdateDialog from "./UpdateDialog.svelte";

interface DialogProps {
  status: UpdateStatus;
  version: string | null;
  notes: string;
  error: string | null;
  appVersion: string | null;
  busy: boolean;
  available: boolean;
  onClose: () => void;
  onInstall: () => void;
}

function renderDialog(overrides: Partial<DialogProps> = {}) {
  const mocks = {
    onClose: vi.fn((): void => {}),
    onInstall: vi.fn((): void => {}),
  };
  const props: DialogProps = {
    status: "current",
    version: null,
    notes: "",
    error: null,
    appVersion: "2.2.0",
    busy: false,
    available: false,
    ...mocks,
    ...overrides,
  };
  const result = render(UpdateDialog, {
    props,
    context: new Map([[I18N_CONTEXT_KEY, testI18n()]]),
  });
  return { ...mocks, result };
}

beforeAll(installDomStubs);
beforeEach(async () => {
  await setup();
});
afterEach(cleanup);

describe("UpdateDialog", () => {
  it("renders the current release notes as readable markdown", () => {
    const { result } = renderDialog({
      notes:
        "### Changed\n\n- **Landing page**: an editorial redesign.\n- **Filter panel**: shares one row.",
    });

    expect(screen.getByText("You are on the latest version.")).not.toBeNull();
    expect(screen.getByText("What's new")).not.toBeNull();
    expect(screen.getByText("Changed")).not.toBeNull();
    expect(screen.getByText("Landing page")).not.toBeNull();
    expect(screen.getByText("v2.2.0")).not.toBeNull();
    expect(result.container.textContent).not.toContain("**");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("offers the install action for a pending release", async () => {
    const { onClose, onInstall } = renderDialog({
      status: "available",
      version: "2.2.1",
      available: true,
      notes: "### Added\n\n- Faster imports.",
    });

    expect(screen.getByText("Version 2.2.1 is available.")).not.toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reports a failed check as the dialog headline", () => {
    renderDialog({
      status: "error",
      error: "Could not update: endpoint unreachable",
      appVersion: "2.2.0",
    });

    expect(screen.getByText("Could not update: endpoint unreachable")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).not.toBeNull();
  });
});
