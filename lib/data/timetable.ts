import type { DeliveryMode, SessionStatus } from "../../generated/prisma/client";
import { prisma } from "../db";
import { canManageResource, canManageTimetable, canReadResource, canReadSection, type Actor } from "../auth/permissions";
import {
  addCalendarDays,
  clockOfInstant,
  dayBounds,
  deliveryLabel,
  formatCivilDate,
  formatShortDate,
  isUuid,
  localDateOfInstant,
  materialLabel,
  mondayOnOrBefore,
  parseIsoDate,
  sessionInstants,
  validateMeetingUrl,
  validateTimetableInput,
  weekBounds,
  weekdayLabel,
  weekdayOfInstant,
  WEEKDAYS,
  type DeliveryModeName,
  type TimetableInput,
  type WeekdayName,
} from "../lms/timetable";

type Db = typeof prisma;

const DENIED = "You cannot change this timetable.";

export type TimetableFailure = { ok: false; code: "denied" | "invalid"; message: string };

export type TimetableSessionView = {
  id: string;
  title: string;
  weekday: WeekdayName;
  startTime: string;
  endTime: string;
  deliveryMode: DeliveryModeName;
  deliveryLabel: string;
  status: SessionStatus;
  joinHref: string | null;
  meetingUrlForEdit: string | null;
  materialHref: string | null;
  materialLabel: string | null;
  linkedResourceId: string | null;
  inPersonNote: string | null;
  canDelete: boolean;
};

export type TimetableResourceOption = {
  id: string;
  title: string;
  resourceType: string;
};

export type WeeklyTimetable = {
  sectionId: string;
  sectionName: string;
  courseId: string;
  courseTitle: string;
  timezone: string;
  weekOf: string;
  weekLabel: string;
  previousWeek: string;
  nextWeek: string;
  canManage: boolean;
  days: {
    weekday: WeekdayName;
    label: string;
    dateLabel: string;
    sessions: TimetableSessionView[];
  }[];
  resources: TimetableResourceOption[];
};

export type WeeklyTimetableResult =
  | { kind: "hidden" }
  | { kind: "invalid-timezone" }
  | { kind: "ok"; timetable: WeeklyTimetable };

export type TodayClass = {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  courseTitle: string;
  sectionName: string;
  sectionId: string;
  deliveryMode: DeliveryModeName;
  deliveryLabel: string;
  joinHref: string | null;
  materialHref: string | null;
  materialLabel: string | null;
  inPersonNote: string | null;
};

export type TodayResult = { ok: true; classes: TodayClass[] } | { ok: false; message: string };

function denied(): TimetableFailure {
  return { ok: false, code: "denied", message: DENIED };
}

function invalid(message: string): TimetableFailure {
  return { ok: false, code: "invalid", message };
}

const sectionSelect = {
  id: true,
  name: true,
  courseId: true,
  course: {
    select: {
      id: true,
      title: true,
      centerId: true,
      sections: { select: { id: true } },
      center: { select: { timezone: true } },
    },
  },
} as const;

async function loadSection(sectionId: string, db: Db) {
  if (!isUuid(sectionId)) return null;
  return db.section.findUnique({ where: { id: sectionId }, select: sectionSelect });
}

function sectionScope(section: { id: string; course: { centerId: string } }) {
  return { id: section.id, centerId: section.course.centerId };
}

type ResourceRow = {
  id: string;
  title: string;
  resourceType: string;
  externalUrl: string | null;
  storageKey: string | null;
  sectionId: string | null;
};

function materialHrefFor(
  resource: ResourceRow,
  viewerIsLearner: boolean,
  sectionId: string,
  courseId: string,
): { href: string; label: string } | null {
  if (resource.externalUrl?.startsWith("https://")) {
    return { href: resource.externalUrl, label: materialLabel(resource.resourceType) };
  }
  if ((resource.resourceType === "PDF" || resource.resourceType === "AUDIO") && resource.storageKey) {
    return { href: `/api/resources/${resource.id}/download`, label: materialLabel(resource.resourceType) };
  }
  if (resource.resourceType === "TEXT") {
    const href = viewerIsLearner
      ? `/student/sections/${sectionId}#lesson-${resource.id}`
      : `/courses/${courseId}#lesson-${resource.id}`;
    return { href, label: materialLabel(resource.resourceType) };
  }
  return null;
}

