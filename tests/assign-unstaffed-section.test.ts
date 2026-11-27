import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashSecret } from "../lib/auth/password";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import { setAccountActive } from "../lib/auth/accounts";
import { utcDay } from "../lib/auth/assignments";
import { loadSectionGradebook } from "../lib/data/assignments";
import {
  assignTeacherToUnstaffedSection,
  listReassignmentChoices,
  listUnstaffedSections,
} from "../lib/data/handoff";
import { prisma } from "../lib/db";
import { assertConnectedTestDatabase } from "../lib/test-db/connect";

const PASSWORD = "day20-password";
const PRIVATE_NAME = "Day20 Private Learner";

const ids: Record<string, string> = {};
let director: Actor;
let admin: Actor;
let foreignDirector: Actor;
let idleActor: Actor;

async function removeCenter(code: string): Promise<void> {
  await assertConnectedTestDatabase();
  const center = await prisma.center.findUnique({ where: { code }, select: { id: true } });
  if (!center) return;
  const centerId = center.id;
  const inCenter = { section: { course: { centerId } } };
  await prisma.transitionProfileNote.deleteMany({ where: { transitionProfile: { handoffReport: inCenter } } });
  await prisma.transitionProfile.deleteMany({ where: { handoffReport: inCenter } });
  await prisma.handoffReport.deleteMany({ where: inCenter });
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.allow_demo_reset', 'on', true)`;
    const people = await tx.user.findMany({ where: { centerId }, select: { id: true } });
    await tx.auditLog.deleteMany({
      where: {
        OR: [
          { centerId },
          { actor: { centerId } },
          { entityId: { in: people.map((user) => user.id) } },
        ],
      },
    });
  });
  await prisma.sectionTeacher.deleteMany({ where: inCenter });
  await prisma.enrollment.deleteMany({ where: inCenter });
  await prisma.section.deleteMany({ where: { course: { centerId } } });
  await prisma.course.deleteMany({ where: { centerId } });
  await prisma.authSession.deleteMany({ where: { user: { centerId } } });
  await prisma.$transaction(async (tx) => {
    await tx.learnerProfile.deleteMany({ where: { centerId } });
    await tx.user.deleteMany({ where: { centerId } });
  });
  await prisma.center.delete({ where: { id: centerId } });
}

async function actorOf(userId: string): Promise<Actor> {
  const actor = await loadActor(userId);
  if (!actor) throw new Error("The test account could not be loaded.");
  return actor;
}

