// A teacher reviews the two saved copies and chooses what the gradebook keeps.
// The merged scoreboard is built here. A vector sent by the browser is ignored.
// The resolving phone's own count goes up by one. If the browser cannot name
// itself, one stable server device for this center is used instead, so the
// count still moves forward. Phone clocks are not compared.

import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { canEditAssignedRecords, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import { RECORD_VIEW_FAILED, writeRecordViews } from "./audit";
import { writeNoteViewAudits } from "./progress-notes";
import { registerOfflinePhone } from "./sync-attendance";
import { isUuid } from "../lms/timetable";
import { canonicalPoints, SKILL_GAPS, type SkillGapName } from "../sync/record-batch";
import {
  incrementDeviceCounter,
  mergeVersionVectors,
  parseVersionVector,
} from "../sync/version-vector";

const HIDDEN = "That conflict is not one you can resolve.";
export const SERVER_RESOLUTION_LABEL = "Server conflict resolution";

export type ConflictListItem = {
  id: string;
  kind: "Grade" | "Progress note";
  learnerCode: string;
  learnerName: string;
  context: string;
};

export type ConflictCopy = {
  id: string;
  provisional: boolean;
  deviceRecordedAt: string;
  syncedAt: string;
  points?: string;
  academicNote?: string | null;
  body?: string;
  skillGaps?: string[];
  customSkillLabel?: string | null;
  customSkillTagId?: string | null;
  customSkillTagName?: string | null;
  customSkillTagActive?: boolean;
};

export type ConflictReview = {
  id: string;
  kind: "Grade" | "Progress note";
  learnerCode: string;
  learnerName: string;
  context: string;
  maxPoints: string | null;
  explanation: string;
  shown: ConflictCopy;
  other: ConflictCopy;
  skillTags: { id: string; name: string }[];
};

export type ResolveInput = {
  conflictId: string;
  localDeviceId: string | null;
  choice: "shown" | "other" | "merge";
  points?: string;
  academicNote?: string | null;
  body?: string;
  skillGaps?: string[];
  customSkillTagId?: string | null;
};

function serverDeviceId(centerId: string): string {
  const hex = createHash("sha256").update(`open-lms-conflict-resolution:${centerId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function pointsText(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

function sameGrade(points: Prisma.Decimal | string, note: string | null, otherPoints: string, otherNote: string | null): boolean {
  return new Prisma.Decimal(points).equals(new Prisma.Decimal(otherPoints)) && (note ?? null) === otherNote;
}

function sameNote(
  body: string,
  gaps: string[],
  label: string | null,
  tagId: string | null,
  otherBody: string,
  otherGaps: string[],
  otherLabel: string | null,
  otherTagId: string | null,
): boolean {
  return (
    body === otherBody &&
    (label ?? null) === otherLabel &&
    (tagId ?? null) === otherTagId &&
    [...gaps].sort().join(",") === [...otherGaps].sort().join(",")
  );
}

async function resolutionDevice(actor: Actor, localDeviceId: string | null): Promise<{ ok: true; deviceId: string } | { ok: false; message: string }> {
  if (localDeviceId && /^[0-9a-f-]{36}$/i.test(localDeviceId)) {
    const registered = await registerOfflinePhone(actor, localDeviceId.toLowerCase(), new Date());
    if (!registered.ok) return { ok: false, message: "This phone cannot resolve records for this center." };
    return { ok: true, deviceId: registered.deviceId };
  }
  const id = serverDeviceId(actor.centerId);
  const existing = await prisma.device.findUnique({ where: { id }, select: { id: true, centerId: true } });
  if (existing) {
    if (existing.centerId !== actor.centerId) return { ok: false, message: "This conflict could not be resolved." };
    return { ok: true, deviceId: existing.id };
  }
  try {
    await prisma.device.create({
      data: {
        id,
        centerId: actor.centerId,
        label: SERVER_RESOLUTION_LABEL,
        registeredById: actor.id,
        lastSeenAt: new Date(),
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      return { ok: false, message: "This conflict could not be resolved. Try again." };
    }
  }
  const created = await prisma.device.findUnique({ where: { id }, select: { centerId: true } });
  if (!created || created.centerId !== actor.centerId) return { ok: false, message: "This conflict could not be resolved." };
  return { ok: true, deviceId: id };
}

export async function listOpenConflicts(actor: Actor): Promise<ConflictListItem[]> {
  if (!actor.active || actor.role !== "TEACHER" || actor.assignedSectionIds.length === 0) return [];
  const rows = await prisma.syncConflict.findMany({
    where: {
      state: "OPEN",
      OR: [
        { gradeEntry: { assignment: { sectionId: { in: actor.assignedSectionIds } } } },
        { progressNote: { sectionId: { in: actor.assignedSectionIds } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      gradeEntry: {
        select: {
          assignment: { select: { title: true } },
          learner: { select: { learnerCode: true, displayName: true } },
        },
      },
      progressNote: {
        select: { learner: { select: { learnerCode: true, displayName: true } } },
      },
    },
  });
  return rows.flatMap((row): ConflictListItem[] => {
    if (row.entityType === "GRADE_ENTRY" && row.gradeEntry) {
      return [{
        id: row.id,
        kind: "Grade" as const,
        learnerCode: row.gradeEntry.learner.learnerCode,
        learnerName: row.gradeEntry.learner.displayName,
        context: row.gradeEntry.assignment.title,
      }];
    }
    if (row.entityType === "PROGRESS_NOTE" && row.progressNote) {
      return [{
        id: row.id,
        kind: "Progress note" as const,
        learnerCode: row.progressNote.learner.learnerCode,
        learnerName: row.progressNote.learner.displayName,
        context: "Academic note",
      }];
    }
    return [];
  });
}

const explanation =
  "This copy is shown for now because the server received it later. The time on the phone is only a note for people. It does not decide which copy is newer, and it does not decide which copy wins.";

export async function readConflict(actor: Actor, conflictId: string): Promise<ConflictReview | null> {
  if (!actor.active || actor.role !== "TEACHER") return null;
  const row = await prisma.syncConflict.findUnique({
    where: { id: conflictId },
    include: {
      gradeVersionA: true,
      gradeVersionB: true,
      shownGradeVersion: true,
      noteVersionA: { include: { customSkillTag: { select: { id: true, name: true, active: true } } } },
      noteVersionB: { include: { customSkillTag: { select: { id: true, name: true, active: true } } } },
      shownNoteVersion: { include: { customSkillTag: { select: { id: true, name: true, active: true } } } },
      gradeEntry: {
        select: {
          id: true,
          assignment: { select: { title: true, maxPoints: true, sectionId: true, section: { select: { course: { select: { centerId: true } } } } } },
          learner: { select: { learnerCode: true, displayName: true } },
        },
      },
      progressNote: {
        select: {
          id: true,
          sectionId: true,
          section: { select: { name: true, course: { select: { centerId: true } } } },
          learner: { select: { learnerCode: true, displayName: true } },
        },
      },
    },
  });
  if (!row || row.state !== "OPEN") return null;
  if (row.entityType === "GRADE_ENTRY" && row.gradeEntry && row.gradeVersionA && row.gradeVersionB && row.shownGradeVersion) {
    const section = row.gradeEntry.assignment;
    if (!canEditAssignedRecords(actor, { id: section.sectionId, centerId: section.section.course.centerId })) return null;
    const toCopy = (version: typeof row.gradeVersionA, provisional: boolean): ConflictCopy => ({
      id: version.id,
      provisional,
      deviceRecordedAt: version.deviceRecordedAt.toISOString(),
      syncedAt: version.syncedAt.toISOString(),
      points: pointsText(version.points),
      academicNote: version.academicNote,
    });
    const shown = row.shownGradeVersion;
    const other = shown.id === row.gradeVersionA.id ? row.gradeVersionB : row.gradeVersionA;
    const gradeEntry = row.gradeEntry;
    try {
      await prisma.$transaction(async (tx) => {
        await writeRecordViews(tx, actor, "GRADE_ENTRY", [gradeEntry.id], { source: "online" });
      });
    } catch {
      throw new Error(RECORD_VIEW_FAILED);
    }
    return {
      id: row.id,
      kind: "Grade",
      learnerCode: row.gradeEntry.learner.learnerCode,
      learnerName: row.gradeEntry.learner.displayName,
      context: section.title,
      maxPoints: pointsText(section.maxPoints),
      explanation,
      shown: toCopy(shown, true),
      other: toCopy(other, false),
      skillTags: [],
    };
  }
  if (row.entityType === "PROGRESS_NOTE" && row.progressNote && row.noteVersionA && row.noteVersionB && row.shownNoteVersion) {
    const section = row.progressNote.section;
    if (!canEditAssignedRecords(actor, { id: row.progressNote.sectionId, centerId: section.course.centerId })) return null;
    const toCopy = (version: typeof row.noteVersionA, provisional: boolean): ConflictCopy => ({
      id: version.id,
      provisional,
      deviceRecordedAt: version.deviceRecordedAt.toISOString(),
      syncedAt: version.syncedAt.toISOString(),
      body: version.body,
      skillGaps: [...version.skillGaps],
      customSkillLabel: version.customSkillTag ? null : version.customSkillLabel,
      customSkillTagId: version.customSkillTagId,
      customSkillTagName: version.customSkillTag?.name ?? null,
      customSkillTagActive: version.customSkillTag?.active ?? false,
    });
    const shown = row.shownNoteVersion;
    const other = shown.id === row.noteVersionA.id ? row.noteVersionB : row.noteVersionA;
    const skillTags = await prisma.centerSkillTag.findMany({
      where: { centerId: section.course.centerId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    await prisma.$transaction(async (tx) => {
      await writeNoteViewAudits(tx, actor, [row.progressNote!.id], { source: "online" });
    });
    return {
      id: row.id,
      kind: "Progress note",
      learnerCode: row.progressNote.learner.learnerCode,
      learnerName: row.progressNote.learner.displayName,
      context: section.name,
      maxPoints: null,
      explanation,
      shown: toCopy(shown, true),
      other: toCopy(other, false),
      skillTags,
    };
  }
  return null;
}

function cleanLabel(value: string | null | undefined, max: number): string | null | "bad" {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max || trimmed.includes("\0")) return "bad";
  return trimmed;
}

export async function resolveConflict(actor: Actor, input: ResolveInput): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  if (!actor.active || actor.role !== "TEACHER") return { ok: false, message: HIDDEN };
  const device = await resolutionDevice(actor, input.localDeviceId);
  if (!device.ok) return device;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "sync_conflicts" WHERE id = ${input.conflictId}::uuid FOR UPDATE`;
      const row = await tx.syncConflict.findUnique({
        where: { id: input.conflictId },
        include: {
          gradeVersionA: true,
          gradeVersionB: true,
          shownGradeVersion: true,
          noteVersionA: true,
          noteVersionB: true,
          shownNoteVersion: true,
          gradeEntry: {
            select: {
              id: true,
              assignment: { select: { maxPoints: true, sectionId: true, section: { select: { course: { select: { centerId: true } } } } } },
            },
          },
          progressNote: {
            select: {
              id: true,
              sectionId: true,
              section: { select: { course: { select: { centerId: true } } } },
            },
          },
        },
      });
      if (!row) return { ok: false, message: HIDDEN };
      const sectionId = row.gradeEntry?.assignment.sectionId ?? row.progressNote?.sectionId ?? null;
      const centerId = row.gradeEntry?.assignment.section.course.centerId ?? row.progressNote?.section.course.centerId ?? null;
      if (!sectionId || !centerId || !canEditAssignedRecords(actor, { id: sectionId, centerId })) {
        return { ok: false, message: HIDDEN };
      }
      if (row.state !== "OPEN") return { ok: false, message: "This conflict is already resolved." };

      const resolvedAt = new Date();
      if (row.entityType === "GRADE_ENTRY" && row.gradeEntry && row.gradeVersionA && row.gradeVersionB && row.shownGradeVersion) {
        const shown = row.shownGradeVersion;
        const other = shown.id === row.gradeVersionA.id ? row.gradeVersionB : row.gradeVersionA;
        let points = pointsText(shown.points);
        let academicNote = shown.academicNote;
        if (input.choice === "other") {
          points = pointsText(other.points);
          academicNote = other.academicNote;
        }
        if (input.choice === "merge") {
          const parsed = input.points ? canonicalPoints(input.points) : null;
          const note = cleanLabel(input.academicNote, 500);
          if (!parsed || note === "bad") return { ok: false, message: "The merged grade is not valid." };
          if (new Prisma.Decimal(parsed).gt(row.gradeEntry.assignment.maxPoints)) {
            return { ok: false, message: "The merged grade is higher than the assignment allows." };
          }
          points = parsed;
          academicNote = note;
        }
        const vectorA = parseVersionVector(row.gradeVersionA.versionVector);
        const vectorB = parseVersionVector(row.gradeVersionB.versionVector);
        if (!vectorA || !vectorB) return { ok: false, message: "This conflict could not be resolved." };
        const nextVector = incrementDeviceCounter(mergeVersionVectors(vectorA, vectorB), device.deviceId);
        if (!nextVector) return { ok: false, message: "This conflict could not be resolved." };
        const resolution = sameGrade(shown.points, shown.academicNote, points, academicNote)
          ? "KEPT_LATER_RECEIVED"
          : sameGrade(other.points, other.academicNote, points, academicNote)
            ? "KEPT_OTHER_VERSION"
            : "MERGED";
        const versionId = crypto.randomUUID();
        await tx.gradeEntryVersion.create({
          data: {
            id: versionId,
            gradeEntryId: row.gradeEntry.id,
            points,
            academicNote,
            recordedById: actor.id,
            deviceId: device.deviceId,
            versionVector: nextVector,
            deviceRecordedAt: resolvedAt,
            syncedAt: resolvedAt,
            createdOffline: false,
            preservedFromConflict: false,
          },
        });
        await tx.gradeEntry.update({
          where: { id: row.gradeEntry.id },
          data: {
            points,
            academicNote,
            recordedById: actor.id,
            deviceId: device.deviceId,
            versionVector: nextVector,
            deviceRecordedAt: resolvedAt,
            syncedAt: resolvedAt,
            createdOffline: false,
          },
        });
        await tx.syncConflict.update({
          where: { id: row.id },
          data: {
            state: "RESOLVED",
            resolution,
            resolvedById: actor.id,
            resolvedAt,
            resolvedGradeVersionId: versionId,
          },
        });
        await tx.auditLog.create({
          data: {
            centerId: actor.centerId,
            actorId: actor.id,
            action: "RESOLVE_CONFLICT",
            entityType: "GRADE_ENTRY",
            entityId: row.gradeEntry.id,
            deviceId: device.deviceId,
            metadata: { conflictId: row.id, resolution, resolvedVersionId: versionId },
          },
        });
        return { ok: true, message: "The conflict is resolved. Both earlier copies are still kept." };
      }

      if (row.entityType === "PROGRESS_NOTE" && row.progressNote && row.noteVersionA && row.noteVersionB && row.shownNoteVersion) {
        const shown = row.shownNoteVersion;
        const other = shown.id === row.noteVersionA.id ? row.noteVersionB : row.noteVersionA;
        let body = shown.body;
        let skillGaps = [...shown.skillGaps];
        let customSkillLabel = shown.customSkillLabel;
        let customSkillTagId = shown.customSkillTagId;
        if (input.choice === "other") {
          body = other.body;
          skillGaps = [...other.skillGaps];
          customSkillLabel = other.customSkillLabel;
          customSkillTagId = other.customSkillTagId;
        }
        if (input.choice === "merge") {
          const nextBody = input.body?.trim() ?? "";
          const gaps = input.skillGaps ?? [];
          if (nextBody.length < 1 || nextBody.length > 2000) {
            return { ok: false, message: "The merged note is not valid." };
          }
          if (gaps.length > SKILL_GAPS.length || gaps.some((gap, index) => !SKILL_GAPS.includes(gap as SkillGapName) || gaps.indexOf(gap) !== index)) {
            return { ok: false, message: "The merged note is not valid." };
          }
          const sorted = [...gaps].sort() as SkillGapName[];
          const centerId = row.progressNote.section.course.centerId;
          if (sorted.includes("CUSTOM")) {
            const tagId = input.customSkillTagId ?? "";
            if (!isUuid(tagId)) return { ok: false, message: "The merged note is not valid." };
            const tag = await tx.centerSkillTag.findFirst({
              where: { id: tagId, centerId, active: true },
              select: { id: true },
            });
            if (!tag) return { ok: false, message: "The merged note is not valid." };
            customSkillTagId = tag.id;
            customSkillLabel = null;
          } else {
            customSkillTagId = null;
            customSkillLabel = null;
          }
          body = nextBody;
          skillGaps = sorted;
        }
        const vectorA = parseVersionVector(row.noteVersionA.versionVector);
        const vectorB = parseVersionVector(row.noteVersionB.versionVector);
        if (!vectorA || !vectorB) return { ok: false, message: "This conflict could not be resolved." };
        const nextVector = incrementDeviceCounter(mergeVersionVectors(vectorA, vectorB), device.deviceId);
        if (!nextVector) return { ok: false, message: "This conflict could not be resolved." };
        const resolution = sameNote(shown.body, shown.skillGaps, shown.customSkillLabel, shown.customSkillTagId, body, skillGaps, customSkillLabel, customSkillTagId)
          ? "KEPT_LATER_RECEIVED"
          : sameNote(other.body, other.skillGaps, other.customSkillLabel, other.customSkillTagId, body, skillGaps, customSkillLabel, customSkillTagId)
            ? "KEPT_OTHER_VERSION"
            : "MERGED";
        const versionId = crypto.randomUUID();
        await tx.progressNoteVersion.create({
          data: {
            id: versionId,
            progressNoteId: row.progressNote.id,
            authorId: actor.id,
            body,
            skillGaps,
            customSkillLabel,
            customSkillTagId,
            deviceId: device.deviceId,
            versionVector: nextVector,
            deviceRecordedAt: resolvedAt,
            syncedAt: resolvedAt,
            createdOffline: false,
            preservedFromConflict: false,
          },
        });
        await tx.progressNote.update({
          where: { id: row.progressNote.id },
          data: {
            authorId: actor.id,
            body,
            skillGaps,
            customSkillLabel,
            customSkillTagId,
            deviceId: device.deviceId,
            versionVector: nextVector,
            deviceRecordedAt: resolvedAt,
            syncedAt: resolvedAt,
            createdOffline: false,
          },
        });
        await tx.syncConflict.update({
          where: { id: row.id },
          data: {
            state: "RESOLVED",
            resolution,
            resolvedById: actor.id,
            resolvedAt,
            resolvedNoteVersionId: versionId,
          },
        });
        await tx.auditLog.create({
          data: {
            centerId: actor.centerId,
            actorId: actor.id,
            action: "RESOLVE_CONFLICT",
            entityType: "PROGRESS_NOTE",
            entityId: row.progressNote.id,
            deviceId: device.deviceId,
            metadata: { conflictId: row.id, resolution, resolvedVersionId: versionId },
          },
        });
        return { ok: true, message: "The conflict is resolved. Both earlier copies are still kept." };
      }
      return { ok: false, message: HIDDEN };
    }, { timeout: 20000 });
  } catch {
    return { ok: false, message: "This conflict could not be resolved. Try again." };
  }
}
