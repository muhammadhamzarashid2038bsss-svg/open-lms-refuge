import "server-only";

import type { ResourceType } from "../../generated/prisma/client";
import { assertSessionSecret } from "../auth/session-secret";
import { canManageResource, type Actor } from "../auth/permissions";
import { prisma } from "../db";
import { isUuid } from "../lms/timetable";
import { fingerprintStream } from "../storage/checksum";
import { assessStoredCourseFile } from "../storage/course-file-check";
import {
  COURSE_PUT_URL_SECONDS,
  assessCourseFileClaim,
  courseFileLimit,
  isCourseResourceKey,
  sniffCourseMime,
  type CourseFileType,
} from "../storage/course-file-rules";
import { courseResourceObjectKey } from "../storage/course-object-key";
import { openCourseUpload, sealCourseUpload, type CourseUploadClaim } from "../storage/course-upload-token";
import { GET_URL_SECONDS } from "../storage/file-rules";
import { downloadFilename, syntheticFileBytes } from "../storage/synthetic-file";
import { storageFromEnv } from "../storage/s3";
import type { StorageAdapter } from "../storage/types";
import { normalizeChecksum } from "../storage/file-rules";
import { readResourceObject } from "./courses";

const UNAVAILABLE = "File storage is not available right now.";
const HIDDEN = "Not found.";
const EXPIRED = "This upload link has expired. Choose the file again.";
const TOKEN_EXTRA_MS = 5 * 60 * 1000;

export type CourseFileResult = { status: number; body: Record<string, unknown> };

type CourseScope = {
  id: string;
  centerId: string;
  sectionIds: string[];
};

export type VerifiedCourseFile = {
  id: string;
  courseId: string;
  sectionId: string | null;
  title: string;
  resourceType: CourseFileType;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  storageKey: string;
  actorId: string;
  centerId: string;
  courseSectionIds: string[];
};

export type CourseFileDb = {
  course(id: string): Promise<CourseScope | null>;
  resource(id: string): Promise<VerifiedCourseFile | null>;
  insertVerified(row: VerifiedCourseFile): Promise<"created" | "exists">;
};

export type CourseFileDeps = {
  db: CourseFileDb;
  storage: StorageAdapter | null;
  now: Date;
  secret: string;
};

function fail(status: number, error: string, code: string): CourseFileResult {
  return { status, body: { error, code } };
}

function hidden(): CourseFileResult {
  return fail(404, HIDDEN, "NOT_FOUND");
}

function scopeFor(course: CourseScope, sectionId: string | null) {
  return {
    id: course.id,
    centerId: course.centerId,
    sectionId,
    courseSectionIds: course.sectionIds,
  };
}

function sameFile(row: VerifiedCourseFile, claim: CourseUploadClaim): boolean {
  return (
    row.courseId === claim.courseId &&
    row.sectionId === claim.sectionId &&
    row.resourceType === claim.resourceType &&
    row.byteSize === claim.byteSize &&
    row.storageKey === claim.storageKey &&
    row.checksumSha256 === claim.checksumSha256
  );
}

async function presign(deps: CourseFileDeps, claim: CourseUploadClaim): Promise<CourseFileResult> {
  if (!deps.storage) return fail(503, UNAVAILABLE, "STORAGE_UNAVAILABLE");
  try {
    const signed = await deps.storage.presignPut({
      key: claim.storageKey,
      contentType: claim.mimeType,
      byteSize: claim.byteSize,
      expiresInSeconds: COURSE_PUT_URL_SECONDS,
    });
    const uploadToken = sealCourseUpload(claim, deps.secret);
    if (!uploadToken) return fail(503, UNAVAILABLE, "STORAGE_UNAVAILABLE");
    return {
      status: 200,
      body: { uploadUrl: signed.url, expiresAt: signed.expiresAt, uploadToken },
    };
  } catch {
    return fail(503, UNAVAILABLE, "STORAGE_UNAVAILABLE");
  }
}

function readClaim(token: string, deps: CourseFileDeps): CourseUploadClaim | null {
  const claim = openCourseUpload(token, deps.secret, deps.now);
  if (!claim || !isCourseResourceKey(claim.storageKey)) return null;
  if (!isUuid(claim.resourceId) || !isUuid(claim.courseId) || !isUuid(claim.actorId)) return null;
  if (claim.sectionId !== null && !isUuid(claim.sectionId)) return null;
  if (claim.storageKey !== `course-resources/${claim.resourceId}`) return null;
  return claim;
}

async function allowed(actor: Actor, deps: CourseFileDeps, claim: CourseUploadClaim): Promise<CourseScope | null> {
  if (!actor.active || actor.id !== claim.actorId || actor.centerId.length === 0) return null;
  const course = await deps.db.course(claim.courseId);
  if (!course || course.centerId !== actor.centerId) return null;
  if (claim.sectionId && !course.sectionIds.includes(claim.sectionId)) return null;
  if (!canManageResource(actor, scopeFor(course, claim.sectionId))) return null;
  return course;
}

