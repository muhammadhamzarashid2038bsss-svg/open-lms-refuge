// @vitest-environment happy-dom
// The ordinary download must stay usable without opening the requirement form.
// A missed confirmation is an on-page message, not a new page of JSON.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExportDownloadForm } from "@/components/export-download-form";
import { FunderRequirements } from "@/components/funder-requirements";
import { CONFIRMATION_MISSING, LEARNER_LEVEL_CONFIRMATION, LEARNER_LEVEL_WARNING } from "@/lib/export/offer";
import type { FunderRequirementView } from "@/lib/export/requirements";

let root: Root;
let container: HTMLDivElement;

const requirement: FunderRequirementView = {
  id: "11111111-1111-4111-8111-111111111111",
  requirementReference: "GRANT-2026",
  learnerLevelReason: "The agreement asks for a row for each learner.",
  crossReportLinkage: false,
  active: true,
  recordedLabel: "1 Nov 2026",
  deactivatedLabel: null,
};

const closed: FunderRequirementView = {
  ...requirement,
  id: "22222222-2222-4222-8222-222222222222",
  requirementReference: "GRANT-OLD",
  active: false,
  deactivatedLabel: "2 Nov 2026",
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function download(offered: boolean, extra: { mode?: "aggregate" | "pseudonymized"; confirmationError?: string | null } = {}) {
  return (
    <ExportDownloadForm
      centerId={null}
      centerName={null}
      from="2026-01-01"
      to="2026-01-31"
      format="pdf"
      mode={extra.mode ?? "aggregate"}
      formError={null}
      offered={offered}
      warning={offered ? LEARNER_LEVEL_WARNING : null}
      confirmationLabel={offered ? LEARNER_LEVEL_CONFIRMATION : null}
      confirmationError={extra.confirmationError ?? null}
      requirements={offered ? [{ id: requirement.id, requirementReference: requirement.requirementReference, crossReportLinkage: false }] : []}
      initialRequirementId={offered ? requirement.id : ""}
    />
  );
}

describe("export page layout", () => {
  it("keeps aggregate download free of requirement fields", async () => {
    await act(async () => {
      root.render(download(false));
    });
    expect(container.querySelector("h2")?.textContent).toBe("Generate a report");
    expect(container.querySelector("input[name='periodStart']")).toHaveProperty("value", "2026-01-01");
    expect(container.querySelector("input[name='periodEnd']")).toHaveProperty("value", "2026-01-31");
    expect(container.querySelector("input[value='pdf']")).toHaveProperty("checked", true);
    expect(container.querySelector("input[value='aggregate']")).toHaveProperty("checked", true);
    expect(container.querySelector("input[value='pseudonymized']")).toBeNull();
    expect(container.querySelector("input[name='learnerLevelConfirmed']")).toBeNull();
    expect(container.querySelector("textarea[name='learnerLevelReason']")).toBeNull();
    expect(container.querySelector("input[name='requirementReference']")).toBeNull();
    expect(container.querySelector("input[name='crossReportLinkage']")).toBeNull();
    expect(container.textContent).toContain("Learner-level reporting is unavailable unless a funder explicitly requires it.");
    expect(container.querySelector("button")?.textContent).toBe("Download report");
  });

  it("shows learner-level only after that report is chosen, and keeps a missed confirmation on the page", async () => {
    await act(async () => {
      root.render(download(true));
    });
    expect(container.querySelector("input[value='aggregate']")).toHaveProperty("checked", true);
    expect(container.querySelector("input[name='learnerLevelConfirmed']")).toBeNull();
    const learner = container.querySelector("input[value='pseudonymized']");
    expect(learner).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      learner?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const box = container.querySelector("input[name='learnerLevelConfirmed']");
    expect(box).toBeInstanceOf(HTMLInputElement);
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(container.textContent).toContain("is not anonymous");

    await act(async () => {
      root.render(download(true, { mode: "pseudonymized", confirmationError: CONFIRMATION_MISSING }));
    });
    const alert = container.querySelector("#learner-level-error");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.textContent).toBe(CONFIRMATION_MISSING);
    expect(container.querySelector("input[value='pseudonymized']")).toHaveProperty("checked", true);
    expect(container.querySelector("input[name='periodStart']")).toHaveProperty("value", "2026-01-01");
    expect(container.querySelector("input[value='pdf']")).toHaveProperty("checked", true);
    expect((container.querySelector("input[name='learnerLevelConfirmed']") as HTMLInputElement).checked).toBe(false);
    expect(container.textContent).not.toContain("{");
  });

  it("keeps the requirement form closed until it is opened, and can still turn one off", async () => {
    await act(async () => {
      root.render(<FunderRequirements centerId="center-1" showCenterField={false} requirements={[]} />);
    });
    const closedForm = container.querySelector("details");
    expect(closedForm).toBeInstanceOf(HTMLDetailsElement);
    expect((closedForm as HTMLDetailsElement).open).toBe(false);
    expect(closedForm?.querySelector("summary")?.textContent).toBe("Record funder requirement");
    expect(closedForm?.querySelector("textarea[name='learnerLevelReason']")).toBeTruthy();
    expect((closedForm?.querySelector("input[name='crossReportLinkage']") as HTMLInputElement).checked).toBe(false);
    expect(container.textContent).toContain("Aggregate reports do not need a funder requirement.");

    await act(async () => {
      root.render(<FunderRequirements centerId="center-1" showCenterField={false} requirements={[requirement, closed]} />);
    });
    expect(container.textContent).toContain("GRANT-2026 · Active");
    expect(container.textContent).toContain("Recorded 1 Nov 2026");
    const turnOff = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Turn off requirement");
    expect(turnOff).toBeTruthy();
    expect(turnOff?.closest("details")).toBeNull();
    const sections = container.querySelectorAll("details");
    expect(sections).toHaveLength(2);
    expect((sections[0] as HTMLDetailsElement).open).toBe(false);
    expect(sections[0]?.querySelector("summary")?.textContent).toBe("Record another requirement");
    expect((sections[1] as HTMLDetailsElement).open).toBe(false);
    expect(sections[1]?.textContent).toContain("GRANT-OLD");
    expect(sections[1]?.textContent).toContain("Turned off");
  });
});
