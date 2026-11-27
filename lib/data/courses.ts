import { Prisma, type ResourceType, type Semester } from "../../generated/prisma/client";
import { prisma } from "../db";
import {
  canManageCourse,
  canManageResource,
  canReadResource,
  canReadSection,
  type Actor,
} from "../auth/permissions";
import { countDownloadableResources, validateResourcePayload, type ResourceTypeName } from "../lms/resources";
import { formatShortDate, localDateOfInstant } from "../lms/timetable";
import { isCourseResourceKey } from "../storage/course-file-rules";
import { storageFromEnv } from "../storage/s3";
import type { StorageAdapter } from "../storage/types";
import type { ResourceView } from "./records";

// Shown on the course page when Remove is refused. A class session stores
// linkedResourceId with ON DELETE RESTRICT, so the database will not remove
// the material while a timetable still points at it. Teachers unlink it from
// Weekly timetable → Change this class → Lesson or audio.
export const RESOURCE_IN_USE_MESSAGE =
  "This material is currently linked to one or more timetable sessions. Remove or replace those timetable links before deleting it.";

const FILE_REMOVE_FAILED = "The file could not be removed. Try again.";

type Db = typeof prisma;

export type CourseListItem = {
  id: string;
  title: string;
  code: string;
  academicYear: number;
  semester: string;
  sectionCount: number;
};

export type CourseDetail = {
  id: string;
  title: string;
  code: string;
  academicYear: number;
  semester: string;
  summary: string | null;
  sections: { id: string; name: string }[];
  resources: ResourceView[];
  downloadableCount: number;
};

function toResourceRow(row: {
  id: string;
  title: string;
  resourceType: string;
  externalUrl: string | null;
  mimeType: string | null;
  byteSize: number | null;
  storageKey: string | null;
  bodyText: string | null;
  sectionId: string | null;
  section: { name: string } | null;
}): ResourceView {
  return {
    id: row.id,
    title: row.title,
    resourceType: row.resourceType,
    externalUrl: row.storageKey ? null : row.externalUrl,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    fileStatus: row.storageKey ? "private" : "none",
    bodyText: row.bodyText,
    sectionId: row.sectionId,
    sectionName: row.section?.name ?? null,
  };
}

const resourceSelect = {
  id: true,
  title: true,
  resourceType: true,
  externalUrl: true,
  mimeType: true,
  byteSize: true,
  storageKey: true,
  bodyText: true,
  sectionId: true,
  section: { select: { name: true } },
} as const;

// A whole-course resource has no section. The section relation omits those rows,
// so learners would never see a sheet meant for every group in the course.
function resourcesForSection(sectionId: string) {
  return {
    where: { OR: [{ sectionId: null }, { sectionId }] },
    select: resourceSelect,
    orderBy: { title: "asc" as const },
  };
}

function teacherCourseFilter(actor: Actor) {
  if (actor.role === "CENTER_DIRECTOR") return { centerId: actor.centerId };
  // A new course has no section, so nobody is assigned yet. The teacher must
  // still open it to add the first section. Once any section exists, only
  // teachers assigned to one of those sections can see the course.
  return {
    centerId: actor.centerId,
    OR: [
      { sections: { some: { id: { in: actor.assignedSectionIds } } } },
      { sections: { none: {} } },
    ],
  };
}

