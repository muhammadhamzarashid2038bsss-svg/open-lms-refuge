// Applies offline grade and progress-note edits.
// The signed-in teacher and their center come from the session. A user id in
// the JSON is not accepted. Phone clocks are stored for a person to read.
// They are not compared. Order comes from the version vector only.
//
// Each edit is its own transaction. One rejected edit does not undo another.
// The same mutation id is applied once. A repeat with different content is
// refused. A repeat with the same content does not add another version.

import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { canEditAssignedRecords, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import type { HttpResult } from "../http/records";
import { registerOfflinePhone } from "./sync-attendance";
import {
  validateRecordEnvelope,
  type GradeMutation,
  type NoteMutation,
  type RecordMutation,
} from "../sync/record-batch";
import {
  compareVersionVectors,
  isOwnIncrement,
  isSingleDeviceVector,
  parseVersionVector,
  type VersionVector,
} from "../sync/version-vector";

export type RecordSyncOutcome = "accepted" | "already_accepted" | "conflict" | "stale" | "rejected" | "retryable_failure";

export type RecordSyncResult = {
  clientMutationId: string;
  outcome: RecordSyncOutcome;
  code?: string;
  recordId?: string;
  conflictId?: string;
};

type Tx = Prisma.TransactionClient;

type Decision = "already" | "stale" | "invalid_counter" | "accept" | "conflict";

const itemSelect = {
  clientMutationId: true,
  entityId: true,
  entityType: true,
  status: true,
  contentFingerprint: true,
} as const;

function rejected(clientMutationId: string, code: string, recordId?: string): RecordSyncResult {
  return { clientMutationId, outcome: "rejected", code, ...(recordId ? { recordId } : {}) };
}

function retryable(clientMutationId: string, code: string): RecordSyncResult {
  return { clientMutationId, outcome: "retryable_failure", code };
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function ruleCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("grade points") || message.includes("grade must")) return "invalid_grade";
  if (message.includes("progress note") || message.includes("custom")) return "invalid_note";
  if (message.includes("append-only")) return "invalid_mutation";
  return null;
}

function fingerprintOf(mutation: RecordMutation): string {
  const content =
    mutation.entityType === "GRADE_ENTRY"
      ? {
          academicNote: mutation.academicNote,
          assignmentId: mutation.assignmentId,
          learnerId: mutation.learnerId,
          points: mutation.points,
        }
      : {
          body: mutation.body,
          customSkillLabel: mutation.customSkillLabel,
          learnerId: mutation.learnerId,
          sectionId: mutation.sectionId,
          skillGaps: mutation.skillGaps,
        };
  const payload = {
    clientMutationId: mutation.clientMutationId,
    content,
    createdOffline: mutation.createdOffline,
    deviceRecordedAt: mutation.deviceRecordedAt,
    entityType: mutation.entityType,
    recordId: mutation.recordId,
    versionVector: mutation.versionVector,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function samePoints(stored: Prisma.Decimal | string | number, points: string): boolean {
  return new Prisma.Decimal(stored).equals(new Prisma.Decimal(points));
}

function decide(current: VersionVector, incoming: VersionVector, sameContent: boolean, deviceId: string): Decision {
  const order = compareVersionVectors(incoming, current);
  if (order === "equal") return sameContent ? "already" : "invalid_counter";
  if (order === "dominated") return "stale";
  if (isOwnIncrement(current, incoming, deviceId)) return "accept";
  if (order === "concurrent") return "conflict";
  return "invalid_counter";
}

/// A new receipt sorts after the copy already stored when the clock does not
/// move between the two saves. This is still the server clock, not the phone.
function receiptAfter(previous: Date | null): Date {
  const now = new Date();
  if (previous && now.getTime() <= previous.getTime()) return new Date(previous.getTime() + 1);
  return now;
}

async function writeItem(
  tx: Tx,
  input: {
    deviceId: string;
    centerId: string;
    entityType: "GRADE_ENTRY" | "PROGRESS_NOTE";
    entityId: string;
    clientMutationId: string;
    status: "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED";
    fingerprint: string;
    byteSize: number;
  },
): Promise<void> {
  const batch = await tx.jsonSyncBatch.create({
    data: {
      deviceId: input.deviceId,
      centerId: input.centerId,
      receivedAt: new Date(),
      itemCount: 1,
      compressedByteSize: input.byteSize,
    },
    select: { id: true },
  });
  await tx.jsonSyncItem.create({
    data: {
      batchId: batch.id,
      deviceId: input.deviceId,
      entityType: input.entityType,
      entityId: input.entityId,
      clientMutationId: input.clientMutationId,
      status: input.status,
      contentFingerprint: input.fingerprint,
    },
  });
}

async function auditChange(
  tx: Tx,
  actor: Actor,
  action: "CREATE" | "UPDATE",
  entityType: "GRADE_ENTRY" | "PROGRESS_NOTE",
  entityId: string,
  deviceId: string,
  clientMutationId: string,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      centerId: actor.centerId,
      actorId: actor.id,
      action,
      entityType,
      entityId,
      deviceId,
      metadata: { source: "record-sync", clientMutationId },
    },
  });
}

