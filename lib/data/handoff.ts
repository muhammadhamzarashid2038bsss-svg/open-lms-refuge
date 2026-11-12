// A handoff is built in the same database transaction as the staffing change.
// A slow phone can send the request twice. The teacher row or the assignment
// row is claimed once, and sourceKey refuses a second pack for that same change.
// Note text stays on the note version. The profile stores counts and the version id.

import { Prisma } from "../../generated/prisma/client";
import { isCurrentAssignment, reassignmentEndDate, utcDay } from "../auth/assignments";
import { canReassignSection, canViewAuditLog, canViewHandoff, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import { visibleAuditMetadata, writeAuditEvent, writeRecordViews } from "./audit";
import { measureHandoffLearner, type PerformanceInput } from "../lms/dashboard-metrics";
import {
  ATTENDANCE_LOOKBACK,
  ATTENDANCE_RULE,
  GRADE_RULE,
  chooseHandoffRecipient,
  latestNoteVersion,
  lessonSnapshot,
  roundPercent,
  trendEnum,
} from "../lms/handoff-metrics";
import { isUuid } from "../lms/timetable";

type Tx = Prisma.TransactionClient;
type SkillName = "READING" | "WRITING" | "SPEAKING" | "NUMBER_SENSE" | "CUSTOM";

export class HandoffError extends Error {}

const BAD_INCOMING = "The selected teacher cannot take this section.";
const CLOCK = "The center clock could not be read, so the handoff was not created.";

const SKILL_LABEL: Record<string, string> = {
  READING: "Reading",
  WRITING: "Writing",
  SPEAKING: "Speaking",
  NUMBER_SENSE: "Number sense",
  CUSTOM: "Custom",
};

export type HandoffListItem = {
  id: string;
  sectionName: string;
  courseTitle: string;
  reasonLabel: string;
  generatedAtLabel: string;
  recipientName: string;
};

export type HandoffNoteView = {
  noteId: string;
  versionId: string | null;
  recordedAt: string | null;
  body: string | null;
  skillLabels: string[];
};

export type HandoffProfileView = {
  id: string;
  learnerName: string;
  learnerCode: string;
  attendanceLabel: string;
  attendanceDetail: string;
  unexcusedLabel: string;
  gradeLabel: string;
  gradeDetail: string;
  marks: { title: string; percent: string }[];
  lessonLabel: string;
  skillLabels: string[];
  enrolledOn: string | null;
  notes: HandoffNoteView[];
};

export type HandoffView = {
  id: string;
  sectionName: string;
  courseTitle: string;
  centerName: string;
  outgoingName: string;
  incomingName: string | null;
  recipientName: string;
  reasonLabel: string;
  generatedAtLabel: string;
  learnerCount: number;
  attendanceSummary: string;
  gradeSummary: string;
  lessonSummary: string;
  profiles: HandoffProfileView[];
};

type BuiltReport = { id: string; profileCount: number };

function reasonLabel(reason: string): string {
  return reason === "TEACHER_DEACTIVATED" ? "Teacher deactivated" : "Section reassigned";
}

function personName(name: string | null | undefined): string {
  return name && name.trim().length > 0 ? name : "Account";
}

function formatWhen(value: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(value);
  } catch {
    return `${value.toISOString()} UTC`;
  }
}

function safeTitle(title: string): string {
  const cleaned = title.replace(/[\u0000-\u001F]/g, "").trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : "Assignment";
}

function skillLabels(gaps: readonly string[], custom: string | null, active: boolean | null): string[] {
  return gaps.map((gap) => {
    if (gap !== "CUSTOM") return SKILL_LABEL[gap] ?? gap;
    if (!custom) return "Custom";
    return active === false ? `${custom} (not used for new notes)` : custom;
  });
}

function confirmedRate(present: number, late: number, eligible: number, marked: number): { kind: "RECORDED" | "NO_ELIGIBLE_SESSIONS" | "NO_ATTENDANCE_RECORDED"; rate: string | null; label: string } {
  if (eligible === 0) return { kind: "NO_ELIGIBLE_SESSIONS", rate: null, label: "No eligible sessions yet" };
  if (marked === 0) return { kind: "NO_ATTENDANCE_RECORDED", rate: null, label: "No attendance recorded yet" };
  const rate = roundPercent(((present + late) / eligible) * 100);
  return { kind: "RECORDED", rate, label: `${rate}% present or late` };
}

