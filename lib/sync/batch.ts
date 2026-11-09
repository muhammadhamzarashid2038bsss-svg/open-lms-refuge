// Builds one attendance upload without dropping a mark that does not fit.
// Prepaid data and a small phone need a hard stop: 25 events, 64 KiB of JSON,
// and 32 KiB after gzip. A mark that does not fit stays in `remaining` for a
// later batch. This file does not upload and does not delete local rows.
// Gzip uses the browser CompressionStream. When that API is missing, or the
// gzip result is over 32 KiB while the JSON is still within 64 KiB, the same
// JSON is sent plain. A mark that fits neither limit stays in `remaining`.

import type { FutureAttendanceEvent } from "@/lib/device/local-db";
import { isAbsenceReason, isAttendanceStatus, reasonAllowedFor, type AbsenceReasonName, type AttendanceStatusName } from "@/lib/lms/attendance";
import { isUuid } from "@/lib/lms/timetable";
import { canonicalInstant } from "@/lib/sync/retry";

export const SYNC_ENVELOPE_VERSION = 1;
export const MAX_EVENTS_PER_BATCH = 25;
export const MAX_UNCOMPRESSED_BYTES = 64 * 1024;
export const MAX_COMPRESSED_BYTES = 32 * 1024;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const ENVELOPE_KEYS = ["version", "localDeviceId", "events"] as const;
const EVENT_KEYS = [
  "clientEventId",
  "sectionId",
  "classSessionId",
  "learnerId",
  "status",
  "reasonCode",
  "recordedAt",
  "sequence",
  "correctsClientEventId",
  "correctsServerEventId",
] as const;

export type SyncBatchLimits = {
  maxEvents: number;
  maxUncompressedBytes: number;
  maxCompressedBytes: number;
};

export type SyncWireEvent = {
  clientEventId: string;
  sectionId: string;
  classSessionId: string;
  learnerId: string;
  status: AttendanceStatusName;
  reasonCode: AbsenceReasonName | null;
  recordedAt: string;
  sequence: number;
  correctsClientEventId: string | null;
  correctsServerEventId: string | null;
};

export type SyncEnvelope = {
  version: typeof SYNC_ENVELOPE_VERSION;
  localDeviceId: string;
  events: SyncWireEvent[];
};

export type EncodedSyncBatch = {
  envelope: SyncEnvelope;
  encoding: "gzip" | "identity";
  body: Uint8Array;
  uncompressedBytes: number;
};

export type SyncBatchBlock = {
  clientEventId: string;
  reason: "oversized" | "invalid";
};

export type SelectSyncBatchResult =
  | { ok: false; reason: "invalid_device" | "duplicate_id" | "duplicate_sequence" }
  | {
      ok: true;
      encoded: EncodedSyncBatch | null;
      remaining: FutureAttendanceEvent[];
      blockedBy: SyncBatchBlock | null;
    };

export type GzipFn = (bytes: Uint8Array) => Promise<Uint8Array | null>;

const DEFAULT_LIMITS: SyncBatchLimits = {
  maxEvents: MAX_EVENTS_PER_BATCH,
  maxUncompressedBytes: MAX_UNCOMPRESSED_BYTES,
  maxCompressedBytes: MAX_COMPRESSED_BYTES,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function boundedInteger(value: number | undefined, max: number): number {
  if (value === undefined) return max;
  if (!Number.isInteger(value) || value < 1 || value > max) return max;
  return value;
}

/// A requested limit can be smaller than the cap. It cannot be larger.
export function resolveBatchLimits(tighter?: Partial<SyncBatchLimits>): SyncBatchLimits {
  return {
    maxEvents: boundedInteger(tighter?.maxEvents, DEFAULT_LIMITS.maxEvents),
    maxUncompressedBytes: boundedInteger(tighter?.maxUncompressedBytes, DEFAULT_LIMITS.maxUncompressedBytes),
    maxCompressedBytes: boundedInteger(tighter?.maxCompressedBytes, DEFAULT_LIMITS.maxCompressedBytes),
  };
}

export function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function nullableId(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !SAFE_ID.test(value)) return undefined;
  return value;
}

