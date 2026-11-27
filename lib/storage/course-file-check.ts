import "server-only";

import { sameSha256 } from "./checksum";
import {
  courseFileLimit,
  courseFileLimitLabel,
  courseFileMime,
  type CourseFileMime,
  type CourseFileType,
} from "./course-file-rules";
import { mimeBase, normalizeChecksum } from "./file-rules";

export type CourseObjectCode =
  | "TOO_LARGE"
  | "SIZE_MISMATCH"
  | "UNSUPPORTED_TYPE"
  | "TYPE_MISMATCH"
  | "CHECKSUM_MISMATCH"
  | "INCOMPLETE";

// The browser label is not proof. The bytes decide the format, and the size
// is the number of bytes the server actually read.
export function assessStoredCourseFile(input: {
  resourceType: CourseFileType;
  expectedByteSize: number;
  expectedChecksum: string;
  actualByteSize: number;
  headContentType: string | null;
  sniffed: CourseFileMime | null;
  actualChecksum: string;
  streamEndedEarly: boolean;
}): { ok: true } | { ok: false; code: CourseObjectCode; error: string } {
  const limit = courseFileLimit(input.resourceType);
  const label = courseFileLimitLabel(input.resourceType);
  const kind = input.resourceType === "PDF" ? "PDF" : "MP3";
  if (input.streamEndedEarly || input.actualByteSize < 1) {
    return { ok: false, code: "INCOMPLETE", error: "The upload stopped before the whole file arrived." };
  }
  if (input.actualByteSize > limit) {
    return { ok: false, code: "TOO_LARGE", error: `This ${kind} is too large. The limit is ${label}.` };
  }
  if (input.actualByteSize !== input.expectedByteSize) {
    return { ok: false, code: "SIZE_MISMATCH", error: "The stored file size does not match this upload." };
  }
  const expectedMime = courseFileMime(input.resourceType);
  if (!input.sniffed || input.sniffed !== expectedMime) {
    return {
      ok: false,
      code: input.sniffed ? "TYPE_MISMATCH" : "UNSUPPORTED_TYPE",
      error: input.resourceType === "PDF" ? "This file is not a PDF." : "This file is not an MP3.",
    };
  }
  const headMime = input.headContentType ? mimeBase(input.headContentType) : "";
  const headIgnored = headMime === "" || headMime === "application/octet-stream" || headMime === "binary/octet-stream";
  if (!headIgnored && headMime !== input.sniffed) {
    return { ok: false, code: "TYPE_MISMATCH", error: input.resourceType === "PDF" ? "This file is not a PDF." : "This file is not an MP3." };
  }
  const expected = normalizeChecksum(input.expectedChecksum);
  const actual = normalizeChecksum(input.actualChecksum);
  if (!expected || !actual || !sameSha256(expected, actual)) {
    return { ok: false, code: "CHECKSUM_MISMATCH", error: "The file does not match the checksum from this upload." };
  }
  return { ok: true };
}
