// @vitest-environment happy-dom
// Renders the real editor and fires the note dropdown's change event.
// The draft helper is not enough: the old handler only stored the note id,
// so the box and the skill-gap boxes stayed empty.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfflineRecordEditor } from "@/components/offline-record-editor";
import type { RecordCatalog } from "@/lib/data/record-catalog";

const centerId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000004";
const sectionId = "00000000-0000-4000-8000-00000000000b";
const learnerId = "00000000-0000-4000-8000-0000000000c8";
const readingId = "21bb34d2-98ad-4792-91bc-9e46b7bcef7e";
const otherId = "00000000-0000-4000-8000-000000001771";
const readingBody = "Learner participates well in reading activities and is improving in comprehension.";
const otherBody = "Demo note: letter sounds for A to E are in progress.";

const catalog: RecordCatalog = {
  sections: [
    {
      id: sectionId,
      name: "Morning Group",
      assignments: [{ id: "00000000-0000-4000-8000-00000000044f", title: "Demo midterm paper", maxPoints: "100.00" }],
      learners: [{ id: learnerId, learnerCode: "LNR-0001", displayName: "Demo Learner 01" }],
    },
  ],
  grades: [],
  notes: [
    {
      id: otherId,
      sectionId,
      learnerId,
      body: otherBody,
      skillGaps: ["WRITING"],
      customSkillLabel: null,
      versionVector: { "00000000-0000-4000-8000-0000000000d1": 1 },
      provisional: false,
    },
    {
      id: readingId,
      sectionId,
      learnerId,
      body: readingBody,
      skillGaps: ["READING"],
      customSkillLabel: null,
      versionVector: { "63cff376-e264-4597-89bf-b1da82096e69": 1 },
      provisional: false,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let opens = 0;

beforeEach(() => {
  opens = 0;
  HTMLElement.prototype.scrollIntoView = () => {};
  // A selection must not open the phone database. Save is the only writer.
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        opens += 1;
        throw new Error("selecting a note must not open the phone database");
      },
    },
  });
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

function noteSelect(): HTMLSelectElement {
  const select = [...container.querySelectorAll("select")].find((item) => item.options[0]?.text === "New note");
  if (!select) throw new Error("the existing-note dropdown is missing");
  return select;
}

function noteBox(): HTMLTextAreaElement {
  const box = container.querySelector("textarea");
  if (!box) throw new Error("the note box is missing");
  return box;
}

function gapBox(label: string): HTMLInputElement {
  const input = [...container.querySelectorAll("input[type='checkbox']")].find(
    (item) => item.parentElement?.textContent?.includes(label),
  );
  if (!input) throw new Error(`${label} is missing`);
  return input as HTMLInputElement;
}

async function choose(id: string) {
  const select = noteSelect();
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("progress note form", () => {
  it("fills the note box and the Reading box from the selected saved note", async () => {
    await act(async () => {
      root.render(<OfflineRecordEditor centerId={centerId} userId={userId} catalog={catalog} />);
    });

    expect(noteSelect().value).toBe("");
    expect(noteBox().value).toBe("");
    expect(gapBox("Reading").checked).toBe(false);

    await choose(readingId);

    expect(noteSelect().value).toBe(readingId);
    expect(noteBox().value).toBe(readingBody);
    expect(gapBox("Reading").checked).toBe(true);
    expect(gapBox("Writing").checked).toBe(false);
    const customLabel = [...container.querySelectorAll("input")].find(
      (item) => item instanceof HTMLInputElement && item.maxLength === 80,
    );
    expect(customLabel).toBeInstanceOf(HTMLInputElement);
    expect((customLabel as HTMLInputElement).value).toBe("");
    expect(opens).toBe(0);
  });

  it("loads the other note, then clears the form for a new note, without saving", async () => {
    await act(async () => {
      root.render(<OfflineRecordEditor centerId={centerId} userId={userId} catalog={catalog} />);
    });

    await choose(readingId);
    await choose(otherId);

    expect(noteSelect().value).toBe(otherId);
    expect(noteBox().value).toBe(otherBody);
    expect(gapBox("Reading").checked).toBe(false);
    expect(gapBox("Writing").checked).toBe(true);

    await choose("");

    expect(noteSelect().value).toBe("");
    expect(noteBox().value).toBe("");
    expect(gapBox("Reading").checked).toBe(false);
    expect(gapBox("Writing").checked).toBe(false);
    expect(opens).toBe(0);
  });
});
