// Reads one progress note for an assigned teacher or the center director.
// The audit row is written before the note text is returned. If that write
// fails, this function throws and the caller must not show the note.
// Metadata is only the source. It never includes the note, a tag name, or a learner.

import { Prisma } from "../../generated/prisma/client";
import { canViewProgressNote, type Actor } from "../auth/permissions";
import { prisma } from "../db";

type Tx = Prisma.TransactionClient;

export const NOTE_VIEW_FAILED = "The note view could not be recorded.";

export type NoteViewMetadata = { source: "online" } | { source: "offline"; clientEventId: string };

export type ProgressNoteView = {
  id: string;
  body: string;
  skillGaps: string[];
  sectionName: string;
  learnerCode: string;
  learnerName: string;
  updatedAt: string;
  customTagName: string | null;
  customTagActive: boolean;
  legacyCustomLabel: string | null;
};

export type ProgressNoteSummary = {
  id: string;
  sectionName: string;
  learnerCode: string;
  learnerName: string;
  updatedAt: string;
  skillGaps: string[];
  customTagName: string | null;
  customTagActive: boolean;
  hasLegacyLabel: boolean;
};

const noteSelect = {
  id: true,
  body: true,
  skillGaps: true,
  customSkillLabel: true,
  updatedAt: true,
  sectionId: true,
  section: { select: { name: true, course: { select: { centerId: true } } } },
  learner: { select: { learnerCode: true, displayName: true } },
  customSkillTag: { select: { name: true, active: true } },
} as const;

export async function writeNoteViewAudits(
  tx: Tx,
  actor: Actor,
  noteIds: string[],
  metadata: NoteViewMetadata,
): Promise<void> {
  if (noteIds.length === 0) return;
  const written = await tx.auditLog.createMany({
    data: noteIds.map((entityId) => ({
      centerId: actor.centerId,
      actorId: actor.id,
      action: "VIEW" as const,
      entityType: "PROGRESS_NOTE" as const,
      entityId,
      metadata,
    })),
  });
  if (written.count !== noteIds.length) throw new Error(NOTE_VIEW_FAILED);
}

function toView(note: {
  id: string;
  body: string;
  skillGaps: string[];
  customSkillLabel: string | null;
  updatedAt: Date;
  section: { name: string };
  learner: { learnerCode: string; displayName: string };
  customSkillTag: { name: string; active: boolean } | null;
}): ProgressNoteView {
  return {
    id: note.id,
    body: note.body,
    skillGaps: [...note.skillGaps],
    sectionName: note.section.name,
    learnerCode: note.learner.learnerCode,
    learnerName: note.learner.displayName,
    updatedAt: note.updatedAt.toISOString(),
    customTagName: note.customSkillTag?.name ?? null,
    customTagActive: note.customSkillTag?.active ?? false,
    legacyCustomLabel: note.customSkillTag ? null : note.customSkillLabel,
  };
}

/// Returns null when the caller must not see the note. The same null is used
/// for a missing id and a forbidden id, so a guess does not reveal the text.
/// A failed audit throws instead of returning the note.
export async function readProgressNote(actor: Actor, noteId: string): Promise<ProgressNoteView | null> {
  if (!actor.active) return null;
  const note = await prisma.progressNote.findUnique({ where: { id: noteId }, select: noteSelect });
  if (!note) return null;
  const centerId = note.section.course.centerId;
  if (!canViewProgressNote(actor, { centerId, sectionId: note.sectionId })) return null;
  await prisma.$transaction(async (tx) => {
    await writeNoteViewAudits(tx, actor, [note.id], { source: "online" });
  });
  return toView(note);
}

/// Director list. The note text and any legacy label stay off this response.
/// Opening one note is a separate audited read.
export async function listProgressNoteSummaries(actor: Actor): Promise<ProgressNoteSummary[] | null> {
  if (!actor.active || actor.role !== "CENTER_DIRECTOR") return null;
  const rows = await prisma.progressNote.findMany({
    where: { section: { course: { centerId: actor.centerId } } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      skillGaps: true,
      updatedAt: true,
      section: { select: { name: true } },
      learner: { select: { learnerCode: true, displayName: true } },
      customSkillTag: { select: { name: true, active: true } },
      customSkillLabel: true,
    },
  });
  return rows.map((note) => ({
    id: note.id,
    sectionName: note.section.name,
    learnerCode: note.learner.learnerCode,
    learnerName: note.learner.displayName,
    updatedAt: note.updatedAt.toISOString(),
    skillGaps: [...note.skillGaps],
    customTagName: note.customSkillTag?.name ?? null,
    customTagActive: note.customSkillTag?.active ?? false,
    hasLegacyLabel: note.customSkillLabel !== null && note.customSkillTag === null,
  }));
}