export function toWireEvent(event: FutureAttendanceEvent): SyncWireEvent | null {
  if (event.syncState !== "pending") return null;
  if (!SAFE_ID.test(event.clientEventId) || !isUuid(event.localDeviceId)) return null;
  if (!isUuid(event.sectionId) || !isUuid(event.classSessionId) || !isUuid(event.learnerId)) return null;
  if (!isAttendanceStatus(event.status)) return null;
  if (event.reasonCode !== null && (!isAbsenceReason(event.reasonCode) || !reasonAllowedFor(event.status))) return null;
  if (!canonicalInstant(event.recordedAt)) return null;
  if (!Number.isInteger(event.sequence) || event.sequence < 1) return null;
  const correctsClientEventId = nullableId(event.correctsClientEventId);
  const correctsServerEventId = nullableId(event.correctsServerEventId);
  if (correctsClientEventId === undefined || correctsServerEventId === undefined) return null;
  if (correctsClientEventId !== null && correctsServerEventId !== null) return null;
  if (event.centerId.trim() === "" || event.userId.trim() === "") return null;
  return {
    clientEventId: event.clientEventId,
    sectionId: event.sectionId,
    classSessionId: event.classSessionId,
    learnerId: event.learnerId,
    status: event.status,
    reasonCode: event.reasonCode,
    recordedAt: event.recordedAt,
    sequence: event.sequence,
    correctsClientEventId,
    correctsServerEventId,
  };
}

function wireFromUnknown(value: unknown): SyncWireEvent | null {
  if (!isRecord(value) || !exactKeys(value, EVENT_KEYS)) return null;
  const correctsClientEventId = nullableId(value.correctsClientEventId);
  const correctsServerEventId = nullableId(value.correctsServerEventId);
  if (correctsClientEventId === undefined || correctsServerEventId === undefined) return null;
  if (correctsClientEventId !== null && correctsServerEventId !== null) return null;
  if (typeof value.clientEventId !== "string" || !SAFE_ID.test(value.clientEventId)) return null;
  if (typeof value.sectionId !== "string" || !isUuid(value.sectionId)) return null;
  if (typeof value.classSessionId !== "string" || !isUuid(value.classSessionId)) return null;
  if (typeof value.learnerId !== "string" || !isUuid(value.learnerId)) return null;
  if (typeof value.status !== "string" || !isAttendanceStatus(value.status)) return null;
  if (value.reasonCode !== null && (typeof value.reasonCode !== "string" || !isAbsenceReason(value.reasonCode) || !reasonAllowedFor(value.status))) {
    return null;
  }
  if (typeof value.recordedAt !== "string" || !canonicalInstant(value.recordedAt)) return null;
  if (typeof value.sequence !== "number" || !Number.isInteger(value.sequence) || value.sequence < 1) return null;
  return {
    clientEventId: value.clientEventId,
    sectionId: value.sectionId,
    classSessionId: value.classSessionId,
    learnerId: value.learnerId,
    status: value.status,
    reasonCode: value.reasonCode === null ? null : value.reasonCode,
    recordedAt: value.recordedAt,
    sequence: value.sequence,
    correctsClientEventId,
    correctsServerEventId,
  };
}

export function validateSyncEnvelope(value: unknown, limits: SyncBatchLimits = DEFAULT_LIMITS): { ok: true; envelope: SyncEnvelope } | { ok: false } {
  if (!isRecord(value) || !exactKeys(value, ENVELOPE_KEYS)) return { ok: false };
  if (value.version !== SYNC_ENVELOPE_VERSION) return { ok: false };
  if (typeof value.localDeviceId !== "string" || !isUuid(value.localDeviceId)) return { ok: false };
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > limits.maxEvents) return { ok: false };
  const events: SyncWireEvent[] = [];
  const seen = new Set<string>();
  for (const item of value.events) {
    const wire = wireFromUnknown(item);
    if (!wire || seen.has(wire.clientEventId)) return { ok: false };
    seen.add(wire.clientEventId);
    events.push(wire);
  }
  const envelope: SyncEnvelope = { version: SYNC_ENVELOPE_VERSION, localDeviceId: value.localDeviceId, events };
  if (utf8Bytes(JSON.stringify(envelope)).byteLength > limits.maxUncompressedBytes) return { ok: false };
  return { ok: true, envelope };
}

function buildEnvelope(localDeviceId: string, events: FutureAttendanceEvent[]): { envelope: SyncEnvelope; json: string; bytes: Uint8Array } | null {
  const wire: SyncWireEvent[] = [];
  for (const event of events) {
    const next = toWireEvent(event);
    if (!next) return null;
    wire.push(next);
  }
  const envelope: SyncEnvelope = { version: SYNC_ENVELOPE_VERSION, localDeviceId, events: wire };
  const json = JSON.stringify(envelope);
  return { envelope, json, bytes: utf8Bytes(json) };
}

