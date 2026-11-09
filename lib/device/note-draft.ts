// Choosing a saved note only fills the form. It does not write a mutation.
// The phone queues an edit when the teacher presses Save, using the same
// record id so the later sync updates that note instead of creating another.

import type { CatalogNote } from "@/lib/data/record-catalog";

export type NoteDraft = {
  noteId: string;
  body: string;
  skillGaps: string[];
  customSkillLabel: string;
};

const emptyDraft = (): NoteDraft => ({ noteId: "", body: "", skillGaps: [], customSkillLabel: "" });

export function draftForNoteChoice(choiceId: string, notes: readonly CatalogNote[]): NoteDraft {
  const note = choiceId ? notes.find((item) => item.id === choiceId) : undefined;
  if (!note) return emptyDraft();
  return {
    noteId: note.id,
    body: note.body,
    skillGaps: [...note.skillGaps],
    customSkillLabel: note.customSkillLabel ?? "",
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
    customSkillLabel: draft.customSkillLabel.length > 0 ? draft.customSkillLabel : null,
    recordId: draft.noteId.length > 0 ? draft.noteId : null,
    baseVector: baseVector ?? {},
  };
}
