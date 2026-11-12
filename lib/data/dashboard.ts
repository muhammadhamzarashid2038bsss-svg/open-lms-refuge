// LMS-7 reads the gradebook rows and the attendance sheet. It does not create
// a second grade or a second sync path. The permission check happens here, on
// the server, before any section numbers are returned.

import { Prisma } from "../../generated/prisma/client";
import { canViewPerformance, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import { RECORD_VIEW_FAILED, writeRecordViews } from "./audit";
import {
  buildSectionPerformance,
  type AssignmentKindName,
  type AttendanceStatusName,
  type PerformanceInput,
  type SectionPerformance,
  type SessionStatusName,
  type UploadStateName,
} from "../lms/dashboard-metrics";
import { isUuid } from "../lms/timetable";

export type LearnerPerformancePage = {
  sectionId: string;
  sectionName: string;
  courseTitle: string;
  learner: SectionPerformance["learners"][number];
};

export type CenterPerformance = {
  sections: SectionPerformance[];
};

type Db = typeof prisma;

export async function loadSectionPerformance(
  actor: Actor,
  sectionId: string,
  now = new Date(),
  db: Db = prisma,
): Promise<SectionPerformance | null> {
  if (!canRequest(actor, sectionId)) return null;
  const sections = await readSections(actor, [sectionId], now, db);
  return sections[0] ?? null;
}

export async function loadLearnerPerformance(
  actor: Actor,
  sectionId: string,
  learnerId: string,
  now = new Date(),
  db: Db = prisma,
): Promise<LearnerPerformancePage | null> {
  if (!isUuid(learnerId)) return null;
  const section = await loadSectionPerformance(actor, sectionId, now, db);
  const learner = section?.learners.find((item) => item.id === learnerId);
  if (!section || !learner) return null;
  const grades = await db.gradeEntry.findMany({
    where: { learnerId, assignment: { sectionId } },
    select: { id: true },
  });
  try {
    await prisma.$transaction(async (tx) => {
      await writeRecordViews(tx, actor, "GRADE_ENTRY", grades.map((grade) => grade.id), { source: "online" });
    });
  } catch {
    throw new Error(RECORD_VIEW_FAILED);
  }
  return {
    sectionId: section.sectionId,
    sectionName: section.sectionName,
    courseTitle: section.courseTitle,
    learner,
  };
}

export async function loadCenterPerformance(actor: Actor, now = new Date(), db: Db = prisma): Promise<CenterPerformance | null> {
  if (!actor.active || actor.role !== "CENTER_DIRECTOR") return null;
  const rows = await db.section.findMany({
    where: { course: { centerId: actor.centerId } },
    select: { id: true },
    orderBy: [{ course: { title: "asc" } }, { name: "asc" }],
  });
  return { sections: await readSections(actor, rows.map((row) => row.id), now, db) };
}

function canRequest(actor: Actor, sectionId: string): boolean {
  if (!actor.active || !isUuid(sectionId)) return false;
  if (actor.role === "TEACHER") return actor.assignedSectionIds.includes(sectionId);
  return actor.role === "CENTER_DIRECTOR";
}

async function readSections(actor: Actor, sectionIds: string[], now: Date, db: Db): Promise<SectionPerformance[]> {
  if (sectionIds.length === 0) return [];
  const [rows, conflicts] = await Promise.all([
    db.section.findMany({
      where: { id: { in: sectionIds }, course: { centerId: actor.centerId } },
      select: {
        id: true,
        name: true,
        course: { select: { title: true, centerId: true, center: { select: { timezone: true } } } },
        enrollments: {
          where: { status: "ACTIVE" },
          orderBy: { learner: { learnerCode: "asc" } },
          select: {
            enrolledOn: true,
            withdrawnOn: true,
            learner: { select: { id: true, learnerCode: true, displayName: true } },
          },
        },
        assignments: {
          select: {
            id: true,
            title: true,
            kind: true,
            maxPoints: true,
            dueAt: true,
            createdAt: true,
            gradeEntries: { select: { id: true, learnerId: true, points: true } },
            submissions: { select: { id: true, learnerId: true, uploadState: true, updatedAt: true, receivedAt: true } },
          },
        },
        sessions: {
          select: {
            id: true,
            title: true,
            startsAt: true,
            status: true,
            attendanceRecords: { select: { id: true, learnerId: true, status: true, syncedAt: true, createdAt: true } },
          },
        },
      },
    }),
    db.syncConflict.findMany({
      where: { state: "OPEN", gradeEntry: { assignment: { sectionId: { in: sectionIds } } } },
      select: { gradeEntryId: true },
    }),
  ]);
  const openIds = new Set(conflicts.map((conflict) => conflict.gradeEntryId).filter((id): id is string => id !== null));
  const order = new Map(sectionIds.map((id, index) => [id, index]));
  return rows
    .filter((row) => canViewPerformance(actor, { id: row.id, centerId: row.course.centerId }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((row) => buildSectionPerformance(toInput(row, openIds, now)));
}

function toInput(
  row: {
    id: string;
    name: string;
    course: { title: string; center: { timezone: string } };
    enrollments: {
      enrolledOn: Date;
      withdrawnOn: Date | null;
      learner: { id: string; learnerCode: string; displayName: string };
    }[];
    assignments: {
      id: string;
      title: string;
      kind: string;
      maxPoints: Prisma.Decimal;
      dueAt: Date | null;
      createdAt: Date;
      gradeEntries: { id: string; learnerId: string; points: Prisma.Decimal }[];
      submissions: { id: string; learnerId: string; uploadState: string; updatedAt: Date; receivedAt: Date | null }[];
    }[];
    sessions: {
      id: string;
      title: string;
      startsAt: Date;
      status: string;
      attendanceRecords: { id: string; learnerId: string; status: string; syncedAt: Date; createdAt: Date }[];
    }[];
  },
  openIds: Set<string>,
  now: Date,
): PerformanceInput {
  const assignments = row.assignments.flatMap((assignment) => {
    const kind = asKind(assignment.kind);
    return kind ? [{ ...assignment, kind }] : [];
  });
  return {
    now,
    timeZone: row.course.center.timezone,
    sectionId: row.id,
    sectionName: row.name,
    courseTitle: row.course.title,
    learners: row.enrollments.map((enrollment) => ({
      id: enrollment.learner.id,
      learnerCode: enrollment.learner.learnerCode,
      displayName: enrollment.learner.displayName,
      enrolledOn: enrollment.enrolledOn,
      withdrawnOn: enrollment.withdrawnOn,
    })),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      kind: assignment.kind,
      maxPoints: pointsText(assignment.maxPoints),
      dueAt: assignment.dueAt,
      createdAt: assignment.createdAt,
    })),
    grades: assignments.flatMap((assignment) =>
      assignment.gradeEntries.map((grade) => ({
        id: grade.id,
        assignmentId: assignment.id,
        learnerId: grade.learnerId,
        points: pointsText(grade.points),
        openConflict: openIds.has(grade.id),
      })),
    ),
    submissions: assignments.flatMap((assignment) =>
      assignment.submissions.flatMap((submission) => {
        const uploadState = asUpload(submission.uploadState);
        return uploadState
          ? [
              {
                id: submission.id,
                assignmentId: assignment.id,
                learnerId: submission.learnerId,
                uploadState,
                updatedAt: submission.updatedAt,
                receivedAt: submission.receivedAt,
              },
            ]
          : [];
      }),
    ),
    sessions: row.sessions.flatMap((session) => {
      const status = asSessionStatus(session.status);
      return status ? [{ id: session.id, title: session.title, startsAt: session.startsAt, status }] : [];
    }),
    attendance: row.sessions.flatMap((session) =>
      session.attendanceRecords.flatMap((event) => {
        const status = asAttendance(event.status);
        return status
          ? [{ id: event.id, sessionId: session.id, learnerId: event.learnerId, status, syncedAt: event.syncedAt, createdAt: event.createdAt }]
          : [];
      }),
    ),
  };
}

function pointsText(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

function asKind(kind: string): AssignmentKindName | null {
  if (kind === "PAPER" || kind === "DIGITAL" || kind === "BOTH" || kind === "IN_CLASS_EXAM") return kind;
  return null;
}

function asUpload(state: string): UploadStateName | null {
  if (state === "QUEUED" || state === "UPLOADING" || state === "STORED" || state === "FAILED") return state;
  return null;
}

function asSessionStatus(status: string): SessionStatusName | null {
  if (status === "SCHEDULED" || status === "HELD" || status === "CANCELLED") return status;
  return null;
}

function asAttendance(status: string): AttendanceStatusName | null {
  if (status === "PRESENT" || status === "ABSENT" || status === "LATE" || status === "EXCUSED") return status;
  return null;
}