/// Null means this browser has no CompressionStream. The caller then keeps plain JSON.
export async function gzipWithCompressionStream(bytes: Uint8Array): Promise<Uint8Array | null> {
  const factory = globalThis.CompressionStream;
  if (typeof factory !== "function") return null;
  const stream = new factory("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(bytes as BufferSource);
  await writer.close();
  const compressed = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  if (compressed.byteLength === 0) return null;
  return compressed;
}

type Fit = { ok: true; compressed: Uint8Array | null } | { ok: false };

async function fits(bytes: Uint8Array, limits: SyncBatchLimits, gzip: GzipFn, identity: boolean): Promise<Fit & { identity: boolean }> {
  if (bytes.byteLength > limits.maxUncompressedBytes) return { ok: false, identity };
  if (identity) return { ok: true, compressed: null, identity: true };
  const compressed = await gzip(bytes);
  if (compressed === null || compressed.byteLength === 0) return { ok: true, compressed: null, identity: true };
  // The server accepts plain JSON up to 64 KiB. A gzip result over 32 KiB
  // must not leave a valid mark stuck when that plain JSON still fits.
  if (compressed.byteLength > limits.maxCompressedBytes) return { ok: true, compressed: null, identity: true };
  return { ok: true, compressed, identity: false };
}

function encodedFrom(built: { envelope: SyncEnvelope; bytes: Uint8Array }, compressed: Uint8Array | null): EncodedSyncBatch {
  if (compressed === null) {
    return { envelope: built.envelope, encoding: "identity", body: built.bytes, uncompressedBytes: built.bytes.byteLength };
  }
  return {
    envelope: built.envelope,
    encoding: "gzip",
    body: compressed,
    uncompressedBytes: built.bytes.byteLength,
  };
}

/// Packs the longest prefix that fits. The event that stops the prefix, and
/// every event after it, stay in `remaining` in the same order. They are not
/// deleted and they are not skipped so a later correction cannot jump ahead.
export async function selectSyncBatch(input: {
  localDeviceId: string;
  events: FutureAttendanceEvent[];
  gzip?: GzipFn;
  limits?: Partial<SyncBatchLimits>;
}): Promise<SelectSyncBatchResult> {
  if (!isUuid(input.localDeviceId)) return { ok: false, reason: "invalid_device" };
  // Sequence order is the phone's correction order. Packing must not follow
  // the order the rows happened to be read.
  const events = [...input.events].sort((left, right) => left.sequence - right.sequence);
  const seen = new Set<string>();
  const sequences = new Set<number>();
  for (const event of events) {
    if (seen.has(event.clientEventId)) return { ok: false, reason: "duplicate_id" };
    if (sequences.has(event.sequence)) return { ok: false, reason: "duplicate_sequence" };
    seen.add(event.clientEventId);
    sequences.add(event.sequence);
  }

  const limits = resolveBatchLimits(input.limits);
  const gzip = input.gzip ?? gzipWithCompressionStream;
  const chosen: FutureAttendanceEvent[] = [];
  let identity = false;

  const finish = async (start: number, blockedBy: SyncBatchBlock | null): Promise<SelectSyncBatchResult> => {
    if (chosen.length === 0) {
      return { ok: true, encoded: null, remaining: events.slice(start), blockedBy };
    }
    const built = buildEnvelope(input.localDeviceId, chosen);
    const first = chosen[0];
    if (!built || !first) return { ok: false, reason: "duplicate_id" };
    const fit = await fits(built.bytes, limits, gzip, identity);
    if (!fit.ok) {
      return { ok: true, encoded: null, remaining: events, blockedBy: { clientEventId: first.clientEventId, reason: "oversized" } };
    }
    return { ok: true, encoded: encodedFrom(built, fit.compressed), remaining: events.slice(start), blockedBy };
  };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!toWireEvent(event)) {
      return finish(index, { clientEventId: event.clientEventId, reason: "invalid" });
    }
    if (chosen.length + 1 > limits.maxEvents) return finish(index, null);

    const candidate = buildEnvelope(input.localDeviceId, [...chosen, event]);
    if (!candidate) return finish(index, { clientEventId: event.clientEventId, reason: "invalid" });
    const fit = await fits(candidate.bytes, limits, gzip, identity);
    if (!fit.ok) {
      const alone = chosen.length === 0;
      return finish(index, alone ? { clientEventId: event.clientEventId, reason: "oversized" } : null);
    }
    identity = fit.identity;
    chosen.push(event);
  }

  return finish(events.length, null);
}
