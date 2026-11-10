import { sameSha256 } from "./checksum";
import { MAX_SUBMISSION_BYTES, mimeBase, normalizeChecksum, type AllowedSubmissionMime } from "./file-rules";

export {
  ALLOWED_SUBMISSION_MIMES,
  GET_URL_SECONDS,
  MAX_SUBMISSION_BYTES,
  PUT_URL_SECONDS,
  assessSubmissionClaim,
  isAllowedMime,
  mimeBase,
  normalizeChecksum,
  sniffSubmissionMime,
  type AllowedSubmissionMime,
  type ClaimRejection,
  type SubmissionClaim,
} from "./file-rules";

export type ObjectVerdictCode = "TOO_LARGE" | "SIZE_MISMATCH" | "UNSUPPORTED_TYPE" | "TYPE_MISMATCH" | "CHECKSUM_MISMATCH" | "INCOMPLETE";

// Re-checks the stored object. The MIME type and checksum saved at the start are
// the claim to test, not proof that the file is safe.
export function assessStoredObject(input: {
  expectedByteSize: number;
  expectedMime: string;
  expectedChecksum: string;
  actualByteSize: number;
  headContentType: string | null;
  sniffed: AllowedSubmissionMime | null;
  actualChecksum: string;
  streamEndedEarly: boolean;
}): { ok: true } | { ok: false; code: ObjectVerdictCode; error: string } {
  if (input.streamEndedEarly || input.actualByteSize < 1) {
    return { ok: false, code: "INCOMPLETE", error: "The upload stopped before the whole file arrived." };
  }
  if (input.actualByteSize > MAX_SUBMISSION_BYTES) {
    return { ok: false, code: "TOO_LARGE", error: "This file is too large. The limit is 1 MB." };
  }
  if (input.actualByteSize !== input.expectedByteSize) {
    return { ok: false, code: "SIZE_MISMATCH", error: "The stored file size does not match this upload." };
  }
  if (!input.sniffed) {
    return { ok: false, code: "UNSUPPORTED_TYPE", error: "This file type is not allowed. Use a JPEG, PNG, WebP, or PDF." };
  }
  if (input.sniffed !== input.expectedMime) {
    return { ok: false, code: "TYPE_MISMATCH", error: "The stored file is not the type this upload described." };
  }
  if (input.headContentType && mimeBase(input.headContentType) !== input.sniffed) {
    return { ok: false, code: "TYPE_MISMATCH", error: "The stored file is not the type this upload described." };
  }
  const expected = normalizeChecksum(input.expectedChecksum);
  const actual = normalizeChecksum(input.actualChecksum);
  if (!expected || !actual || !sameSha256(expected, actual)) {
    return { ok: false, code: "CHECKSUM_MISMATCH", error: "The file does not match the checksum from this phone." };
  }
  return { ok: true };
}
