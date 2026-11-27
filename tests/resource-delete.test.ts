import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../lib/auth/permissions";
import { loadActor } from "../lib/auth/load-actor";
import { deleteResource, RESOURCE_IN_USE_MESSAGE } from "../lib/data/courses";
import { createTimetableSession, updateTimetableSession } from "../lib/data/timetable";
import { prisma } from "../lib/db";
import type { TimetableInput } from "../lib/lms/timetable";
import { assertConnectedTestDatabase } from "../lib/test-db/connect";
import { memoryStorage, type MemoryStorage } from "./support/memory-submission";

const now = new Date("2026-11-05T12:00:00.000Z");
const weekOf = "2028-01-03";
const checksum = "ab".repeat(32);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

async function cleanup() {
  await assertConnectedTestDatabase();
  await prisma.classSession.deleteMany({ where: { title: { startsWith: "Delete test" } } });
  await prisma.resource.deleteMany({ where: { title: { startsWith: "Delete test" } } });
}

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id, now);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}

async function learnerByCode(code: string) {
  const learner = await prisma.learnerProfile.findFirstOrThrow({
    where: { learnerCode: code, center: { code: "DEMO" } },
    select: { userId: true },
  });
  const actor = await loadActor(learner.userId, now);
  if (!actor) throw new Error(`missing learner ${code}`);
  return actor;
}

async function demoCourse() {
  return prisma.course.findFirstOrThrow({
    where: { center: { code: "DEMO" }, sections: { some: { name: "Morning Group" } } },
    select: { id: true, sections: { select: { id: true, name: true } } },
  });
}

function sectionId(course: Awaited<ReturnType<typeof demoCourse>>, name: string) {
  const section = course.sections.find((item) => item.name === name);
  if (!section) throw new Error(`missing ${name}`);
  return section.id;
}

function classInput(title: string, resourceId: string | null, start: string, end: string): TimetableInput {
  return {
    title,
    weekday: "MONDAY",
    startTime: start,
    endTime: end,
    weekOf,
    deliveryMode: "IN_PERSON",
    meetingUrl: null,
    linkedResourceId: resourceId,
  };
}

async function addPdf(input: {
  courseId: string;
  createdById: string;
  title: string;
  sectionId: string | null;
  storageKey: string;
}) {
  return prisma.resource.create({
    data: {
      courseId: input.courseId,
      sectionId: input.sectionId,
      createdById: input.createdById,
      title: input.title,
      resourceType: "PDF",
      storageKey: input.storageKey,
      mimeType: "application/pdf",
      byteSize: 4,
      checksumSha256: checksum,
    },
    select: { id: true, storageKey: true },
  });
}

function putFile(storage: MemoryStorage, key: string) {
  storage.objects.set(key, { bytes: Buffer.from("%PDF"), contentType: "application/pdf" });
}