function toSessionView(input: {
  row: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    deliveryMode: DeliveryMode;
    meetingUrl: string | null;
    status: SessionStatus;
    linkedResourceId: string | null;
    linkedResource: ResourceRow | null;
    attendanceRecords: { id: string }[];
    lessonProgress: { id: string }[];
  };
  timeZone: string;
  canManage: boolean;
  viewerIsLearner: boolean;
  sectionId: string;
  courseId: string;
  centerId: string;
  courseSectionIds: string[];
  actor: Actor;
}): TimetableSessionView | null {
  const weekday = weekdayOfInstant(input.row.startsAt, input.timeZone);
  const startTime = clockOfInstant(input.row.startsAt, input.timeZone);
  const endTime = clockOfInstant(input.row.endsAt, input.timeZone);
  if (!weekday || !startTime || !endTime) return null;
  const mode = input.row.deliveryMode;
  const cancelled = input.row.status === "CANCELLED";
  const meeting = input.row.meetingUrl ? validateMeetingUrl(input.row.meetingUrl) : null;
  const joinHref = !cancelled && mode === "LIVE_ONLINE" && meeting?.ok ? meeting.url : null;
  let materialHref: string | null = null;
  let materialLabelText: string | null = null;
  const resource = input.row.linkedResource;
  if (!cancelled && resource) {
    const allowed = canReadResource(input.actor, {
      id: resource.id,
      centerId: input.centerId,
      sectionId: resource.sectionId,
      courseSectionIds: input.courseSectionIds,
    });
    if (allowed) {
      const opened = materialHrefFor(resource, input.viewerIsLearner, input.sectionId, input.courseId);
      materialHref = opened?.href ?? null;
      materialLabelText = opened?.label ?? null;
    }
  }
  return {
    id: input.row.id,
    title: input.row.title,
    weekday,
    startTime,
    endTime,
    deliveryMode: mode,
    deliveryLabel: deliveryLabel(mode),
    status: input.row.status,
    joinHref,
    meetingUrlForEdit: input.canManage ? input.row.meetingUrl : null,
    materialHref,
    materialLabel: materialLabelText,
    linkedResourceId: input.row.linkedResourceId,
    inPersonNote: !cancelled && mode === "IN_PERSON" ? "Come to class in person." : null,
    canDelete: input.row.attendanceRecords.length === 0 && input.row.lessonProgress.length === 0,
  };
}

async function assertLinkableResource(
  actor: Actor,
  section: NonNullable<Awaited<ReturnType<typeof loadSection>>>,
  resourceId: string | null,
  db: Db,
): Promise<{ ok: true } | TimetableFailure> {
  if (!resourceId) return { ok: true };
  if (!isUuid(resourceId)) return invalid("That lesson is not part of this section.");
  const resource = await db.resource.findUnique({
    where: { id: resourceId },
    select: {
      id: true,
      sectionId: true,
      courseId: true,
      course: { select: { centerId: true, sections: { select: { id: true } } } },
    },
  });
  if (!resource || resource.courseId !== section.courseId) {
    return invalid("That lesson is not part of this section.");
  }
  if (resource.sectionId && resource.sectionId !== section.id) {
    return invalid("That lesson is not part of this section.");
  }
  const allowed = canManageResource(actor, {
    id: resource.id,
    centerId: resource.course.centerId,
    sectionId: resource.sectionId,
    courseSectionIds: resource.course.sections.map((row) => row.id),
  });
  if (!allowed) return invalid("That lesson is not part of this section.");
  return { ok: true };
}

async function findOverlap(
  db: Db,
  sectionId: string,
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
): Promise<boolean> {
  const clash = await db.classSession.findFirst({
    where: {
      sectionId,
      status: { not: "CANCELLED" },
      id: excludeId ? { not: excludeId } : undefined,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
    },
    select: { id: true },
  });
  return Boolean(clash);
}

export async function listTimetableSections(actor: Actor, db: Db = prisma) {
  if (!actor.active) return [];
  if (actor.role === "TEACHER") {
    return db.section.findMany({
      where: { id: { in: actor.assignedSectionIds }, course: { centerId: actor.centerId } },
      select: { id: true, name: true, course: { select: { title: true } } },
      orderBy: { name: "asc" },
    });
  }
  if (actor.role === "CENTER_DIRECTOR") {
    return db.section.findMany({
      where: { course: { centerId: actor.centerId } },
      select: { id: true, name: true, course: { select: { title: true } } },
      orderBy: [{ course: { title: "asc" } }, { name: "asc" }],
    });
  }
  return [];
}

