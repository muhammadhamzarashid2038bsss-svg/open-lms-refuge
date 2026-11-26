// @vitest-environment happy-dom
// The warning has to be on the page, not only in a comment. Aggregate stays
// the default even when this notice is shown.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LearnerLevelNotice } from "@/components/export-learner-level";
import { LEARNER_LEVEL_CONFIRMATION, LEARNER_LEVEL_WARNING } from "@/lib/export/offer";

let root: Root;
let container: HTMLDivElement;

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

describe("learner-level export notice", () => {
  it("shows the sensitive-data warning and a confirmation box", async () => {
    await act(async () => {
      root.render(
        <form>
          <label>
            <input type="radio" name="mode" value="aggregate" defaultChecked />
            Aggregate report
          </label>
          <label>
            <input type="radio" name="mode" value="pseudonymized" />
            Pseudonymized learner-level file
          </label>
          <LearnerLevelNotice warning={LEARNER_LEVEL_WARNING} confirmationLabel={LEARNER_LEVEL_CONFIRMATION} />
        </form>,
      );
    });
    const warning = container.querySelector("[role='alert']");
    expect(warning?.textContent).toBe(LEARNER_LEVEL_WARNING);
    expect(warning?.textContent).toContain("is not anonymous");
    expect(warning?.className).toContain("font-medium");
    const box = container.querySelector("input[name='learnerLevelConfirmed']");
    expect(box).toBeInstanceOf(HTMLInputElement);
    expect(box).toHaveProperty("value", "yes");
    expect((box as HTMLInputElement).checked).toBe(false);
    const aggregate = container.querySelector("input[value='aggregate']");
    expect(aggregate).toHaveProperty("checked", true);
  });
});