async function buildProfiles(
  tx: Tx,
  reportId: string,
  section: {
    id: string;
    course: { center: { timezone: string } };
  },
  now: Date,
): Promise<number> {
  const enrollments = await tx.enrollment.findMany({
    where: { sectionId: section.id, status: "ACTIVE" },
    select: {
      enrolledOn: true,
      learner: { select: { id: true, displayName: true } },
    },
  });
  const learners = enrollments.map((row) => ({
    id: row.learner.id,
    displayName: row.learner.displayName,
    enrolledOn: row.enrolledOn,
    withdrawnOn: null,
  }));
  const [sessions, assignments, grades, notes, lessonRows] = await Promise.all([
    tx.classSession.findMany({
      where: { sectionId: section.id },
      select: { id: true, title: true, startsAt: true, status: true },
    }),
    tx.assignment.findMany({
      where: { sectionId: section.id },
      select: { id: true, title: true, kind: true, maxPoints: true, dueAt: true, createdAt: true },
    }),
    tx.gradeEntry.findMany({
      where: { assignment: { sectionId: section.id } },
      select: { id: true, assignmentId: true, learnerId: true, points: true },
    }),
    tx.progressNote.findMany({
      where: { sectionId: section.id },
      select: {
        id: true,
        learnerId: true,
        skillGaps: true,
        versions: {
          select: {
            id: true,
            syncedAt: true,
            createdAt: true,
            skillGaps: true,
            customSkillTag: { select: { name: true, active: true } },
          },
        },
      },
    }),
    tx.lessonProgress.findMany({
      where: { classSession: { sectionId: section.id } },
      select: { learnerId: true, status: true, classSession: { select: { startsAt: true } } },
    }),
  ]);
  const sessionIds = sessions.map((session) => session.id);
  const learnerIds = learners.map((learner) => learner.id);
  const attendance = sessionIds.length === 0 || learnerIds.length === 0
    ? []
    : await tx.attendanceRecord.findMany({
        where: { sessionId: { in: sessionIds }, learnerId: { in: learnerIds } },
        select: { id: true, sessionId: true, learnerId: true, status: true, reasonCode: true, syncedAt: true, createdAt: true },
      });
  const openConflicts = grades.length === 0
    ? []
    : await tx.syncConflict.findMany({
        where: { state: "OPEN", gradeEntryId: { in: grades.map((grade) => grade.id) } },
        select: { gradeEntryId: true },
      });
  const openIds = new Set(openConflicts.map((row) => row.gradeEntryId).filter((id): id is string => id !== null));
  const inputBase: Omit<PerformanceInput, "learners"> = {
    now,
    timeZone: section.course.center.timezone,
    sectionId: section.id,
    sectionName: "",
    courseTitle: "",
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      kind: assignment.kind,
      maxPoints: assignment.maxPoints.toString(),
      dueAt: assignment.dueAt,
      createdAt: assignment.createdAt,
    })),
    grades: grades.map((grade) => ({
      id: grade.id,
      assignmentId: grade.assignmentId,
      learnerId: grade.learnerId,
      points: grade.points.toString(),
      openConflict: openIds.has(grade.id),
    })),
    submissions: [],
    sessions: sessions.map((session) => ({
      id: session.id,
      title: session.title,
      startsAt: session.startsAt,
      status: session.status,
    })),
    attendance,
  };
  const titles = new Map(assignments.map((assignment) => [assignment.id, safeTitle(assignment.title)]));

  for (const enrollment of learners) {
    const measured = measureHandoffLearner({ ...inputBase, learners: [{ ...enrollment, learnerCode: "" }] }, { ...enrollment, learnerCode: "" });
    if (!measured.clockOk || !measured.attendance) throw new HandoffError(CLOCK);
    const counts = measured.attendance.rates;
    const marked = counts.present + counts.late + counts.absent + counts.excused;
    const attendance = confirmedRate(counts.present, counts.late, counts.eligibleSessions, marked);
    const lessonFacts = lessonSnapshot(
      lessonRows.filter((row) => row.learnerId === enrollment.id).map((row) => ({ status: row.status, startsAt: row.classSession.startsAt })),
      now,
    );
    const learnerNotes = notes.filter((note) => note.learnerId === enrollment.id);
    const links: { progressNoteId: string; progressNoteVersionId: string | null; skillGaps: SkillName[] }[] = [];
    const gapSet = new Set<SkillName>();
    for (const note of learnerNotes) {
      const version = latestNoteVersion(note.versions);
      const gaps = (version?.skillGaps ?? note.skillGaps) as SkillName[];
      for (const gap of gaps) gapSet.add(gap);
      links.push({ progressNoteId: note.id, progressNoteVersionId: version?.id ?? null, skillGaps: gaps });
    }
    const profile = await tx.transitionProfile.create({
      data: {
        handoffReportId: reportId,
        learnerId: enrollment.id,
        attendanceRate: attendance.rate,
        attendanceKind: attendance.kind,
        countsStored: true,
        eligibleSessionCount: counts.eligibleSessions,
        presentCount: counts.present,
        lateCount: counts.late,
        absentCount: counts.absent,
        excusedCount: counts.excused,
        unmarkedCount: counts.unmarked,
        unexcusedAbsenceCount: measured.attendance.unexcusedAbsences,
        gradeTrend: trendEnum(measured.trajectory.label),
        gradeSettledCount: measured.trajectory.settledCount,
        gradeSnapshot: {
          rule: GRADE_RULE,
          settledCount: measured.trajectory.settledCount,
          windowCount: measured.trajectory.windowCount,
          earlierMedian: measured.trajectory.earlierMedian,
          laterMedian: measured.trajectory.laterMedian,
          difference: measured.trajectory.difference,
          explanation: measured.trajectory.explanation,
          marks: measured.settled.map((mark) => ({
            assignmentId: mark.assignmentId,
            title: titles.get(mark.assignmentId) ?? "Assignment",
            percent: Number(roundPercent(mark.percent)),
          })),
        },
        historySnapshot: {
          enrolledOn: enrollment.enrolledOn.toISOString().slice(0, 10),
          enrollmentStatus: "ACTIVE",
          attendanceRule: ATTENDANCE_RULE,
          gradeRule: GRADE_RULE,
        },
        lessonsTracked: lessonFacts.tracked,
        lessonsCompleted: lessonFacts.completed,
        lessonsTotal: lessonFacts.total,
        skillGaps: [...gapSet],
      },
      select: { id: true },
    });
    if (links.length > 0) {
      await tx.transitionProfileNote.createMany({
        data: links.map((link) => ({
          transitionProfileId: profile.id,
          progressNoteId: link.progressNoteId,
          progressNoteVersionId: link.progressNoteVersionId,
        })),
      });
    }
  }
  return learners.length;
}

