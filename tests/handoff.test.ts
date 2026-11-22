import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashSecret } from "../lib/auth/password";
import { authenticateStaff } from "../lib/auth/login";
import { findStaffByEmail } from "../lib/auth/lookup";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { sessionVerdict } from "../lib/auth/session-policy";
import { createSessionRow } from "../lib/auth/session-db";
import type { ThrottleStore } from "../lib/auth/throttle";
import { setAccountActive } from "../lib/auth/accounts";
import { loadSectionGradebook } from "../lib/data/assignments";
import { recordExportAudit, recordRiskFlagAudit } from "../lib/data/audit";
import { dayBefore, isCurrentAssignment, reassignmentEndDate, utcDay } from "../lib/auth/assignments";
import { listAuditLog, listReassignmentChoices, readHandoffReport, reassignSectionTeacher } from "../lib/data/handoff";
import { prisma } from "../lib/db";
import { assertConnectedTestDatabase } from "../lib/test-db/connect";

const holder = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("@/lib/auth/session", () => ({
  readSessionUserId: async () => holder.userId,
}));

import { GET as getAudit } from "../app/api/audit/route";
import { GET as getHandoff, POST as postHandoff } from "../app/api/handoff/[id]/route";

const NOTE = "Day13 second note text";
const MARK_NOTE = "Day13 mark comment";
const PASSWORD = "day13-password";

const ids: Record<string, string> = {};

function memoryStore(): ThrottleStore {
  const rows = new Map<string, { failedCount: number; lockedUntil: Date | null }>();
  return {
    async get(key) {
      const row = rows.get(key);
      return row ? { failedCount: row.failedCount, lockedUntil: row.lockedUntil } : null;
    },
    async save(key, row) {
      rows.set(key, { failedCount: row.failedCount, lockedUntil: row.lockedUntil });
    },
    async clear(key) {
      rows.delete(key);
    },
  };
}

async function actorOf(userId: string): Promise<Actor> {
  const actor = await loadActor(userId);
  if (!actor) throw new Error(userId);
  return actor;
}

async function removeDay13(): Promise<void> {
  await assertConnectedTestDatabase();
  const center = await prisma.center.findUnique({ where: { code: "DAY13" }, select: { id: true } });
  if (!center) return;
  const centerId = center.id;
  const inCenter = { section: { course: { centerId } } };
  // Deletes filter by the center, so a cleanup that stopped halfway can run again.
  await prisma.transitionProfileNote.deleteMany({ where: { transitionProfile: { handoffReport: inCenter } } });
  await prisma.transitionProfile.deleteMany({ where: { handoffReport: inCenter } });
  await prisma.handoffReport.deleteMany({ where: inCenter });
  await prisma.syncConflict.deleteMany({
    where: { OR: [{ gradeEntry: { assignment: inCenter } }, { progressNote: inCenter }] },
  });
  // The reset switch is local to one transaction. Attendance and grade history
  // are append-only, so they need the switch in their own short transaction.
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.attendanceRecord.deleteMany({ where: { session: inCenter } });
    await tx.gradeEntryVersion.deleteMany({ where: { gradeEntry: { assignment: inCenter } } });
  });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    await tx.progressNoteVersion.deleteMany({ where: { progressNote: inCenter } });
    await tx.auditLog.deleteMany({ where: { centerId } });
  });
  await prisma.progressNote.deleteMany({ where: inCenter });
  await prisma.lessonProgress.deleteMany({ where: { classSession: inCenter } });
  await prisma.gradeEntry.deleteMany({ where: { assignment: inCenter } });
  await prisma.assignment.deleteMany({ where: inCenter });
  await prisma.classSession.deleteMany({ where: inCenter });
  await prisma.sectionTeacher.deleteMany({ where: inCenter });
  await prisma.enrollment.deleteMany({ where: inCenter });
  await prisma.section.deleteMany({ where: { course: { centerId } } });
  await prisma.course.deleteMany({ where: { centerId } });
  await prisma.centerSkillTag.deleteMany({ where: { centerId } });
  await prisma.device.deleteMany({ where: { centerId } });
  await prisma.authSession.deleteMany({ where: { user: { centerId } } });
  // Student accounts and learner profiles are checked together at the end of
  // the transaction. Deleting them separately makes the database reject the save.
  await prisma.$transaction(async (tx) => {
    await tx.learnerProfile.deleteMany({ where: { centerId } });
    await tx.user.deleteMany({ where: { centerId } });
  });
  await prisma.center.delete({ where: { id: centerId } });
}

async function callHandoff(userId: string | null, id: string, method: "GET" | "POST") {
  holder.userId = userId;
  const handler = method === "GET" ? getHandoff : postHandoff;
  const response = await handler(new Request(`http://local.test/api/handoff/${id}`, { method }), { params: Promise.resolve({ id }) });
  return { status: response.status, text: await response.text() };
}

