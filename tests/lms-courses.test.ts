import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadActor } from "../lib/auth/load-actor";
import type { Actor } from "../lib/auth/permissions";
import {
  createCourse,
  createResource,
  listCourses,
  listLearnerSections,
  readCourse,
  readLearnerSection,
  readResourceForDownload,
} from "../lib/data/courses";
import { prisma } from "../lib/db";

const holder = vi.hoisted(() => ({ actor: null as Actor | null }));

vi.mock("@/lib/auth/actor", () => ({
  getActor: async () => holder.actor,
}));

import { GET as downloadResource } from "../app/api/resources/[id]/download/route";

const now = new Date("2026-11-05T12:00:00.000Z");

afterAll(async () => {
  await prisma.$disconnect();
});

async function actorByEmail(email: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const actor = await loadActor(user.id, now);
  if (!actor) throw new Error(`missing actor ${email}`);
  return actor;
}

describe("LMS-1 course manager", () => {
  let courseId = "";
  let afternoonWebId = "";
  let morningAudioId = "";

  beforeAll(async () => {
    const course = await prisma.course.findFirstOrThrow({
      where: { center: { code: "DEMO" } },
      select: { id: true },
    });
    courseId = course.id;
    afternoonWebId = (
      await prisma.resource.findFirstOrThrow({
        where: { title: "Demo number practice link" },
        select: { id: true },
      })
    ).id;
    morningAudioId = (
      await prisma.resource.findFirstOrThrow({
        where: { title: "Demo letter sounds" },
        select: { id: true },
      })
    ).id;
  });

  it("lists learner sections with downloadable counts and blocks cross-section downloads", async () => {
    const morning = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const afternoon = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0016", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const morningActor = await loadActor(morning.userId, now);
    const afternoonActor = await loadActor(afternoon.userId, now);
    if (!morningActor || !afternoonActor) throw new Error("missing learners");

    const morningSections = await listLearnerSections(morningActor);
    expect(morningSections.length).toBeGreaterThan(0);
    expect(morningSections[0]?.downloadableCount).toBeGreaterThan(0);
    expect(await readResourceForDownload(morningActor, morningAudioId)).not.toBeNull();
    expect(await readResourceForDownload(afternoonActor, morningAudioId)).toBeNull();
    expect(await readResourceForDownload(morningActor, afternoonWebId)).toBeNull();
  });

  it("shows a whole-course resource to both sections and hides the other section's resource", async () => {
    const sharedPdf = await prisma.resource.findFirstOrThrow({
      where: { title: "Demo alphabet practice PDF", sectionId: null, course: { center: { code: "DEMO" } } },
      select: { id: true },
    });
    const morning = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const afternoon = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0016", center: { code: "DEMO" } },
      select: { userId: true },
    });
    const morningActor = await loadActor(morning.userId, now);
    const afternoonActor = await loadActor(afternoon.userId, now);
    if (!morningActor || !afternoonActor) throw new Error("missing learners");

    const morningList = await listLearnerSections(morningActor);
    const afternoonList = await listLearnerSections(afternoonActor);
    const morningSection = morningList[0];
    const afternoonSection = afternoonList[0];
    if (!morningSection || !afternoonSection) throw new Error("missing learner section");

    const morningPage = await readLearnerSection(morningActor, morningSection.id);
    const afternoonPage = await readLearnerSection(afternoonActor, afternoonSection.id);

    expect(morningPage?.resources.some((resource) => resource.id === sharedPdf.id)).toBe(true);
    expect(afternoonPage?.resources.some((resource) => resource.id === sharedPdf.id)).toBe(true);
    expect(morningPage?.resources.some((resource) => resource.id === afternoonWebId)).toBe(false);
    expect(afternoonPage?.resources.some((resource) => resource.id === morningAudioId)).toBe(false);
    expect(morningPage?.resources.some((resource) => resource.id === morningAudioId)).toBe(true);
    expect(afternoonPage?.resources.some((resource) => resource.id === afternoonWebId)).toBe(true);

    expect(morningSection.resources.some((resource) => resource.id === sharedPdf.id)).toBe(true);
    expect(afternoonSection.resources.some((resource) => resource.id === sharedPdf.id)).toBe(true);
    expect(morningSection.downloadableCount).toBeGreaterThanOrEqual(2);
    expect(afternoonSection.downloadableCount).toBeGreaterThanOrEqual(1);
    expect(afternoonSection.resources.some((resource) => resource.id === morningAudioId)).toBe(false);
  });

  it("returns a file body without exposing the private storage key", async () => {
    const morning = await prisma.learnerProfile.findFirstOrThrow({
      where: { learnerCode: "LNR-0001", center: { code: "DEMO" } },
      select: { userId: true },
    });
    holder.actor = await loadActor(morning.userId, now);
    const response = await downloadResource(new Request("http://localhost/download"), {
      params: Promise.resolve({ id: morningAudioId }),
    });
    expect(response.status).toBe(200);
    const buffer = new Uint8Array(await response.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    const headers = response.headers.get("content-disposition") ?? "";
    expect(headers).toContain("attachment");
    expect(headers).not.toContain("private/demo");
  });

  it("lets a teacher add a course-wide link resource", async () => {
    const teacherOne = await actorByEmail("teacher.one@demo.invalid");
    const created = await createResource(teacherOne, {
      courseId,
      sectionId: null,
      title: "Temp syllabus note",
      resourceType: "WEB_LINK",
      externalUrl: "https://example.com/temp-syllabus",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const course = await readCourse(teacherOne, courseId);
    expect(course?.resources.some((row) => row.title === "Temp syllabus note")).toBe(true);
    await prisma.resource.delete({ where: { id: created.resourceId } });
  });
});

describe("course creation without a first section", () => {
  const createdCourseIds: string[] = [];

  afterAll(async () => {
    if (createdCourseIds.length === 0) return;
    await prisma.sectionTeacher.deleteMany({
      where: { section: { courseId: { in: createdCourseIds } } },
    });
    await prisma.section.deleteMany({ where: { courseId: { in: createdCourseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  });

  function courseCode(prefix: string): string {
    return `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  }

  it("lets a teacher create, list, and read a course before any section exists", async () => {
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const created = await createCourse(teacher, {
      title: "Sectionless demo course",
      code: courseCode("NS"),
      academicYear: 2026,
      semester: "SEMESTER_1",
      firstSectionName: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdCourseIds.push(created.courseId);

    const listed = await listCourses(teacher);
    expect(listed?.some((course) => course.id === created.courseId)).toBe(true);
    const course = await readCourse(teacher, created.courseId);
    expect(course?.sections).toEqual([]);
    expect(await prisma.section.count({ where: { courseId: created.courseId } })).toBe(0);
  });

  it("still assigns the teacher when the first section is created with the course", async () => {
    const teacher = await actorByEmail("teacher.one@demo.invalid");
    const created = await createCourse(teacher, {
      title: "Sectioned demo course",
      code: courseCode("WS"),
      academicYear: 2026,
      semester: "SEMESTER_1",
      firstSectionName: "First Group",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdCourseIds.push(created.courseId);

    const fresh = await loadActor(teacher.id, new Date());
    if (!fresh) throw new Error("missing teacher after course create");
    const course = await readCourse(fresh, created.courseId);
    expect(course?.sections.map((section) => section.name)).toEqual(["First Group"]);
    const sectionId = course?.sections[0]?.id;
    expect(sectionId).toBeTruthy();
    const assignment = await prisma.sectionTeacher.findFirst({
      where: { sectionId: sectionId ?? "", teacherId: teacher.id, endsOn: null },
    });
    expect(assignment).not.toBeNull();

    const otherTeacher = await loadActor(
      (await actorByEmail("teacher.two@demo.invalid")).id,
      new Date(),
    );
    if (!otherTeacher) throw new Error("missing second teacher");
    expect(await readCourse(otherTeacher, created.courseId)).toBeNull();
    expect((await listCourses(otherTeacher))?.some((row) => row.id === created.courseId)).toBe(false);
  });
});