export async function listCourses(actor: Actor, db: Db = prisma): Promise<CourseListItem[] | null> {
  if (!actor.active || actor.role === "ADMIN" || actor.role === "STUDENT") return null;
  if (!canManageCourse(actor, actor.centerId)) return null;

  const rows = await db.course.findMany({
    where: teacherCourseFilter(actor),
    select: {
      id: true,
      title: true,
      code: true,
      academicYear: true,
      semester: true,
      _count: { select: { sections: true } },
    },
    orderBy: [{ academicYear: "desc" }, { semester: "asc" }, { title: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    code: row.code,
    academicYear: row.academicYear,
    semester: row.semester,
    sectionCount: row._count.sections,
  }));
}

export async function readCourse(actor: Actor, courseId: string, db: Db = prisma): Promise<CourseDetail | null> {
  if (!actor.active || actor.role === "ADMIN" || actor.role === "STUDENT") return null;

  const row = await db.course.findFirst({
    where: { id: courseId, ...teacherCourseFilter(actor) },
    select: {
      id: true,
      title: true,
      code: true,
      academicYear: true,
      semester: true,
      summary: true,
      centerId: true,
      sections: { select: { id: true, name: true }, orderBy: { name: "asc" } },
      resources: { select: resourceSelect, orderBy: { title: "asc" } },
    },
  });
  if (!row || !canManageCourse(actor, row.centerId)) return null;

  const courseSectionIds = row.sections.map((section) => section.id);
  const resources = row.resources
    .filter((resource) =>
      canReadResource(actor, {
        id: resource.id,
        centerId: row.centerId,
        sectionId: resource.sectionId,
        courseSectionIds,
      }),
    )
    .map(toResourceRow);

  return {
    id: row.id,
    title: row.title,
    code: row.code,
    academicYear: row.academicYear,
    semester: row.semester,
    summary: row.summary,
    sections: row.sections,
    resources,
    downloadableCount: countDownloadableResources(resources),
  };
}

export type CreateCourseInput = {
  title: string;
  code: string;
  academicYear: number;
  semester: Semester;
  summary?: string | null;
  firstSectionName?: string | null;
};

export async function createCourse(
  actor: Actor,
  input: CreateCourseInput,
  db: Db = prisma,
): Promise<{ ok: true; courseId: string } | { ok: false; message: string }> {
  if (!canManageCourse(actor, actor.centerId)) return { ok: false, message: "You cannot create courses here." };

  const title = input.title.trim();
  const code = input.code.trim().toUpperCase();
  if (title.length < 3) return { ok: false, message: "Course name needs at least 3 characters." };
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
    return { ok: false, message: "Course code uses letters, numbers, and dashes (2–12 characters)." };
  }
  if (input.academicYear < 2020 || input.academicYear > 2100) {
    return { ok: false, message: "Pick a sensible academic year." };
  }

  const sectionName = (input.firstSectionName ?? "").trim();
  if (sectionName.length > 0 && sectionName.length < 2) {
    return { ok: false, message: "Section name is too short." };
  }

  try {
    const course = await db.$transaction(async (tx) => {
      const created = await tx.course.create({
        data: {
          centerId: actor.centerId,
          title,
          code,
          academicYear: input.academicYear,
          semester: input.semester,
          summary: input.summary?.trim() || null,
        },
      });
      if (sectionName) {
        const section = await tx.section.create({
          data: { courseId: created.id, name: sectionName },
        });
        if (actor.role === "TEACHER") {
          await tx.sectionTeacher.create({
            data: {
              sectionId: section.id,
              teacherId: actor.id,
              startsOn: new Date(),
              endsOn: null,
            },
          });
        }
      }
      return created;
    });
    return { ok: true, courseId: course.id };
  } catch {
    return { ok: false, message: "That course code already exists for this year and semester." };
  }
}

export async function createSection(
  actor: Actor,
  courseId: string,
  name: string,
  db: Db = prisma,
): Promise<{ ok: true; sectionId: string } | { ok: false; message: string }> {
  const course = await db.course.findFirst({
    where: { id: courseId, centerId: actor.centerId },
    select: { id: true, centerId: true },
  });
  if (!course || !canManageCourse(actor, course.centerId)) {
    return { ok: false, message: "Course not found." };
  }

  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: false, message: "Section name needs at least 2 characters." };

  try {
    const section = await db.$transaction(async (tx) => {
      const created = await tx.section.create({ data: { courseId: course.id, name: trimmed } });
      if (actor.role === "TEACHER") {
        await tx.sectionTeacher.create({
          data: {
            sectionId: created.id,
            teacherId: actor.id,
            startsOn: new Date(),
            endsOn: null,
          },
        });
      }
      return created;
    });
    return { ok: true, sectionId: section.id };
  } catch {
    return { ok: false, message: "That section name already exists in this course." };
  }
}

export type CreateResourceInput = {
  courseId: string;
  sectionId?: string | null;
  title: string;
  resourceType: ResourceTypeName;
  externalUrl?: string | null;
  bodyText?: string | null;
  storageKey?: string | null;
  mimeType?: string | null;
  byteSize?: number | null;
  checksumSha256?: string | null;
};