beforeAll(async () => {
  await removeCenter("DAY20A");
  await removeCenter("DAY20B");
  const passwordHash = hashSecret(PASSWORD);
  const center = await prisma.center.create({
    data: { name: "Day20 Centre", code: "DAY20A", timezone: "UTC" },
    select: { id: true },
  });
  const foreign = await prisma.center.create({
    data: { name: "Day20 Other Centre", code: "DAY20B", timezone: "UTC" },
    select: { id: true },
  });
  ids.center = center.id;
  ids.foreignCenter = foreign.id;

  async function staff(key: string, centerId: string, role: "TEACHER" | "CENTER_DIRECTOR" | "ADMIN", email: string, name: string, active = true) {
    const created = await prisma.user.create({
      data: {
        centerId,
        role,
        email,
        passwordHash,
        displayName: name,
        active,
        deactivatedAt: active ? null : new Date(),
      },
      select: { id: true },
    });
    ids[key] = created.id;
  }
  await staff("director", center.id, "CENTER_DIRECTOR", "director@day20.invalid", "Day20 Director");
  await staff("admin", center.id, "ADMIN", "admin@day20.invalid", "Day20 Admin");
  await staff("left", center.id, "TEACHER", "teacher.left@day20.invalid", "Day20 Left");
  await staff("next", center.id, "TEACHER", "teacher.next@day20.invalid", "Day20 Next");
  await staff("raceOne", center.id, "TEACHER", "teacher.race1@day20.invalid", "Day20 Race One");
  await staff("raceTwo", center.id, "TEACHER", "teacher.race2@day20.invalid", "Day20 Race Two");
  await staff("idle", center.id, "TEACHER", "teacher.idle@day20.invalid", "Day20 Idle");
  await staff("twinOne", center.id, "TEACHER", "twin.one@day20.invalid", "Day20 Twin");
  await staff("twinTwo", center.id, "TEACHER", "twin.two@day20.invalid", "Day20 Twin");
  await staff("inactive", center.id, "TEACHER", "teacher.inactive@day20.invalid", "Day20 Inactive", false);
  await staff("foreignDirector", foreign.id, "CENTER_DIRECTOR", "director@day20b.invalid", "Day20 Foreign Director");
  await staff("foreignTeacher", foreign.id, "TEACHER", "teacher@day20b.invalid", "Day20 Foreign Teacher");

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { centerId: center.id, role: "STUDENT", active: true },
      select: { id: true },
    });
    const profile = await tx.learnerProfile.create({
      data: {
        userId: user.id,
        centerId: center.id,
        learnerCode: "DAY20-1",
        displayName: PRIVATE_NAME,
        ageBand: "AGE_12_14",
        pinHash: hashSecret("1234"),
      },
      select: { id: true },
    });
    ids.learnerUser = user.id;
    ids.learner = profile.id;
  });

  const course = await prisma.course.create({
    data: { centerId: center.id, title: "Day20 Course", code: "D20", academicYear: 2026, semester: "SEMESTER_1" },
    select: { id: true },
  });
  const foreignCourse = await prisma.course.create({
    data: { centerId: foreign.id, title: "Day20 Foreign Course", code: "D20F", academicYear: 2026, semester: "SEMESTER_1" },
    select: { id: true },
  });
  async function section(key: string, courseId: string, name: string) {
    const created = await prisma.section.create({ data: { courseId, name }, select: { id: true } });
    ids[key] = created.id;
  }
  await section("today", course.id, "Day20 Afternoon");
  await section("past", course.id, "Day20 Morning");
  await section("staffed", course.id, "Day20 Staffed");
  await section("foreign", foreignCourse.id, "Day20 Foreign Section");

  const today = utcDay(new Date());
  const pastStart = new Date("2026-01-01T00:00:00.000Z");
  const todayRow = await prisma.sectionTeacher.create({
    data: { sectionId: ids.today, teacherId: ids.left, startsOn: today, endsOn: null },
    select: { id: true },
  });
  const pastRow = await prisma.sectionTeacher.create({
    data: { sectionId: ids.past, teacherId: ids.left, startsOn: pastStart, endsOn: null },
    select: { id: true },
  });
  await prisma.sectionTeacher.create({
    data: { sectionId: ids.staffed, teacherId: ids.idle, startsOn: pastStart, endsOn: null },
  });
  await prisma.sectionTeacher.create({
    data: { sectionId: ids.staffed, teacherId: ids.raceOne, startsOn: pastStart, endsOn: null },
  });
  ids.todayRow = todayRow.id;
  ids.pastRow = pastRow.id;

  director = await actorOf(ids.director);
  const switchedOff = await setAccountActive(director, ids.left, false, null);
  if (switchedOff.status !== "saved") throw new Error("The test teacher could not be switched off.");
  admin = await actorOf(ids.admin);
  foreignDirector = await actorOf(ids.foreignDirector);
  idleActor = await actorOf(ids.idle);
}, 60000);

afterAll(async () => {
  await removeCenter("DAY20A");
  await removeCenter("DAY20B");
});

