// Reads one sync upload and turns the session into a health or sync response.
// The session cookie is httpOnly and SameSite=lax, so another site does not
// receive it on a cross-site post. A browser that also sends Origin or
// Sec-Fetch-Site must match this page. This file does not add a second login
// system and does not redirect to the sign-in page.
//
// Next.js does not decompress a request body in this app. A Node Request keeps
// the raw gzip bytes, so the body is inflated here exactly once. If a host has
// already turned the body into JSON, those bytes start with "{" and are not
// inflated again. A batch whose gzip is over 32 KiB is sent as plain JSON when
// that JSON is still within 64 KiB. A single mark that fits neither limit stays
// on the phone with a visible failure. One normal mark is only a few hundred bytes.

import { gunzipSync } from "node:zlib";
import type { Actor } from "@/lib/auth/permissions";
import { acceptSyncBatch } from "@/lib/data/sync-attendance";
import type { HttpResult } from "@/lib/http/records";
import { MAX_COMPRESSED_BYTES, MAX_UNCOMPRESSED_BYTES } from "@/lib/sync/batch";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/// Missing browser headers stay allowed. The cookie rule still applies, and
/// the existing tests call the route without an Origin header. A present
/// header from another site is refused before any mark is read.
export function syncPostAllowed(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site.trim().toLowerCase() !== "same-origin" && site.trim().toLowerCase() !== "none") return false;
  const origin = request.headers.get("origin");
  if (origin === null || origin.trim() === "") return true;
  try {
    return new URL(request.url).origin === origin;
  } catch {
    return false;
  }
}

export function healthResponse(access: "anonymous" | "disabled" | "ok"): HttpResult {
  if (access === "ok") return { status: 200, body: { status: "ok" } };
  return { status: access === "anonymous" ? 401 : 403, body: { status: "unauthorized" } };
}

function declaredLength(request: Request): number | null | "bad" {
  const raw = request.headers.get("content-length");
  if (raw === null || raw.trim() === "") return null;
  if (!/^\d+$/.test(raw.trim())) return "bad";
  return Number(raw.trim());
}

function contentEncoding(request: Request): "gzip" | "identity" | "unsupported" {
  const raw = request.headers.get("content-encoding");
  if (raw === null || raw.trim() === "") return "identity";
  const value = raw.trim().toLowerCase();
  if (value === "identity") return "identity";
  if (value === "gzip") return "gzip";
  return "unsupported";
}

function looksLikeJson(bytes: Uint8Array): boolean {
  let index = 0;
  while (index < bytes.length) {
    const byte = bytes[index];
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) break;
    index += 1;
  }
  return bytes[index] === 0x7b;
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

async function readBounded(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Uint8Array | "too-large" | "empty"> {
  if (!body) return "empty";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return "too-large";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return "empty";
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function inflateOnce(bytes: Uint8Array): { ok: true; text: string } | { ok: false; status: 400 | 413 } {
  try {
    const inflated = gunzipSync(bytes, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
    const text = decodeText(inflated);
    if (text === null) return { ok: false, status: 400 };
    return { ok: true, text };
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
    if (code === "ERR_BUFFER_TOO_LARGE") return { ok: false, status: 413 };
    return { ok: false, status: 400 };
  }
}

export type SyncBodyResult = { ok: true; json: unknown; wireBytes: number } | { ok: false; status: 400 | 413 | 415; error: string };

/// Stops reading once the cap is passed. The cap is the compressed size for
/// gzip and the JSON size for plain text, so a huge body is not buffered first.
export async function readSyncBody(request: Request): Promise<SyncBodyResult> {
  const encoding = contentEncoding(request);
  if (encoding === "unsupported") return { ok: false, status: 415, error: "Unsupported content encoding." };
  const cap = encoding === "gzip" ? MAX_COMPRESSED_BYTES : MAX_UNCOMPRESSED_BYTES;
  const declared = declaredLength(request);
  if (declared === "bad") return { ok: false, status: 400, error: "The upload could not be read." };
  if (declared !== null && declared > cap) return { ok: false, status: 413, error: "The upload is too large." };

  const raw = await readBounded(request.body, cap);
  if (raw === "too-large") return { ok: false, status: 413, error: "The upload is too large." };
  if (raw === "empty") return { ok: false, status: 400, error: "The upload could not be read." };

  let text: string | null;
  if (encoding === "gzip") {
    if (looksLikeJson(raw)) {
      if (raw.byteLength > MAX_UNCOMPRESSED_BYTES) return { ok: false, status: 413, error: "The upload is too large." };
      text = decodeText(raw);
    } else if (!isGzip(raw)) {
      return { ok: false, status: 400, error: "The upload could not be read." };
    } else {
      const inflated = inflateOnce(raw);
      if (!inflated.ok) {
        return {
          ok: false,
          status: inflated.status,
          error: inflated.status === 413 ? "The upload is too large." : "The upload could not be read.",
        };
      }
      text = inflated.text;
    }
  } else if (isGzip(raw)) {
    return { ok: false, status: 400, error: "The upload could not be read." };
  } else {
    text = decodeText(raw);
  }

  if (text === null || text.length === 0) return { ok: false, status: 400, error: "The upload could not be read." };
  try {
    return { ok: true, json: JSON.parse(text) as unknown, wireBytes: raw.byteLength };
  } catch {
    return { ok: false, status: 400, error: "The upload could not be read." };
  }
}

export async function syncPostResponse(actor: Actor, request: Request): Promise<HttpResult> {
  // Learners and admins cannot record attendance. Stop before reading a body
  // or creating a device row for an account that is not allowed to send marks.
  if (!actor.active || (actor.role !== "TEACHER" && actor.role !== "CENTER_DIRECTOR")) {
    return { status: 403, body: { error: "You cannot record attendance." } };
  }
  const body = await readSyncBody(request);
  if (!body.ok) return { status: body.status, body: { error: body.error } };
  return acceptSyncBatch(actor, body.json, body.wireBytes);
}
