// Reads the rows a donor export is allowed to use. Names, phones, notes,
// PINs, passwords, and emails are not selected. Learner codes stay in memory
// only long enough to build a pseudonym, and only the protected export calls
// this. A phone number is never selected, even when the center collects one.

import { Prisma } from "../../generated/prisma/client";
import { formatCivilDate, localDateOfInstant } from "../lms/timetable";
import type { AgeBandName, ExportFacts, GenderName } from "./types";

type Tx = Prisma.TransactionClient;

const INVALID = "The export could not be built from the center records.";

type ProfileRow = {
  id: string;
  learnerCode: string;
  ageBand: AgeBandName;
  gender: GenderName | null;
};

export async function loadExportFacts(
  tx: Tx,
  input: { centerId: string; timeZone: string; genderEnabled: boolean; now: Date },
): Promise<{ ok: true; facts: ExportFacts } | { ok: false; message: string }> {
  const profiles = await loadProfiles(tx, input.centerId, input.genderEnabled);
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const enrollments = await tx.enrollment.findMany({
    where: { learner: { centerId: input.centerId } },
    select: { learnerId: true, sectionId: true, status: true, enrolledOn: true, withdrawnOn: true, completedOn: true },
  });
  const sessions = await tx.classSession.findMany({
    where: { section: { course: { centerId: input.centerId } } },
    select: { id: true, sectionId: true, startsAt: true, status: true },
  });
  const sessionIds = sessions.map((session) => session.id);
  const attendance = sessionIds.length
    ? await tx.attendanceRecord.findMany({
        where: { sessionId: { in: sessionIds } },
        select: { id: true, learnerId: true, sessionId: true, status: true, syncedAt: true, createdAt: true },
      })
    : [];
  const assignments = await tx.assignment.findMany({
    where: { section: { course: { centerId: input.centerId } } },
    select: { id: true, sectionId: true, kind: true, dueAt: true, maxPoints: true },
  });
  const assignmentIds = assignments.map((assignment) => assignment.id);
  const grades = assignmentIds.length
    ? await tx.gradeEntry.findMany({
        where: { assignmentId: { in: assignmentIds } },
        select: { id: true, assignmentId: true, learnerId: true },
      })
    : [];
  const gradeIds = grades.map((grade) => grade.id);
  const openConflicts = gradeIds.length
    ? await tx.syncConflict.findMany({
        where: { state: "OPEN", gradeEntryId: { in: gradeIds } },
        select: { gradeEntryId: true },
      })
    : [];
  const submissions = assignmentIds.length
    ? await tx.submission.findMany({
        where: { assignmentId: { in: assignmentIds } },
        select: { id: true, assignmentId: true, learnerId: true, uploadState: true, updatedAt: true },
      })
    : [];

  const currentMark = latestAttendance(attendance);
  const openGradeIds = new Set(openConflicts.map((conflict) => conflict.gradeEntryId).filter((id): id is string => id !== null));
  const settled = new Set(
    grades.filter((grade) => !openGradeIds.has(grade.id)).map((grade) => pair(grade.assignmentId, grade.learnerId)),
  );
  const stored = latestStoredFiles(submissions);

  const classes: Array<ExportFacts["classes"][number]> = [];
  for (const session of sessions) {
    const local = localDateOfInstant(session.startsAt, input.timeZone);
    if (!local) return { ok: false, message: INVALID };
    const sessionOn = formatCivilDate(local);
    const occurred = session.startsAt.getTime() <= input.now.getTime();
    for (const enrollment of enrollments) {
      if (enrollment.sectionId !== session.sectionId) continue;
      const profile = byId.get(enrollment.learnerId);
      if (!profile) return { ok: false, message: INVALID };
      const mark = currentMark.get(pair(session.id, enrollment.learnerId)) ?? null;
      classes.push({
        sessionKey: session.id,
        sectionKey: session.sectionId,
        learnerCode: profile.learnerCode,
        sessionOn,
        sessionStatus: session.status,
        occurred,
        mark,
      });
    }
  }

  const tasks: Array<ExportFacts["tasks"][number]> = [];
  for (const assignment of assignments) {
    // No due date: the gradebook never treats the task as overdue, so it is
    // not in this rate. A zero maximum cannot describe completion either.
    if (!assignment.dueAt) continue;
    const maxPoints = Number(assignment.maxPoints.toString());
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) continue;
    const local = localDateOfInstant(assignment.dueAt, input.timeZone);
    if (!local) return { ok: false, message: INVALID };
    const dueOn = formatCivilDate(local);
    const duePassed = assignment.dueAt.getTime() <= input.now.getTime();
    for (const enrollment of enrollments) {
      if (enrollment.sectionId !== assignment.sectionId) continue;
      const profile = byId.get(enrollment.learnerId);
      if (!profile) return { ok: false, message: INVALID };
      const key = pair(assignment.id, enrollment.learnerId);
      tasks.push({
        taskKey: assignment.id,
        sectionKey: assignment.sectionId,
        learnerCode: profile.learnerCode,
        dueOn,
        duePassed,
        kind: assignment.kind,
        settledGrade: settled.has(key),
        storedFile: stored.has(key),
      });
    }
  }

  const enrollmentFacts: Array<ExportFacts["enrollments"][number]> = [];
  for (const enrollment of enrollments) {
    const profile = byId.get(enrollment.learnerId);
    if (!profile) return { ok: false, message: INVALID };
    enrollmentFacts.push({
      learnerCode: profile.learnerCode,
      sectionKey: enrollment.sectionId,
      status: enrollment.status,
      enrolledOn: utcDay(enrollment.enrolledOn),
      withdrawnOn: enrollment.withdrawnOn ? utcDay(enrollment.withdrawnOn) : null,
      completedOn: enrollment.completedOn ? utcDay(enrollment.completedOn) : null,
    });
  }

  return {
    ok: true,
    facts: {
      genderEnabled: input.genderEnabled,
      people: profiles.map((profile) => ({
        learnerCode: profile.learnerCode,
        ageBand: profile.ageBand,
        gender: input.genderEnabled ? profile.gender : null,
      })),
      enrollments: enrollmentFacts,
      classes,
      tasks,
    },
  };
}