async function writeReport(
  tx: Tx,
  actor: Actor,
  input: {
    sectionId: string;
    outgoingTeacherId: string;
    reason: "TEACHER_DEACTIVATED" | "SECTION_REASSIGNED";
    sourceKey: string;
    explicitIncomingId: string | null;
    now: Date;
  },
): Promise<BuiltReport> {
  const section = await tx.section.findUnique({
    where: { id: input.sectionId },
    select: {
      id: true,
      name: true,
      course: { select: { title: true, centerId: true, center: { select: { timezone: true } } } },
    },
  });
  if (!section) throw new HandoffError("That section could not be prepared.");
  const centerId = section.course.centerId;
  const explicit = input.explicitIncomingId
    ? await tx.user.findUnique({
        where: { id: input.explicitIncomingId },
        select: { id: true, active: true, role: true, centerId: true },
      })
    : null;
  if (input.explicitIncomingId && !explicit) throw new HandoffError(BAD_INCOMING);
  const staffing = await tx.sectionTeacher.findMany({
    where: { sectionId: section.id },
    select: {
      teacherId: true,
      startsOn: true,
      endsOn: true,
      teacher: { select: { active: true, role: true } },
    },
  });
  const others = staffing
    .filter((row) => row.teacherId !== input.outgoingTeacherId && row.teacher.active && row.teacher.role === "TEACHER" && isCurrentAssignment(row.startsOn, row.endsOn, input.now))
    .map((row) => row.teacherId);
  const directors = await tx.user.findMany({
    where: { centerId, role: "CENTER_DIRECTOR", active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const choice = chooseHandoffRecipient({
    outgoingTeacherId: input.outgoingTeacherId,
    sectionCenterId: centerId,
    explicitIncoming: explicit,
    otherCurrentTeacherIds: others,
    directorIds: directors.map((director) => director.id),
  });
  if (!choice.ok) throw new HandoffError(choice.message);
  const report = await tx.handoffReport.create({
    data: {
      sectionId: section.id,
      outgoingTeacherId: input.outgoingTeacherId,
      incomingTeacherId: choice.incomingTeacherId,
      assignedToId: choice.assignedToId,
      reason: input.reason,
      status: "READY",
      generatedAt: input.now,
      sourceKey: input.sourceKey,
      sectionNameSnapshot: section.name,
      courseTitleSnapshot: section.course.title,
    },
    select: { id: true },
  });
  const profileCount = await buildProfiles(tx, report.id, section, input.now);
  await writeAuditEvent(tx, {
    actor,
    action: "GENERATE_HANDOFF",
    entityType: "HANDOFF_REPORT",
    entityId: report.id,
    centerId,
    metadata: {
      source: "handoff",
      reason: input.reason,
      sectionId: section.id,
      profileCount,
    },
  });
  return { id: report.id, profileCount };
}

export async function createDeactivationHandoffs(
  tx: Tx,
  actor: Actor,
  teacherId: string,
  now: Date,
): Promise<number> {
  const teacher = await tx.user.findUnique({
    where: { id: teacherId },
    select: { id: true, centerId: true },
  });
  if (!teacher) throw new HandoffError("That teacher could not be prepared.");
  const rows = await tx.sectionTeacher.findMany({
    where: { teacherId: teacher.id },
    select: {
      sectionId: true,
      startsOn: true,
      endsOn: true,
      section: { select: { course: { select: { centerId: true } } } },
    },
  });
  const sectionIds = [...new Set(
    rows
      .filter((row) => row.section.course.centerId === teacher.centerId && isCurrentAssignment(row.startsOn, row.endsOn, now))
      .map((row) => row.sectionId),
  )];
  const sourceKey = `deactivate:${teacher.id}:${now.toISOString()}`;
  for (const sectionId of sectionIds) {
    await writeReport(tx, actor, {
      sectionId,
      outgoingTeacherId: teacher.id,
      reason: "TEACHER_DEACTIVATED",
      sourceKey,
      explicitIncomingId: null,
      now,
    });
  }
  return sectionIds.length;
}

export async function reassignSectionTeacher(
  actor: Actor,
  input: { sectionId: string; outgoingTeacherId: string; incomingTeacherId: string | null; now?: Date },
): Promise<{ status: "saved"; reportId: string; sameDayAccess: boolean } | { status: "unchanged" } | { status: "hidden" } | { status: "invalid"; message: string }> {
  if (!actor.active || !isUuid(input.sectionId) || !isUuid(input.outgoingTeacherId)) return { status: "hidden" };
  if (input.incomingTeacherId && !isUuid(input.incomingTeacherId)) return { status: "invalid", message: BAD_INCOMING };
  if (input.incomingTeacherId === input.outgoingTeacherId) return { status: "invalid", message: BAD_INCOMING };
  const now = input.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const section = await tx.section.findUnique({
        where: { id: input.sectionId },
        select: { id: true, course: { select: { centerId: true } } },
      });
      if (!section || !canReassignSection(actor, { id: section.id, centerId: section.course.centerId })) {
        return { status: "hidden" as const };
      }
      const openRows = await tx.sectionTeacher.findMany({
        where: { sectionId: section.id, teacherId: input.outgoingTeacherId },
        select: { id: true, startsOn: true, endsOn: true },
      });
      const current = openRows.filter((row) => isCurrentAssignment(row.startsOn, row.endsOn, now));
      if (current.length === 0) return { status: "unchanged" as const };
      if (current.length !== 1) {
        return { status: "invalid" as const, message: "This teacher has more than one open assignment on that section." };
      }
      const assignment = current[0];
      if (!assignment) return { status: "unchanged" as const };
      const today = utcDay(now);
      const sourceKey = `assignment:${assignment.id}`;
      // A same-day end stays current until that UTC day is over, so a second
      // request still sees the assignment. The source key is what stops a second pack.
      const packed = await tx.handoffReport.findFirst({
        where: { sectionId: section.id, reason: "SECTION_REASSIGNED", sourceKey },
        select: { id: true },
      });
      if (packed) return { status: "unchanged" as const };
      const endsOn = reassignmentEndDate(assignment.startsOn, now);
      if (input.incomingTeacherId) {
        const incoming = await tx.user.findUnique({
          where: { id: input.incomingTeacherId },
          select: { id: true, active: true, role: true, centerId: true },
        });
        const choice = chooseHandoffRecipient({
          outgoingTeacherId: input.outgoingTeacherId,
          sectionCenterId: section.course.centerId,
          explicitIncoming: incoming,
          otherCurrentTeacherIds: [],
          directorIds: [],
        });
        if (!choice.ok) return { status: "invalid" as const, message: choice.message };
      }
      const ended = await tx.sectionTeacher.updateMany({
        where: {
          id: assignment.id,
          OR: [{ endsOn: null }, { endsOn: { gte: today } }],
        },
        data: { endsOn },
      });
      if (ended.count !== 1) return { status: "unchanged" as const };
      if (input.incomingTeacherId) {
        const existing = await tx.sectionTeacher.findMany({
          where: { sectionId: section.id, teacherId: input.incomingTeacherId },
          select: { startsOn: true, endsOn: true },
        });
        const stillCurrent = existing.some((row) => isCurrentAssignment(row.startsOn, row.endsOn, now));
        const startsToday = existing.some((row) => utcDay(row.startsOn).getTime() === today.getTime());
        if (!stillCurrent && !startsToday) {
          await tx.sectionTeacher.create({
            data: {
              sectionId: section.id,
              teacherId: input.incomingTeacherId,
              startsOn: today,
              endsOn: null,
            },
          });
        }
      }
      const report = await writeReport(tx, actor, {
        sectionId: section.id,
        outgoingTeacherId: input.outgoingTeacherId,
        reason: "SECTION_REASSIGNED",
        sourceKey,
        explicitIncomingId: input.incomingTeacherId,
        now,
      });
      return {
        status: "saved" as const,
        reportId: report.id,
        sameDayAccess: endsOn.getTime() === utcDay(assignment.startsOn).getTime(),
      };
    }, { timeout: 20000 });
  } catch (error) {
    if (error instanceof HandoffError) return { status: "invalid", message: error.message };
    return { status: "invalid", message: "The section assignment could not be changed. Nothing was changed." };
  }
}