export async function beginCourseUpload(
  actor: Actor | null,
  input: Record<string, unknown>,
  deps: CourseFileDeps,
): Promise<CourseFileResult> {
  if (!actor) return fail(401, "Sign in required.", "SIGN_IN");
  if (!actor.active) return fail(403, "This account is switched off.", "INACTIVE");
  const courseId = typeof input.courseId === "string" ? input.courseId : "";
  const sectionRaw = typeof input.sectionId === "string" ? input.sectionId.trim() : "";
  const sectionId = sectionRaw.length > 0 ? sectionRaw : null;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const resourceType = typeof input.resourceType === "string" ? input.resourceType : "";
  const byteSize = typeof input.byteSize === "number" ? input.byteSize : Number.NaN;
  const checksum = typeof input.checksumSha256 === "string" ? normalizeChecksum(input.checksumSha256) : null;
  if (!isUuid(courseId) || (sectionId !== null && !isUuid(sectionId))) return hidden();
  if (title.length < 3 || title.length > 200) return fail(400, "Title needs at least 3 characters.", "INVALID");
  if (!checksum) return fail(400, "The file checksum is not valid.", "INVALID");
  const assessed = assessCourseFileClaim({ resourceType, byteSize });
  if (!assessed.ok) {
    const status = assessed.code === "TOO_LARGE" ? 413 : assessed.code === "UNSUPPORTED_TYPE" ? 415 : 400;
    return fail(status, assessed.error, assessed.code);
  }
  if (!deps.storage || deps.secret.length < 32) return fail(503, UNAVAILABLE, "STORAGE_UNAVAILABLE");

  const course = await deps.db.course(courseId);
  if (!course || course.centerId !== actor.centerId) return hidden();
  if (sectionId && !course.sectionIds.includes(sectionId)) return hidden();
  if (!canManageResource(actor, scopeFor(course, sectionId))) return hidden();

  const minted = courseResourceObjectKey();
  const claim: CourseUploadClaim = {
    resourceId: minted.resourceId,
    storageKey: minted.storageKey,
    courseId,
    sectionId,
    title,
    resourceType: assessed.resourceType,
    mimeType: assessed.mimeType,
    byteSize,
    checksumSha256: checksum,
    actorId: actor.id,
    exp: deps.now.getTime() + COURSE_PUT_URL_SECONDS * 1000 + TOKEN_EXTRA_MS,
  };
  return presign(deps, claim);
}

export async function refreshCourseUpload(actor: Actor | null, token: string, deps: CourseFileDeps): Promise<CourseFileResult> {
  if (!actor) return fail(401, "Sign in required.", "SIGN_IN");
  const claim = readClaim(token, deps);
  if (!claim) return fail(400, EXPIRED, "EXPIRED");
  if (!(await allowed(actor, deps, claim))) return hidden();
  const existing = await deps.db.resource(claim.resourceId);
  if (existing && sameFile(existing, claim)) {
    return { status: 200, body: { stored: true, resourceId: existing.id } };
  }
  return presign(deps, claim);
}

async function deleteMinted(storage: StorageAdapter, storageKey: string): Promise<void> {
  if (!isCourseResourceKey(storageKey)) return;
  try {
    await storage.delete(storageKey);
  } catch {
    // The file is still refused. A later try can remove the same key.
  }
}

export async function finalizeCourseUpload(actor: Actor | null, token: string, deps: CourseFileDeps): Promise<CourseFileResult> {
  if (!actor) return fail(401, "Sign in required.", "SIGN_IN");
  const claim = readClaim(token, deps);
  if (!claim) return fail(400, EXPIRED, "EXPIRED");
  const course = await allowed(actor, deps, claim);
  if (!course) return hidden();

  const existing = await deps.db.resource(claim.resourceId);
  if (existing) {
    if (sameFile(existing, claim)) return { status: 200, body: { stored: true, resourceId: existing.id } };
    return fail(409, "This upload does not match the saved file.", "CONFLICT");
  }
  if (!deps.storage) return fail(503, UNAVAILABLE, "STORAGE_UNAVAILABLE");

  let head;
  try {
    head = await deps.storage.head(claim.storageKey);
  } catch {
    return fail(503, UNAVAILABLE, "STORAGE_UNAVAILABLE");
  }
  if (!head) return fail(409, "The file was not found in storage. Upload it again.", "OBJECT_NOT_FOUND");

  let stream;
  try {
    stream = await deps.storage.open(claim.storageKey);
  } catch {
    return fail(503, UNAVAILABLE, "STORAGE_UNAVAILABLE");
  }
  if (!stream) return fail(409, "The file was not found in storage. Upload it again.", "OBJECT_NOT_FOUND");

  const finger = await fingerprintStream(stream, courseFileLimit(claim.resourceType));
  const verdict = assessStoredCourseFile({
    resourceType: claim.resourceType,
    expectedByteSize: claim.byteSize,
    expectedChecksum: claim.checksumSha256,
    actualByteSize: finger.byteSize,
    headContentType: head.contentType,
    sniffed: sniffCourseMime(finger.prefix),
    actualChecksum: finger.checksumSha256,
    streamEndedEarly: !finger.complete || finger.byteSize !== head.byteSize,
  });
  if (!verdict.ok) {
    await deleteMinted(deps.storage, claim.storageKey);
    const status = verdict.code === "TOO_LARGE" ? 413 : verdict.code === "UNSUPPORTED_TYPE" || verdict.code === "TYPE_MISMATCH" ? 415 : 409;
    return fail(status, verdict.error, verdict.code);
  }

  const row: VerifiedCourseFile = {
    id: claim.resourceId,
    courseId: claim.courseId,
    sectionId: claim.sectionId,
    title: claim.title,
    resourceType: claim.resourceType,
    mimeType: claim.mimeType,
    byteSize: claim.byteSize,
    checksumSha256: claim.checksumSha256,
    storageKey: claim.storageKey,
    actorId: actor.id,
    centerId: course.centerId,
    courseSectionIds: course.sectionIds,
  };
  try {
    const saved = await deps.db.insertVerified(row);
    if (saved === "exists") {
      const again = await deps.db.resource(claim.resourceId);
      if (again && sameFile(again, claim)) return { status: 200, body: { stored: true, resourceId: again.id } };
      return fail(409, "This upload does not match the saved file.", "CONFLICT");
    }
  } catch {
    return fail(503, "The file could not be saved. Try again.", "DATABASE_FAILED");
  }
  return { status: 200, body: { stored: true, resourceId: row.id } };
}