export async function readWeeklyTimetable(
  actor: Actor,
  sectionId: string,
  weekOf: string | null,
  now = new Date(),
  db: Db = prisma,
): Promise<WeeklyTimetableResult> {
  if (!actor.active) return { kind: "hidden" };
  const section = await loadSection(sectionId, db);
  if (!section || !canReadSection(actor, sectionScope(section))) return { kind: "hidden" };
  const timeZone = section.course.center.timezone;
  if (!localDateOfInstant(now, timeZone)) return { kind: "invalid-timezone" };

  const requested = weekOf ? parseIsoDate(weekOf) : localDateOfInstant(now, timeZone);
  if (!requested) return { kind: "invalid-timezone" };
  const monday = mondayOnOrBefore(requested);
  const bounds = weekBounds(monday, timeZone);
  if (!bounds) return { kind: "invalid-timezone" };

  const canManage = canManageTimetable(actor, sectionScope(section));
  const courseSectionIds = section.course.sections.map((row) => row.id);
  const rows = await db.classSession.findMany({
    where: { sectionId: section.id, startsAt: { gte: bounds.start, lt: bounds.end } },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      deliveryMode: true,
      meetingUrl: true,
      status: true,
      linkedResourceId: true,
      linkedResource: {
        select: {
          id: true,
          title: true,
          resourceType: true,
          externalUrl: true,
          storageKey: true,
          sectionId: true,
        },
      },
      attendanceRecords: { select: { id: true }, take: 1 },
      lessonProgress: { select: { id: true }, take: 1 },
    },
    orderBy: { startsAt: "asc" },
  });

  const sessions = rows.flatMap((row) => {
    const view = toSessionView({
      row,
      timeZone,
      canManage,
      viewerIsLearner: actor.role === "STUDENT",
      sectionId: section.id,
      courseId: section.courseId,
      centerId: section.course.centerId,
      courseSectionIds,
      actor,
    });
    return view ? [view] : [];
  });

  const resources = canManage
    ? await db.resource.findMany({
        where: {
          courseId: section.courseId,
          OR: [{ sectionId: null }, { sectionId: section.id }],
        },
        select: { id: true, title: true, resourceType: true },
        orderBy: { title: "asc" },
      })
    : [];

  const days = WEEKDAYS.map((weekday, index) => {
    const date = addCalendarDays(monday, index);
    return {
      weekday,
      label: weekdayLabel(weekday),
      dateLabel: formatShortDate(date),
      sessions: sessions.filter((session) => session.weekday === weekday),
    };
  });

  const sunday = addCalendarDays(monday, 6);
  return {
    kind: "ok",
    timetable: {
      sectionId: section.id,
      sectionName: section.name,
      courseId: section.courseId,
      courseTitle: section.course.title,
      timezone: timeZone,
      weekOf: formatCivilDate(monday),
      weekLabel: `${formatShortDate(monday)} to ${formatShortDate(sunday)}`,
      previousWeek: formatCivilDate(addCalendarDays(monday, -7)),
      nextWeek: formatCivilDate(addCalendarDays(monday, 7)),
      canManage,
      days,
      resources,
    },
  };
}

async function prepareWrite(
  actor: Actor,
  sectionId: string,
  input: TimetableInput,
  db: Db,
): Promise<
  | {
      ok: true;
      section: NonNullable<Awaited<ReturnType<typeof loadSection>>>;
      value: Extract<ReturnType<typeof validateTimetableInput>, { ok: true }>["value"];
      startsAt: Date;
      endsAt: Date;
    }
  | TimetableFailure
> {
  if (!actor.active) return denied();
  const section = await loadSection(sectionId, db);
  if (!section || !canManageTimetable(actor, sectionScope(section))) return denied();
  const parsed = validateTimetableInput(input);
  if (!parsed.ok) return invalid(parsed.message);
  const linked = await assertLinkableResource(actor, section, parsed.value.linkedResourceId, db);
  if (!linked.ok) return linked;
  const instants = sessionInstants(parsed.value, section.course.center.timezone);
  if (!instants) return invalid("End time must be after the start time.");
  return { ok: true, section, value: parsed.value, ...instants };
}

export async function createTimetableSession(
  actor: Actor,
  sectionId: string,
  input: TimetableInput,
  db: Db = prisma,
): Promise<{ ok: true; sessionId: string } | TimetableFailure> {
  const prepared = await prepareWrite(actor, sectionId, input, db);
  if (!prepared.ok) return prepared;
  const overlap = await findOverlap(db, prepared.section.id, prepared.startsAt, prepared.endsAt);
  if (overlap) return invalid("This time overlaps another class in this section. Pick a different time.");
  const created = await db.classSession.create({
    data: {
      sectionId: prepared.section.id,
      title: prepared.value.title,
      startsAt: prepared.startsAt,
      endsAt: prepared.endsAt,
      deliveryMode: prepared.value.deliveryMode,
      meetingUrl: prepared.value.meetingUrl,
      linkedResourceId: prepared.value.linkedResourceId,
      status: "SCHEDULED",
    },
    select: { id: true },
  });
  return { ok: true, sessionId: created.id };
}