async function loadProfiles(tx: Tx, centerId: string, genderEnabled: boolean): Promise<ProfileRow[]> {
  if (genderEnabled) {
    const rows = await tx.learnerProfile.findMany({
      where: { centerId },
      select: { id: true, learnerCode: true, ageBand: true, gender: { select: { gender: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      learnerCode: row.learnerCode,
      ageBand: row.ageBand,
      gender: row.gender?.gender ?? null,
    }));
  }
  const rows = await tx.learnerProfile.findMany({
    where: { centerId },
    select: { id: true, learnerCode: true, ageBand: true },
  });
  return rows.map((row) => ({ id: row.id, learnerCode: row.learnerCode, ageBand: row.ageBand, gender: null }));
}

function latestAttendance(
  rows: readonly { id: string; learnerId: string; sessionId: string; status: ExportFacts["classes"][number]["mark"] & string; syncedAt: Date; createdAt: Date }[],
): Map<string, NonNullable<ExportFacts["classes"][number]["mark"]>> {
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = pair(row.sessionId, row.learnerId);
    const current = best.get(key);
    if (!current || laterAttendance(row, current)) best.set(key, row);
  }
  const marks = new Map<string, NonNullable<ExportFacts["classes"][number]["mark"]>>();
  for (const [key, row] of best) {
    if (row.status) marks.set(key, row.status);
  }
  return marks;
}

function laterAttendance(
  candidate: { syncedAt: Date; createdAt: Date; id: string },
  current: { syncedAt: Date; createdAt: Date; id: string },
): boolean {
  const synced = candidate.syncedAt.getTime() - current.syncedAt.getTime();
  if (synced !== 0) return synced > 0;
  const created = candidate.createdAt.getTime() - current.createdAt.getTime();
  if (created !== 0) return created > 0;
  return candidate.id > current.id;
}

function latestStoredFiles(
  rows: readonly { id: string; assignmentId: string; learnerId: string; uploadState: string; updatedAt: Date }[],
): Set<string> {
  const best = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = pair(row.assignmentId, row.learnerId);
    const current = best.get(key);
    if (!current || laterSubmission(row, current)) best.set(key, row);
  }
  const stored = new Set<string>();
  for (const [key, row] of best) {
    if (row.uploadState === "STORED") stored.add(key);
  }
  return stored;
}

function laterSubmission(candidate: { updatedAt: Date; id: string }, current: { updatedAt: Date; id: string }): boolean {
  const updated = candidate.updatedAt.getTime() - current.updatedAt.getTime();
  if (updated !== 0) return updated > 0;
  return candidate.id > current.id;
}

function pair(left: string, right: string): string {
  return `${left}\0${right}`;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
