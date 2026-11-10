// Shrinks a homework photo on the phone before it is queued.
// PDFs are not rewritten. A photo stays in its own format so a worksheet
// is not silently turned into a type the server will reject.
// 500 KB is the target when the writing can stay readable. 1 MB is the hard stop.

import { MAX_SUBMISSION_BYTES, sniffSubmissionMime, type AllowedSubmissionMime } from "@/lib/storage/file-rules";

export const PHOTO_TARGET_BYTES = 500 * 1024;

const JPEG_ATTEMPTS = [
  { quality: 0.82, scale: 1 },
  { quality: 0.7, scale: 1 },
  { quality: 0.62, scale: 1 },
  { quality: 0.62, scale: 0.75 },
] as const;

const STILL_ATTEMPTS = [
  { quality: 0.9, scale: 1 },
  { quality: 0.9, scale: 0.75 },
  { quality: 0.9, scale: 0.5 },
] as const;

export type ImageCodec = {
  decode(bytes: Uint8Array, mime: AllowedSubmissionMime): Promise<{ hasAlpha: boolean } | null>;
  encode(options: { bytes: Uint8Array; mime: AllowedSubmissionMime; quality: number; scale: number }): Promise<Uint8Array | null>;
};

export type PreparedFile = {
  ok: true;
  filename: string;
  mimeType: AllowedSubmissionMime;
  bytes: Uint8Array;
  note: string | null;
};

const TOO_BIG = "This file is too large. The limit is 1 MB.";
const BAD_TYPE = "This file type is not allowed. Use a JPEG, PNG, WebP, or PDF.";
const UNREADABLE = "This file could not be read. It was not saved.";
const KEPT_LEGIBLE = "The photo is still over 500 KB. It was kept readable and it is under the 1 MB limit.";
const COULD_NOT_SHRINK = "This phone could not shrink the photo. The original file is still within the 1 MB limit.";
const BAD_RESULT = "This phone could not keep the photo in an allowed format.";

function kept(filename: string, mimeType: AllowedSubmissionMime, bytes: Uint8Array, note: string | null): PreparedFile {
  return { ok: true, filename, mimeType, bytes, note };
}

function accepted(bytes: Uint8Array, mime: AllowedSubmissionMime): Uint8Array | null {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_SUBMISSION_BYTES) return null;
  if (sniffSubmissionMime(bytes) !== mime) return null;
  return bytes;
}

export async function prepareStoredFile(
  input: { filename: string; bytes: Uint8Array },
  codec: ImageCodec,
): Promise<PreparedFile | { ok: false; message: string }> {
  const filename = input.filename.trim().slice(0, 120) || "homework";
  const sniffed = sniffSubmissionMime(input.bytes);
  if (!sniffed) return { ok: false, message: BAD_TYPE };
  if (sniffed === "application/pdf") {
    if (input.bytes.byteLength > MAX_SUBMISSION_BYTES) return { ok: false, message: TOO_BIG };
    return kept(filename, sniffed, input.bytes, null);
  }
  if (input.bytes.byteLength <= PHOTO_TARGET_BYTES) return kept(filename, sniffed, input.bytes, null);

  let decoded: { hasAlpha: boolean } | null = null;
  try {
    decoded = await codec.decode(input.bytes, sniffed);
  } catch {
    decoded = null;
  }
  if (!decoded) {
    if (input.bytes.byteLength <= MAX_SUBMISSION_BYTES) return kept(filename, sniffed, input.bytes, COULD_NOT_SHRINK);
    return { ok: false, message: input.bytes.byteLength > MAX_SUBMISSION_BYTES ? TOO_BIG : UNREADABLE };
  }

  const attempts = sniffed === "image/jpeg" && !decoded.hasAlpha ? JPEG_ATTEMPTS : STILL_ATTEMPTS;
  let best: Uint8Array | null = null;
  for (const attempt of attempts) {
    let encoded: Uint8Array | null = null;
    try {
      encoded = await codec.encode({ bytes: input.bytes, mime: sniffed, quality: attempt.quality, scale: attempt.scale });
    } catch {
      encoded = null;
    }
    const usable = encoded ? accepted(encoded, sniffed) : null;
    if (!usable) continue;
    if (!best || usable.byteLength < best.byteLength) best = usable;
    if (usable.byteLength <= PHOTO_TARGET_BYTES) break;
  }
  if (!best) {
    if (input.bytes.byteLength <= MAX_SUBMISSION_BYTES) return kept(filename, sniffed, input.bytes, COULD_NOT_SHRINK);
    return { ok: false, message: TOO_BIG };
  }
  if (best.byteLength > MAX_SUBMISSION_BYTES) return { ok: false, message: TOO_BIG };
  const note = best.byteLength > PHOTO_TARGET_BYTES ? KEPT_LEGIBLE : null;
  return kept(filename, sniffed, best, note);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const PREPARE_MESSAGES = { TOO_BIG, BAD_TYPE, UNREADABLE, KEPT_LEGIBLE, COULD_NOT_SHRINK, BAD_RESULT };
