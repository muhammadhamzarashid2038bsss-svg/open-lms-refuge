import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import type { CatalogNote } from "../lib/data/record-catalog";
import { draftForNoteChoice, noteSaveInput } from "../lib/device/note-draft";
import { listLocalRecords, saveLocalNote } from "../lib/device/local-records";

const owner = { centerId: "00000000-0000-4000-8000-0000000000c1", userId: "00000000-0000-4000-8000-0000000000a1" };
const sectionId = "00000000-0000-4000-8000-000000000033";
const learnerId = "00000000-0000-4000-8000-000000000022";
const deviceKey = "00000000-0000-4000-8000-0000000000d1";

const granted = {
  persist: async () => true,
  estimate: async () => ({ quota: 5_000_000, usage: 1000 }),
};

function note(id: string, skillGaps: string[], customSkillTagId: string | null = null): CatalogNote {
  return {
    id,
    sectionId,
    learnerId,
    skillGaps,
    customSkillTagId,
    customSkillTagName: customSkillTagId ? "Map reading" : null,
    customSkillTagActive: customSkillTagId !== null,
    versionVector: { [deviceKey]: 1 },
    provisional: false,
  };
}

const reading = note("00000000-0000-4000-8000-000000001101", ["READING", "WRITING"]);
const numbers = note("00000000-0000-4000-8000-000000001102", ["NUMBER_SENSE", "CUSTOM"], "00000000-0000-4000-8000-000000001199");
const notes = [reading, numbers];

beforeEach(() => {
  globalThis.IDBKeyRange = IDBKeyRange;
});

describe("progress note editor choice", () => {
  it("loads the skill gaps of the selected note and leaves the note text empty", () => {
    expect(draftForNoteChoice(reading.id, notes)).toEqual({
      noteId: reading.id,
      body: "",
      skillGaps: ["READING", "WRITING"],
      customSkillTagId: "",
      legacyCustomLabel: "",
    });
  });

  it("loads the newly selected note when the teacher switches", () => {
    const first = draftForNoteChoice(reading.id, notes);
    const second = draftForNoteChoice(numbers.id, notes);
    expect(first.body).toBe("");
    expect(second).toEqual({
      noteId: numbers.id,
      body: "",
      skillGaps: ["NUMBER_SENSE", "CUSTOM"],
      customSkillTagId: numbers.customSkillTagId,
      legacyCustomLabel: "",
    });
    expect(second.skillGaps).not.toBe(numbers.skillGaps);
    expect(JSON.stringify(second)).not.toContain("map reading");
  });

  it("clears the previous note when New note is selected", () => {
    const filled = draftForNoteChoice(numbers.id, notes);
    expect(filled.skillGaps).toEqual(["NUMBER_SENSE", "CUSTOM"]);
    expect(draftForNoteChoice("", notes)).toEqual({
      noteId: "",
      body: "",
      skillGaps: [],
      customSkillTagId: "",
      legacyCustomLabel: "",
    });
  });

  it("keeps the original record id when an existing note is edited and saved", async () => {
    const indexedDB = new IDBFactory();
    const chosen = draftForNoteChoice(reading.id, notes);
    const edited = { ...chosen, body: "Learner participates well in reading activities. Comprehension is improving." };
    const before = await listLocalRecords(indexedDB, owner);
    expect(before.ok && before.mutations).toEqual([]);

    const saved = await saveLocalNote(indexedDB, owner, noteSaveInput(edited, sectionId, learnerId, reading.versionVector), { storage: granted });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.mutation.recordId).toBe(reading.id);
    expect(saved.mutation.entityType).toBe("PROGRESS_NOTE");
    if (!("body" in saved.mutation.content)) throw new Error("saved note content missing");
    expect(saved.mutation.content.body).toBe(edited.body);
    expect(saved.mutation.content.skillGaps).toEqual(["READING", "WRITING"]);

    const again = await saveLocalNote(
      indexedDB,
      owner,
      noteSaveInput({ ...edited, body: `${edited.body} Still the same note.` }, sectionId, learnerId, saved.mutation.versionVector),
      { storage: granted },
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.mutation.recordId).toBe(reading.id);
    expect(again.mutation.clientMutationId).not.toBe(saved.mutation.clientMutationId);
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok && listed.mutations.map((item) => item.recordId)).toEqual([reading.id, reading.id]);
  });
});