function gradeContentMatches(
  points: Prisma.Decimal | string | number,
  academicNote: string | null,
  mutation: GradeMutation,
): boolean {
  return samePoints(points, mutation.points) && (academicNote ?? null) === mutation.academicNote;
}

function noteContentMatches(
  body: string,
  skillGaps: string[],
  customSkillLabel: string | null,
  mutation: NoteMutation,
): boolean {
  return body === mutation.body && (customSkillLabel ?? null) === mutation.customSkillLabel && [...skillGaps].sort().join(",") === mutation.skillGaps.join(",");
}

async function replayResult(tx: Tx, item: {
  entityId: string;
  entityType: string;
  status: string;
  contentFingerprint: string | null;
}, mutation: RecordMutation, fingerprint: string): Promise<RecordSyncResult> {
  if (item.entityType !== mutation.entityType || item.contentFingerprint !== fingerprint) {
    return rejected(mutation.clientMutationId, "mutation_mismatch");
  }
  // The first upload already wrote the version. Say so instead of pretending this request applied it again.
  if (item.status === "APPLIED") return { clientMutationId: mutation.clientMutationId, outcome: "already_accepted", recordId: item.entityId };
  if (item.status === "DUPLICATE") {
    return { clientMutationId: mutation.clientMutationId, outcome: "already_accepted", recordId: item.entityId };
  }
  if (item.status === "CONFLICT") {
    const conflict =
      mutation.entityType === "GRADE_ENTRY"
        ? await tx.syncConflict.findFirst({
            where: { gradeEntryId: item.entityId, state: "OPEN" },
            select: { id: true },
          })
        : await tx.syncConflict.findFirst({
            where: { progressNoteId: item.entityId, state: "OPEN" },
            select: { id: true },
          });
    return {
      clientMutationId: mutation.clientMutationId,
      outcome: "conflict",
      code: "concurrent",
      recordId: item.entityId,
      ...(conflict ? { conflictId: conflict.id } : {}),
    };
  }
  if (item.status === "REJECTED") {
    return rejected(mutation.clientMutationId, "invalid_counter", item.entityId);
  }
  return retryable(mutation.clientMutationId, "database");
}

async function lockGrade(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "grade_entries" WHERE id = ${id}::uuid FOR UPDATE`;
}

async function lockNote(tx: Tx, id: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "progress_notes" WHERE id = ${id}::uuid FOR UPDATE`;
}

