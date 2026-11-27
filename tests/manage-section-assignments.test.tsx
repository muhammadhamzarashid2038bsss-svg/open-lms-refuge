// @vitest-environment happy-dom
// The section menu is one stacked form. Changing the section swaps the
// button, so a phone does not show two separate forms.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManageSectionAssignments } from "@/components/manage-section-assignments";
import type { ManagedSection } from "@/lib/lms/section-management";

const sections: ManagedSection[] = [
  {
    id: "empty",
    courseTitle: "Demo English and Number Sense",
    sectionName: "Afternoon Group",
    centerId: "centre",
    currentTeachers: [],
  },
  {
    id: "one",
    courseTitle: "Demo English and Number Sense",
    sectionName: "Morning Group",
    centerId: "centre",
    currentTeachers: [{ id: "ada", name: "Ada" }],
  },
  {
    id: "two",
    courseTitle: "Demo English and Number Sense",
    sectionName: "Evening Group",
    centerId: "centre",
    currentTeachers: [{ id: "ada", name: "Ada" }, { id: "bo", name: "Bo" }],
  },
];

const teachers = [
  { id: "ada", name: "Ada", centerId: "centre" },
  { id: "bo", name: "Bo", centerId: "centre" },
  { id: "cy", name: "Cy", centerId: "centre" },
];

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

async function renderForm() {
  await act(async () => {
    root.render(
      <ManageSectionAssignments
        sections={sections}
        teachers={teachers}
        blankHint="Choose the teacher who is taking over."
        blankOptionLabel="No incoming teacher — send the report to me"
      />,
    );
  });
}

function sectionSelect(): HTMLSelectElement {
  const select = container.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) throw new Error("section select missing");
  return select;
}

async function choose(id: string) {
  const select = sectionSelect();
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("manage section assignments", () => {
  it("shows staffed and unstaffed sections, then the matching action", async () => {
    await renderForm();
    const text = container.textContent ?? "";
    expect(text).toContain("Manage section assignments");
    expect(sectionSelect().className).toContain("w-full");
    expect(sectionSelect().className).toContain("min-h-12");
    const options = [...sectionSelect().options].map((option) => option.textContent);
    expect(options).toEqual([
      "Demo English and Number Sense · Afternoon Group — Unstaffed",
      "Demo English and Number Sense · Morning Group — 1 current teacher",
      "Demo English and Number Sense · Evening Group — 2 current teachers",
    ]);

    expect(text).toContain("No current teacher");
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Assign teacher"]);
    const assign = container.querySelector("form")?.querySelector("select");
    expect(assign?.className).toContain("w-full");

    await choose("one");
    expect(container.textContent).toContain("This transfers the assignment for Ada.");
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Reassign section"]);
    const hidden = container.querySelector("input[name='assignment']");
    expect(hidden).toHaveProperty("value", "one|ada");

    await choose("two");
    expect(container.textContent).toContain("The handoff covers only the selected assignment.");
    const outgoing = [...container.querySelectorAll("select")].at(1);
    expect(outgoing?.querySelectorAll("option")).toHaveLength(2);
    expect(container.querySelector("input[name='assignment']")).toHaveProperty("value", "two|ada");
  });
});