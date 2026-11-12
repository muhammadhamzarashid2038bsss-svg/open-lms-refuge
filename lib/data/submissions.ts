// Digital homework files. The phone asks for a short-lived upload link, sends the
// file straight to private storage, then asks this server to check the bytes.
// A grade is not written here. Grades stay on the existing GradeEntry sync path.
// Directors and admins do not receive a file link from this workflow.

import type { Readable } from "stream";
import type { Actor } from "../auth/permissions";
import { canEditAssignedRecords } from "../auth/permissions";
import { prisma } from "../db";
import { writeAuditEvent } from "./audit";
import { isUuid } from "../lms/timetable";
import { fingerprintStream } from "../storage/checksum";
import {
  assessStoredObject,
  assessSubmissionClaim,
  GET_URL_SECONDS,
  MAX_SUBMISSION_BYTES,
  PUT_URL_SECONDS,
  sniffSubmissionMime,
  type ObjectVerdictCode,
} from "../storage/file-policy";
import { isServerObjectKey, submissionObjectKey } from "../storage/object-key";
import { storageFromEnv } from "../storage/r2";
import { type StorageAdapter } from "../storage/types";
import { registerOfflinePhone } from "./sync-attendance";
import {
  DuplicateSubmissionError,
  prismaSubmissionDb,
  type FileErrorName,
  type SubmissionDb,
  type SubmissionRecord,
} from "./submission-db";

export type SubmissionResult = { status: number; body: Record<string, unknown> };

type DeviceResult = { ok: true; deviceId: string } | { ok: false; status: 403 | 503; error: string };

export type SubmissionDeps = {
  db: SubmissionDb;
  storage: StorageAdapter | null;
  now: Date;
  registerDevice: (actor: Actor, deviceId: string, now: Date) => Promise<DeviceResult>;
  /// Optional so tests can use a memory database. The live server records the view
  /// before it returns a download link. The link itself is not stored in the audit.
  recordDownload?: (actor: Actor, submissionId: string) => Promise<void>;
};

type Claim = {
  assignmentId: string;
  learnerId: string;
  byteSize: number;
  mimeType: string;
  checksumSha256: string;
};

type FailureCode = ObjectVerdictCode | "STORAGE_UNAVAILABLE" | "OBJECT_NOT_FOUND";

const HIDDEN: SubmissionResult = { status: 404, body: { error: "Not found.", acknowledged: false } };
const SIGN_IN: SubmissionResult = { status: 401, body: { error: "Sign in required.", acknowledged: false } };

function fail(status: number, code: string, error: string, extra: Record<string, unknown> = {}): SubmissionResult {
  return { status, body: { error, code, acknowledged: false, ...extra } };
}

function storedAck(row: SubmissionRecord): SubmissionResult {
  return {
    status: 200,
    body: {
      acknowledged: true,
      submissionId: row.id,
      clientSubmissionId: row.clientSubmissionId,
      uploadState: "STORED",
    },
  };
}

function unavailable(extra: Record<string, unknown> = {}): SubmissionResult {
  return fail(503, "STORAGE_UNAVAILABLE", "File storage is not available right now.", extra);
}

function sameClaim(row: SubmissionRecord, claim: Claim): boolean {
  return (
    row.assignmentId === claim.assignmentId &&
    row.learnerId === claim.learnerId &&
    row.byteSize === claim.byteSize &&
    row.mimeType === claim.mimeType &&
    row.checksumSha256 === claim.checksumSha256
  );
}

function storedErrorCode(code: FailureCode): FileErrorName {
  if (code === "CHECKSUM_MISMATCH" || code === "TOO_LARGE" || code === "STORAGE_UNAVAILABLE") return code;
  return null;
}

function failureStatus(code: FailureCode): number {
  if (code === "TOO_LARGE") return 413;
  if (code === "UNSUPPORTED_TYPE" || code === "TYPE_MISMATCH") return 415;
  if (code === "STORAGE_UNAVAILABLE") return 503;
  return 409;
}

async function learnerOwns(actor: Actor, db: SubmissionDb, learnerId: string): Promise<boolean> {
  if (!actor.active || actor.role !== "STUDENT" || actor.learnerId !== learnerId) return false;
  const learner = await db.learner(learnerId);
  return Boolean(learner && learner.userId === actor.id && learner.centerId === actor.centerId);
}

async function deleteInvalidObject(storage: StorageAdapter, storageKey: string): Promise<void> {
  // Only a key this server minted can be removed. Seeded demo keys are left alone.
  if (!isServerObjectKey(storageKey)) return;
  try {
    await storage.delete(storageKey);
  } catch {
    // The attempt is still a failure. A later upload uses the same key.
  }
}

