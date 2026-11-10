// Shared by the server and the phone. This file does not import Node-only
// modules, so the learner page can use the same size and signature checks.
// The filename is never trusted. The server checks the stored bytes again.

export const MAX_SUBMISSION_BYTES = 1024 * 1024;

// A weak link may need a few minutes to send 1 MB. The link then dies.
export const PUT_URL_SECONDS = 10 * 60;
export const GET_URL_SECONDS = 2 * 60;

export const ALLOWED_SUBMISSION_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export type AllowedSubmissionMime = (typeof ALLOWED_SUBMISSION_MIMES)[number];

const CLIENT_SUBMISSION_ID = /^[A-Za-z0-9_-]{8,80}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type ClaimRejection = "TOO_LARGE" | "UNSUPPORTED_TYPE" | "INVALID";

export type SubmissionClaim = {
  clientSubmissionId: string;
  assignmentId: string;
  learnerId: string;
  deviceId: string;
  byteSize: number;
  mimeType: AllowedSubmissionMime;
  checksumSha256: string;
  createdOffline: boolean;
};

export function normalizeChecksum(value: string): string | null {
  const hex = value.trim().toLowerCase();
  return SHA256_HEX.test(hex) ? hex : null;
}

export function mimeBase(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

export function isAllowedMime(value: string): value is AllowedSubmissionMime {
  return (ALLOWED_SUBMISSION_MIMES as readonly string[]).includes(mimeBase(value));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function asciiPrefix(bytes: Uint8Array): string {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  let text = "";
  const end = Math.min(bytes.length, start + 64);
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index] ?? 0;
    if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) break;
    text += String.fromCharCode(byte);
  }
  return text.trimStart().toLowerCase();
}

function isDangerous(bytes: Uint8Array): boolean {
  if (startsWith(bytes, [0x4d, 0x5a])) return true;
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return true;
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) || startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])) return true;
  if (startsWith(bytes, [0x1f, 0x8b])) return true;
  if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21])) return true;
  if (startsWith(bytes, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return true;
  const text = asciiPrefix(bytes);
  return text.startsWith("<svg") || text.startsWith("<html") || text.startsWith("<!doctype") || text.startsWith("<?xml") || text.startsWith("<script");
}

// Magic bytes, not the browser's MIME label. Unknown and dangerous files are refused.
export function sniffSubmissionMime(bytes: Uint8Array): AllowedSubmissionMime | null {
  if (isDangerous(bytes)) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  return null;
}

export function assessSubmissionClaim(
  input: Record<string, unknown> & { isUuid: (value: string) => boolean },
): { ok: true; claim: SubmissionClaim } | { ok: false; code: ClaimRejection; error: string } {
  if (typeof input.clientSubmissionId !== "string" || !CLIENT_SUBMISSION_ID.test(input.clientSubmissionId)) {
    return { ok: false, code: "INVALID", error: "This upload id is not valid." };
  }
  if (typeof input.assignmentId !== "string" || !input.isUuid(input.assignmentId)) {
    return { ok: false, code: "INVALID", error: "That assignment was not found." };
  }
  if (typeof input.learnerId !== "string" || !input.isUuid(input.learnerId)) {
    return { ok: false, code: "INVALID", error: "That learner was not found." };
  }
  if (typeof input.deviceId !== "string" || !input.isUuid(input.deviceId)) {
    return { ok: false, code: "INVALID", error: "This phone was not recognized." };
  }
  if (typeof input.byteSize !== "number" || !Number.isSafeInteger(input.byteSize) || input.byteSize < 1) {
    return { ok: false, code: "INVALID", error: "The file size is not valid." };
  }
  if (input.byteSize > MAX_SUBMISSION_BYTES) {
    return { ok: false, code: "TOO_LARGE", error: "This file is too large. The limit is 1 MB." };
  }
  if (typeof input.mimeType !== "string" || !isAllowedMime(input.mimeType)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", error: "This file type is not allowed. Use a JPEG, PNG, WebP, or PDF." };
  }
  if (typeof input.checksumSha256 !== "string") {
    return { ok: false, code: "INVALID", error: "The file checksum is missing." };
  }
  const checksumSha256 = normalizeChecksum(input.checksumSha256);
  if (!checksumSha256) return { ok: false, code: "INVALID", error: "The file checksum is not valid." };
  if (typeof input.createdOffline !== "boolean") {
    return { ok: false, code: "INVALID", error: "Say whether this file was saved on the phone." };
  }
  return {
    ok: true,
    claim: {
      clientSubmissionId: input.clientSubmissionId,
      assignmentId: input.assignmentId.toLowerCase(),
      learnerId: input.learnerId.toLowerCase(),
      deviceId: input.deviceId.toLowerCase(),
      byteSize: input.byteSize,
      mimeType: mimeBase(input.mimeType) as AllowedSubmissionMime,
      checksumSha256,
      createdOffline: input.createdOffline,
    },
  };
}
