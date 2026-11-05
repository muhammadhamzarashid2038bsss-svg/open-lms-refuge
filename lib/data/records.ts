import { prisma } from "../db";
import {
  canReadContact,
  canReadLearner,
  canReadResource,
  canReadSection,
  type Actor,
} from "../auth/permissions";
import { countDownloadableResources } from "../lms/resources";

type Db = typeof prisma;

export type ResourceView = {
  id: string;
  title: string;
  resourceType: string;
  externalUrl: string | null;
  mimeType: string | null;
  byteSize: number | null;
  fileStatus: "none" | "private";
  bodyText: string | null;
  sectionId: string | null;
  sectionName: string | null;
};

export type LearnerView = {
  id: string;
  learnerCode: string;
  displayName: string;
  ageBand: string;
  sections: { id: string; name: string }[];
  attendanceCount: number;
  gradeCount: number;
};

export type SectionLearner = {
  id: string;
  learnerCode: string;
  displayName: string;
  status: string;
};

export type SectionView = {
  id: string;
  name: string;
  courseTitle: string;
  resources: ResourceView[];
  downloadableCount: number;
  learners: SectionLearner[] | null;
};

export type AccountView = {
  id: string;
  role: string;
  email: string | null;
  displayName: string;
  learnerCode: string | null;
  active: boolean;
};

export type PrivateFileView = {
  id: string;
  title: string;
  mimeType: string | null;
  byteSize: number | null;
  message: string;
};

function toResourceView(row: {
  id: string;
  title: string;
  resourceType: string;
  externalUrl: string | null;
  mimeType: string | null;
  byteSize: number | null;
  storageKey: string | null;
  bodyText?: string | null;
  sectionId?: string | null;
  section?: { name: string } | null;
}): ResourceView {
  return {
    id: row.id,
    title: row.title,
    resourceType: row.resourceType,
    externalUrl: row.storageKey ? null : row.externalUrl,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    fileStatus: row.storageKey ? "private" : "none",
    bodyText: row.bodyText ?? null,
    sectionId: row.sectionId ?? null,
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
  courseId: true,
  section: { select: { name: true } },
} as const;

export async function readLearnerRecord(
  actor: Actor,
  learnerId: string,
  db: Db = prisma,
): Promise<LearnerView | null> {
  if (!actor.active || actor.role === "ADMIN") return null;

  const row = await db.learnerProfile.findFirst({
    where:
      actor.role === "STUDENT"
        ? { id: learnerId, userId: actor.id }
        : actor.role === "TEACHER"
          ? {
              id: learnerId,
              centerId: actor.centerId,
              enrollments: { some: { sectionId: { in: actor.assignedSectionIds } } },
            }
          : { id: learnerId, centerId: actor.centerId },
    select: {
      id: true,
      userId: true,
      centerId: true,
      learnerCode: true,
      displayName: true,
      ageBand: true,
      enrollments: { select: { sectionId: true, section: { select: { id: true, name: true } } } },
      _count: { select: { attendanceRecords: true, gradeEntries: true } },
    },
  });
  if (!row) return null;
  if (
    !canReadLearner(actor, {
      id: row.id,
      userId: row.userId,
      centerId: row.centerId,
      sectionIds: row.enrollments.map((enrollment) => enrollment.sectionId),
    })
  ) {
    return null;
  }

  return {
    id: row.id,
    learnerCode: row.learnerCode,
    displayName: row.displayName,
    ageBand: row.ageBand,
    sections: row.enrollments.map((enrollment) => enrollment.section),
    attendanceCount: row._count.attendanceRecords,
    gradeCount: row._count.gradeEntries,
  };
}

export async function readLearnerContact(
  actor: Actor,
  learnerId: string,
  db: Db = prisma,
): Promise<{ phone: string | null } | null> {
  if (!actor.active || actor.role !== "CENTER_DIRECTOR") return null;
  const row = await db.learnerProfile.findFirst({
    where: { id: learnerId, centerId: actor.centerId },
    select: {
      id: true,
      userId: true,
      centerId: true,
      enrollments: { select: { sectionId: true } },
      contact: { select: { phoneE164: true } },
    },
  });
  if (!row) return null;
  if (
    !canReadContact(actor, {
      id: row.id,
      userId: row.userId,
      centerId: row.centerId,
      sectionIds: row.enrollments.map((enrollment) => enrollment.sectionId),
    })
  ) {
    return null;
  }
  return { phone: row.contact?.phoneE164 ?? null };
}

export async function readSectionRecord(
  actor: Actor,
  sectionId: string,
  db: Db = prisma,
): Promise<SectionView | null> {
  if (!actor.active || actor.role === "ADMIN") return null;
  const row = await db.section.findFirst({
    where: {
      AND: [
        { id: sectionId },
        { course: { centerId: actor.centerId } },
        ...(actor.role === "TEACHER" ? [{ id: { in: actor.assignedSectionIds } }] : []),
        ...(actor.role === "STUDENT"
          ? [{ enrollments: { some: { learnerId: actor.learnerId ?? "none", status: "ACTIVE" as const } } }]
          : []),
      ],
    },
    select: {
      id: true,
      name: true,
      course: {
        select: {
          title: true,
          centerId: true,
          sections: { select: { id: true } },
          resources: {
            where: { OR: [{ sectionId: null }, { sectionId }] },
            select: resourceSelect,
            orderBy: { title: "asc" },
          },
        },
      },
      enrollments: {
        select: {
          status: true,
          learner: { select: { id: true, learnerCode: true, displayName: true } },
        },
      },
    },
  });
  if (!row) return null;
  if (!canReadSection(actor, { id: row.id, centerId: row.course.centerId })) return null;
  if (actor.role === "TEACHER" && !actor.assignedSectionIds.includes(row.id)) return null;

  const resources = row.course.resources
    .filter((resource) =>
      canReadResource(actor, {
        id: resource.id,
        centerId: row.course.centerId,
        sectionId: resource.sectionId,
        courseSectionIds: row.course.sections.map((section) => section.id),
      }),
    )
    .map(toResourceView);

  return {
    id: row.id,
    name: row.name,
    courseTitle: row.course.title,
    resources,
    downloadableCount: countDownloadableResources(resources),
    learners:
      actor.role === "STUDENT"
        ? null
        : row.enrollments.map((enrollment) => ({
            id: enrollment.learner.id,
            learnerCode: enrollment.learner.learnerCode,
            displayName: enrollment.learner.displayName,
            status: enrollment.status,
          })),
  };
}

export async function readResourceRecord(
  actor: Actor,
  resourceId: string,
  db: Db = prisma,
): Promise<ResourceView | null> {
  const row = await loadResource(actor, resourceId, db);
  if (!row) return null;
  return toResourceView(row);
}

export async function readPrivateFile(
  actor: Actor,
  resourceId: string,
  db: Db = prisma,
): Promise<PrivateFileView | null> {
  const row = await loadResource(actor, resourceId, db);
  if (!row?.storageKey) return null;
  return {
    id: row.id,
    title: row.title,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    message: "This file stays in private storage. The app does not give out a public link.",
  };
}

async function loadResource(actor: Actor, resourceId: string, db: Db) {
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
    },
    select: {
      ...resourceSelect,
      course: { select: { centerId: true, sections: { select: { id: true } } } },
    },
  });
  if (!row) return null;
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
  return row;
}

