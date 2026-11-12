// Teachers add assignments only for a section they are assigned to now.
// The gradebook reads the same GradeEntry rows the sync engine already writes.
// A homework file is a Submission. It does not create a grade.

import { Prisma } from "../../generated/prisma/client";
import { canEditAssignedRecords, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import { RECORD_VIEW_FAILED, writeRecordViews } from "./audit";
import { validateNewAssignment, serverFileStatus, type CreatableAssignmentKind, type ServerFileStatus } from "../lms/gradebook";
import { isUuid } from "../lms/timetable";
import { parseVersionVector, type VersionVector } from "../sync/version-vector";

const NOT_YOUR_SECTION = "You can add an assignment only for a section assigned to you.";

export type GradebookGrade = {
  id: string;
  assignmentId: string;
  learnerId: string;
  points: string;
  academicNote: string | null;
  versionVector: VersionVector;
  provisional: boolean;
};

export type GradebookView = {
  sectionId: string;
  sectionName: string;
  courseTitle: string;
  learners: { id: string; learnerCode: string; displayName: string }[];
  assignments: {
    id: string;
    title: string;
    kind: string;
    maxPoints: string;
  }[];
  grades: GradebookGrade[];
  files: { assignmentId: string; learnerId: string; status: ServerFileStatus; submissionId: string | null }[];
};

function pointsText(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export async function createAssignment(
  actor: Actor,
  input: { sectionId: string; title: string; kind: string; maxPoints: string },
): Promise<
  { ok: true; assignmentId: string; kind: CreatableAssignmentKind } | { ok: false; message: string }
> {
  const parsed = validateNewAssignment(input);
  if (!parsed.ok) return parsed;
  if (!actor.active || !isUuid(input.sectionId)) return { ok: false, message: NOT_YOUR_SECTION };
  const section = await prisma.section.findUnique({
    where: { id: input.sectionId },
    select: { id: true, course: { select: { centerId: true } } },
  });
  if (!section || !canEditAssignedRecords(actor, { id: section.id, centerId: section.course.centerId })) {
    return { ok: false, message: NOT_YOUR_SECTION };
  }
  const created = await prisma.assignment.create({
    data: {
      sectionId: section.id,
      title: parsed.title,
      kind: parsed.kind,
      maxPoints: parsed.maxPoints,
      createdById: actor.id,
    },
    select: { id: true, kind: true },
  });
  if (created.kind !== parsed.kind) {
    return { ok: false, message: "The assignment could not be saved." };
  }
  return { ok: true, assignmentId: created.id, kind: parsed.kind };
}

export async function loadSectionGradebook(actor: Actor, sectionId: string): Promise<GradebookView | null> {
  if (!actor.active || actor.role !== "TEACHER" || !isUuid(sectionId)) return null;
  const section = await prisma.section.findUnique({
    where: { id: sectionId },
    select: {
      id: true,
      name: true,
      course: { select: { title: true, centerId: true } },
      assignments: {
        orderBy: [{ dueAt: "asc" }, { title: "asc" }],
        select: { id: true, title: true, kind: true, maxPoints: true },
      },
      enrollments: {
        where: { status: "ACTIVE" },
        orderBy: { learner: { learnerCode: "asc" } },
        select: { learner: { select: { id: true, learnerCode: true, displayName: true } } },
      },
    },
  });
  if (!section || !canEditAssignedRecords(actor, { id: section.id, centerId: section.course.centerId })) return null;
  const [grades, openConflicts, submissions] = await Promise.all([
    prisma.gradeEntry.findMany({
      where: { assignment: { sectionId: section.id } },
      select: {
        id: true,
        assignmentId: true,
        learnerId: true,
        points: true,
        academicNote: true,
        versionVector: true,
      },
    }),
    prisma.syncConflict.findMany({
      where: { state: "OPEN", gradeEntry: { assignment: { sectionId: section.id } } },
      select: { gradeEntryId: true },
    }),
    prisma.submission.findMany({
      where: { assignment: { sectionId: section.id, kind: { in: ["DIGITAL", "BOTH"] } } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, assignmentId: true, learnerId: true, uploadState: true },
    }),
  ]);
  const openIds = new Set(
    openConflicts.map((row) => row.gradeEntryId).filter((id): id is string => id !== null),
  );
  const visibleGrades = grades.flatMap((grade) => {
    const versionVector = parseVersionVector(grade.versionVector);
    if (!versionVector) return [];
    return [
      {
        id: grade.id,
        assignmentId: grade.assignmentId,
        learnerId: grade.learnerId,
        points: pointsText(grade.points),
        academicNote: grade.academicNote,
        versionVector,
        provisional: openIds.has(grade.id),
      },
    ];
  });
  try {
    await prisma.$transaction(async (tx) => {
      await writeRecordViews(tx, actor, "GRADE_ENTRY", visibleGrades.map((grade) => grade.id), { source: "online" });
    });
  } catch {
    throw new Error(RECORD_VIEW_FAILED);
  }
  return {
    sectionId: section.id,
    sectionName: section.name,
    courseTitle: section.course.title,
    learners: section.enrollments.map((enrollment) => enrollment.learner),
    assignments: section.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      kind: assignment.kind,
      maxPoints: pointsText(assignment.maxPoints),
    })),
    grades: visibleGrades,
    files: latestFiles(section.assignments, section.enrollments.map((enrollment) => enrollment.learner.id), submissions),
  };
}

function latestFiles(
  assignments: { id: string; kind: string }[],
  learnerIds: string[],
  submissions: { id: string; assignmentId: string; learnerId: string; uploadState: "QUEUED" | "UPLOADING" | "STORED" | "FAILED" }[],
): GradebookView["files"] {
  const fileAssignments = assignments.filter((assignment) => assignment.kind === "DIGITAL" || assignment.kind === "BOTH");
  return fileAssignments.flatMap((assignment) =>
    learnerIds.map((learnerId) => {
      const row = submissions.find((item) => item.assignmentId === assignment.id && item.learnerId === learnerId);
      return {
        assignmentId: assignment.id,
        learnerId,
        status: serverFileStatus(row?.uploadState ?? null),
        submissionId: row && row.uploadState === "STORED" ? row.id : null,
      };
    }),
  );
}
