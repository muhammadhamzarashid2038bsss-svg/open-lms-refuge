// The lists a teacher needs to save a grade or a note on the phone.
// Only sections assigned to that teacher are included.

import { Prisma } from "../../generated/prisma/client";
import type { Actor } from "../auth/permissions";
import { prisma } from "../db";
import { parseVersionVector, type VersionVector } from "../sync/version-vector";

export type CatalogSection = {
  id: string;
  name: string;
  assignments: { id: string; title: string; maxPoints: string }[];
  learners: { id: string; learnerCode: string; displayName: string }[];
};

export type CatalogGrade = {
  id: string;
  assignmentId: string;
  learnerId: string;
  points: string;
  academicNote: string | null;
  versionVector: VersionVector;
  provisional: boolean;
};

// The list identifies a note. It does not carry the note text or an older
// custom label. Opening one note loads that text and records the view.
export type CatalogNote = {
  id: string;
  sectionId: string;
  learnerId: string;
  skillGaps: string[];
  customSkillTagId: string | null;
  customSkillTagName: string | null;
  customSkillTagActive: boolean;
  versionVector: VersionVector;
  provisional: boolean;
};

export type RecordCatalog = {
  sections: CatalogSection[];
  grades: CatalogGrade[];
  notes: CatalogNote[];
  skillTags: { id: string; name: string }[];
};

function pointsText(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export async function loadRecordCatalog(actor: Actor): Promise<RecordCatalog | null> {
  if (!actor.active || actor.role !== "TEACHER") return null;
  const sectionIds = actor.assignedSectionIds;
  if (sectionIds.length === 0) return { sections: [], grades: [], notes: [], skillTags: [] };
  const [sections, grades, notes, openConflicts, skillTags] = await Promise.all([
    prisma.section.findMany({
      where: { id: { in: sectionIds } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        assignments: { orderBy: { title: "asc" }, select: { id: true, title: true, maxPoints: true } },
        enrollments: {
          where: { status: "ACTIVE" },
          orderBy: { learner: { learnerCode: "asc" } },
          select: { learner: { select: { id: true, learnerCode: true, displayName: true } } },
        },
      },
    }),
    prisma.gradeEntry.findMany({
      where: { assignment: { sectionId: { in: sectionIds } } },
      select: {
        id: true,
        assignmentId: true,
        learnerId: true,
        points: true,
        academicNote: true,
        versionVector: true,
      },
    }),
    prisma.progressNote.findMany({
      where: { sectionId: { in: sectionIds } },
      select: {
        id: true,
        sectionId: true,
        learnerId: true,
        skillGaps: true,
        customSkillTagId: true,
        customSkillTag: { select: { name: true, active: true } },
        versionVector: true,
      },
    }),
    prisma.syncConflict.findMany({
      where: {
        state: "OPEN",
        OR: [
          { gradeEntry: { assignment: { sectionId: { in: sectionIds } } } },
          { progressNote: { sectionId: { in: sectionIds } } },
        ],
      },
      select: { gradeEntryId: true, progressNoteId: true },
    }),
    prisma.centerSkillTag.findMany({
      where: { centerId: actor.centerId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const openGrades = new Set(openConflicts.map((row) => row.gradeEntryId).filter((id): id is string => id !== null));
  const openNotes = new Set(openConflicts.map((row) => row.progressNoteId).filter((id): id is string => id !== null));
  const visibleNotes = notes.flatMap((note) => {
    const versionVector = parseVersionVector(note.versionVector);
    if (!versionVector) return [];
    return [{
      id: note.id,
      sectionId: note.sectionId,
      learnerId: note.learnerId,
      skillGaps: [...note.skillGaps],
      customSkillTagId: note.customSkillTagId,
      customSkillTagName: note.customSkillTag?.name ?? null,
      customSkillTagActive: note.customSkillTag?.active ?? false,
      versionVector,
      provisional: openNotes.has(note.id),
    }];
  });
  // Loading this list is not opening a note, so it writes no view record.
  // The note text stays on the server until one note is requested.
  return {
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      assignments: section.assignments.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        maxPoints: pointsText(assignment.maxPoints),
      })),
      learners: section.enrollments.map((enrollment) => enrollment.learner),
    })),
    grades: grades.flatMap((grade) => {
      const versionVector = parseVersionVector(grade.versionVector);
      if (!versionVector) return [];
      return [{
        id: grade.id,
        assignmentId: grade.assignmentId,
        learnerId: grade.learnerId,
        points: pointsText(grade.points),
        academicNote: grade.academicNote,
        versionVector,
        provisional: openGrades.has(grade.id),
      }];
    }),
    notes: visibleNotes,
    skillTags,
  };
}