export async function createResource(
  actor: Actor,
  input: CreateResourceInput,
  db: Db = prisma,
): Promise<{ ok: true; resourceId: string } | { ok: false; message: string }> {
  // A PDF or MP3 becomes a resource only after the stored object is checked.
  // This path is for links and reading lists. A typed storage key is not accepted.
  if (input.resourceType === "PDF" || input.resourceType === "AUDIO") {
    return { ok: false, message: "Add a PDF or MP3 with the file control. A storage key cannot be typed in." };
  }
  const course = await db.course.findFirst({
    where: { id: input.courseId, centerId: actor.centerId },
    select: { id: true, centerId: true, sections: { select: { id: true } } },
  });
  if (!course) return { ok: false, message: "Course not found." };

  const courseSectionIds = course.sections.map((section) => section.id);
  const sectionId = input.sectionId?.trim() ? input.sectionId : null;
  if (sectionId && !courseSectionIds.includes(sectionId)) {
    return { ok: false, message: "That section does not belong to this course." };
  }

  const scope = {
    id: "new",
    centerId: course.centerId,
    sectionId,
    courseSectionIds,
  };
  if (!canManageResource(actor, scope)) {
    return { ok: false, message: "You cannot add materials for that section." };
  }

  const title = input.title.trim();
  if (title.length < 3) return { ok: false, message: "Title needs at least 3 characters." };

  const payloadCheck = validateResourcePayload({
    resourceType: input.resourceType,
    externalUrl: input.externalUrl,
    bodyText: input.bodyText,
    storageKey: input.storageKey,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    checksumSha256: input.checksumSha256,
  });
  if (!payloadCheck.ok) return { ok: false, message: payloadCheck.message };

  const linkTypes = new Set(["TEXTBOOK_LINK", "VIDEO_LINK", "WEB_LINK"]);

  const resource = await db.$transaction(async (tx) => {
    return tx.resource.create({
      data: {
        courseId: course.id,
        sectionId,
        createdById: actor.id,
        title,
        resourceType: input.resourceType as ResourceType,
        externalUrl: linkTypes.has(input.resourceType) ? input.externalUrl!.trim() : null,
        bodyText: input.resourceType === "TEXT" ? input.bodyText!.trim() : null,
        storageKey: null,
        mimeType: null,
        byteSize: null,
        checksumSha256: null,
      },
    });
  });

  return { ok: true, resourceId: resource.id };
}

type DeleteFailure = { ok: false; message: string; reason: "missing" | "linked" | "storage" };

type LinkedClass = {
  title: string;
  startsAt: Date;
  sectionName: string;
  timeZone: string;
};

function linkedClassLabel(session: LinkedClass): string {
  const day = localDateOfInstant(session.startsAt, session.timeZone);
  const date = day ? formatShortDate(day) : session.startsAt.toISOString().slice(0, 10);
  return `${session.sectionName}: ${session.title} (${date})`;
}

function linkedMessage(sessions: LinkedClass[]): string {
  const shown = sessions.slice(0, 5).map(linkedClassLabel);
  const extra = sessions.length > shown.length ? `, and ${sessions.length - shown.length} more` : "";
  return `${RESOURCE_IN_USE_MESSAGE} Linked classes: ${shown.join("; ")}${extra}.`;
}

async function classesUsingResource(db: Db, resourceId: string): Promise<LinkedClass[]> {
  const rows = await db.classSession.findMany({
    where: { linkedResourceId: resourceId },
    orderBy: { startsAt: "asc" },
    select: {
      title: true,
      startsAt: true,
      section: {
        select: {
          name: true,
          course: { select: { center: { select: { timezone: true } } } },
        },
      },
    },
  });
  return rows.map((row) => ({
    title: row.title,
    startsAt: row.startsAt,
    sectionName: row.section.name,
    timeZone: row.section.course.center.timezone,
  }));
}

export async function deleteResource(
  actor: Actor,
  resourceId: string,
  db: Db = prisma,
  // Undefined uses the configured bucket. Tests pass a stand-in so they never
  // call Backblaze. Null means storage is unavailable.
  storage: Pick<StorageAdapter, "delete"> | null | undefined = undefined,
): Promise<{ ok: true } | DeleteFailure> {
  const row = await db.resource.findFirst({
    where: { id: resourceId, course: { centerId: actor.centerId } },
    select: {
      id: true,
      storageKey: true,
      course: { select: { centerId: true, sections: { select: { id: true } } } },
      sectionId: true,
    },
  });
  if (!row) return { ok: false, reason: "missing", message: "Resource not found." };

  const courseSectionIds = row.course.sections.map((section) => section.id);
  if (
    !canManageResource(actor, {
      id: row.id,
      centerId: row.course.centerId,
      sectionId: row.sectionId,
      courseSectionIds,
    })
  ) {
    return { ok: false, reason: "missing", message: "Resource not found." };
  }

  // Check the timetable before touching the bucket. Deleting the file first
  // would leave the course row in place when the database refuses the delete,
  // and the class would point at a missing file.
  const linked = await classesUsingResource(db, row.id);
  if (linked.length > 0) return { ok: false, reason: "linked", message: linkedMessage(linked) };

  // Only a server-minted course file is removed. Homework lives under
  // submissions/ and demo stand-ins live under private/demo/. Neither is a
  // course-resources key, so this delete cannot reach them.
  const courseKey = row.storageKey && isCourseResourceKey(row.storageKey) ? row.storageKey : null;
  if (courseKey) {
    const bucket = storage === undefined ? storageFromEnv() : storage;
    if (!bucket) return { ok: false, reason: "storage", message: FILE_REMOVE_FAILED };
    try {
      await bucket.delete(courseKey);
    } catch {
      return { ok: false, reason: "storage", message: FILE_REMOVE_FAILED };
    }
  }

  try {
    await db.resource.delete({ where: { id: row.id } });
  } catch (error) {
    // A class can be linked in the moment between the check and this delete.
    // Say why, instead of showing the database error. The file may already
    // have been removed in that rare case; the row stays until the link is gone.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      const again = await classesUsingResource(db, row.id);
      return {
        ok: false,
        reason: "linked",
        message: again.length > 0 ? linkedMessage(again) : RESOURCE_IN_USE_MESSAGE,
      };
    }
    throw error;
  }
  return { ok: true };
}