async function issuePut(deps: SubmissionDeps, row: SubmissionRecord): Promise<SubmissionResult> {
  if (!deps.storage) {
    await deps.db.markFailed(row.id, "STORAGE_UNAVAILABLE");
    return unavailable({ submissionId: row.id, clientSubmissionId: row.clientSubmissionId });
  }
  let signed;
  try {
    signed = await deps.storage.presignPut({
      key: row.storageKey,
      contentType: row.mimeType,
      byteSize: row.byteSize,
      expiresInSeconds: PUT_URL_SECONDS,
    });
  } catch {
    await deps.db.markFailed(row.id, "STORAGE_UNAVAILABLE");
    return unavailable({ submissionId: row.id, clientSubmissionId: row.clientSubmissionId });
  }
  try {
    await deps.db.markUploading(row.id);
  } catch {
    return fail(503, "DATABASE_FAILED", "The file could not be saved. Try again.", {
      submissionId: row.id,
      clientSubmissionId: row.clientSubmissionId,
    });
  }
  return {
    status: 200,
    body: {
      acknowledged: false,
      submissionId: row.id,
      clientSubmissionId: row.clientSubmissionId,
      uploadState: "UPLOADING",
      uploadUrl: signed.url,
      expiresAt: signed.expiresAt,
      headers: { "content-type": row.mimeType },
    },
  };
}

async function continueExisting(deps: SubmissionDeps, actor: Actor, row: SubmissionRecord, claim: Claim): Promise<SubmissionResult> {
  if (row.learnerId !== actor.learnerId || row.submittedById !== actor.id || row.centerId !== actor.centerId) return HIDDEN;
  if (!sameClaim(row, claim)) {
    return fail(409, "CONFLICT", "That upload does not match the one already started.", {
      submissionId: row.id,
      clientSubmissionId: row.clientSubmissionId,
    });
  }
  if (row.uploadState === "STORED") return storedAck(row);
  return issuePut(deps, row);
}

export async function initiateSubmission(
  actor: Actor | null,
  input: Record<string, unknown>,
  deps: SubmissionDeps,
): Promise<SubmissionResult> {
  if (!actor) return SIGN_IN;
  if (!actor.active) return fail(403, "INACTIVE", "This account is switched off.");
  const parsed = assessSubmissionClaim({ ...input, isUuid });
  if (!parsed.ok) {
    const status = parsed.code === "TOO_LARGE" ? 413 : parsed.code === "UNSUPPORTED_TYPE" ? 415 : 400;
    return fail(status, parsed.code, parsed.error);
  }
  const claim = parsed.claim;
  if (!(await learnerOwns(actor, deps.db, claim.learnerId))) return HIDDEN;

  const assignment = await deps.db.assignment(claim.assignmentId);
  if (!assignment || assignment.centerId !== actor.centerId) return HIDDEN;
  if (assignment.kind !== "DIGITAL" && assignment.kind !== "BOTH") {
    return fail(400, "PAPER_NOT_ALLOWED", "This assignment does not take a file.");
  }
  if (!(await deps.db.activeEnrollment(claim.learnerId, assignment.sectionId))) return HIDDEN;

  const device = await deps.registerDevice(actor, claim.deviceId, deps.now);
  if (!device.ok) return { status: device.status, body: { error: device.error, acknowledged: false } };

  let existing = await deps.db.byClientId(claim.clientSubmissionId);
  if (!existing) {
    if (!deps.storage) return unavailable();
    const minted = submissionObjectKey();
    try {
      existing = await deps.db.insertPending({
        id: minted.submissionId,
        clientSubmissionId: claim.clientSubmissionId,
        assignmentId: claim.assignmentId,
        learnerId: claim.learnerId,
        submittedById: actor.id,
        byteSize: claim.byteSize,
        mimeType: claim.mimeType,
        checksumSha256: claim.checksumSha256,
        storageKey: minted.storageKey,
        deviceId: device.deviceId,
        createdOffline: claim.createdOffline,
        queuedAt: deps.now,
      });
    } catch (error) {
      if (!(error instanceof DuplicateSubmissionError)) {
        return fail(503, "DATABASE_FAILED", "The file could not be saved. Try again.");
      }
      existing = await deps.db.byClientId(claim.clientSubmissionId);
      if (!existing) return fail(503, "DATABASE_FAILED", "The file could not be saved. Try again.");
    }
  }
  return continueExisting(deps, actor, existing, claim);
}

async function rejectObject(
  deps: SubmissionDeps,
  row: SubmissionRecord,
  code: FailureCode,
  error: string,
  remove: boolean,
): Promise<SubmissionResult> {
  if (remove && deps.storage) await deleteInvalidObject(deps.storage, row.storageKey);
  await deps.db.markFailed(row.id, storedErrorCode(code));
  return fail(failureStatus(code), code, error, { submissionId: row.id, clientSubmissionId: row.clientSubmissionId });
}

