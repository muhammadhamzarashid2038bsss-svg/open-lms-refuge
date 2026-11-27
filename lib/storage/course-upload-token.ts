import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { CourseFileMime, CourseFileType } from "./course-file-rules";

// The resource row is created only after the object is checked, so this claim
// cannot live in the database yet. The token is encrypted with the existing
// session secret. The storage key is not readable in the browser response.

export type CourseUploadClaim = {
  resourceId: string;
  storageKey: string;
  courseId: string;
  sectionId: string | null;
  title: string;
  resourceType: CourseFileType;
  mimeType: CourseFileMime;
  byteSize: number;
  checksumSha256: string;
  actorId: string;
  exp: number;
};

const TOKEN_VERSION = 1;

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update("open-lms-course-upload-v1").update(secret).digest();
}

export function sealCourseUpload(claim: CourseUploadClaim, secret: string): string | null {
  if (secret.length < 32) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const body = Buffer.from(JSON.stringify({ v: TOKEN_VERSION, ...claim }), "utf8");
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function openCourseUpload(token: string, secret: string, now: Date): CourseUploadClaim | null {
  if (secret.length < 32 || token.length < 28 || token.length > 4000) return null;
  let packed: Buffer;
  try {
    packed = Buffer.from(token, "base64url");
  } catch {
    return null;
  }
  if (packed.length < 12 + 16 + 1) return null;
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  let text = "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
    decipher.setAuthTag(tag);
    text = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.v !== TOKEN_VERSION) return null;
  if (typeof row.exp !== "number" || row.exp <= now.getTime()) return null;
  if (row.resourceType !== "PDF" && row.resourceType !== "AUDIO") return null;
  if (typeof row.resourceId !== "string" || typeof row.storageKey !== "string") return null;
  if (typeof row.courseId !== "string" || typeof row.title !== "string" || typeof row.actorId !== "string") return null;
  if (typeof row.mimeType !== "string" || typeof row.byteSize !== "number" || typeof row.checksumSha256 !== "string") return null;
  if (row.sectionId !== null && typeof row.sectionId !== "string") return null;
  return {
    resourceId: row.resourceId,
    storageKey: row.storageKey,
    courseId: row.courseId,
    sectionId: row.sectionId,
    title: row.title,
    resourceType: row.resourceType,
    mimeType: row.mimeType as CourseFileMime,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    actorId: row.actorId,
    exp: row.exp,
  };
}
