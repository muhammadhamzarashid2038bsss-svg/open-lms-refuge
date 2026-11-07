// Saves kiosk attendance as new AttendanceRecord rows.
// The Day 2 table is append-only: this file only inserts. A correction is a
// later row for the same learner and class. The sheet reads the row with the
// latest server receipt time. Unmarked learners are omitted from the save,
// so a blank name never becomes an absence.
//
// Day 6 writes while the teacher is connected. createdOffline stays false.
// The offline queue is Day 7 and is not started here.

import { Prisma } from "../../generated/prisma/client";
import { canRecordAttendance, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import {
  buildSessionHistory,
  isAbsenceReason,
  isAttendanceStatus,
  latestEventByLearner,
  normalizeAttendanceBatch,
  WEB_KIOSK_DEVICE_LABEL,
  type AbsenceReasonName,
  type AttendanceEventFact,
  type AttendanceLearnerRow,
  type AttendanceStatusName,
  type HistoryLine,
  type MarkDraftInput,
} from "../lms/attendance";
import {
  clockOfInstant,
  formatCivilDate,
  formatShortDate,
  isUuid,
  localDateOfInstant,
  mondayOnOrBefore,
  weekdayLabel,
  weekdayOfInstant,
} from "../lms/timetable";

type Db = typeof prisma;

export type AttendanceFailure = { ok: false; code: "denied" | "invalid" | "conflict"; message: string };

export type AttendanceSheet = {
  sectionId: string;
  sectionName: string;
  sessionId: string;
  title: string;
  whenLabel: string;
  weekOf: string | null;
  cancelled: boolean;
  learners: AttendanceLearnerRow[];
  history: HistoryLine[];
};

export type AttendanceSheetResult = { kind: "hidden" } | { kind: "ok"; sheet: AttendanceSheet };

export type RecordAttendanceResult =
  | { ok: true; created: number; alreadyStored: number }
  | AttendanceFailure;

function denied(): AttendanceFailure {
  return { ok: false, code: "denied", message: "You cannot record attendance for this class." };
}

function invalid(message: string): AttendanceFailure {
  return { ok: false, code: "invalid", message };
}

function conflict(): AttendanceFailure {
  return {
    ok: false,
    code: "conflict",
    message: "That save was already used for a different mark. The earlier mark was not changed.",
  };
}

const sessionSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  status: true,
  section: {
    select: {
      id: true,
      name: true,
      course: { select: { centerId: true, center: { select: { timezone: true } } } },
    },
  },
} as const;

async function loadSession(sectionId: string, sessionId: string, db: Db) {
  if (!isUuid(sectionId) || !isUuid(sessionId)) return null;
  return db.classSession.findFirst({
    where: { id: sessionId, sectionId },
    select: sessionSelect,
  });
}

function whenLabel(startsAt: Date, endsAt: Date, timeZone: string): string {
  const weekday = weekdayOfInstant(startsAt, timeZone);
  const day = localDateOfInstant(startsAt, timeZone);
  const start = clockOfInstant(startsAt, timeZone);
  const end = clockOfInstant(endsAt, timeZone);
  if (!weekday || !day || !start || !end) return `${startsAt.toISOString()} to ${endsAt.toISOString()}`;
  return `${weekdayLabel(weekday)} ${formatShortDate(day)}, ${start} to ${end}`;
}

function weekOfSession(startsAt: Date, timeZone: string): string | null {
  const day = localDateOfInstant(startsAt, timeZone);
  if (!day) return null;
  return formatCivilDate(mondayOnOrBefore(day));
}

function toFact(
  row: {
    id: string;
    clientEventId: string;
    learnerId: string;
    status: string;
    reasonCode: string | null;
    recordedAt: Date;
    syncedAt: Date;
    createdAt: Date;
    createdOffline: boolean;
    learner: { displayName: string; learnerCode: string };
    recordedBy: { displayName: string | null };
  },
): AttendanceEventFact | null {
  if (!isAttendanceStatus(row.status)) return null;
  if (row.reasonCode !== null && !isAbsenceReason(row.reasonCode)) return null;
  return {
    id: row.id,
    clientEventId: row.clientEventId,
    learnerId: row.learnerId,
    learnerName: row.learner.displayName,
    learnerCode: row.learner.learnerCode,
    status: row.status,
    reasonCode: row.reasonCode,
    recordedByName: row.recordedBy.displayName ?? "Staff",
    recordedAt: row.recordedAt,
    syncedAt: row.syncedAt,
    createdAt: row.createdAt,
    createdOffline: row.createdOffline,
  };
}