async function applyGrade(
  tx: Tx,
  actor: Actor,
  deviceId: string,
  mutation: GradeMutation,
  fingerprint: string,
  byteSize: number,
): Promise<RecordSyncResult> {
  const prior = await tx.jsonSyncItem.findUnique({
    where: { deviceId_clientMutationId: { deviceId, clientMutationId: mutation.clientMutationId } },
    select: itemSelect,
  });
  const rejectionReplay = prior?.status === "REJECTED" && prior.entityType === "GRADE_ENTRY" && prior.contentFingerprint === fingerprint;
  if (prior && !rejectionReplay) return replayResult(tx, prior, mutation, fingerprint);

  const assignment = await tx.assignment.findUnique({
    where: { id: mutation.assignmentId },
    select: {
      id: true,
      maxPoints: true,
      sectionId: true,
      section: { select: { course: { select: { centerId: true } } } },
    },
  });
  if (!assignment) return rejected(mutation.clientMutationId, "unknown_record");
  const centerId = assignment.section.course.centerId;
  if (centerId !== actor.centerId) return rejected(mutation.clientMutationId, "wrong_center");
  if (!canEditAssignedRecords(actor, { id: assignment.sectionId, centerId })) return rejected(mutation.clientMutationId, "forbidden");
  if (!samePoints(mutation.points, mutation.points) || new Prisma.Decimal(mutation.points).lt(0) || new Prisma.Decimal(mutation.points).gt(assignment.maxPoints)) {
    return rejected(mutation.clientMutationId, "invalid_grade");
  }

  const enrollment = await tx.enrollment.findFirst({
    where: { sectionId: assignment.sectionId, learnerId: mutation.learnerId, status: "ACTIVE" },
    select: { learner: { select: { centerId: true } } },
  });
  if (!enrollment || enrollment.learner.centerId !== actor.centerId) return rejected(mutation.clientMutationId, "not_enrolled");

  let grade = await tx.gradeEntry.findUnique({ where: { id: mutation.recordId } });
  if (grade && (grade.assignmentId !== mutation.assignmentId || grade.learnerId !== mutation.learnerId)) {
    return rejected(mutation.clientMutationId, "wrong_record");
  }
  if (!grade) {
    grade = await tx.gradeEntry.findUnique({
      where: { assignmentId_learnerId: { assignmentId: mutation.assignmentId, learnerId: mutation.learnerId } },
    });
  }

  const recordedAt = new Date(mutation.deviceRecordedAt);
  if (!grade) {
    if (rejectionReplay) return rejected(mutation.clientMutationId, "invalid_counter");
    if (!isSingleDeviceVector(mutation.versionVector, deviceId)) return rejected(mutation.clientMutationId, "invalid_counter");
    const syncedAt = new Date();
    await tx.gradeEntry.create({
      data: {
        id: mutation.recordId,
        assignmentId: mutation.assignmentId,
        learnerId: mutation.learnerId,
        points: mutation.points,
        academicNote: mutation.academicNote,
        recordedById: actor.id,
        deviceId,
        versionVector: mutation.versionVector,
        deviceRecordedAt: recordedAt,
        syncedAt,
        createdOffline: mutation.createdOffline,
      },
    });
    await tx.gradeEntryVersion.create({
      data: {
        id: crypto.randomUUID(),
        gradeEntryId: mutation.recordId,
        points: mutation.points,
        academicNote: mutation.academicNote,
        recordedById: actor.id,
        deviceId,
        versionVector: mutation.versionVector,
        deviceRecordedAt: recordedAt,
        syncedAt,
        createdOffline: mutation.createdOffline,
        preservedFromConflict: false,
      },
    });
    await writeItem(tx, {
      deviceId,
      centerId: actor.centerId,
      entityType: "GRADE_ENTRY",
      entityId: mutation.recordId,
      clientMutationId: mutation.clientMutationId,
      status: "APPLIED",
      fingerprint,
      byteSize,
    });
    await auditChange(tx, actor, "CREATE", "GRADE_ENTRY", mutation.recordId, deviceId, mutation.clientMutationId);
    return { clientMutationId: mutation.clientMutationId, outcome: "accepted", recordId: mutation.recordId };
  }

  await lockGrade(tx, grade.id);
  const locked = await tx.gradeEntry.findUnique({ where: { id: grade.id } });
  if (!locked) return retryable(mutation.clientMutationId, "database");
  const currentVector = parseVersionVector(locked.versionVector);
  if (!currentVector) return retryable(mutation.clientMutationId, "database");
  const decision = decide(
    currentVector,
    mutation.versionVector,
    gradeContentMatches(locked.points, locked.academicNote, mutation),
    deviceId,
  );
  const open = await tx.syncConflict.findFirst({
    where: { gradeEntryId: locked.id, state: "OPEN" },
    select: { id: true },
  });
  if (open && (decision === "accept" || decision === "conflict")) {
    return { clientMutationId: mutation.clientMutationId, outcome: "retryable_failure", code: "conflict_open", recordId: locked.id, conflictId: open.id };
  }
  if (rejectionReplay && decision !== "stale" && decision !== "invalid_counter") {
    return rejected(mutation.clientMutationId, "invalid_counter", locked.id);
  }
  if (decision === "already") {
    await writeItem(tx, {
      deviceId,
      centerId: actor.centerId,
      entityType: "GRADE_ENTRY",
      entityId: locked.id,
      clientMutationId: mutation.clientMutationId,
      status: "DUPLICATE",
      fingerprint,
      byteSize,
    });
    return { clientMutationId: mutation.clientMutationId, outcome: "already_accepted", recordId: locked.id };
  }
  if (decision === "stale" || decision === "invalid_counter") {
    if (!rejectionReplay) {
      await writeItem(tx, {
        deviceId,
        centerId: actor.centerId,
        entityType: "GRADE_ENTRY",
        entityId: locked.id,
        clientMutationId: mutation.clientMutationId,
        status: "REJECTED",
        fingerprint,
        byteSize,
      });
    }
    if (decision === "stale") {
      return { clientMutationId: mutation.clientMutationId, outcome: "stale", code: "stale", recordId: locked.id };
    }
    return rejected(mutation.clientMutationId, "invalid_counter", locked.id);
  }

  const versions = await tx.gradeEntryVersion.findMany({ where: { gradeEntryId: locked.id } });
  const existingCurrent = versions.find((version) => {
    const parsed = parseVersionVector(version.versionVector);
    return parsed !== null && compareVersionVectors(parsed, currentVector) === "equal" && gradeContentMatches(version.points, version.academicNote, {
      ...mutation,
      points: new Prisma.Decimal(locked.points).toFixed(2),
      academicNote: locked.academicNote,
    });
  });
  let versionAId = existingCurrent?.id ?? null;
  if (!versionAId) {
    versionAId = crypto.randomUUID();
    await tx.gradeEntryVersion.create({
      data: {
        id: versionAId,
        gradeEntryId: locked.id,
        points: locked.points,
        academicNote: locked.academicNote,
        recordedById: locked.recordedById,
        deviceId: locked.deviceId,
        versionVector: currentVector,
        deviceRecordedAt: locked.deviceRecordedAt,
        syncedAt: locked.syncedAt,
        createdOffline: locked.createdOffline,
        preservedFromConflict: decision === "conflict",
      },
    });
  }
  const syncedAt = receiptAfter(locked.syncedAt);
  const versionBId = crypto.randomUUID();
  await tx.gradeEntryVersion.create({
    data: {
      id: versionBId,
      gradeEntryId: locked.id,
      points: mutation.points,
      academicNote: mutation.academicNote,
      recordedById: actor.id,
      deviceId,
      versionVector: mutation.versionVector,
      deviceRecordedAt: recordedAt,
      syncedAt,
      createdOffline: mutation.createdOffline,
      preservedFromConflict: decision === "conflict",
    },
  });

  if (decision === "accept") {
    await tx.gradeEntry.update({
      where: { id: locked.id },
      data: {
        points: mutation.points,
        academicNote: mutation.academicNote,
        recordedById: actor.id,
        deviceId,
        versionVector: mutation.versionVector,
        deviceRecordedAt: recordedAt,
        syncedAt,
        createdOffline: mutation.createdOffline,
      },
    });
    await writeItem(tx, {
      deviceId,
      centerId: actor.centerId,
      entityType: "GRADE_ENTRY",
      entityId: locked.id,
      clientMutationId: mutation.clientMutationId,
      status: "APPLIED",
      fingerprint,
      byteSize,
    });
    await auditChange(tx, actor, "UPDATE", "GRADE_ENTRY", locked.id, deviceId, mutation.clientMutationId);
    return { clientMutationId: mutation.clientMutationId, outcome: "accepted", recordId: locked.id };
  }
  if (decision !== "conflict") return retryable(mutation.clientMutationId, "database");

  const versionA = existingCurrent ?? (await tx.gradeEntryVersion.findUniqueOrThrow({ where: { id: versionAId } }));
  const shownId = versionA.syncedAt > syncedAt ? versionA.id : versionBId;
  const shownIncoming = shownId === versionBId;
  await tx.gradeEntry.update({
    where: { id: locked.id },
    data: shownIncoming
      ? {
          points: mutation.points,
          academicNote: mutation.academicNote,
          recordedById: actor.id,
          deviceId,
          versionVector: mutation.versionVector,
          deviceRecordedAt: recordedAt,
          syncedAt,
          createdOffline: mutation.createdOffline,
        }
      : {
          points: versionA.points,
          academicNote: versionA.academicNote,
          recordedById: versionA.recordedById,
          deviceId: versionA.deviceId,
          versionVector: currentVector,
          deviceRecordedAt: versionA.deviceRecordedAt,
          syncedAt: versionA.syncedAt,
          createdOffline: versionA.createdOffline,
        },
  });
  const conflict = await tx.syncConflict.create({
    data: {
      entityType: "GRADE_ENTRY",
      state: "OPEN",
      gradeEntryId: locked.id,
      gradeVersionAId: versionAId,
      gradeVersionBId: versionBId,
      shownGradeVersionId: shownId,
    },
    select: { id: true },
  });
  await writeItem(tx, {
    deviceId,
    centerId: actor.centerId,
    entityType: "GRADE_ENTRY",
    entityId: locked.id,
    clientMutationId: mutation.clientMutationId,
    status: "CONFLICT",
    fingerprint,
    byteSize,
  });
  await auditChange(tx, actor, "UPDATE", "GRADE_ENTRY", locked.id, deviceId, mutation.clientMutationId);
  return {
    clientMutationId: mutation.clientMutationId,
    outcome: "conflict",
    code: "concurrent",
    recordId: locked.id,
    conflictId: conflict.id,
  };
}