export async function finalizeSubmission(actor: Actor | null, submissionId: string, deps: SubmissionDeps): Promise<SubmissionResult> {
  if (!actor) return SIGN_IN;
  if (!actor.active) return fail(403, "INACTIVE", "This account is switched off.");
  if (!isUuid(submissionId)) return HIDDEN;
  const row = await deps.db.byId(submissionId.toLowerCase());
  if (!row || row.centerId !== actor.centerId) return HIDDEN;
  if (!(await learnerOwns(actor, deps.db, row.learnerId)) || row.submittedById !== actor.id) return HIDDEN;
  if (!(await deps.db.activeEnrollment(row.learnerId, row.sectionId))) return HIDDEN;
  if (row.uploadState === "STORED") return storedAck(row);
  if (!deps.storage) return rejectObject(deps, row, "STORAGE_UNAVAILABLE", "File storage is not available right now.", false);

  let head;
  try {
    head = await deps.storage.head(row.storageKey);
  } catch {
    return rejectObject(deps, row, "STORAGE_UNAVAILABLE", "File storage is not available right now.", false);
  }
  if (!head) {
    return rejectObject(deps, row, "OBJECT_NOT_FOUND", "The file was not found in storage. Upload it again.", false);
  }
  if (head.byteSize > MAX_SUBMISSION_BYTES || head.byteSize !== row.byteSize) {
    const code = head.byteSize > MAX_SUBMISSION_BYTES ? "TOO_LARGE" : "SIZE_MISMATCH";
    const error =
      code === "TOO_LARGE" ? "This file is too large. The limit is 1 MB." : "The stored file size does not match this upload.";
    return rejectObject(deps, row, code, error, true);
  }

  let stream: Readable | null;
  try {
    stream = await deps.storage.open(row.storageKey);
  } catch {
    return rejectObject(deps, row, "STORAGE_UNAVAILABLE", "File storage is not available right now.", false);
  }
  if (!stream) return rejectObject(deps, row, "OBJECT_NOT_FOUND", "The file was not found in storage. Upload it again.", false);

  const finger = await fingerprintStream(stream, MAX_SUBMISSION_BYTES);
  const verdict = assessStoredObject({
    expectedByteSize: row.byteSize,
    expectedMime: row.mimeType,
    expectedChecksum: row.checksumSha256,
    actualByteSize: finger.byteSize,
    headContentType: head.contentType,
    sniffed: sniffSubmissionMime(finger.prefix),
    actualChecksum: finger.checksumSha256,
    streamEndedEarly: !finger.complete || finger.byteSize !== head.byteSize,
  });
  if (!verdict.ok) return rejectObject(deps, row, verdict.code, verdict.error, true);

  try {
    const saved = await deps.db.finalize(row.id, deps.now);
    if (saved === "missing") return HIDDEN;
  } catch {
    return fail(503, "DATABASE_FAILED", "The file could not be saved. Try again.", {
      submissionId: row.id,
      clientSubmissionId: row.clientSubmissionId,
    });
  }
  return storedAck(row);
}

export async function downloadSubmission(actor: Actor | null, submissionId: string, deps: SubmissionDeps): Promise<SubmissionResult> {
  if (!actor) return SIGN_IN;
  if (!actor.active) return fail(403, "INACTIVE", "This account is switched off.");
  if (!isUuid(submissionId)) return HIDDEN;
  const row = await deps.db.byId(submissionId.toLowerCase());
  if (!row || row.centerId !== actor.centerId) return HIDDEN;

  const teacher = canEditAssignedRecords(actor, { id: row.sectionId, centerId: row.centerId });
  const learner = (await learnerOwns(actor, deps.db, row.learnerId)) && row.submittedById === actor.id;
  if (learner && !(await deps.db.activeEnrollment(row.learnerId, row.sectionId))) return HIDDEN;
  if (!teacher && !learner) return HIDDEN;
  if (row.uploadState !== "STORED") return fail(409, "NOT_READY", "This file is not ready to open.", { submissionId: row.id });
  if (!deps.storage) return unavailable({ submissionId: row.id });
  if (deps.recordDownload) {
    try {
      await deps.recordDownload(actor, row.id);
    } catch {
      return fail(500, "AUDIT_FAILED", "The file view could not be recorded.");
    }
  }
  try {
    const signed = await deps.storage.presignGet({ key: row.storageKey, expiresInSeconds: GET_URL_SECONDS });
    return { status: 200, body: { downloadUrl: signed.url, expiresAt: signed.expiresAt, submissionId: row.id } };
  } catch {
    return unavailable({ submissionId: row.id });
  }
}

export function liveSubmissionDeps(now = new Date()): SubmissionDeps {
  return {
    db: prismaSubmissionDb(prisma),
    storage: storageFromEnv(),
    now,
    registerDevice: (actor, deviceId, at) => registerOfflinePhone(actor, deviceId, at),
    recordDownload: async (actor, submissionId) => {
      await prisma.$transaction(async (tx) => {
        await writeAuditEvent(tx, {
          actor,
          action: "VIEW",
          entityType: "SUBMISSION",
          entityId: submissionId,
          metadata: { source: "download-request" },
        });
      });
    },
  };
}