describe("student transition profiles and audit trail", () => {
  let admin: Actor;
  let director: Actor;
  let teacherSolo: Actor;
  let teacherExtra: Actor;
  let learner: Actor;

  beforeAll(async () => {
    await removeDay13();
    const passwordHash = hashSecret(PASSWORD);
    const pinHash = hashSecret("1234");
    const center = await prisma.center.create({
      data: { name: "Day13 Center", code: "DAY13", timezone: "UTC" },
      select: { id: true },
    });
    ids.center = center.id;
    async function staff(key: string, role: "ADMIN" | "CENTER_DIRECTOR" | "TEACHER", email: string, name: string) {
      const user = await prisma.user.create({
        data: { centerId: center.id, role, email, passwordHash, displayName: name, active: true },
        select: { id: true },
      });
      ids[key] = user.id;
    }
    await staff("admin", "ADMIN", "admin@day13.invalid", "Day13 Admin");
    await staff("director", "CENTER_DIRECTOR", "director@day13.invalid", "Day13 Director");
    await staff("teacherD", "TEACHER", "teacher.d@day13.invalid", "Day13 Teacher D");
    await staff("solo", "TEACHER", "teacher.solo@day13.invalid", "Day13 Solo");
    await staff("extra1", "TEACHER", "teacher.extra1@day13.invalid", "Day13 Extra One");
    await staff("extra2", "TEACHER", "teacher.extra2@day13.invalid", "Day13 Extra Two");
    await staff("out", "TEACHER", "teacher.out@day13.invalid", "Day13 Outgoing");
    await staff("inn", "TEACHER", "teacher.in@day13.invalid", "Day13 Incoming");
    await staff("fail", "TEACHER", "teacher.fail@day13.invalid", "Day13 Fail");
    await staff("idle", "TEACHER", "teacher.idle@day13.invalid", "Day13 Idle");
    async function learnerAccount(key: string, code: string, name: string) {
      // A student row and its profile have to commit together. The database
      // rejects a student account that has no profile.
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { centerId: center.id, role: "STUDENT", active: true },
          select: { id: true },
        });
        const profile = await tx.learnerProfile.create({
          data: { userId: user.id, centerId: center.id, learnerCode: code, displayName: name, ageBand: "AGE_12_14", pinHash },
          select: { id: true },
        });
        return { userId: user.id, profileId: profile.id };
      });
      ids[key] = created.profileId;
      ids[`${key}User`] = created.userId;
    }
    await learnerAccount("l1", "DAY13-1", "Day13 Learner One");
    await learnerAccount("l2", "DAY13-2", "Day13 Learner Two");
    await learnerAccount("l3", "DAY13-3", "Day13 Learner Three");
    await learnerAccount("withdrawn", "DAY13-W", "Day13 Withdrawn");
    await learnerAccount("lfail", "DAY13-F", "Day13 Fail Learner");
    const course = await prisma.course.create({
      data: { centerId: center.id, title: "Day13 Course", code: "D13", academicYear: 2026, semester: "SEMESTER_1" },
      select: { id: true },
    });
    async function section(key: string, name: string) {
      const created = await prisma.section.create({ data: { courseId: course.id, name }, select: { id: true } });
      ids[key] = created.id;
    }
    await section("d1", "Day13 Section One");
    await section("d2", "Day13 Section Two");
    await section("move", "Day13 Section Move");
    await section("failSection", "Day13 Section Fail");
    const start = new Date("2026-01-01T00:00:00.000Z");
    async function assign(sectionId: string, teacherId: string) {
      await prisma.sectionTeacher.create({ data: { sectionId, teacherId, startsOn: start, endsOn: null } });
    }
    await assign(ids.d1, ids.teacherD);
    await assign(ids.d1, ids.solo);
    await assign(ids.d2, ids.teacherD);
    await assign(ids.d2, ids.extra1);
    await assign(ids.d2, ids.extra2);
    await assign(ids.move, ids.out);
    await assign(ids.failSection, ids.fail);
    async function enroll(sectionId: string, learnerId: string, status: "ACTIVE" | "WITHDRAWN" = "ACTIVE") {
      await prisma.enrollment.create({
        data: { sectionId, learnerId, status, enrolledOn: start, withdrawnOn: status === "WITHDRAWN" ? start : null },
      });
    }
    await enroll(ids.d1, ids.l1);
    await enroll(ids.d1, ids.withdrawn, "WITHDRAWN");
    await enroll(ids.d2, ids.l2);
    await enroll(ids.move, ids.l3);
    await enroll(ids.failSection, ids.lfail);
    const device = await prisma.device.create({
      data: { id: crypto.randomUUID(), centerId: center.id, label: "Day13 phone" },
      select: { id: true },
    });
    ids.device = device.id;
    async function session(sectionId: string, key: string, startsAt: string, status: "HELD" | "SCHEDULED" | "CANCELLED") {
      const starts = new Date(startsAt);
      const created = await prisma.classSession.create({
        data: {
          sectionId,
          title: key,
          startsAt: starts,
          endsAt: new Date(starts.getTime() + 60 * 60 * 1000),
          deliveryMode: "IN_PERSON",
          status,
        },
        select: { id: true },
      });
      ids[key] = created.id;
    }
    await session(ids.d1, "present", "2026-10-01T08:00:00.000Z", "HELD");
    await session(ids.d1, "blank", "2026-10-02T08:00:00.000Z", "HELD");
    await session(ids.d1, "away", "2026-10-03T08:00:00.000Z", "HELD");
    await session(ids.d1, "family", "2026-10-04T08:00:00.000Z", "SCHEDULED");
    await session(ids.d1, "cancelled", "2026-10-05T08:00:00.000Z", "CANCELLED");
    await session(ids.d1, "future", "2026-12-01T08:00:00.000Z", "SCHEDULED");
    await session(ids.d2, "d2future", "2026-12-02T08:00:00.000Z", "SCHEDULED");
    await session(ids.move, "movePast", "2026-10-06T08:00:00.000Z", "HELD");
    async function mark(sessionKey: string, learnerId: string, status: "PRESENT" | "ABSENT", reasonCode: "UNKNOWN" | "FAMILY_CIRCUMSTANCES_NOT_RECORDED" | null) {
      await prisma.attendanceRecord.create({
        data: {
          clientEventId: crypto.randomUUID(),
          learnerId,
          sessionId: ids[sessionKey],
          status,
          reasonCode,
          deviceId: ids.device,
          recordedById: ids.teacherD,
          recordedAt: new Date("2026-10-06T00:00:00.000Z"),
          syncedAt: new Date("2026-10-06T00:00:00.000Z"),
          createdOffline: false,
        },
      });
    }
    await mark("present", ids.l1, "PRESENT", null);
    await mark("away", ids.l1, "ABSENT", "UNKNOWN");
    await mark("family", ids.l1, "ABSENT", "FAMILY_CIRCUMSTANCES_NOT_RECORDED");
    const points = [50, 55, 70, 78];
    for (let index = 0; index < points.length; index += 1) {
      const assignment = await prisma.assignment.create({
        data: {
          sectionId: ids.d1,
          title: `Day13 mark ${index + 1}`,
          kind: "PAPER",
          maxPoints: "100.00",
          dueAt: new Date(Date.UTC(2026, 8, index + 1)),
          createdById: ids.teacherD,
        },
        select: { id: true },
      });
      await prisma.gradeEntry.create({
        data: {
          assignmentId: assignment.id,
          learnerId: ids.l1,
          points: points[index].toFixed(2),
          academicNote: index === 0 ? MARK_NOTE : null,
          recordedById: ids.teacherD,
          deviceId: ids.device,
          versionVector: { [ids.device]: 1 },
          deviceRecordedAt: new Date("2026-10-01T00:00:00.000Z"),
          syncedAt: new Date("2026-10-01T00:00:00.000Z"),
          createdOffline: false,
        },
      });
    }
    await prisma.assignment.create({
      data: { sectionId: ids.d1, title: "Day13 missing mark", kind: "DIGITAL", maxPoints: "10.00", createdById: ids.teacherD },
    });
    const zeroAssignment = await prisma.assignment.create({
      data: { sectionId: ids.d2, title: "Day13 zero mark", kind: "PAPER", maxPoints: "10.00", dueAt: new Date("2026-10-01T00:00:00.000Z"), createdById: ids.teacherD },
      select: { id: true },
    });
    ids.zeroAssignment = zeroAssignment.id;
    await prisma.assignment.create({
      data: { sectionId: ids.d2, title: "Day13 absent mark", kind: "PAPER", maxPoints: "10.00", dueAt: new Date("2026-10-02T00:00:00.000Z"), createdById: ids.teacherD },
    });
    await prisma.gradeEntry.create({
      data: {
        assignmentId: zeroAssignment.id,
        learnerId: ids.l2,
        points: "0.00",
        recordedById: ids.teacherD,
        deviceId: ids.device,
        versionVector: { [ids.device]: 1 },
        deviceRecordedAt: new Date("2026-10-01T00:00:00.000Z"),
        syncedAt: new Date("2026-10-01T00:00:00.000Z"),
        createdOffline: false,
      },
    });
    await prisma.lessonProgress.createMany({
      data: [
        { learnerId: ids.l1, classSessionId: ids.present, status: "COMPLETED", completedAt: new Date("2026-10-01T09:00:00.000Z"), recordedById: ids.teacherD },
        { learnerId: ids.l1, classSessionId: ids.blank, status: "NOT_STARTED", completedAt: null, recordedById: ids.teacherD },
        { learnerId: ids.l3, classSessionId: ids.movePast, status: "NOT_STARTED", completedAt: null, recordedById: ids.out },
      ],
    });
    const tag = await prisma.centerSkillTag.create({
      data: { centerId: center.id, name: "Day13 shape", active: false, deactivatedAt: new Date("2026-10-02T00:00:00.000Z") },
      select: { id: true },
    });
    const noteId = crypto.randomUUID();
    const oldVersion = crypto.randomUUID();
    const currentVersion = crypto.randomUUID();
    ids.note = noteId;
    ids.oldVersion = oldVersion;
    ids.currentVersion = currentVersion;
    await prisma.progressNote.create({
      data: {
        id: noteId,
        learnerId: ids.l1,
        sectionId: ids.d1,
        authorId: ids.teacherD,
        body: NOTE,
        skillGaps: ["WRITING", "CUSTOM"],
        customSkillTagId: tag.id,
        deviceId: ids.device,
        versionVector: { [ids.device]: 2 },
        deviceRecordedAt: new Date("2026-10-02T00:00:00.000Z"),
        syncedAt: new Date("2026-10-02T00:00:00.000Z"),
        createdOffline: false,
      },
    });
    await prisma.progressNoteVersion.createMany({
      data: [
        {
          id: oldVersion,
          progressNoteId: noteId,
          authorId: ids.teacherD,
          body: "Day13 first note text",
          skillGaps: ["READING"],
          deviceId: ids.device,
          versionVector: { [ids.device]: 1 },
          deviceRecordedAt: new Date("2026-10-01T00:00:00.000Z"),
          syncedAt: new Date("2026-10-01T00:00:00.000Z"),
          createdOffline: false,
        },
        {
          id: currentVersion,
          progressNoteId: noteId,
          authorId: ids.teacherD,
          body: NOTE,
          skillGaps: ["WRITING", "CUSTOM"],
          customSkillTagId: tag.id,
          deviceId: ids.device,
          versionVector: { [ids.device]: 2 },
          deviceRecordedAt: new Date("2026-10-02T00:00:00.000Z"),
          syncedAt: new Date("2026-10-02T00:00:00.000Z"),
          createdOffline: false,
        },
      ],
    });
    admin = await actorOf(ids.admin);
    director = await actorOf(ids.director);
    await actorOf(ids.inn);
    teacherSolo = await actorOf(ids.solo);
    teacherExtra = await actorOf(ids.extra1);
    learner = await actorOf(ids.l1User);
  }, 60000);

  afterAll(async () => {
    try {
      holder.userId = null;
      await removeDay13();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("does not reassign when the named teacher is ineligible, and does not invent a handoff", async () => {
    const before = await prisma.handoffReport.count({ where: { sectionId: ids.move } });
    const refused = await reassignSectionTeacher(admin, {
      sectionId: ids.move,
      outgoingTeacherId: ids.out,
      incomingTeacherId: ids.l1User,
    });
    expect(refused.status).toBe("invalid");
    const still = await prisma.sectionTeacher.findFirstOrThrow({ where: { sectionId: ids.move, teacherId: ids.out } });
    expect(still.endsOn).toBeNull();
    expect(await prisma.handoffReport.count({ where: { sectionId: ids.move } })).toBe(before);
    const untouched = await reassignSectionTeacher(admin, {
      sectionId: ids.move,
      outgoingTeacherId: ids.idle,
      incomingTeacherId: ids.inn,
    });
    expect(untouched.status).toBe("unchanged");
    expect(await prisma.handoffReport.count({ where: { sectionId: ids.move } })).toBe(before);
  });

  it("assigns the report to the named incoming teacher and ignores a repeated request", async () => {
    const first = await reassignSectionTeacher(admin, {
      sectionId: ids.move,
      outgoingTeacherId: ids.out,
      incomingTeacherId: ids.inn,
    });
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    ids.moveReport = first.reportId;
    const report = await prisma.handoffReport.findUniqueOrThrow({ where: { id: first.reportId } });
    expect(report.incomingTeacherId).toBe(ids.inn);
    expect(report.assignedToId).toBe(ids.inn);
    expect(report.reason).toBe("SECTION_REASSIGNED");
    const profiles = await prisma.transitionProfile.findMany({ where: { handoffReportId: report.id } });
    expect(profiles.map((profile) => profile.learnerId)).toEqual([ids.l3]);
    expect(profiles[0]?.lessonsTracked).toBe(true);
    expect(profiles[0]?.lessonsCompleted).toBe(0);
    const second = await reassignSectionTeacher(admin, {
      sectionId: ids.move,
      outgoingTeacherId: ids.out,
      incomingTeacherId: ids.inn,
    });
    expect(second.status).toBe("unchanged");
    expect(await prisma.handoffReport.count({ where: { sectionId: ids.move } })).toBe(1);
    const endedMove = await prisma.sectionTeacher.findFirstOrThrow({ where: { sectionId: ids.move, teacherId: ids.out } });
    const moveToday = utcDay(new Date());
    expect(endedMove.endsOn?.getTime()).toBe(dayBefore(moveToday).getTime());
    expect(endedMove.endsOn && endedMove.endsOn.getTime() >= endedMove.startsOn.getTime()).toBe(true);
    const outgoing = await loadActor(ids.out);
    expect(outgoing?.assignedSectionIds.includes(ids.move)).toBe(false);
    const incoming = await loadActor(ids.inn);
    expect(incoming?.assignedSectionIds.includes(ids.move)).toBe(true);
  });

  it("ends an assignment that started today on that same UTC day and does not pack it twice", async () => {
    const now = new Date();
    const today = utcDay(now);
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const olderStart = new Date("2026-01-01T00:00:00.000Z");
    expect(reassignmentEndDate(today, now).getTime()).toBe(today.getTime());
    expect(reassignmentEndDate(olderStart, now).getTime()).toBe(dayBefore(today).getTime());
    expect(reassignmentEndDate(today, now).getTime() >= utcDay(today).getTime()).toBe(true);
    expect(reassignmentEndDate(olderStart, now).getTime() >= utcDay(olderStart).getTime()).toBe(true);

    const passwordHash = hashSecret(PASSWORD);
    const sameDayTeacher = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "TEACHER",
        email: "teacher.sameday@day13.invalid",
        passwordHash,
        displayName: "Day13 Same Day Teacher",
        active: true,
      },
      select: { id: true },
    });
    const course = await prisma.course.findFirstOrThrow({ where: { centerId: ids.center }, select: { id: true } });
    const section = await prisma.section.create({
      data: { courseId: course.id, name: "Day13 Same Day" },
      select: { id: true },
    });
    const pinHash = hashSecret("1234");
    const learner = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { centerId: ids.center, role: "STUDENT", active: true },
        select: { id: true },
      });
      return tx.learnerProfile.create({
        data: { userId: user.id, centerId: ids.center, learnerCode: "DAY13-S", displayName: "Day13 Same Day", ageBand: "AGE_12_14", pinHash },
        select: { id: true },
      });
    });
    await prisma.enrollment.create({
      data: { sectionId: section.id, learnerId: learner.id, status: "ACTIVE", enrolledOn: today },
    });
    const assignment = await prisma.sectionTeacher.create({
      data: { sectionId: section.id, teacherId: sameDayTeacher.id, startsOn: today, endsOn: null },
      select: { id: true, startsOn: true },
    });

    const first = await reassignSectionTeacher(admin, {
      sectionId: section.id,
      outgoingTeacherId: sameDayTeacher.id,
      incomingTeacherId: null,
      now,
    });
    expect(first.status).toBe("saved");
    if (first.status !== "saved") return;
    expect(first.sameDayAccess).toBe(true);
    const ended = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(ended.endsOn?.getTime()).toBe(ended.startsOn.getTime());
    expect(ended.startsOn.getTime()).toBe(today.getTime());
    expect(ended.accessClosed).toBe(false);
    expect(isCurrentAssignment(ended.startsOn, ended.endsOn, now, ended.accessClosed)).toBe(true);
    expect(isCurrentAssignment(ended.startsOn, ended.endsOn, tomorrow, ended.accessClosed)).toBe(false);
    const stillTeaching = await loadActor(sameDayTeacher.id);
    expect(stillTeaching?.assignedSectionIds.includes(section.id)).toBe(true);
    expect(await loadSectionGradebook(stillTeaching!, section.id)).not.toBeNull();
    const listed = (await listReassignmentChoices(admin))?.sections.find((row) => row.id === section.id);
    expect(listed?.teachers.some((teacher) => teacher.id === sameDayTeacher.id)).toBe(true);
    const reports = await prisma.handoffReport.findMany({ where: { sectionId: section.id } });
    expect(reports).toHaveLength(1);
    const profiles = await prisma.transitionProfile.findMany({ where: { handoffReportId: reports[0]?.id } });
    expect(profiles.map((profile) => profile.learnerId)).toEqual([learner.id]);

    const repeat = await reassignSectionTeacher(admin, {
      sectionId: section.id,
      outgoingTeacherId: sameDayTeacher.id,
      incomingTeacherId: null,
      now,
    });
    expect(repeat.status).toBe("unchanged");
    expect(await prisma.handoffReport.count({ where: { sectionId: section.id } })).toBe(1);
    expect(await prisma.transitionProfile.count({ where: { handoffReportId: reports[0]?.id } })).toBe(1);

    await expect(prisma.sectionTeacher.update({
      where: { id: assignment.id },
      data: { endsOn: dayBefore(today) },
    })).rejects.toThrow();
    const kept = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(kept.endsOn?.getTime()).toBe(today.getTime());
  });

  it("rolls back the assignment when profile generation fails", async () => {
    const real = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((callback: unknown, options?: unknown) => {
      if (typeof callback !== "function") return real(callback as never, options as never);
      return real(async (tx: { transitionProfile: { create: (...args: never[]) => Promise<unknown> } }) => {
        tx.transitionProfile.create = () => Promise.reject(new Error("boom"));
        return callback(tx);
      }, options as never);
    }) as typeof prisma.$transaction);
    try {
      const result = await setAccountActive(admin, ids.fail, false);
      expect(result.status).toBe("invalid");
    } finally {
      spy.mockRestore();
    }
    const teacher = await prisma.user.findUniqueOrThrow({ where: { id: ids.fail }, select: { active: true } });
    expect(teacher.active).toBe(true);
    expect(await prisma.handoffReport.count({ where: { sectionId: ids.failSection } })).toBe(0);
    const assignment = await prisma.sectionTeacher.findFirstOrThrow({ where: { sectionId: ids.failSection, teacherId: ids.fail } });
    expect(assignment.endsOn).toBeNull();
    const toDirector = await reassignSectionTeacher(admin, {
      sectionId: ids.failSection,
      outgoingTeacherId: ids.fail,
      incomingTeacherId: null,
    });
    expect(toDirector.status).toBe("saved");
    if (toDirector.status !== "saved") return;
    const report = await prisma.handoffReport.findUniqueOrThrow({ where: { id: toDirector.reportId } });
    expect(report.incomingTeacherId).toBeNull();
    expect(report.assignedToId).toBe(ids.director);
    const repeated = await reassignSectionTeacher(admin, {
      sectionId: ids.failSection,
      outgoingTeacherId: ids.fail,
      incomingTeacherId: null,
    });
    expect(repeated.status).toBe("unchanged");
    expect(await prisma.handoffReport.count({ where: { sectionId: ids.failSection } })).toBe(1);
  });

  it("builds one pack per section on deactivation and does not build another when repeated", async () => {
    const gradesBefore = await prisma.gradeEntry.count({ where: { learnerId: ids.l1 } });
    const notesBefore = await prisma.progressNote.count({ where: { id: ids.note } });
    const session = await createSessionRow(ids.teacherD, new Date());
    const first = await setAccountActive(admin, ids.teacherD, false);
    expect(first.status).toBe("saved");
    const reports = await prisma.handoffReport.findMany({
      where: { outgoingTeacherId: ids.teacherD, reason: "TEACHER_DEACTIVATED" },
      select: { id: true, sectionId: true, incomingTeacherId: true, assignedToId: true },
    });
    expect(reports).toHaveLength(2);
    const bySection = new Map(reports.map((report) => [report.sectionId, report]));
    // Solo still teaches section one. They are not named, so they do not receive the pack.
    expect(bySection.get(ids.d1)?.incomingTeacherId).toBeNull();
    expect(bySection.get(ids.d1)?.assignedToId).toBe(ids.director);
    expect(bySection.get(ids.d2)?.incomingTeacherId).toBeNull();
    expect(bySection.get(ids.d2)?.assignedToId).toBe(ids.director);
    const deactivateAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: ids.teacherD, action: "DEACTIVATE" } });
    expect(deactivateAudit.metadata).toMatchObject({ active: false, reportCount: 2, source: "account", incomingNamed: false });
    ids.d1Report = bySection.get(ids.d1)?.id ?? "";
    ids.d2Report = bySection.get(ids.d2)?.id ?? "";
    const d1Profiles = await prisma.transitionProfile.findMany({ where: { handoffReportId: ids.d1Report } });
    expect(d1Profiles.map((profile) => profile.learnerId)).toEqual([ids.l1]);
    const link = await prisma.transitionProfileNote.findFirstOrThrow({ where: { progressNoteId: ids.note } });
    expect(link.progressNoteVersionId).toBe(ids.currentVersion);
    expect(await prisma.gradeEntry.count({ where: { learnerId: ids.l1 } })).toBe(gradesBefore);
    expect(await prisma.progressNote.count({ where: { id: ids.note } })).toBe(notesBefore);
    expect(await prisma.sectionTeacher.count({ where: { teacherId: ids.teacherD } })).toBe(2);
    const storedSession = await prisma.authSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(sessionVerdict(storedSession, new Date())).toBe("revoked");
    expect(await loadActor(ids.teacherD)).toBeNull();
    const repeat = await setAccountActive(admin, ids.teacherD, false);
    expect(repeat.status).toBe("saved");
    expect(await prisma.handoffReport.count({ where: { outgoingTeacherId: ids.teacherD } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: ids.teacherD, action: "DEACTIVATE" } })).toBe(1);
    const idle = await setAccountActive(admin, ids.idle, false);
    expect(idle.status).toBe("saved");
    expect(await prisma.handoffReport.count({ where: { outgoingTeacherId: ids.idle } })).toBe(0);
    const login = await authenticateStaff({
      email: "teacher.d@day13.invalid",
      password: PASSWORD,
      now: new Date(),
      ip: "day13-test",
      store: memoryStore(),
      findStaff: findStaffByEmail,
    });
    expect(login).toEqual({ ok: false, error: "deactivated" });
  });

  it("stores attendance, grades, lessons, and the note version from that moment", async () => {
    const rich = await prisma.transitionProfile.findFirstOrThrow({ where: { handoffReportId: ids.d1Report, learnerId: ids.l1 } });
    expect(rich.attendanceKind).toBe("RECORDED");
    expect(rich.attendanceRate?.toFixed(2)).toBe("33.33");
    expect(rich.eligibleSessionCount).toBe(4);
    expect(rich.unmarkedCount).toBe(1);
    expect(rich.unexcusedAbsenceCount).toBe(1);
    expect(rich.gradeTrend).toBe("IMPROVING");
    expect(rich.lessonsTracked).toBe(true);
    expect(rich.lessonsCompleted).toBe(1);
    expect(rich.lessonsTotal).toBe(2);
    expect(rich.skillGaps).toEqual(expect.arrayContaining(["WRITING", "CUSTOM"]));
    const sparse = await prisma.transitionProfile.findFirstOrThrow({ where: { handoffReportId: ids.d2Report, learnerId: ids.l2 } });
    expect(sparse.attendanceKind).toBe("NO_ELIGIBLE_SESSIONS");
    expect(sparse.attendanceRate).toBeNull();
    expect(sparse.gradeTrend).toBe("INSUFFICIENT");
    expect(sparse.lessonsTracked).toBe(false);
    const snapshot = sparse.gradeSnapshot as { marks?: { assignmentId?: string; percent?: number }[] };
    expect(snapshot.marks).toEqual([{ assignmentId: ids.zeroAssignment, title: "Day13 zero mark", percent: 0 }]);
    const viewed = await readHandoffReport(director, ids.d1Report, "view");
    expect(viewed?.profiles[0]?.lessonLabel).toBe("1 of 2 tracked lessons completed");
    expect(viewed?.profiles[0]?.notes[0]?.body).toBe(NOTE);
    expect(viewed?.profiles[0]?.notes[0]?.versionId).toBe(ids.currentVersion);
    expect(viewed?.profiles[0]?.skillLabels.join(" ")).toContain("Day13 shape");
    expect(viewed?.profiles[0]?.skillLabels.join(" ")).toContain("not used for new notes");
    const later = crypto.randomUUID();
    await prisma.progressNoteVersion.create({
      data: {
        id: later,
        progressNoteId: ids.note,
        authorId: ids.solo,
        body: "Day13 later edit",
        skillGaps: ["SPEAKING"],
        deviceId: ids.device,
        versionVector: { [ids.device]: 3 },
        deviceRecordedAt: new Date("2026-11-01T00:00:00.000Z"),
        syncedAt: new Date("2026-11-01T00:00:00.000Z"),
        createdOffline: false,
      },
    });
    await prisma.progressNote.update({
      where: { id: ids.note },
      data: { body: "Day13 later edit", skillGaps: ["SPEAKING"], customSkillTagId: null, authorId: ids.solo },
    });
    const again = await readHandoffReport(director, ids.d1Report, "view");
    expect(again?.profiles[0]?.notes[0]?.body).toBe(NOTE);
    expect(again?.profiles[0]?.notes[0]?.versionId).toBe(ids.currentVersion);
    expect(again?.profiles[0]?.notes[0]?.body).not.toBe("Day13 later edit");
    const move = await readHandoffReport(await actorOf(ids.inn), ids.moveReport, "view");
    expect(move?.profiles[0]?.lessonLabel).toBe("No lessons completed");
    const sparseView = await readHandoffReport(director, ids.d2Report, "view");
    expect(sparseView?.profiles[0]?.attendanceLabel).toBe("No eligible sessions yet");
    expect(sparseView?.profiles[0]?.gradeLabel).toBe("Insufficient data");
    expect(sparseView?.profiles[0]?.lessonLabel).toBe("Not tracked");
    expect(sparseView?.profiles[0]?.marks.map((mark) => mark.title)).toEqual(["Day13 zero mark"]);
  });

  it("enforces report access on the record id and records views and print requests", async () => {
    const allowed = await callHandoff(ids.director, ids.d1Report, "GET");
    expect(allowed.status).toBe(200);
    expect(allowed.text).toContain(NOTE);
    const guessed = await callHandoff(ids.solo, ids.d1Report, "GET");
    expect(guessed.status).toBe(404);
    expect(guessed.text).not.toContain(NOTE);
    const incoming = await callHandoff(ids.inn, ids.moveReport, "GET");
    expect(incoming.status).toBe(200);
    const other = await callHandoff(ids.extra1, ids.d1Report, "GET");
    expect(other.status).toBe(404);
    expect(other.text).not.toContain(NOTE);
    const outgoing = await callHandoff(ids.out, ids.moveReport, "GET");
    expect(outgoing.status).toBe(404);
    expect(outgoing.text).not.toContain("Day13");
    const switchedOff = await callHandoff(ids.teacherD, ids.d1Report, "GET");
    expect(switchedOff.status).toBe(403);
    expect(switchedOff.text).not.toContain(NOTE);
    const student = await callHandoff(ids.l1User, ids.d1Report, "GET");
    expect(student.status).toBe(404);
    expect(student.text).not.toContain(NOTE);
    const adminRead = await callHandoff(ids.admin, ids.d1Report, "GET");
    expect(adminRead.status).toBe(404);
    expect(adminRead.text).not.toContain(NOTE);
    const directorRead = await callHandoff(ids.director, ids.d2Report, "GET");
    expect(directorRead.status).toBe(200);
    const printed = await callHandoff(ids.director, ids.d1Report, "POST");
    expect(printed.status).toBe(200);
    expect(printed.text).toContain("print-request");
    expect(printed.text).not.toContain(NOTE);
    const deniedPrint = await callHandoff(ids.extra1, ids.d1Report, "POST");
    expect(deniedPrint.status).toBe(404);
    const generation = await prisma.auditLog.findMany({ where: { action: "GENERATE_HANDOFF", entityId: { in: [ids.d1Report, ids.d2Report, ids.moveReport] } } });
    expect(generation).toHaveLength(3);
    expect(generation.every((row) => row.actorId === ids.admin)).toBe(true);
    const view = await prisma.auditLog.findFirstOrThrow({ where: { action: "VIEW", entityType: "HANDOFF_REPORT", entityId: ids.d1Report, actorId: ids.director } });
    expect(JSON.stringify(view.metadata)).not.toContain(NOTE);
    expect(JSON.stringify(view.metadata)).not.toContain(MARK_NOTE);
    expect(JSON.stringify(view.metadata)).not.toContain("Day13 shape");
    const noteView = await prisma.auditLog.findFirstOrThrow({ where: { action: "VIEW", entityType: "PROGRESS_NOTE", entityId: ids.note, actorId: ids.director } });
    expect(noteView.metadata).toMatchObject({ source: "handoff", handoffReportId: ids.d1Report });
    expect(JSON.stringify(noteView.metadata)).not.toContain(NOTE);
    const exported = await prisma.auditLog.findFirstOrThrow({ where: { action: "EXPORT", entityType: "HANDOFF_REPORT", entityId: ids.d1Report, actorId: ids.director } });
    expect(exported.metadata).toEqual({ source: "print-request" });
    expect(await prisma.auditLog.count({ where: { action: "EXPORT", entityId: ids.d1Report, actorId: ids.extra1 } })).toBe(0);
  });

  it("records a grade view from the signed-in teacher and hides the grade when the audit fails", async () => {
    const book = await loadSectionGradebook(teacherSolo, ids.d1);
    expect(book?.grades.length).toBeGreaterThan(0);
    const gradeId = book?.grades[0]?.id ?? "";
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "VIEW", entityType: "GRADE_ENTRY", entityId: gradeId, actorId: ids.solo } });
    expect(audit.metadata).toEqual({ source: "online" });
    expect(JSON.stringify(audit.metadata)).not.toContain(MARK_NOTE);
    const real = prisma.$transaction.bind(prisma);
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((callback: unknown, options?: unknown) => {
      if (typeof callback !== "function") return real(callback as never, options as never);
      return real(async (tx: { auditLog: { createMany: (...args: never[]) => Promise<unknown>; create: (...args: never[]) => Promise<unknown> } }) => {
        tx.auditLog.createMany = () => Promise.reject(new Error("audit write failed"));
        tx.auditLog.create = () => Promise.reject(new Error("audit write failed"));
        return callback(tx);
      }, options as never);
    }) as typeof prisma.$transaction);
    try {
      await expect(loadSectionGradebook(teacherSolo, ids.d1)).rejects.toThrow("The view could not be recorded.");
      const blocked = await callHandoff(ids.director, ids.d1Report, "GET");
      expect(blocked.status).toBe(500);
      expect(blocked.text).not.toContain(NOTE);
    } finally {
      spy.mockRestore();
    }
  });

  it("shows directors and admins a filtered audit log and keeps teachers and learners out", async () => {
    await prisma.$transaction(async (tx) => {
      await recordRiskFlagAudit(tx, director, crypto.randomUUID(), "OPEN");
      await recordExportAudit(tx, director, crypto.randomUUID(), "CSV", "AGGREGATE");
    });
    const directorLog = await listAuditLog(director, { action: "GENERATE_HANDOFF" });
    expect(directorLog?.rows.length).toBeGreaterThan(0);
    expect(directorLog?.rows.every((row) => row.action === "GENERATE_HANDOFF")).toBe(true);
    expect(directorLog?.rows.every((row) => row.centerCode === null)).toBe(true);
    expect(JSON.stringify(directorLog)).not.toContain(NOTE);
    const adminLog = await listAuditLog(admin, { entityType: "HANDOFF_REPORT", actorId: ids.admin });
    expect(adminLog?.rows.some((row) => row.centerCode === "DAY13")).toBe(true);
    expect(await listAuditLog(teacherExtra, {})).toBeNull();
    expect(await listAuditLog(learner, {})).toBeNull();
    holder.userId = ids.l1User;
    const studentAudit = await getAudit(new Request("http://local.test/api/audit"));
    expect(studentAudit.status).toBe(404);
    holder.userId = ids.director;
    const filtered = await getAudit(new Request("http://local.test/api/audit?action=UPDATE_RISK_FLAG"));
    expect(filtered.status).toBe(200);
    const body = await filtered.text();
    expect(body).toContain("UPDATE_RISK_FLAG");
    expect(body).not.toContain(NOTE);
    expect(body).not.toContain(PASSWORD);
    holder.userId = null;
  });

  it("names the incoming teacher, refuses another centre, and keeps older reports", async () => {
    const namedNote = "Day13 named handoff note";
    const laterNote = "Day13 named handoff note later";
    const passwordHash = hashSecret(PASSWORD);
    const outgoing = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "TEACHER",
        email: "teacher.named-out@day13.invalid",
        passwordHash,
        displayName: "Day13 Named Out",
        active: true,
      },
      select: { id: true },
    });
    const incoming = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "TEACHER",
        email: "teacher.named-in@day13.invalid",
        passwordHash,
        displayName: "Day13 Named In",
        active: true,
      },
      select: { id: true },
    });
    const coworker = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "TEACHER",
        email: "teacher.named-co@day13.invalid",
        passwordHash,
        displayName: "Day13 Named Co",
        active: true,
      },
      select: { id: true },
    });
    const staleForeign = await prisma.center.findUnique({ where: { code: "DAY13X" }, select: { id: true } });
    if (staleForeign) {
      await prisma.user.deleteMany({ where: { centerId: staleForeign.id } });
      await prisma.center.delete({ where: { id: staleForeign.id } });
    }
    const foreignCenter = await prisma.center.create({
      data: { name: "Day13 Other", code: "DAY13X", timezone: "UTC" },
      select: { id: true },
    });
    const foreign = await prisma.user.create({
      data: {
        centerId: foreignCenter.id,
        role: "TEACHER",
        email: "teacher.other@day13x.invalid",
        passwordHash,
        displayName: "Day13 Other Teacher",
        active: true,
      },
      select: { id: true },
    });
    try {
      const course = await prisma.course.findFirstOrThrow({ where: { centerId: ids.center }, select: { id: true } });
      const section = await prisma.section.create({
        data: { courseId: course.id, name: "Day13 Named" },
        select: { id: true },
      });
      const moveSection = await prisma.section.create({
        data: { courseId: course.id, name: "Day13 Named Move" },
        select: { id: true },
      });
      const pinHash = hashSecret("1234");
      const learner = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { centerId: ids.center, role: "STUDENT", active: true },
          select: { id: true },
        });
        return tx.learnerProfile.create({
          data: {
            userId: user.id,
            centerId: ids.center,
            learnerCode: "DAY13-N",
            displayName: "Day13 Named Learner",
            ageBand: "AGE_12_14",
            pinHash,
          },
          select: { id: true },
        });
      });
      const start = new Date("2026-01-01T00:00:00.000Z");
      await prisma.enrollment.create({
        data: { sectionId: section.id, learnerId: learner.id, status: "ACTIVE", enrolledOn: start },
      });
      const keptAssignment = await prisma.sectionTeacher.create({
        data: { sectionId: section.id, teacherId: outgoing.id, startsOn: start, endsOn: null },
        select: { id: true, startsOn: true },
      });
      await prisma.sectionTeacher.create({
        data: { sectionId: section.id, teacherId: coworker.id, startsOn: start, endsOn: null },
      });
      await prisma.sectionTeacher.create({
        data: { sectionId: moveSection.id, teacherId: outgoing.id, startsOn: start, endsOn: null },
      });
      const noteId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      await prisma.progressNote.create({
        data: {
          id: noteId,
          learnerId: learner.id,
          sectionId: section.id,
          authorId: outgoing.id,
          body: namedNote,
          skillGaps: ["READING"],
          deviceId: ids.device,
          versionVector: { [ids.device]: 1 },
          deviceRecordedAt: new Date("2026-10-02T00:00:00.000Z"),
          syncedAt: new Date("2026-10-02T00:00:00.000Z"),
          createdOffline: false,
        },
      });
      await prisma.progressNoteVersion.create({
        data: {
          id: versionId,
          progressNoteId: noteId,
          authorId: outgoing.id,
          body: namedNote,
          skillGaps: ["READING"],
          deviceId: ids.device,
          versionVector: { [ids.device]: 1 },
          deviceRecordedAt: new Date("2026-10-02T00:00:00.000Z"),
          syncedAt: new Date("2026-10-02T00:00:00.000Z"),
          createdOffline: false,
        },
      });

      const teacherAttempt = await setAccountActive(teacherSolo, outgoing.id, false, foreign.id);
      expect(teacherAttempt.status).toBe("hidden");
      const directorAttempt = await setAccountActive(director, outgoing.id, false, foreign.id);
      expect(directorAttempt.status).toBe("invalid");
      const selfAttempt = await setAccountActive(director, outgoing.id, false, outgoing.id);
      expect(selfAttempt.status).toBe("invalid");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: outgoing.id } })).active).toBe(true);
      expect(await prisma.handoffReport.count({ where: { outgoingTeacherId: outgoing.id } })).toBe(0);
      expect(await prisma.sectionTeacher.count({ where: { teacherId: outgoing.id } })).toBe(2);

      const blockedMove = await reassignSectionTeacher(teacherSolo, {
        sectionId: moveSection.id,
        outgoingTeacherId: outgoing.id,
        incomingTeacherId: foreign.id,
      });
      expect(blockedMove.status).toBe("hidden");
      const foreignMove = await reassignSectionTeacher(director, {
        sectionId: moveSection.id,
        outgoingTeacherId: outgoing.id,
        incomingTeacherId: foreign.id,
      });
      expect(foreignMove.status).toBe("invalid");
      const stillOpen = await prisma.sectionTeacher.findFirstOrThrow({
        where: { sectionId: moveSection.id, teacherId: outgoing.id },
      });
      expect(stillOpen.endsOn).toBeNull();
      expect(await prisma.handoffReport.count({ where: { sectionId: moveSection.id } })).toBe(0);

      const handed = await reassignSectionTeacher(director, {
        sectionId: moveSection.id,
        outgoingTeacherId: outgoing.id,
        incomingTeacherId: incoming.id,
      });
      expect(handed.status).toBe("saved");
      if (handed.status !== "saved") return;
      const moveReport = await prisma.handoffReport.findUniqueOrThrow({ where: { id: handed.reportId } });
      expect(moveReport.incomingTeacherId).toBe(incoming.id);
      expect(moveReport.assignedToId).toBe(incoming.id);
      expect(moveReport.reason).toBe("SECTION_REASSIGNED");
      const endedMove = await prisma.sectionTeacher.findFirstOrThrow({
        where: { sectionId: moveSection.id, teacherId: outgoing.id },
      });
      expect(endedMove.endsOn).not.toBeNull();
      expect(endedMove.accessClosed).toBe(false);

      const first = await setAccountActive(director, outgoing.id, false, incoming.id);
      expect(first).toMatchObject({ status: "saved", handoff: "teacher" });
      const reports = await prisma.handoffReport.findMany({
        where: { outgoingTeacherId: outgoing.id, reason: "TEACHER_DEACTIVATED" },
      });
      expect(reports).toHaveLength(1);
      const report = reports[0];
      if (!report) return;
      expect(report.sectionId).toBe(section.id);
      expect(report.incomingTeacherId).toBe(incoming.id);
      expect(report.assignedToId).toBe(incoming.id);
      expect(report.assignedToId).not.toBe(coworker.id);
      const profiles = await prisma.transitionProfile.findMany({ where: { handoffReportId: report.id } });
      expect(profiles.map((profile) => profile.learnerId)).toEqual([learner.id]);
      const link = await prisma.transitionProfileNote.findFirstOrThrow({ where: { progressNoteId: noteId } });
      expect(link.progressNoteVersionId).toBe(versionId);

      const kept = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: keptAssignment.id } });
      expect(kept.startsOn.getTime()).toBe(keptAssignment.startsOn.getTime());
      expect(kept.endsOn?.getTime()).toBe(reassignmentEndDate(keptAssignment.startsOn, new Date()).getTime());
      expect(kept.accessClosed).toBe(true);
      expect(isCurrentAssignment(kept.startsOn, kept.endsOn, new Date(), kept.accessClosed)).toBe(false);
      const added = await prisma.sectionTeacher.findFirst({
        where: { sectionId: section.id, teacherId: incoming.id },
      });
      expect(added?.endsOn).toBeNull();
      expect(added?.accessClosed).toBe(false);
      const storedOutgoing = await prisma.user.findUniqueOrThrow({ where: { id: outgoing.id } });
      expect(storedOutgoing.active).toBe(false);
      expect(storedOutgoing.displayName).toBe("Day13 Named Out");
      expect(await loadActor(outgoing.id)).toBeNull();

      const deactivateAudit = await prisma.auditLog.findFirstOrThrow({
        where: { action: "DEACTIVATE", entityId: outgoing.id },
      });
      expect(deactivateAudit.actorId).toBe(director.id);
      expect(deactivateAudit.metadata).toMatchObject({
        active: false,
        reportCount: 1,
        source: "account",
        incomingNamed: true,
      });
      expect(JSON.stringify(deactivateAudit.metadata)).not.toContain(namedNote);
      const generated = await prisma.auditLog.findFirstOrThrow({
        where: { action: "GENERATE_HANDOFF", entityId: report.id },
      });
      expect(generated.actorId).toBe(director.id);
      expect(JSON.stringify(generated.metadata)).not.toContain(namedNote);

      const reader = await loadActor(incoming.id);
      if (!reader) throw new Error("incoming teacher");
      expect(reader.assignedSectionIds).toContain(section.id);
      const viewed = await readHandoffReport(reader, report.id, "view");
      expect(viewed?.recipientName).toBe("Day13 Named In");
      expect(viewed?.profiles[0]?.notes[0]?.body).toBe(namedNote);
      expect(viewed?.profiles[0]?.notes[0]?.versionId).toBe(versionId);

      const laterVersion = crypto.randomUUID();
      await prisma.progressNoteVersion.create({
        data: {
          id: laterVersion,
          progressNoteId: noteId,
          authorId: incoming.id,
          body: laterNote,
          skillGaps: ["WRITING"],
          deviceId: ids.device,
          versionVector: { [ids.device]: 2 },
          deviceRecordedAt: new Date("2026-11-20T00:00:00.000Z"),
          syncedAt: new Date("2026-11-20T00:00:00.000Z"),
          createdOffline: false,
        },
      });
      await prisma.progressNote.update({
        where: { id: noteId },
        data: { body: laterNote, skillGaps: ["WRITING"], authorId: incoming.id },
      });
      const again = await readHandoffReport(await actorOf(incoming.id), report.id, "view");
      expect(again?.profiles[0]?.notes[0]?.body).toBe(namedNote);
      expect(again?.profiles[0]?.notes[0]?.versionId).toBe(versionId);
      expect(again?.profiles[0]?.notes[0]?.body).not.toBe(laterNote);
      const older = await readHandoffReport(director, ids.d1Report, "view");
      expect(older?.profiles[0]?.notes[0]?.body).toBe(NOTE);

      const opened = await callHandoff(incoming.id, report.id, "GET");
      expect(opened.status).toBe(200);
      expect(opened.text).toContain(namedNote);
      const coworkerRead = await callHandoff(coworker.id, report.id, "GET");
      expect(coworkerRead.status).toBe(404);
      expect(coworkerRead.text).not.toContain(namedNote);
      const printed = await callHandoff(incoming.id, report.id, "POST");
      expect(printed.status).toBe(200);
      expect(printed.text).toContain("print-request");
      expect(printed.text).not.toContain(namedNote);

      const repeat = await setAccountActive(director, outgoing.id, false, incoming.id);
      expect(repeat.status).toBe("saved");
      expect(await prisma.handoffReport.count({
        where: { outgoingTeacherId: outgoing.id, reason: "TEACHER_DEACTIVATED" },
      })).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: outgoing.id, action: "DEACTIVATE" } })).toBe(1);
      expect(await prisma.user.count({ where: { id: outgoing.id } })).toBe(1);
    } finally {
      holder.userId = null;
      await prisma.user.deleteMany({ where: { centerId: foreignCenter.id } });
      await prisma.center.delete({ where: { id: foreignCenter.id } }).catch(() => undefined);
    }
  }, 60000);

  it("closes old class assignments on switch-off and does not reopen them", async () => {
    const passwordHash = hashSecret(PASSWORD);
    const outgoing = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "TEACHER",
        email: "teacher.closed@day13.invalid",
        passwordHash,
        displayName: "Day13 Closed",
        active: true,
      },
      select: { id: true },
    });
    const incoming = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "TEACHER",
        email: "teacher.keeps@day13.invalid",
        passwordHash,
        displayName: "Day13 Keeps",
        active: true,
      },
      select: { id: true },
    });
    const course = await prisma.course.findFirstOrThrow({ where: { centerId: ids.center }, select: { id: true } });
    const pastSection = await prisma.section.create({
      data: { courseId: course.id, name: "Day13 Closed Past" },
      select: { id: true },
    });
    const todaySection = await prisma.section.create({
      data: { courseId: course.id, name: "Day13 Closed Today" },
      select: { id: true },
    });
    const pastStart = new Date("2026-01-01T00:00:00.000Z");
    const today = utcDay(new Date());
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const pastRow = await prisma.sectionTeacher.create({
      data: { sectionId: pastSection.id, teacherId: outgoing.id, startsOn: pastStart, endsOn: null },
      select: { id: true, startsOn: true },
    });
    const todayRow = await prisma.sectionTeacher.create({
      data: { sectionId: todaySection.id, teacherId: outgoing.id, startsOn: today, endsOn: null },
      select: { id: true, startsOn: true },
    });

    const switchedOff = await setAccountActive(director, outgoing.id, false, incoming.id);
    expect(switchedOff).toMatchObject({ status: "saved", handoff: "teacher" });

    const closedPast = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: pastRow.id } });
    expect(closedPast.startsOn.getTime()).toBe(pastRow.startsOn.getTime());
    expect(closedPast.endsOn?.getTime()).toBe(reassignmentEndDate(pastStart, new Date()).getTime());
    expect(closedPast.accessClosed).toBe(true);
    expect(isCurrentAssignment(closedPast.startsOn, closedPast.endsOn, new Date(), closedPast.accessClosed)).toBe(false);

    const closedToday = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: todayRow.id } });
    expect(closedToday.startsOn.getTime()).toBe(today.getTime());
    expect(closedToday.endsOn?.getTime()).toBe(today.getTime());
    expect(closedToday.endsOn && closedToday.endsOn.getTime() >= closedToday.startsOn.getTime()).toBe(true);
    expect(closedToday.accessClosed).toBe(true);
    // The date alone would still include today. The closed flag is what removes access.
    expect(isCurrentAssignment(closedToday.startsOn, closedToday.endsOn, new Date(), false)).toBe(true);
    expect(isCurrentAssignment(closedToday.startsOn, closedToday.endsOn, new Date(), closedToday.accessClosed)).toBe(false);
    expect(isCurrentAssignment(closedToday.startsOn, closedToday.endsOn, tomorrow, closedToday.accessClosed)).toBe(false);

    const incomingNow = await loadActor(incoming.id);
    expect(incomingNow?.assignedSectionIds).toEqual(expect.arrayContaining([pastSection.id, todaySection.id]));
    expect(await loadSectionGradebook(incomingNow!, todaySection.id)).not.toBeNull();

    const switchedOn = await setAccountActive(director, outgoing.id, true);
    expect(switchedOn.status).toBe("saved");
    const returned = await loadActor(outgoing.id);
    expect(returned?.active).toBe(true);
    expect(returned?.assignedSectionIds.includes(pastSection.id)).toBe(false);
    expect(returned?.assignedSectionIds.includes(todaySection.id)).toBe(false);
    expect(await loadSectionGradebook(returned!, todaySection.id)).toBeNull();
    expect(await loadSectionGradebook(returned!, pastSection.id)).toBeNull();
    const pastAfter = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: pastRow.id } });
    const todayAfter = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: todayRow.id } });
    expect(pastAfter.endsOn?.getTime()).toBe(closedPast.endsOn?.getTime());
    expect(pastAfter.accessClosed).toBe(true);
    expect(todayAfter.endsOn?.getTime()).toBe(today.getTime());
    expect(todayAfter.accessClosed).toBe(true);
    expect(await prisma.sectionTeacher.count({ where: { teacherId: outgoing.id } })).toBe(2);

    const choices = await listReassignmentChoices(director);
    const todayChoice = choices?.sections.find((section) => section.id === todaySection.id);
    expect(todayChoice?.teachers.some((teacher) => teacher.id === outgoing.id)).toBe(false);
    expect(todayChoice?.teachers.some((teacher) => teacher.id === incoming.id)).toBe(true);
    const retry = await reassignSectionTeacher(director, {
      sectionId: todaySection.id,
      outgoingTeacherId: outgoing.id,
      incomingTeacherId: incoming.id,
    });
    expect(retry.status).toBe("unchanged");
    expect(await prisma.handoffReport.count({
      where: { sectionId: todaySection.id, reason: "SECTION_REASSIGNED" },
    })).toBe(0);

    const incomingStill = await loadActor(incoming.id);
    expect(incomingStill?.assignedSectionIds).toEqual(expect.arrayContaining([pastSection.id, todaySection.id]));
    const incomingRows = await prisma.sectionTeacher.findMany({
      where: { teacherId: incoming.id, sectionId: { in: [pastSection.id, todaySection.id] } },
    });
    expect(incomingRows).toHaveLength(2);
    expect(incomingRows.every((row) => row.endsOn === null && row.accessClosed === false)).toBe(true);

    const putBackToday = await reassignSectionTeacher(director, {
      sectionId: todaySection.id,
      outgoingTeacherId: incoming.id,
      incomingTeacherId: outgoing.id,
    });
    expect(putBackToday).toEqual({
      status: "invalid",
      message:
        "This teacher already has an assignment for that section today. They can be assigned to it again on the next UTC day.",
    });
    expect(await prisma.sectionTeacher.count({
      where: { sectionId: todaySection.id, teacherId: outgoing.id },
    })).toBe(1);
    const incomingToday = await prisma.sectionTeacher.findFirstOrThrow({
      where: { sectionId: todaySection.id, teacherId: incoming.id },
    });
    expect(incomingToday.endsOn).toBeNull();
    expect(incomingToday.accessClosed).toBe(false);

    const putBackPast = await reassignSectionTeacher(director, {
      sectionId: pastSection.id,
      outgoingTeacherId: incoming.id,
      incomingTeacherId: outgoing.id,
    });
    expect(putBackPast.status).toBe("saved");
    const restoredPast = await prisma.sectionTeacher.findFirst({
      where: { sectionId: pastSection.id, teacherId: outgoing.id, endsOn: null, accessClosed: false },
    });
    expect(restoredPast).not.toBeNull();
    const closedPastStill = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: pastRow.id } });
    expect(closedPastStill.accessClosed).toBe(true);
    expect(closedPastStill.endsOn).not.toBeNull();
  });

  it("gives a blank handoff to the director who asked, and refuses an administrator when directors are not exactly one", async () => {
    const passwordHash = hashSecret(PASSWORD);
    const second = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "CENTER_DIRECTOR",
        email: "director.two@day13.invalid",
        passwordHash,
        displayName: "Day13 Director Two",
        active: true,
      },
      select: { id: true },
    });
    const outgoing = await prisma.user.create({
      data: {
        centerId: ids.center,
        role: "TEACHER",
        email: "teacher.blank@day13.invalid",
        passwordHash,
        displayName: "Day13 Blank",
        active: true,
      },
      select: { id: true },
    });
    const course = await prisma.course.findFirstOrThrow({ where: { centerId: ids.center }, select: { id: true } });
    const section = await prisma.section.create({
      data: { courseId: course.id, name: "Day13 Several Directors" },
      select: { id: true },
    });
    const start = new Date("2026-01-01T00:00:00.000Z");
    await prisma.sectionTeacher.create({
      data: { sectionId: section.id, teacherId: outgoing.id, startsOn: start, endsOn: null },
    });
    const secondDirector = await actorOf(second.id);

    const adminReassign = await reassignSectionTeacher(admin, {
      sectionId: section.id,
      outgoingTeacherId: outgoing.id,
      incomingTeacherId: null,
    });
    expect(adminReassign.status).toBe("invalid");
    expect((await prisma.sectionTeacher.findFirstOrThrow({
      where: { sectionId: section.id, teacherId: outgoing.id },
    })).endsOn).toBeNull();
    expect(await prisma.handoffReport.count({ where: { sectionId: section.id } })).toBe(0);

    const adminOff = await setAccountActive(admin, outgoing.id, false, null);
    expect(adminOff.status).toBe("invalid");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: outgoing.id } })).active).toBe(true);

    const saved = await setAccountActive(secondDirector, outgoing.id, false, null);
    expect(saved).toMatchObject({ status: "saved", handoff: "director" });
    const report = await prisma.handoffReport.findFirstOrThrow({
      where: { sectionId: section.id, reason: "TEACHER_DEACTIVATED" },
    });
    expect(report.assignedToId).toBe(second.id);
    expect(report.assignedToId).not.toBe(ids.director);
    expect(report.incomingTeacherId).toBeNull();
    const ended = await prisma.sectionTeacher.findFirstOrThrow({
      where: { sectionId: section.id, teacherId: outgoing.id },
    });
    expect(ended.endsOn?.getTime()).toBe(reassignmentEndDate(start, new Date()).getTime());

    const stale = await prisma.center.findUnique({ where: { code: "DAY13Z" }, select: { id: true } });
    if (stale) {
      await prisma.sectionTeacher.deleteMany({ where: { section: { course: { centerId: stale.id } } } });
      await prisma.section.deleteMany({ where: { course: { centerId: stale.id } } });
      await prisma.course.deleteMany({ where: { centerId: stale.id } });
      await prisma.user.deleteMany({ where: { centerId: stale.id } });
      await prisma.center.delete({ where: { id: stale.id } });
    }
    const quiet = await prisma.center.create({
      data: { name: "Day13 No Director", code: "DAY13Z", timezone: "UTC" },
      select: { id: true },
    });
    try {
      const quietCourse = await prisma.course.create({
        data: { centerId: quiet.id, title: "Day13 Quiet", code: "D13Z", academicYear: 2026, semester: "SEMESTER_1" },
        select: { id: true },
      });
      const quietSection = await prisma.section.create({
        data: { courseId: quietCourse.id, name: "Day13 Quiet Section" },
        select: { id: true },
      });
      const quietTeacher = await prisma.user.create({
        data: {
          centerId: quiet.id,
          role: "TEACHER",
          email: "teacher.quiet@day13z.invalid",
          passwordHash,
          displayName: "Day13 Quiet",
          active: true,
        },
        select: { id: true },
      });
      await prisma.sectionTeacher.create({
        data: { sectionId: quietSection.id, teacherId: quietTeacher.id, startsOn: start, endsOn: null },
      });
      const noDirector = await setAccountActive(admin, quietTeacher.id, false, null);
      expect(noDirector.status).toBe("invalid");
      expect((await prisma.user.findUniqueOrThrow({ where: { id: quietTeacher.id } })).active).toBe(true);
      expect(await prisma.handoffReport.count({ where: { sectionId: quietSection.id } })).toBe(0);
      expect((await prisma.sectionTeacher.findFirstOrThrow({
        where: { sectionId: quietSection.id, teacherId: quietTeacher.id },
      })).endsOn).toBeNull();
    } finally {
      await prisma.sectionTeacher.deleteMany({ where: { section: { course: { centerId: quiet.id } } } });
      await prisma.section.deleteMany({ where: { course: { centerId: quiet.id } } });
      await prisma.course.deleteMany({ where: { centerId: quiet.id } });
      await prisma.user.deleteMany({ where: { centerId: quiet.id } });
      await prisma.center.delete({ where: { id: quiet.id } }).catch(() => undefined);
    }
  });
});
