// Choosing a saved note fills the skill gaps and the center tag id from the
// list. The list does not include the note text or an older custom label.
// Those arrive only after that one note is opened. This does not write a
// mutation. The phone queues an edit when the teacher presses Save, using
// the same record id so the later sync updates that note instead of creating
// another. A new save names a center tag id. It does not send a typed category.

import type { CatalogNote } from "@/lib/data/record-catalog";

export type NoteDraft = {
  noteId: string;
  body: string;
  skillGaps: string[];
  customSkillTagId: string;
  legacyCustomLabel: string;
};

const emptyDraft = (): NoteDraft => ({ noteId: "", body: "", skillGaps: [], customSkillTagId: "", legacyCustomLabel: "" });

export function draftForNoteChoice(choiceId: string, notes: readonly CatalogNote[]): NoteDraft {
  const note = choiceId ? notes.find((item) => item.id === choiceId) : undefined;
  if (!note) return emptyDraft();
  return {
    noteId: note.id,
    body: "",
    skillGaps: [...note.skillGaps],
    customSkillTagId: note.customSkillTagId ?? "",
    legacyCustomLabel: "",
  };
}

export function noteSaveInput(
  draft: NoteDraft,
  sectionId: string,
  learnerId: string,
  baseVector: CatalogNote["versionVector"] | undefined,
) {
  return {
    sectionId,
    learnerId,
    body: draft.body,
    skillGaps: draft.skillGaps,
    customSkillTagId: draft.customSkillTagId.length > 0 ? draft.customSkillTagId : null,
    recordId: draft.noteId.length > 0 ? draft.noteId : null,
    baseVector: baseVector ?? {},
  };
}