export async function courseResourceDownloadResponse(
  actor: Actor | null,
  resourceId: string,
  deps: { storage: StorageAdapter | null; load: typeof readResourceObject },
): Promise<Response> {
  if (!actor) {
    return Response.json({ error: "Sign in required." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const file = await deps.load(actor, resourceId);
  if (!file?.storageKey) {
    return Response.json({ error: HIDDEN }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const filename = downloadFilename(file.title, file.mimeType);
  if (!isCourseResourceKey(file.storageKey)) {
    const bytes = syntheticFileBytes(file.checksumSha256, file.byteSize);
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": file.mimeType ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  if (!deps.storage) {
    return Response.json({ error: UNAVAILABLE }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  try {
    const signed = await deps.storage.presignGet({
      key: file.storageKey,
      expiresInSeconds: GET_URL_SECONDS,
      contentDisposition: `attachment; filename="${filename}"`,
    });
    return new Response(null, {
      status: 302,
      headers: { "cache-control": "no-store", location: signed.url },
    });
  } catch {
    return Response.json({ error: UNAVAILABLE }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}

export function liveCourseFileDeps(now = new Date()): CourseFileDeps {
  let secret = "";
  try {
    secret = assertSessionSecret(process.env.SESSION_SECRET);
  } catch {
    secret = "";
  }
  return { db: prismaCourseFileDb(), storage: storageFromEnv(), now, secret };
}

export function prismaCourseFileDb(db: typeof prisma = prisma): CourseFileDb {
  return {
    async course(id) {
      const row = await db.course.findUnique({
        where: { id },
        select: { id: true, centerId: true, sections: { select: { id: true } } },
      });
      if (!row) return null;
      return { id: row.id, centerId: row.centerId, sectionIds: row.sections.map((section) => section.id) };
    },
    async resource(id) {
      const row = await db.resource.findUnique({
        where: { id },
        select: {
          id: true,
          courseId: true,
          sectionId: true,
          title: true,
          resourceType: true,
          mimeType: true,
          byteSize: true,
          checksumSha256: true,
          storageKey: true,
          createdById: true,
          course: { select: { centerId: true, sections: { select: { id: true } } } },
        },
      });
      if (!row?.storageKey || !row.mimeType || row.byteSize == null || !row.checksumSha256) return null;
      if (row.resourceType !== "PDF" && row.resourceType !== "AUDIO") return null;
      return {
        id: row.id,
        courseId: row.courseId,
        sectionId: row.sectionId,
        title: row.title,
        resourceType: row.resourceType,
        mimeType: row.mimeType,
        byteSize: row.byteSize,
        checksumSha256: row.checksumSha256,
        storageKey: row.storageKey,
        actorId: row.createdById,
        centerId: row.course.centerId,
        courseSectionIds: row.course.sections.map((section) => section.id),
      };
    },
    async insertVerified(row) {
      try {
        await db.resource.create({
          data: {
            id: row.id,
            courseId: row.courseId,
            sectionId: row.sectionId,
            createdById: row.actorId,
            title: row.title,
            resourceType: row.resourceType as ResourceType,
            externalUrl: null,
            bodyText: null,
            storageKey: row.storageKey,
            mimeType: row.mimeType,
            byteSize: row.byteSize,
            checksumSha256: row.checksumSha256,
          },
        });
        return "created";
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (code === "P2002") return "exists";
        throw error;
      }
    },
  };
}