export async function listReassignmentChoices(actor: Actor): Promise<{
  sections: { id: string; label: string; teachers: { id: string; name: string }[] }[];
  teachers: { id: string; name: string }[];
} | null> {
  if (!actor.active || (actor.role !== "ADMIN" && actor.role !== "CENTER_DIRECTOR")) return null;
  const now = new Date();
  const sections = await prisma.section.findMany({
    where: actor.role === "ADMIN" ? {} : { course: { centerId: actor.centerId } },
    select: {
      id: true,
      name: true,
      course: { select: { title: true } },
      teachers: {
        select: {
          teacherId: true,
          startsOn: true,
          endsOn: true,
          teacher: { select: { displayName: true, active: true, role: true } },
        },
      },
    },
    orderBy: [{ course: { title: "asc" } }, { name: "asc" }],
  });
  const choices = sections.flatMap((section) => {
    const teachers = section.teachers
      .filter((row) => row.teacher.active && row.teacher.role === "TEACHER" && isCurrentAssignment(row.startsOn, row.endsOn, now))
      .map((row) => ({ id: row.teacherId, name: personName(row.teacher.displayName) }));
    if (teachers.length === 0) return [];
    return [{ id: section.id, label: `${section.course.title} · ${section.name}`, teachers }];
  });
  const teachers = await prisma.user.findMany({
    where: {
      role: "TEACHER",
      active: true,
      ...(actor.role === "CENTER_DIRECTOR" ? { centerId: actor.centerId } : {}),
    },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
  return {
    sections: choices,
    teachers: teachers.map((teacher) => ({ id: teacher.id, name: personName(teacher.displayName) })),
  };
}

export async function listHandoffReports(actor: Actor): Promise<HandoffListItem[] | null> {
  if (!actor.active || (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR")) return null;
  const rows = await prisma.handoffReport.findMany({
    where: actor.role === "CENTER_DIRECTOR"
      ? { section: { course: { centerId: actor.centerId } } }
      : { assignedToId: actor.id, sectionId: { in: actor.assignedSectionIds } },
    orderBy: { generatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      reason: true,
      generatedAt: true,
      sectionNameSnapshot: true,
      courseTitleSnapshot: true,
      assignedTo: { select: { displayName: true } },
      section: { select: { course: { select: { center: { select: { timezone: true } } } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    sectionName: row.sectionNameSnapshot,
    courseTitle: row.courseTitleSnapshot,
    reasonLabel: reasonLabel(row.reason),
    generatedAtLabel: formatWhen(row.generatedAt, row.section.course.center.timezone),
    recipientName: personName(row.assignedTo.displayName),
  }));
}

function snapshotObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function profileView(row: {
  id: string;
  attendanceRate: Prisma.Decimal | null;
  attendanceKind: string;
  countsStored: boolean;
  eligibleSessionCount: number;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  excusedCount: number;
  unmarkedCount: number;
  unexcusedAbsenceCount: number;
  gradeTrend: string;
  gradeSettledCount: number;
  gradeSnapshot: unknown;
  historySnapshot: unknown;
  lessonsTracked: boolean;
  lessonsCompleted: number;
  lessonsTotal: number;
  skillGaps: string[];
  learner: { displayName: string; learnerCode: string };
  notes: {
    progressNoteId: string;
    progressNoteVersionId: string | null;
    progressNoteVersion: {
      body: string;
      skillGaps: string[];
      syncedAt: Date;
      customSkillLabel: string | null;
      customSkillTag: { name: string; active: boolean } | null;
    } | null;
  }[];
}, timeZone: string): HandoffProfileView {
  const marked = row.presentCount + row.lateCount + row.absentCount + row.excusedCount;
  const attendance = row.countsStored
    ? confirmedRate(row.presentCount, row.lateCount, row.eligibleSessionCount, marked)
    : {
        label: row.attendanceRate ? `${row.attendanceRate.toString()}% present or late` : "Attendance was not calculated",
        kind: row.attendanceKind,
      };
  const attendanceDetail = row.countsStored
    ? `Eligible ${row.eligibleSessionCount}. Present ${row.presentCount}. Late ${row.lateCount}. Absent ${row.absentCount}. Excused ${row.excusedCount}. Unmarked ${row.unmarkedCount}. ${ATTENDANCE_LOOKBACK}`
    : "This older report stored a rate only. Detailed counts were not saved with it.";
  const unexcusedLabel = !row.countsStored
    ? "Unexcused absences were not saved as a separate count on this older report."
    : row.attendanceKind === "NO_ELIGIBLE_SESSIONS"
      ? "No sessions to count."
      : row.attendanceKind === "NO_ATTENDANCE_RECORDED"
        ? "Unmarked sessions are not absences, so unexcused absences are not calculated."
        : `${row.unexcusedAbsenceCount} unexcused absences. Family circumstances are not counted as unexcused.`;
  const gradeSnapshot = snapshotObject(row.gradeSnapshot);
  const history = snapshotObject(row.historySnapshot);
  const gradeWords: Record<string, string> = {
    IMPROVING: "Improving",
    STEADY: "Steady",
    DECLINING: "Declining",
    INSUFFICIENT: "Insufficient data",
  };
  const explanation = typeof gradeSnapshot?.explanation === "string" ? gradeSnapshot.explanation : null;
  const gradeDetail = explanation
    ? `${explanation} Missing marks are left out. They are not stored as zero.`
    : `${row.gradeSettledCount} settled marks were counted. The numbers behind this older label were not stored.`;
  const marks = Array.isArray(gradeSnapshot?.marks)
    ? gradeSnapshot.marks.flatMap((mark) => {
        const item = snapshotObject(mark);
        if (!item || typeof item.title !== "string" || typeof item.percent !== "number") return [];
        return [{ title: safeTitle(item.title), percent: roundPercent(item.percent) }];
      })
    : [];
  const lessonLabel = !row.lessonsTracked
    ? "Not tracked"
    : row.lessonsCompleted === 0
      ? "No lessons completed"
      : `${row.lessonsCompleted} of ${row.lessonsTotal} tracked lessons completed`;
  const enrolledOn = typeof history?.enrolledOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(history.enrolledOn) ? history.enrolledOn : null;
  return {
    id: row.id,
    learnerName: row.learner.displayName,
    learnerCode: row.learner.learnerCode,
    attendanceLabel: attendance.label,
    attendanceDetail,
    unexcusedLabel,
    gradeLabel: gradeWords[row.gradeTrend] ?? "Insufficient data",
    gradeDetail,
    marks,
    lessonLabel,
    skillLabels: profileSkillLabels(row),
    enrolledOn,
    notes: row.notes.map((note) => {
      const version = note.progressNoteVersion;
      const custom = version?.customSkillTag?.name ?? version?.customSkillLabel ?? null;
      return {
        noteId: note.progressNoteId,
        versionId: note.progressNoteVersionId,
        recordedAt: version ? formatWhen(version.syncedAt, timeZone) : null,
        body: version?.body ?? null,
        skillLabels: version ? skillLabels(version.skillGaps, custom, version.customSkillTag?.active ?? null) : ["The saved version from that day was not stored."],
      };
    }),
  };
}

function profileSkillLabels(row: {
  skillGaps: string[];
  notes: {
    progressNoteVersion: {
      customSkillLabel: string | null;
      customSkillTag: { name: string; active: boolean } | null;
    } | null;
  }[];
}): string[] {
  const labels = row.skillGaps.filter((gap) => gap !== "CUSTOM").map((gap) => SKILL_LABEL[gap] ?? gap);
  for (const note of row.notes) {
    const version = note.progressNoteVersion;
    if (!version) continue;
    if (version.customSkillTag) {
      labels.push(version.customSkillTag.active ? version.customSkillTag.name : `${version.customSkillTag.name} (not used for new notes)`);
    } else if (version.customSkillLabel) labels.push(version.customSkillLabel);
  }
  if (row.skillGaps.includes("CUSTOM") && labels.length === row.skillGaps.filter((gap) => gap !== "CUSTOM").length) {
    labels.push("Custom");
  }
  return [...new Set(labels)];
}

function summarize(rows: { countsStored: boolean; lessonsTracked: boolean; lessonsCompleted: number; lessonsTotal: number; gradeTrend: string; presentCount: number; lateCount: number; absentCount: number; excusedCount: number; unmarkedCount: number; eligibleSessionCount: number }[]): { attendance: string; grade: string; lesson: string } {
  if (rows.length === 0) {
    return {
      attendance: "No learner was enrolled in this section at the handoff.",
      grade: "No learner was enrolled in this section at the handoff.",
      lesson: "No learner was enrolled in this section at the handoff.",
    };
  }
  const detailed = rows.every((row) => row.countsStored);
  let attendance = "Detailed attendance counts were not stored for every learner in this report.";
  if (detailed) {
    const totals = rows.reduce((sum, row) => ({
      eligible: sum.eligible + row.eligibleSessionCount,
      present: sum.present + row.presentCount,
      late: sum.late + row.lateCount,
      absent: sum.absent + row.absentCount,
      excused: sum.excused + row.excusedCount,
      unmarked: sum.unmarked + row.unmarkedCount,
    }), { eligible: 0, present: 0, late: 0, absent: 0, excused: 0, unmarked: 0 });
    const marked = totals.present + totals.late + totals.absent + totals.excused;
    attendance = `${confirmedRate(totals.present, totals.late, totals.eligible, marked).label}. Eligible session-learner rows ${totals.eligible}. Unmarked ${totals.unmarked}.`;
  }
  const trends = rows.reduce<Record<string, number>>((sum, row) => {
    sum[row.gradeTrend] = (sum[row.gradeTrend] ?? 0) + 1;
    return sum;
  }, {});
  const grade = `Improving ${trends.IMPROVING ?? 0}. Steady ${trends.STEADY ?? 0}. Declining ${trends.DECLINING ?? 0}. Insufficient data ${trends.INSUFFICIENT ?? 0}.`;
  const tracked = rows.filter((row) => row.lessonsTracked);
  const lesson = tracked.length === 0
    ? "Not tracked"
    : `${tracked.reduce((sum, row) => sum + row.lessonsCompleted, 0)} of ${tracked.reduce((sum, row) => sum + row.lessonsTotal, 0)} tracked lessons completed. ${rows.length - tracked.length} learners are not tracked.`;
  return { attendance, grade, lesson };
}

export async function readHandoffReport(
  actor: Actor,
  reportId: string,
  mode: "view" | "print",
): Promise<HandoffView | null> {
  if (!actor.active || !isUuid(reportId)) return null;
  const row = await prisma.handoffReport.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      reason: true,
      generatedAt: true,
      assignedToId: true,
      sectionNameSnapshot: true,
      courseTitleSnapshot: true,
      outgoingTeacher: { select: { displayName: true } },
      incomingTeacher: { select: { displayName: true } },
      assignedTo: { select: { displayName: true } },
      section: { select: { id: true, course: { select: { centerId: true, center: { select: { name: true, timezone: true } } } } } },
      profiles: {
        orderBy: { learner: { learnerCode: "asc" } },
        select: {
          id: true,
          attendanceRate: true,
          attendanceKind: true,
          countsStored: true,
          eligibleSessionCount: true,
          presentCount: true,
          lateCount: true,
          absentCount: true,
          excusedCount: true,
          unmarkedCount: true,
          unexcusedAbsenceCount: true,
          gradeTrend: true,
          gradeSettledCount: true,
          gradeSnapshot: true,
          historySnapshot: true,
          lessonsTracked: true,
          lessonsCompleted: true,
          lessonsTotal: true,
          skillGaps: true,
          learner: { select: { displayName: true, learnerCode: true } },
          notes: {
            select: {
              progressNoteId: true,
              progressNoteVersionId: true,
              progressNoteVersion: {
                select: {
                  body: true,
                  skillGaps: true,
                  syncedAt: true,
                  customSkillLabel: true,
                  customSkillTag: { select: { name: true, active: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  const centerId = row.section.course.centerId;
  if (!canViewHandoff(actor, { centerId, sectionId: row.section.id, assignedToId: row.assignedToId })) return null;
  const noteIds = [...new Set(row.profiles.flatMap((profile) => profile.notes.filter((note) => note.progressNoteVersion?.body).map((note) => note.progressNoteId)))];
  try {
    await prisma.$transaction(async (tx) => {
      await writeRecordViews(tx, actor, "HANDOFF_REPORT", [row.id], {
        source: mode === "print" ? "print-request" : "handoff",
      });
      if (mode === "print") {
        await writeAuditEvent(tx, {
          actor,
          action: "EXPORT",
          entityType: "HANDOFF_REPORT",
          entityId: row.id,
          metadata: { source: "print-request" },
        });
      }
      await writeRecordViews(tx, actor, "PROGRESS_NOTE", noteIds, { source: "handoff", handoffReportId: row.id });
    });
  } catch {
    throw new Error("The handoff view could not be recorded.");
  }
  const timeZone = row.section.course.center.timezone;
  const profiles = row.profiles.map((profile) => profileView(profile, timeZone));
  const summary = summarize(row.profiles);
  return {
    id: row.id,
    sectionName: row.sectionNameSnapshot,
    courseTitle: row.courseTitleSnapshot,
    centerName: row.section.course.center.name,
    outgoingName: personName(row.outgoingTeacher.displayName),
    incomingName: row.incomingTeacher ? personName(row.incomingTeacher.displayName) : null,
    recipientName: personName(row.assignedTo.displayName),
    reasonLabel: reasonLabel(row.reason),
    generatedAtLabel: formatWhen(row.generatedAt, timeZone),
    learnerCount: profiles.length,
    attendanceSummary: summary.attendance,
    gradeSummary: summary.grade,
    lessonSummary: summary.lesson,
    profiles,
  };
}

export type AuditListRow = {
  id: string;
  atLabel: string;
  action: string;
  entityType: string;
  entityId: string;
  actorName: string;
  centerCode: string | null;
  metadata: { key: string; value: string }[];
};

const AUDIT_ACTIONS = new Set(["VIEW", "CREATE", "UPDATE", "DEACTIVATE", "EXPORT", "RESOLVE_CONFLICT", "GENERATE_HANDOFF", "UPDATE_RISK_FLAG"]);
const AUDIT_ENTITIES = new Set(["GRADE_ENTRY", "PROGRESS_NOTE", "HANDOFF_REPORT", "RISK_FLAG", "EXPORT", "USER", "ATTENDANCE", "SUBMISSION", "SKILL_TAG"]);

export async function listAuditLog(
  actor: Actor,
  query: { action?: string; entityType?: string; actorId?: string; from?: string; to?: string },
): Promise<{ rows: AuditListRow[]; actors: { id: string; name: string }[]; truncated: boolean } | null> {
  if (!canViewAuditLog(actor)) return null;
  const where: Prisma.AuditLogWhereInput = actor.role === "CENTER_DIRECTOR" ? { centerId: actor.centerId } : {};
  if (query.action && AUDIT_ACTIONS.has(query.action)) where.action = query.action as Prisma.AuditLogWhereInput["action"];
  if (query.entityType && AUDIT_ENTITIES.has(query.entityType)) where.entityType = query.entityType as Prisma.AuditLogWhereInput["entityType"];
  if (query.actorId && isUuid(query.actorId)) {
    const allowed = await prisma.user.findFirst({
      where: {
        id: query.actorId,
        ...(actor.role === "CENTER_DIRECTOR" ? { centerId: actor.centerId } : {}),
      },
      select: { id: true },
    });
    if (!allowed) return { rows: [], actors: await actorChoices(actor), truncated: false };
    where.actorId = query.actorId;
  }
  const from = parseDay(query.from, false);
  const to = parseDay(query.to, true);
  if (from || to) where.at = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  const found = await prisma.auditLog.findMany({
    where,
    orderBy: { at: "desc" },
    take: 101,
    select: {
      id: true,
      at: true,
      action: true,
      entityType: true,
      entityId: true,
      metadata: true,
      actor: { select: { displayName: true, learnerProfile: { select: { displayName: true } } } },
      center: { select: { code: true, timezone: true } },
    },
  });
  const truncated = found.length > 100;
  return {
    truncated,
    actors: await actorChoices(actor),
    rows: found.slice(0, 100).map((row) => ({
      id: row.id,
      atLabel: formatWhen(row.at, actor.role === "ADMIN" ? "UTC" : row.center.timezone),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorName: personName(row.actor?.learnerProfile?.displayName ?? row.actor?.displayName),
      centerCode: actor.role === "ADMIN" ? row.center.code : null,
      metadata: visibleAuditMetadata(row.metadata),
    })),
  };
}

function parseDay(value: string | undefined, end: boolean): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  const date = end ? new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999)) : new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function actorChoices(actor: Actor): Promise<{ id: string; name: string }[]> {
  const users = await prisma.user.findMany({
    where: actor.role === "CENTER_DIRECTOR" ? { centerId: actor.centerId } : {},
    select: { id: true, displayName: true, role: true, learnerProfile: { select: { displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return users.map((user) => ({
    id: user.id,
    name: `${personName(user.learnerProfile?.displayName ?? user.displayName)} · ${user.role}`,
  }));
}