export async function readResourceObject(actor: Actor, resourceId: string, db: Db = prisma) {
  if (!actor.active || actor.role === "ADMIN") return null;

  const sectionIds = actor.role === "STUDENT" ? actor.enrolledSectionIds : actor.assignedSectionIds;
  const row = await db.resource.findFirst({
    where: {
      id: resourceId,
      course: {
        centerId: actor.centerId,
        ...(actor.role === "CENTER_DIRECTOR" ? {} : { sections: { some: { id: { in: sectionIds } } } }),
      },
      ...(actor.role === "CENTER_DIRECTOR"
        ? {}
        : { OR: [{ sectionId: null }, { sectionId: { in: sectionIds } }] }),
      storageKey: { not: null },
    },
    select: {
      id: true,
      title: true,
      resourceType: true,
      mimeType: true,
      byteSize: true,
      checksumSha256: true,
      storageKey: true,
      sectionId: true,
      course: { select: { centerId: true, sections: { select: { id: true } } } },
    },
  });
  if (!row?.storageKey) return null;
  if (
    !canReadResource(actor, {
      id: row.id,
      centerId: row.course.centerId,
      sectionId: row.sectionId,
      courseSectionIds: row.course.sections.map((section) => section.id),
    })
  ) {
    return null;
  }
  if (row.resourceType !== "PDF" && row.resourceType !== "AUDIO") return null;

  return {
    title: row.title,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    storageKey: row.storageKey,
  };
}

export async function readResourceForDownload(actor: Actor, resourceId: string, db: Db = prisma) {
  const row = await readResourceObject(actor, resourceId, db);
  if (!row) return null;
  return {
    title: row.title,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
  };
}

export async function listLearnerSections(actor: Actor, db: Db = prisma) {
  if (!actor.active || actor.role !== "STUDENT" || !actor.learnerId) return [];

  const enrollments = await db.enrollment.findMany({
    where: { learnerId: actor.learnerId, status: "ACTIVE", section: { course: { centerId: actor.centerId } } },
    select: {
      section: {
        select: {
          id: true,
          name: true,
          course: {
            select: {
              title: true,
              academicYear: true,
              semester: true,
              sections: { select: { id: true } },
              resources: {
                where: {
                  OR: [{ sectionId: null }, { sectionId: { in: actor.enrolledSectionIds } }],
                },
                select: resourceSelect,
              },
            },
          },
        },
      },
    },
    orderBy: { section: { name: "asc" } },
  });

  return enrollments.map(({ section }) => {
    const courseSectionIds = section.course.sections.map((row) => row.id);
    const resources = section.course.resources
      .filter((resource) => resource.sectionId === null || resource.sectionId === section.id)
      .filter((resource) =>
        canReadResource(actor, {
          id: resource.id,
          centerId: actor.centerId,
          sectionId: resource.sectionId,
          courseSectionIds,
        }),
      )
      .map(toResourceRow);
    return {
      id: section.id,
      name: section.name,
      courseTitle: section.course.title,
      academicYear: section.course.academicYear,
      semester: section.course.semester,
      resources,
      downloadableCount: countDownloadableResources(resources),
    };
  });
}

export async function readLearnerSection(actor: Actor, sectionId: string, db: Db = prisma) {
  if (!actor.active || actor.role !== "STUDENT") return null;
  const section = await db.section.findFirst({
    where: {
      id: sectionId,
      course: { centerId: actor.centerId },
      enrollments: { some: { learnerId: actor.learnerId ?? "none", status: "ACTIVE" } },
    },
    select: {
      id: true,
      name: true,
      course: {
        select: {
          title: true,
          academicYear: true,
          semester: true,
          centerId: true,
          sections: { select: { id: true } },
          resources: resourcesForSection(sectionId),
        },
      },
    },
  });
  if (!section || !canReadSection(actor, { id: section.id, centerId: section.course.centerId })) return null;

  const courseSectionIds = section.course.sections.map((row) => row.id);
  const resources = section.course.resources
    .filter((resource) =>
      canReadResource(actor, {
        id: resource.id,
        centerId: section.course.centerId,
        sectionId: resource.sectionId,
        courseSectionIds,
      }),
    )
    .map(toResourceRow);

  return {
    id: section.id,
    name: section.name,
    courseTitle: section.course.title,
    academicYear: section.course.academicYear,
    semester: section.course.semester,
    resources,
    downloadableCount: countDownloadableResources(resources),
  };
}