export async function listAccounts(actor: Actor, db: Db = prisma): Promise<AccountView[] | null> {
  if (!actor.active || (actor.role !== "ADMIN" && actor.role !== "CENTER_DIRECTOR")) return null;
  const rows = await db.user.findMany({
    where: actor.role === "ADMIN" ? {} : { centerId: actor.centerId },
    select: {
      id: true,
      role: true,
      email: true,
      displayName: true,
      active: true,
      learnerProfile: { select: { learnerCode: true, displayName: true } },
    },
    orderBy: [{ role: "asc" }, { email: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    email: row.email,
    displayName: row.learnerProfile?.displayName ?? row.displayName ?? "Account",
    learnerCode: row.learnerProfile?.learnerCode ?? null,
    active: row.active,
  }));
}

export async function readCenterSummary(actor: Actor, db: Db = prisma) {
  if (!actor.active || actor.role !== "CENTER_DIRECTOR") return null;
  const center = await db.center.findFirst({
    where: { id: actor.centerId },
    select: { id: true, name: true, code: true },
  });
  if (!center) return null;
  const [learnerCount, sectionCount] = await Promise.all([
    db.learnerProfile.count({ where: { centerId: actor.centerId } }),
    db.section.count({ where: { course: { centerId: actor.centerId } } }),
  ]);
  return { ...center, learnerCount, sectionCount };
}

export async function listAssignedSections(actor: Actor, db: Db = prisma) {
  if (!actor.active || actor.role !== "TEACHER") return [];
  return db.section.findMany({
    where: { id: { in: actor.assignedSectionIds }, course: { centerId: actor.centerId } },
    select: { id: true, name: true, course: { select: { title: true } } },
    orderBy: { name: "asc" },
  });
}