async function applyNote(
  tx: Tx,
  actor: Actor,
  deviceId: string,
  mutation: NoteMutation,
  fingerprint: string,
  byteSize: number,
): Promise<RecordSyncResult> {
  const prior = await tx.jsonSyncItem.findUnique({
    where: { deviceId_clientMutationId: { deviceId, clientMutationId: mutation.clientMutationId } },
    select: itemSelect,
  });
  const rejectionReplay = prior?.status === "REJECTED" && prior.entityType === "PROGRESS_NOTE" && prior.contentFingerprint === fingerprint;
  if (prior && !rejectionReplay) return replayResult(tx, prior, mutation, fingerprint);

  const section = await tx.section.findUnique({
    where: { id: mutation.sectionId },
    select: { id: true, course: { select: { centerId: true } } },
  });
  if (!section) return rejected(mutation.clientMutationId, "unknown_record");
  const centerId = section.course.centerId;
  if (centerId !== actor.centerId) return rejected(mutation.clientMutationId, "wrong_center");
  if (!canEditAssignedRecords(actor, { id: section.id, centerId })) return rejected(mutation.clientMutationId, "forbidden");

  const enrollment = await tx.enrollment.findFirst({
    where: { sectionId: section.id, learnerId: mutation.learnerId, status: "ACTIVE" },
    select: { learner: { select: { centerId: true } } },
  });
  if (!enrollment || enrollment.learner.centerId !== actor.centerId) return rejected(mutation.clientMutationId, "not_enrolled");

  const note = await tx.progressNote.findUnique({ where: { id: mutation.recordId } });
  if (note && (note.sectionId !== mutation.sectionId || note.learnerId !== mutation.learnerId)) {
    return rejected(mutation.clientMutationId, "wrong_record");
  }

  const recordedAt = new Date(mutation.deviceRecordedAt);
  if (!note) {
    if (rejectionReplay) return rejected(mutation.clientMutationId, "invalid_counter");
    if (!isSingleDeviceVector(mutation.versionVector, deviceId)) return rejected(mutation.clientMutationId, "invalid_counter");
    const syncedAt = new Date();
    await tx.progressNote.create({
      data: {
        id: mutation.recordId,
        learnerId: mutation.learnerId,
        sectionId: mutation.sectionId,
        authorId: actor.id,
        body: mutation.body,
        skillGaps: mutation.skillGaps,
        customSkillLabel: mutation.customSkillLabel,
        deviceId,
        versionVector: mutation.versionVector,
        deviceRecordedAt: recordedAt,
        syncedAt,
        createdOffline: mutation.createdOffline,
      },
    });
    await tx.progressNoteVersion.create({
      data: {
        id: crypto.randomUUID(),
        progressNoteId: mutation.recordId,
        authorId: actor.id,
        body: mutation.body,
        skillGaps: mutation.skillGaps,
        customSkillLabel: mutation.customSkillLabel,
        deviceId,
        versionVector: mutation.versionVector,
        deviceRecordedAt: recordedAt,
        syncedAt,
        createdOffline: mutation.createdOffline,
        preservedFromConflict: false,
      },
    });
    await writeItem(tx, {
      deviceId,
      centerId: actor.centerId,
      entityType: "PROGRESS_NOTE",
      entityId: mutation.recordId,
      clientMutationId: mutation.clientMutationId,
      status: "APPLIED",
      fingerprint,
      byteSize,
    });
    await auditChange(tx, actor, "CREATE", "PROGRESS_NOTE", mutation.recordId, deviceId, mutation.clientMutationId);
    return { clientMutationId: mutation.clientMutationId, outcome: "accepted", recordId: mutation.recordId };
  }

  await lockNote(tx, note.id);
  const locked = await tx.progressNote.findUnique({ where: { id: note.id } });
  if (!locked) return retryable(mutation.clientMutationId, "database");
  const currentVector = parseVersionVector(locked.versionVector);
  if (!currentVector) return retryable(mutation.clientMutationId, "database");
  const decision = decide(
    currentVector,
    mutation.versionVector,
    noteContentMatches(locked.body, locked.skillGaps, locked.customSkillLabel, mutation),
    deviceId,
  );
  const open = await tx.syncConflict.findFirst({
    where: { progressNoteId: locked.id, state: "OPEN" },
    select: { id: true },
  });
  if (open && (decision === "accept" || decision === "conflict")) {
    return { clientMutationId: mutation.clientMutationId, outcome: "retryable_failure", code: "conflict_open", recordId: locked.id, conflictId: open.id };
  }
  if (rejectionReplay && decision !== "stale" && decision !== "invalid_counter") {
    return rejected(mutation.clientMutationId, "invalid_counter", locked.id);
  }
  if (decision === "already") {
    await writeItem(tx, {
      deviceId,
      centerId: actor.centerId,
      entityType: "PROGRESS_NOTE",
      entityId: locked.id,
      clientMutationId: mutation.clientMutationId,
      status: "DUPLICATE",
      fingerprint,
      byteSize,
    });
    return { clientMutationId: mutation.clientMutationId, outcome: "already_accepted", recordId: locked.id };
  }
  if (decision === "stale" || decision === "invalid_counter") {
    if (!rejectionReplay) {
      await writeItem(tx, {
        deviceId,
        centerId: actor.centerId,
        entityType: "PROGRESS_NOTE",
        entityId: locked.id,
        clientMutationId: mutation.clientMutationId,
        status: "REJECTED",
        fingerprint,
        byteSize,
      });
    }
    if (decision === "stale") {
      return { clientMutationId: mutation.clientMutationId, outcome: "stale", code: "stale", recordId: locked.id };
    }
    return rejected(mutation.clientMutationId, "invalid_counter", locked.id);
  }

  const versions = await tx.progressNoteVersion.findMany({ where: { progressNoteId: locked.id } });
  const existingCurrent = versions.find((version) => {
    const parsed = parseVersionVector(version.versionVector);
    return (
      parsed !== null &&
      compareVersionVectors(parsed, currentVector) === "equal" &&
      noteContentMatches(version.body, version.skillGaps, version.customSkillLabel, {
        ...mutation,
        body: locked.body,
        skillGaps: [...locked.skillGaps].sort() as NoteMutation["skillGaps"],
        customSkillLabel: locked.customSkillLabel,
      })
    );
  });
  let versionAId = existingCurrent?.id ?? null;
  if (!versionAId) {
    versionAId = crypto.randomUUID();
    await tx.progressNoteVersion.create({
      data: {
        id: versionAId,
        progressNoteId: locked.id,
        authorId: locked.authorId,
        body: locked.body,
        skillGaps: locked.skillGaps,
        customSkillLabel: locked.customSkillLabel,
        deviceId: locked.deviceId,
        versionVector: currentVector,
        deviceRecordedAt: locked.deviceRecordedAt,
        syncedAt: locked.syncedAt,
        createdOffline: locked.createdOffline,
        preservedFromConflict: decision === "conflict",
      },
    });
  }
  const syncedAt = receiptAfter(locked.syncedAt);
  const versionBId = crypto.randomUUID();
  await tx.progressNoteVersion.create({
    data: {
      id: versionBId,
      progressNoteId: locked.id,
      authorId: actor.id,
      body: mutation.body,
      skillGaps: mutation.skillGaps,
      customSkillLabel: mutation.customSkillLabel,
      deviceId,
      versionVector: mutation.versionVector,
      deviceRecordedAt: recordedAt,
      syncedAt,
      createdOffline: mutation.createdOffline,
      preservedFromConflict: decision === "conflict",
    },
  });

  if (decision === "accept") {
    await tx.progressNote.update({
      where: { id: locked.id },
      data: {
        authorId: actor.id,
        body: mutation.body,
        skillGaps: mutation.skillGaps,
        customSkillLabel: mutation.customSkillLabel,
        deviceId,
        versionVector: mutation.versionVector,
        deviceRecordedAt: recordedAt,
        syncedAt,
        createdOffline: mutation.createdOffline,
      },
    });
    await writeItem(tx, {
      deviceId,
      centerId: actor.centerId,
      entityType: "PROGRESS_NOTE",
      entityId: locked.id,
      clientMutationId: mutation.clientMutationId,
      status: "APPLIED",
      fingerprint,
      byteSize,
    });
    await auditChange(tx, actor, "UPDATE", "PROGRESS_NOTE", locked.id, deviceId, mutation.clientMutationId);
    return { clientMutationId: mutation.clientMutationId, outcome: "accepted", recordId: locked.id };
  }
  if (decision !== "conflict") return retryable(mutation.clientMutationId, "database");

  const versionA = existingCurrent ?? (await tx.progressNoteVersion.findUniqueOrThrow({ where: { id: versionAId } }));
  const shownId = versionA.syncedAt > syncedAt ? versionA.id : versionBId;
  const shownIncoming = shownId === versionBId;
  await tx.progressNote.update({
    where: { id: locked.id },
    data: shownIncoming
      ? {
          authorId: actor.id,
          body: mutation.body,
          skillGaps: mutation.skillGaps,
          customSkillLabel: mutation.customSkillLabel,
          deviceId,
          versionVector: mutation.versionVector,
          deviceRecordedAt: recordedAt,
          syncedAt,
          createdOffline: mutation.createdOffline,
        }
      : {
          authorId: versionA.authorId,
          body: versionA.body,
          skillGaps: versionA.skillGaps,
          customSkillLabel: versionA.customSkillLabel,
          deviceId: versionA.deviceId,
          versionVector: currentVector,
          deviceRecordedAt: versionA.deviceRecordedAt,
          syncedAt: versionA.syncedAt,
          createdOffline: versionA.createdOffline,
        },
  });
  const conflict = await tx.syncConflict.create({
    data: {
      entityType: "PROGRESS_NOTE",
      state: "OPEN",
      progressNoteId: locked.id,
      noteVersionAId: versionAId,
      noteVersionBId: versionBId,
      shownNoteVersionId: shownId,
    },
    select: { id: true },
  });
  await writeItem(tx, {
    deviceId,
    centerId: actor.centerId,
    entityType: "PROGRESS_NOTE",
    entityId: locked.id,
    clientMutationId: mutation.clientMutationId,
    status: "CONFLICT",
    fingerprint,
    byteSize,
  });
  await auditChange(tx, actor, "UPDATE", "PROGRESS_NOTE", locked.id, deviceId, mutation.clientMutationId);
  return {
    clientMutationId: mutation.clientMutationId,
    outcome: "conflict",
    code: "concurrent",
    recordId: locked.id,
    conflictId: conflict.id,
  };
}