export async function updateTimetableSession(
  actor: Actor,
  sectionId: string,
  sessionId: string,
  input: TimetableInput & { status?: "SCHEDULED" | "CANCELLED" | null },
  db: Db = prisma,
): Promise<{ ok: true } | TimetableFailure> {
  if (!isUuid(sessionId)) return denied();
  const prepared = await prepareWrite(actor, sectionId, input, db);
  if (!prepared.ok) return prepared;
  const existing = await db.classSession.findFirst({
    where: { id: sessionId, sectionId: prepared.section.id },
    select: { id: true, status: true },
  });
  if (!existing) return denied();
  const nextStatus: SessionStatus = input.status ?? existing.status;
  if (nextStatus !== "CANCELLED") {
    const overlap = await findOverlap(db, prepared.section.id, prepared.startsAt, prepared.endsAt, existing.id);
    if (overlap) return invalid("This time overlaps another class in this section. Pick a different time.");
  }
  await db.classSession.update({
    where: { id: existing.id },
    data: {
      title: prepared.value.title,
      startsAt: prepared.startsAt,
      endsAt: prepared.endsAt,
      deliveryMode: prepared.value.deliveryMode,
      meetingUrl: prepared.value.meetingUrl,
      linkedResourceId: prepared.value.linkedResourceId,
      status: nextStatus,
    },
  });
  return { ok: true };
}

export async function deleteTimetableSession(
  actor: Actor,
  sectionId: string,
  sessionId: string,
  db: Db = prisma,
): Promise<{ ok: true } | TimetableFailure> {
  if (!actor.active || !isUuid(sessionId)) return denied();
  const section = await loadSection(sectionId, db);
  if (!section || !canManageTimetable(actor, sectionScope(section))) return denied();
  const existing = await db.classSession.findFirst({
    where: { id: sessionId, sectionId: section.id },
    select: {
      id: true,
      attendanceRecords: { select: { id: true }, take: 1 },
      lessonProgress: { select: { id: true }, take: 1 },
    },
  });
  if (!existing) return denied();
  if (existing.attendanceRecords.length > 0 || existing.lessonProgress.length > 0) {
    return invalid("This class already has attendance, so it stays on record. Cancel it instead of deleting it.");
  }
  await db.classSession.delete({ where: { id: existing.id } });
  return { ok: true };
}

export async function listTodayClasses(actor: Actor, now = new Date(), db: Db = prisma): Promise<TodayResult> {
  if (!actor.active || actor.role !== "STUDENT" || !actor.learnerId || actor.enrolledSectionIds.length === 0) {
    return { ok: true, classes: [] };
  }
  const center = await db.center.findUnique({
    where: { id: actor.centerId },
    select: { timezone: true },
  });
  if (!center) return { ok: true, classes: [] };
  const today = localDateOfInstant(now, center.timezone);
  if (!today) return { ok: false, message: "The center clock setting needs a fix before today's classes can be shown." };
  const bounds = dayBounds(today, center.timezone);
  if (!bounds) return { ok: false, message: "The center clock setting needs a fix before today's classes can be shown." };

  const rows = await db.classSession.findMany({
    where: {
      sectionId: { in: actor.enrolledSectionIds },
      status: { not: "CANCELLED" },
      startsAt: { gte: bounds.start, lt: bounds.end },
      section: { course: { centerId: actor.centerId } },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      endsAt: true,
      deliveryMode: true,
      meetingUrl: true,
      status: true,
      linkedResourceId: true,
      linkedResource: {
        select: {
          id: true,
          title: true,
          resourceType: true,
          externalUrl: true,
          storageKey: true,
          sectionId: true,
        },
      },
      attendanceRecords: { select: { id: true }, take: 1 },
      lessonProgress: { select: { id: true }, take: 1 },
      section: {
        select: {
          id: true,
          name: true,
          courseId: true,
          course: { select: { title: true, centerId: true, sections: { select: { id: true } } } },
        },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  const classes: TodayClass[] = [];
  for (const row of rows) {
    const view = toSessionView({
      row,
      timeZone: center.timezone,
      canManage: false,
      viewerIsLearner: true,
      sectionId: row.section.id,
      courseId: row.section.courseId,
      centerId: row.section.course.centerId,
      courseSectionIds: row.section.course.sections.map((section) => section.id),
      actor,
    });
    if (!view) continue;
    const startTime = clockOfInstant(row.startsAt, center.timezone);
    const endTime = clockOfInstant(row.endsAt, center.timezone);
    if (!startTime || !endTime) continue;
    classes.push({
      id: view.id,
      title: view.title,
      startTime,
      endTime,
      courseTitle: row.section.course.title,
      sectionName: row.section.name,
      sectionId: row.section.id,
      deliveryMode: view.deliveryMode,
      deliveryLabel: view.deliveryLabel,
      joinHref: view.joinHref,
      materialHref: view.materialHref,
      materialLabel: view.materialLabel,
      inPersonNote: view.inPersonNote,
    });
  }
  return { ok: true, classes };
}