describe("assign a teacher to an unstaffed section", () => {
  it("lists a section with no current teacher and hides one that still has a teacher", async () => {
    const choices = await listUnstaffedSections(director);
    const labels = choices?.sections.map((section) => section.label) ?? [];
    expect(labels).toContain("Day20 Course · Day20 Afternoon");
    expect(labels).toContain("Day20 Course · Day20 Morning");
    expect(labels.some((label) => label.includes("Day20 Staffed"))).toBe(false);
    expect(choices?.sections.every((section) => section.centerId === ids.center)).toBe(true);
    expect(choices?.teachers.some((teacher) => teacher.id === ids.next)).toBe(true);
    expect(choices?.teachers.some((teacher) => teacher.id === ids.foreignTeacher)).toBe(false);
    expect(choices?.teachers.find((teacher) => teacher.id === ids.next)?.name).toBe("Day20 Next");
    expect(choices?.teachers.filter((teacher) => teacher.name.startsWith("Day20 Twin")).map((teacher) => teacher.name).sort()).toEqual([
      "Day20 Twin · twin.one@day20.invalid",
      "Day20 Twin · twin.two@day20.invalid",
    ]);
    expect(choices?.teachers.every((teacher) => !teacher.name.includes("DAY20"))).toBe(true);

    const adminList = await listUnstaffedSections(admin);
    expect(adminList?.sections.some((section) => section.id === ids.foreign)).toBe(true);
    expect(adminList?.sections.some((section) => section.id === ids.staffed)).toBe(false);
    expect(adminList?.teachers.find((teacher) => teacher.id === ids.next)?.name).toBe("Day20 Next · DAY20A");
    expect(adminList?.teachers.filter((teacher) => teacher.name.startsWith("Day20 Twin")).map((teacher) => teacher.name).sort()).toEqual([
      "Day20 Twin · twin.one@day20.invalid · DAY20A",
      "Day20 Twin · twin.two@day20.invalid · DAY20A",
    ]);
    expect(adminList?.teachers.find((teacher) => teacher.id === ids.foreignTeacher)?.name).toContain("DAY20B");

    const staffed = await listReassignmentChoices(director);
    const staffedRow = staffed?.sections.find((section) => section.id === ids.staffed);
    expect(staffedRow?.teachers.map((teacher) => teacher.id).sort()).toEqual([ids.idle, ids.raceOne].sort());
    expect(staffed?.sections.some((section) => section.id === ids.today)).toBe(false);
    expect(staffed?.teachers.every((teacher) => teacher.centerId === ids.center)).toBe(true);
  });

  it("refuses the teacher who was switched off from that section today and keeps the closed row", async () => {
    const before = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: ids.todayRow } });
    const returned = await setAccountActive(director, ids.left, true);
    expect(returned.status).toBe("saved");
    const refused = await assignTeacherToUnstaffedSection(director, {
      sectionId: ids.today,
      teacherId: ids.left,
    });
    expect(refused).toEqual({
      status: "invalid",
      message: "This teacher already has an assignment for that section today. They can be assigned to it again on the next UTC day.",
    });
    const after = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: ids.todayRow } });
    expect(after.accessClosed).toBe(true);
    expect(after.startsOn.getTime()).toBe(before.startsOn.getTime());
    expect(after.endsOn?.getTime()).toBe(before.endsOn?.getTime());
    expect(await prisma.sectionTeacher.count({ where: { sectionId: ids.today, teacherId: ids.left } })).toBe(1);
    const returnedTeacher = await loadActor(ids.left);
    expect(returnedTeacher?.assignedSectionIds.includes(ids.today)).toBe(false);
  });

  it("assigns a new teacher, gives access immediately, and leaves the handoff and history unchanged", async () => {
    const reportsBefore = await prisma.handoffReport.findMany({
      where: { sectionId: ids.today },
      orderBy: { id: "asc" },
    });
    expect(reportsBefore.length).toBeGreaterThan(0);
    const saved = await assignTeacherToUnstaffedSection(director, {
      sectionId: ids.today,
      teacherId: ids.next,
    });
    expect(saved).toEqual({ status: "saved" });

    const added = await prisma.sectionTeacher.findFirstOrThrow({
      where: { sectionId: ids.today, teacherId: ids.next, endsOn: null },
    });
    expect(added.accessClosed).toBe(false);
    expect(added.startsOn.getTime()).toBe(utcDay(new Date()).getTime());
    const closed = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: ids.todayRow } });
    expect(closed.accessClosed).toBe(true);
    expect(closed.endsOn).not.toBeNull();
    expect(closed.teacherId).toBe(ids.left);

    const reportsAfter = await prisma.handoffReport.findMany({
      where: { sectionId: ids.today },
      orderBy: { id: "asc" },
    });
    expect(reportsAfter).toEqual(reportsBefore);

    const teaching = await loadActor(ids.next);
    expect(teaching?.assignedSectionIds).toContain(ids.today);
    expect(await loadSectionGradebook(teaching!, ids.today)).not.toBeNull();
    const returned = await setAccountActive(director, ids.left, true);
    expect(returned.status).toBe("saved");
    const oldTeacher = await loadActor(ids.left);
    expect(oldTeacher?.assignedSectionIds.includes(ids.today)).toBe(false);
    const stillClosed = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: ids.todayRow } });
    expect(stillClosed.accessClosed).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.next } })).active).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: ids.next, action: "CREATE", entityType: "USER" },
    });
    expect(audit.metadata).toEqual({ source: "section-assignment", sectionId: ids.today });
    expect(JSON.stringify(audit.metadata)).not.toContain(PRIVATE_NAME);
    expect(JSON.stringify(audit.metadata)).not.toContain("note");
  });

  it("refuses a second assignment to a section that now has a teacher", async () => {
    const repeat = await assignTeacherToUnstaffedSection(director, {
      sectionId: ids.today,
      teacherId: ids.raceOne,
    });
    expect(repeat).toEqual({
      status: "invalid",
      message: "This section already has a teacher. Use Manage section assignments to change who teaches it.",
    });
    expect(await prisma.sectionTeacher.count({
      where: { sectionId: ids.today, endsOn: null },
    })).toBe(1);
  });

  it("lets a director assign only inside their own centre", async () => {
    const blocked = await assignTeacherToUnstaffedSection(foreignDirector, {
      sectionId: ids.past,
      teacherId: ids.foreignTeacher,
    });
    expect(blocked.status).toBe("hidden");
    expect(await prisma.sectionTeacher.count({ where: { sectionId: ids.past, endsOn: null } })).toBe(0);
    const ownList = await listUnstaffedSections(director);
    expect(ownList?.sections.some((section) => section.id === ids.foreign)).toBe(false);
  });

  it("lets an administrator assign a teacher from the section's centre and refuses one from another centre", async () => {
    const wrongCentre = await assignTeacherToUnstaffedSection(admin, {
      sectionId: ids.foreign,
      teacherId: ids.next,
    });
    expect(wrongCentre).toEqual({
      status: "invalid",
      message: "Choose an active teacher from this section's centre.",
    });
    expect(await prisma.sectionTeacher.count({ where: { sectionId: ids.foreign } })).toBe(0);
    const saved = await assignTeacherToUnstaffedSection(admin, {
      sectionId: ids.foreign,
      teacherId: ids.foreignTeacher,
    });
    expect(saved).toEqual({ status: "saved" });
    const teaching = await loadActor(ids.foreignTeacher);
    expect(teaching?.assignedSectionIds).toContain(ids.foreign);
    const listed = await listUnstaffedSections(admin);
    expect(listed?.sections.some((section) => section.id === ids.foreign)).toBe(false);
    expect(listed?.teachers.some((teacher) => teacher.name.includes("DAY20B"))).toBe(true);
  });

  it("rejects an inactive teacher, a learner, and a non-teacher", async () => {
    const inactive = await assignTeacherToUnstaffedSection(director, {
      sectionId: ids.past,
      teacherId: ids.inactive,
    });
    const learner = await assignTeacherToUnstaffedSection(director, {
      sectionId: ids.past,
      teacherId: ids.learnerUser,
    });
    const notTeacher = await assignTeacherToUnstaffedSection(director, {
      sectionId: ids.past,
      teacherId: ids.director,
    });
    const message = "Choose an active teacher from this section's centre.";
    expect(inactive).toEqual({ status: "invalid", message });
    expect(learner).toEqual({ status: "invalid", message });
    expect(notTeacher).toEqual({ status: "invalid", message });
    expect(await prisma.sectionTeacher.count({ where: { sectionId: ids.past, endsOn: null } })).toBe(0);
  });

  it("rejects a section that already has an active teacher", async () => {
    const refused = await assignTeacherToUnstaffedSection(director, {
      sectionId: ids.staffed,
      teacherId: ids.raceTwo,
    });
    expect(refused).toEqual({
      status: "invalid",
      message: "This section already has a teacher. Use Manage section assignments to change who teaches it.",
    });
    const idleRow = await prisma.sectionTeacher.findFirstOrThrow({
      where: { sectionId: ids.staffed, teacherId: ids.idle },
    });
    expect(idleRow.endsOn).toBeNull();
    expect(idleRow.accessClosed).toBe(false);
  });

  it("hides the action from a teacher", async () => {
    const hidden = await assignTeacherToUnstaffedSection(idleActor, {
      sectionId: ids.past,
      teacherId: ids.raceOne,
    });
    expect(hidden.status).toBe("hidden");
    expect(await listUnstaffedSections(idleActor)).toBeNull();
  });

  it("allows only one of two simultaneous assignments and keeps the closed history", async () => {
    const pastBefore = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: ids.pastRow } });
    const [first, second] = await Promise.all([
      assignTeacherToUnstaffedSection(director, { sectionId: ids.past, teacherId: ids.raceOne }),
      assignTeacherToUnstaffedSection(admin, { sectionId: ids.past, teacherId: ids.raceTwo }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["invalid", "saved"]);
    const open = await prisma.sectionTeacher.findMany({
      where: { sectionId: ids.past, endsOn: null },
    });
    expect(open).toHaveLength(1);
    expect([ids.raceOne, ids.raceTwo]).toContain(open[0]?.teacherId);
    const pastAfter = await prisma.sectionTeacher.findUniqueOrThrow({ where: { id: ids.pastRow } });
    expect(pastAfter.accessClosed).toBe(true);
    expect(pastAfter.startsOn.getTime()).toBe(pastBefore.startsOn.getTime());
    expect(pastAfter.endsOn?.getTime()).toBe(pastBefore.endsOn?.getTime());
    expect(pastAfter.teacherId).toBe(ids.left);
    const winner = await loadActor(open[0]?.teacherId ?? "");
    expect(winner?.assignedSectionIds).toContain(ids.past);
  });
});
