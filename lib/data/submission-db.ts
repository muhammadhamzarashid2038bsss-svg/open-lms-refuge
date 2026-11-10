// Database access for digital homework metadata. The file bytes are not stored here.

import { Prisma, type FileErrorCode, type UploadState } from "../../generated/prisma/client";
import { prisma } from "../db";

export type UploadStateName = UploadState;
export type FileErrorName = FileErrorCode | null;

export type AssignmentForUpload = {
  id: string;
  kind: "PAPER" | "DIGITAL" | "IN_CLASS_EXAM" | "BOTH";
  sectionId: string;
  centerId: string;
};

export type SubmissionRecord = {
  id: string;
  clientSubmissionId: string;
  assignmentId: string;
  learnerId: string;
  submittedById: string;
  uploadState: UploadStateName;
  byteSize: number;
  mimeType: string;
  checksumSha256: string;
  storageKey: string;
  deviceId: string;
  createdOffline: boolean;
  sectionId: string;
  centerId: string;
  attemptCount: number;
  lastErrorCode: FileErrorName;
};

export type NewSubmission = {
  id: string;
  clientSubmissionId: string;
  assignmentId: string;
  learnerId: string;
  submittedById: string;
  byteSize: number;
  mimeType: string;
  checksumSha256: string;
  storageKey: string;
  deviceId: string;
  createdOffline: boolean;
  queuedAt: Date;
};

export class DuplicateSubmissionError extends Error {
  constructor() {
    super("DUPLICATE_SUBMISSION");
    this.name = "DuplicateSubmissionError";
  }
}

export type SubmissionDb = {
  assignment(id: string): Promise<AssignmentForUpload | null>;
  learner(id: string): Promise<{ id: string; userId: string; centerId: string } | null>;
  activeEnrollment(learnerId: string, sectionId: string): Promise<boolean>;
  byClientId(clientSubmissionId: string): Promise<SubmissionRecord | null>;
  byId(id: string): Promise<SubmissionRecord | null>;
  insertPending(input: NewSubmission): Promise<SubmissionRecord>;
  markUploading(id: string): Promise<void>;
  markFailed(id: string, code: FileErrorName): Promise<void>;
  finalize(id: string, receivedAt: Date): Promise<"stored" | "already" | "missing">;
};

const submissionSelect = {
  id: true,
  clientSubmissionId: true,
  assignmentId: true,
  learnerId: true,
  submittedById: true,
  uploadState: true,
  byteSize: true,
  mimeType: true,
  checksumSha256: true,
  storageKey: true,
  deviceId: true,
  createdOffline: true,
  assignment: { select: { sectionId: true, section: { select: { course: { select: { centerId: true } } } } } },
  fileQueueItem: { select: { attemptCount: true, lastErrorCode: true } },
} satisfies Prisma.SubmissionSelect;

type SubmissionRow = Prisma.SubmissionGetPayload<{ select: typeof submissionSelect }>;

function toRecord(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    clientSubmissionId: row.clientSubmissionId,
    assignmentId: row.assignmentId,
    learnerId: row.learnerId,
    submittedById: row.submittedById,
    uploadState: row.uploadState,
    byteSize: row.byteSize,
    mimeType: row.mimeType,
    checksumSha256: row.checksumSha256,
    storageKey: row.storageKey,
    deviceId: row.deviceId,
    createdOffline: row.createdOffline,
    sectionId: row.assignment.sectionId,
    centerId: row.assignment.section.course.centerId,
    attemptCount: row.fileQueueItem?.attemptCount ?? 0,
    lastErrorCode: row.fileQueueItem?.lastErrorCode ?? null,
  };
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function prismaSubmissionDb(db: typeof prisma = prisma): SubmissionDb {
  return {
    async assignment(id) {
      const row = await db.assignment.findUnique({
        where: { id },
        select: { id: true, kind: true, sectionId: true, section: { select: { course: { select: { centerId: true } } } } },
      });
      if (!row) return null;
      return { id: row.id, kind: row.kind, sectionId: row.sectionId, centerId: row.section.course.centerId };
    },
    async learner(id) {
      return db.learnerProfile.findUnique({ where: { id }, select: { id: true, userId: true, centerId: true } });
    },
    async activeEnrollment(learnerId, sectionId) {
      const row = await db.enrollment.findFirst({
        where: { learnerId, sectionId, status: "ACTIVE" },
        select: { id: true },
      });
      return Boolean(row);
    },
    async byClientId(clientSubmissionId) {
      const row = await db.submission.findUnique({ where: { clientSubmissionId }, select: submissionSelect });
      return row ? toRecord(row) : null;
    },
    async byId(id) {
      const row = await db.submission.findUnique({ where: { id }, select: submissionSelect });
      return row ? toRecord(row) : null;
    },
    async insertPending(input) {
      try {
        await db.$transaction(async (tx) => {
          await tx.submission.create({
            data: {
              id: input.id,
              clientSubmissionId: input.clientSubmissionId,
              assignmentId: input.assignmentId,
              learnerId: input.learnerId,
              submittedById: input.submittedById,
              uploadState: "QUEUED",
              byteSize: input.byteSize,
              mimeType: input.mimeType,
              checksumSha256: input.checksumSha256,
              storageKey: input.storageKey,
              deviceId: input.deviceId,
              createdOffline: input.createdOffline,
              queuedAt: input.queuedAt,
              receivedAt: null,
            },
          });
          await tx.fileUploadQueueItem.create({
            data: {
              submissionId: input.id,
              state: "QUEUED",
              attemptCount: 0,
              lastErrorCode: null,
              queuedAt: input.queuedAt,
            },
          });
        });
      } catch (error) {
        if (isUnique(error)) throw new DuplicateSubmissionError();
        throw error;
      }
      const created = await db.submission.findUnique({ where: { id: input.id }, select: submissionSelect });
      if (!created) throw new Error("SUBMISSION_INSERT_FAILED");
      return toRecord(created);
    },
    async markUploading(id) {
      await db.$transaction(async (tx) => {
        await tx.submission.updateMany({
          where: { id, uploadState: { in: ["QUEUED", "UPLOADING", "FAILED"] } },
          data: { uploadState: "UPLOADING" },
        });
        await tx.fileUploadQueueItem.updateMany({
          where: { submissionId: id, state: { not: "STORED" } },
          data: { state: "UPLOADING", lastErrorCode: null, attemptCount: { increment: 1 } },
        });
      });
    },
    async markFailed(id, code) {
      await db.$transaction(async (tx) => {
        await tx.submission.updateMany({
          where: { id, uploadState: { not: "STORED" } },
          data: { uploadState: "FAILED" },
        });
        await tx.fileUploadQueueItem.updateMany({
          where: { submissionId: id, state: { not: "STORED" } },
          data: { state: "FAILED", lastErrorCode: code },
        });
      });
    },
    async finalize(id, receivedAt) {
      return db.$transaction(async (tx) => {
        const updated = await tx.submission.updateMany({
          where: { id, uploadState: { in: ["QUEUED", "UPLOADING", "FAILED"] } },
          data: { uploadState: "STORED", receivedAt },
        });
        if (updated.count === 0) {
          const current = await tx.submission.findUnique({ where: { id }, select: { uploadState: true } });
          if (current?.uploadState === "STORED") return "already" as const;
          return "missing" as const;
        }
        await tx.fileUploadQueueItem.updateMany({
          where: { submissionId: id },
          data: { state: "STORED", lastErrorCode: null },
        });
        return "stored" as const;
      });
    },
  };
}