describe("deleting a course material", () => {
  it("deletes a material that no class uses", async () => {
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const course = await demoCourse();
    const storage = memoryStorage();
    const created = await prisma.resource.create({
      data: {
        courseId: course.id,
        createdById: teacher.id,
        title: "Delete test unused link",
        resourceType: "WEB_LINK",
        externalUrl: "https://example.com/delete-test-unused",
      },
      select: { id: true },
    });

    const result = await deleteResource(teacher, created.id, prisma, storage);
    expect(result).toEqual({ ok: true });
    expect(storage.deleted).toEqual([]);
    expect(await prisma.resource.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("refuses a material linked to one class and keeps the row and the stored file", async () => {
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const course = await demoCourse();
    const morning = sectionId(course, "Morning Group");
    const storage = memoryStorage();
    const key = `course-resources/${crypto.randomUUID()}`;
    putFile(storage, key);
    const created = await addPdf({
      courseId: course.id,
      createdById: teacher.id,
      title: "Delete test one pdf",
      sectionId: null,
      storageKey: key,
    });
    const session = await createTimetableSession(
      teacher,
      morning,
      classInput("Delete test one class", created.id, "09:00", "10:00"),
    );
    expect(session.ok).toBe(true);

    const result = await deleteResource(teacher, created.id, prisma, storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("linked");
    expect(result.message).toContain(RESOURCE_IN_USE_MESSAGE);
    expect(result.message).toContain("Morning Group: Delete test one class");
    expect(result.message).toContain("Jan 2028");
    expect(storage.deleted).toEqual([]);
    expect(storage.objects.has(key)).toBe(true);
    expect(await prisma.resource.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it("refuses a material linked from more than one class and names each class", async () => {
    const morningTeacher = await actorByEmail("teacher.one@demo.invalid");
    const afternoonTeacher = await actorByEmail("teacher.two@demo.invalid");
    const course = await demoCourse();
    const storage = memoryStorage();
    const key = `course-resources/${crypto.randomUUID()}`;
    putFile(storage, key);
    const created = await addPdf({
      courseId: course.id,
      createdById: morningTeacher.id,
      title: "Delete test shared pdf",
      sectionId: null,
      storageKey: key,
    });
    const morning = await createTimetableSession(
      morningTeacher,
      sectionId(course, "Morning Group"),
      classInput("Delete test morning class", created.id, "09:00", "10:00"),
    );
    const afternoon = await createTimetableSession(
      afternoonTeacher,
      sectionId(course, "Afternoon Group"),
      classInput("Delete test afternoon class", created.id, "13:00", "14:00"),
    );
    expect(morning.ok).toBe(true);
    expect(afternoon.ok).toBe(true);

    const result = await deleteResource(morningTeacher, created.id, prisma, storage);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("Delete test morning class");
    expect(result.message).toContain("Delete test afternoon class");
    expect(result.message).toContain("Remove or replace those timetable links");
    expect(storage.deleted).toEqual([]);
    expect(storage.objects.has(key)).toBe(true);
    expect(await prisma.resource.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it("deletes the material and only its course file after the timetable links are removed", async () => {
    const morningTeacher = await actorByEmail("teacher.one@demo.invalid");
    const afternoonTeacher = await actorByEmail("teacher.two@demo.invalid");
    const course = await demoCourse();
    const morningId = sectionId(course, "Morning Group");
    const afternoonId = sectionId(course, "Afternoon Group");
    const storage = memoryStorage();
    const key = `course-resources/${crypto.randomUUID()}`;
    const homeworkKey = `submissions/${crypto.randomUUID()}`;
    putFile(storage, key);
    putFile(storage, homeworkKey);
    const created = await addPdf({
      courseId: course.id,
      createdById: morningTeacher.id,
      title: "Delete test after unlink",
      sectionId: null,
      storageKey: key,
    });
    const morning = await createTimetableSession(
      morningTeacher,
      morningId,
      classInput("Delete test unlink morning", created.id, "09:00", "10:00"),
    );
    const afternoon = await createTimetableSession(
      afternoonTeacher,
      afternoonId,
      classInput("Delete test unlink afternoon", created.id, "13:00", "14:00"),
    );
    expect(morning.ok && afternoon.ok).toBe(true);
    if (!morning.ok || !afternoon.ok) return;

    const blocked = await deleteResource(morningTeacher, created.id, prisma, storage);
    expect(blocked.ok).toBe(false);
    expect(storage.objects.has(key)).toBe(true);

    const clearMorning = await updateTimetableSession(
      morningTeacher,
      morningId,
      morning.sessionId,
      classInput("Delete test unlink morning", null, "09:00", "10:00"),
    );
    const clearAfternoon = await updateTimetableSession(
      afternoonTeacher,
      afternoonId,
      afternoon.sessionId,
      classInput("Delete test unlink afternoon", null, "13:00", "14:00"),
    );
    expect(clearMorning.ok).toBe(true);
    expect(clearAfternoon.ok).toBe(true);

    const result = await deleteResource(morningTeacher, created.id, prisma, storage);
    expect(result).toEqual({ ok: true });
    expect(storage.deleted).toEqual([key]);
    expect(storage.objects.has(key)).toBe(false);
    expect(storage.objects.has(homeworkKey)).toBe(true);
    expect(await prisma.resource.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("does not delete a homework object or a demo stand-in when the material row is removed", async () => {
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const course = await demoCourse();
    const storage = memoryStorage();
    const homeworkKey = `submissions/${crypto.randomUUID()}`;
    const demoKey = "private/demo/resources/delete-test-stand-in.pdf";
    putFile(storage, homeworkKey);
    putFile(storage, demoKey);
    const homework = await addPdf({
      courseId: course.id,
      createdById: teacher.id,
      title: "Delete test homework key",
      sectionId: null,
      storageKey: homeworkKey,
    });
    const demo = await addPdf({
      courseId: course.id,
      createdById: teacher.id,
      title: "Delete test demo key",
      sectionId: null,
      storageKey: demoKey,
    });

    expect(await deleteResource(teacher, homework.id, prisma, storage)).toEqual({ ok: true });
    expect(await deleteResource(teacher, demo.id, prisma, storage)).toEqual({ ok: true });
    expect(storage.deleted).toEqual([]);
    expect(storage.objects.has(homeworkKey)).toBe(true);
    expect(storage.objects.has(demoKey)).toBe(true);
  });

  it("keeps the material when the stored file cannot be deleted", async () => {
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const course = await demoCourse();
    const key = `course-resources/${crypto.randomUUID()}`;
    const created = await addPdf({
      courseId: course.id,
      createdById: teacher.id,
      title: "Delete test storage down",
      sectionId: null,
      storageKey: key,
    });
    const storage = {
      async delete() {
        throw new Error("bucket down");
      },
    };

    const failed = await deleteResource(teacher, created.id, prisma, storage);
    expect(failed).toMatchObject({ ok: false, reason: "storage" });
    expect(await prisma.resource.findUnique({ where: { id: created.id } })).not.toBeNull();

    const missing = await deleteResource(teacher, created.id, prisma, null);
    expect(missing).toMatchObject({ ok: false, reason: "storage" });
    expect(await prisma.resource.findUnique({ where: { id: created.id } })).not.toBeNull();
  });

  it("keeps course-wide and section-specific permissions", async () => {
    const morningTeacher = await actorByEmail("teacher.one@demo.invalid");
    const afternoonTeacher = await actorByEmail("teacher.two@demo.invalid");
    const director = await actorByEmail("director@demo.invalid");
    const admin = await actorByEmail("admin@demo.invalid");
    const learner = await learnerByCode("LNR-0001");
    const course = await demoCourse();
    const morning = sectionId(course, "Morning Group");
    const storage = memoryStorage();

    const sectionFile = await addPdf({
      courseId: course.id,
      createdById: morningTeacher.id,
      title: "Delete test morning only",
      sectionId: morning,
      storageKey: `course-resources/${crypto.randomUUID()}`,
    });
    putFile(storage, sectionFile.storageKey ?? "");
    const outsider: Actor = { ...afternoonTeacher, centerId: "00000000-0000-4000-8000-000000000099" };

    for (const actor of [afternoonTeacher, learner, admin, outsider]) {
      const refused = await deleteResource(actor, sectionFile.id, prisma, storage);
      expect(refused).toEqual({ ok: false, reason: "missing", message: "Resource not found." });
    }
    expect(storage.deleted).toEqual([]);
    expect(await prisma.resource.findUnique({ where: { id: sectionFile.id } })).not.toBeNull();
    expect(await deleteResource(morningTeacher, sectionFile.id, prisma, storage)).toEqual({ ok: true });
    expect(storage.deleted).toEqual([sectionFile.storageKey]);

    const shared = await prisma.resource.create({
      data: {
        courseId: course.id,
        createdById: morningTeacher.id,
        title: "Delete test whole course",
        resourceType: "WEB_LINK",
        externalUrl: "https://example.com/delete-test-whole",
      },
      select: { id: true },
    });
    expect(await deleteResource(afternoonTeacher, shared.id, prisma, storage)).toEqual({ ok: true });

    const directorFile = await prisma.resource.create({
      data: {
        courseId: course.id,
        sectionId: morning,
        createdById: director.id,
        title: "Delete test director",
        resourceType: "WEB_LINK",
        externalUrl: "https://example.com/delete-test-director",
      },
      select: { id: true },
    });
    expect(await deleteResource(director, directorFile.id, prisma, storage)).toEqual({ ok: true });
  });
});