async function applyParsed(
  tx: Tx,
  actor: Actor,
  deviceId: string,
  mutation: RecordMutation,
  byteSize: number,
): Promise<RecordSyncResult> {
  const fingerprint = fingerprintOf(mutation);
  if (mutation.entityType === "GRADE_ENTRY") return applyGrade(tx, actor, deviceId, mutation, fingerprint, byteSize);
  return applyNote(tx, actor, deviceId, mutation, fingerprint, byteSize);
}

function byteSizeOf(mutation: RecordMutation): number {
  return Buffer.byteLength(JSON.stringify(mutation));
}

async function applyWithRetry(actor: Actor, deviceId: string, mutation: RecordMutation): Promise<RecordSyncResult> {
  const run = () =>
    prisma.$transaction((tx) => applyParsed(tx, actor, deviceId, mutation, byteSizeOf(mutation)), { timeout: 20000 });
  try {
    return await run();
  } catch (error) {
    if (isUniqueConflict(error)) {
      try {
        return await run();
      } catch (again) {
        const code = ruleCode(again);
        if (code) return rejected(mutation.clientMutationId, code);
        return retryable(mutation.clientMutationId, "database");
      }
    }
    const code = ruleCode(error);
    if (code) return rejected(mutation.clientMutationId, code);
    return retryable(mutation.clientMutationId, "database");
  }
}

export async function acceptRecordBatch(actor: Actor, body: unknown, wireBytes: number): Promise<HttpResult> {
  void wireBytes;
  if (!actor.active || actor.role !== "TEACHER") {
    return { status: 403, body: { error: "You cannot edit grades or notes." } };
  }
  const envelope = validateRecordEnvelope(body);
  if (!envelope.ok) return { status: 400, body: { error: "Invalid body." } };

  const device = await registerOfflinePhone(actor, envelope.localDeviceId, new Date());
  if (!device.ok) return { status: device.status, body: { error: device.error } };

  const results: RecordSyncResult[] = [];
  for (const item of envelope.items) {
    if (!item.ok) {
      results.push(rejected(item.clientMutationId, item.code));
      continue;
    }
    results.push(await applyWithRetry(actor, device.deviceId, item.mutation));
  }
  return { status: 200, body: { results } };
}
