// Course textbooks and audio clips. These limits are not the homework limits.
// A learner photo stays at 1 MB under submissions/. A course PDF may be 25 MB
// and an MP3 may be 20 MB, because a centre still needs a real textbook or a
// spoken lesson on a cheap connection.

export const PDF_MAX_BYTES = 25 * 1024 * 1024;
export const MP3_MAX_BYTES = 20 * 1024 * 1024;

// Homework gives 10 minutes for 1 MB because a weak link may need a few
// minutes for that megabyte. A 25 MB PDF at that same pace cannot finish in
// 10 minutes. This link lasts 60 minutes, which is about two minutes per
// megabyte, and it is signed for one object, one type, and one size.
export const COURSE_PUT_URL_SECONDS = 60 * 60;

export const PDF_MIME = "application/pdf";
export const MP3_MIME = "audio/mpeg";

export type CourseFileType = "PDF" | "AUDIO";
export type CourseFileMime = typeof PDF_MIME | typeof MP3_MIME;

const COURSE_KEY = /^course-resources\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function courseFileLimit(type: CourseFileType): number {
  return type === "PDF" ? PDF_MAX_BYTES : MP3_MAX_BYTES;
}

export function courseFileMime(type: CourseFileType): CourseFileMime {
  return type === "PDF" ? PDF_MIME : MP3_MIME;
}

export function courseFileLimitLabel(type: CourseFileType): string {
  return type === "PDF" ? "25 MB" : "20 MB";
}

export function isCourseResourceKey(storageKey: string): boolean {
  return COURSE_KEY.test(storageKey);
}

// Magic bytes, not the browser's file type. MP3 is the only audio type the
// product already uses. WAV, Ogg, and other audio are refused.
export function sniffCourseMime(bytes: Uint8Array): CourseFileMime | null {
  if (bytes.length < 3) return null;
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return PDF_MIME;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return MP3_MIME;
  if (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return MP3_MIME;
  return null;
}

export type CourseClaimCode = "TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID";

export function assessCourseFileClaim(input: {
  resourceType: string;
  byteSize: number;
}): { ok: true; resourceType: CourseFileType; mimeType: CourseFileMime } | { ok: false; code: CourseClaimCode; error: string } {
  if (input.resourceType !== "PDF" && input.resourceType !== "AUDIO") {
    return { ok: false, code: "UNSUPPORTED_TYPE", error: "Choose a PDF or an MP3." };
  }
  const resourceType = input.resourceType;
  if (typeof input.byteSize !== "number" || !Number.isSafeInteger(input.byteSize) || input.byteSize < 1) {
    return { ok: false, code: "INVALID", error: "The file size is not valid." };
  }
  const limit = courseFileLimit(resourceType);
  if (input.byteSize > limit) {
    const label = courseFileLimitLabel(resourceType);
    const kind = resourceType === "PDF" ? "PDF" : "MP3";
    return { ok: false, code: "TOO_LARGE", error: `This ${kind} is too large. The limit is ${label}.` };
  }
  return { ok: true, resourceType, mimeType: courseFileMime(resourceType) };
}