async function loadFacts(sessionId: string, db: Db): Promise<AttendanceEventFact[]> {
  const rows = await db.attendanceRecord.findMany({
    where: { sessionId },
    select: {
      id: true,
      clientEventId: true,
      learnerId: true,
      status: true,
      reasonCode: true,
      recordedAt: true,
      syncedAt: true,
      createdAt: true,
      createdOffline: true,
      learner: { select: { displayName: true, learnerCode: true } },
      recordedBy: { select: { displayName: true } },
    },
    orderBy: [{ syncedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.flatMap((row) => {
    const fact = toFact(row);
    return fact ? [fact] : [];
  });
}

export async function readAttendanceSheet(
  actor: Actor,
  sectionId: string,
  sessionId: string,
  db: Db = prisma,
): Promise<AttendanceSheetResult> {
  if (!actor.active) return { kind: "hidden" };
  const session = await loadSession(sectionId, sessionId, db);
  if (!session) return { kind: "hidden" };
  const scope = { id: session.section.id, centerId: session.section.course.centerId };
  if (!canRecordAttendance(actor, scope)) return { kind: "hidden" };

  const timeZone = session.section.course.center.timezone;
  const [enrollments, facts] = await Promise.all([
    db.enrollment.findMany({
      where: { sectionId: session.section.id, status: "ACTIVE" },
      select: { learner: { select: { id: true, displayName: true, learnerCode: true } } },
      orderBy: [{ learner: { displayName: "asc" } }, { learner: { learnerCode: "asc" } }],
    }),
    loadFacts(session.id, db),
  ]);
  const latest = latestEventByLearner(facts);
  const learners: AttendanceLearnerRow[] = enrollments.map((row) => {
    const current = latest.get(row.learner.id);
    return {
      id: row.learner.id,
      displayName: row.learner.displayName,
      learnerCode: row.learner.learnerCode,
      saved: current
        ? { eventId: current.id, status: current.status, reasonCode: current.reasonCode }
        : null,
    };
  });

  return {
    kind: "ok",
    sheet: {
      sectionId: session.section.id,
      sectionName: session.section.name,
      sessionId: session.id,
      title: session.title,
      whenLabel: whenLabel(session.startsAt, session.endsAt, timeZone),
      weekOf: weekOfSession(session.startsAt, timeZone),
      cancelled: session.status === "CANCELLED",
      learners,
      history: buildSessionHistory(facts, timeZone),
    },
  };
}

function parseRecordedAt(value: string | null, fallback: Date): Date | null {
  if (value === null || value.trim() === "") return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function sameFact(
  row: { learnerId: string; sessionId: string; status: string; reasonCode: string | null; recordedById: string },
  mark: { learnerId: string; status: AttendanceStatusName; reasonCode: AbsenceReasonName | null },
  sessionId: string,
  recordedById: string,
): boolean {
  return (
    row.learnerId === mark.learnerId &&
    row.sessionId === sessionId &&
    row.status === mark.status &&
    (row.reasonCode ?? null) === mark.reasonCode &&
    row.recordedById === recordedById
  );
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function ensureWebKioskDevice(tx: Prisma.TransactionClient, actor: Actor, now: Date): Promise<string> {
  const existing = await tx.device.findFirst({
    where: { centerId: actor.centerId, registeredById: actor.id, label: WEB_KIOSK_DEVICE_LABEL },
    select: { id: true },
  });
  if (existing) {
    await tx.device.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
    return existing.id;
  }
  const created = await tx.device.create({
    data: {
      id: crypto.randomUUID(),
      centerId: actor.centerId,
      label: WEB_KIOSK_DEVICE_LABEL,
      registeredById: actor.id,
      lastSeenAt: now,
    },
    select: { id: true },
  });
  return created.id;
}

type StoredRow = {
  id: string;
  clientEventId: string;
  learnerId: string;
  sessionId: string;
  status: string;
  reasonCode: string | null;
  recordedById: string;
};

function classifyExisting(
  rows: StoredRow[],
  marks: { learnerId: string; status: AttendanceStatusName; reasonCode: AbsenceReasonName | null; clientEventId: string }[],
  sessionId: string,
  recordedById: string,
): Promise<{ ok: true; already: StoredRow[]; freshIds: Set<string> } | { ok: false }> {
  const byId = new Map(rows.map((row) => [row.clientEventId, row]));
  const already: StoredRow[] = [];
  const freshIds = new Set<string>();
  for (const mark of marks) {
    const row = byId.get(mark.clientEventId);
    if (!row) {
      freshIds.add(mark.clientEventId);
      continue;
    }
    if (!sameFact(row, mark, sessionId, recordedById)) return { ok: false };
    already.push(row);
  }
  return { ok: true, already, freshIds };
}

export async function recordAttendance(
  actor: Actor,
  sectionId: string,
  sessionId: string,
  marks: MarkDraftInput[],
  db: Db = prisma,
  now = new Date(),
): Promise<RecordAttendanceResult> {
  if (!actor.active) return denied();
  const session = await loadSession(sectionId, sessionId, db);
  if (!session) return denied();
  const scope = { id: session.section.id, centerId: session.section.course.centerId };
  if (!canRecordAttendance(actor, scope)) return denied();

  const normalized = normalizeAttendanceBatch(marks);
  if (!normalized.ok) return invalid(normalized.message);

  const timed: { mark: (typeof normalized.marks)[number]; recordedAt: Date }[] = [];
  for (const mark of normalized.marks) {
    if (!isUuid(mark.learnerId)) return invalid("That learner is not in this class.");
    const recordedAt = parseRecordedAt(mark.recordedAt, now);
    if (!recordedAt) return invalid("One mark has a time the server could not read.");
    timed.push({ mark, recordedAt });
  }

  const active = await db.enrollment.findMany({
    where: {
      sectionId: session.section.id,
      status: "ACTIVE",
      learnerId: { in: timed.map((item) => item.mark.learnerId) },
    },
    select: { learnerId: true },
  });
  const activeIds = new Set(active.map((row) => row.learnerId));
  if (timed.some((item) => !activeIds.has(item.mark.learnerId))) {
    return invalid("That learner is not in this class.");
  }

  const write = async (): Promise<RecordAttendanceResult> => {
    return db.$transaction(async (tx) => {
      const existing = await tx.attendanceRecord.findMany({
        where: { clientEventId: { in: timed.map((item) => item.mark.clientEventId) } },
        select: {
          id: true,
          clientEventId: true,
          learnerId: true,
          sessionId: true,
          status: true,
          reasonCode: true,
          recordedById: true,
        },
      });
      const classified = classifyExisting(
        existing,
        timed.map((item) => item.mark),
        session.id,
        actor.id,
      );
      if (!classified.ok) return conflict();
      const fresh = timed.filter((item) => classified.freshIds.has(item.mark.clientEventId));
      if (fresh.length === 0) {
        return { ok: true, created: 0, alreadyStored: classified.already.length };
      }

      // A retry of the same save id must not insert again. The device row is
      // the identity the existing table requires. Day 7 will send the phone's
      // own device id with the offline queue.
      const deviceId = await ensureWebKioskDevice(tx, actor, now);
      await tx.attendanceRecord.createMany({
        data: fresh.map((item) => ({
          clientEventId: item.mark.clientEventId,
          learnerId: item.mark.learnerId,
          sessionId: session.id,
          status: item.mark.status,
          reasonCode: item.mark.reasonCode,
          deviceId,
          recordedById: actor.id,
          recordedAt: item.recordedAt,
          syncedAt: now,
          createdOffline: false,
        })),
      });
      return { ok: true, created: fresh.length, alreadyStored: classified.already.length };
    });
  };

  try {
    return await write();
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    // Two taps can reach the server together. The first insert wins.
    // This second look accepts the retry when the stored mark matches,
    // and refuses it when the same id was used for a different mark.
    const existing = await db.attendanceRecord.findMany({
      where: { clientEventId: { in: timed.map((item) => item.mark.clientEventId) } },
      select: {
        id: true,
        clientEventId: true,
        learnerId: true,
        sessionId: true,
        status: true,
        reasonCode: true,
        recordedById: true,
      },
    });
    const classified = classifyExisting(
      existing,
      timed.map((item) => item.mark),
      session.id,
      actor.id,
    );
    if (!classified.ok) return conflict();
    if (classified.freshIds.size > 0) return invalid("The save did not finish. Save again to retry.");
    return { ok: true, created: 0, alreadyStored: classified.already.length };
  }
}
