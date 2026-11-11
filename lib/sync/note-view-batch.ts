// A progress-note view receipt. It is not a grade or note edit.
// The signed-in person is not read from these fields. The phone clock, when
// present, is stored only long enough to recognize a repeated upload. It is
// not the audit time.

import { isUuid } from "@/lib/lms/timetable";
import { utf8Bytes, MAX_UNCOMPRESSED_BYTES } from "@/lib/sync/batch";
import { canonicalInstant } from "@/lib/sync/retry";

export const NOTE_VIEW_SYNC_VERSION = 1;
export const MAX_NOTE_VIEW_EVENTS = 10;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const ENVELOPE_KEYS = ["version", "localDeviceId", "events"] as const;
const EVENT_KEYS = ["clientEventId", "noteId", "deviceReportedAt"] as const;

export type NoteViewEvent = {
  clientEventId: string;
  noteId: string;
  deviceReportedAt: string | null;
};

export type NoteViewBatchItem =
  | { ok: true; event: NoteViewEvent }
  | { ok: false; clientEventId: string; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function eventIdOf(value: unknown, index: number): string {
  if (isRecord(value) && typeof value.clientEventId === "string" && value.clientEventId.length <= 80) {
    return value.clientEventId;
  }
  return `invalid-${index}`;
}

function parseEvent(value: Record<string, unknown>): NoteViewEvent | null {
  if (!exactKeys(value, EVENT_KEYS)) return null;
  if (typeof value.clientEventId !== "string" || !SAFE_ID.test(value.clientEventId)) return null;
  if (typeof value.noteId !== "string" || !isUuid(value.noteId)) return null;
  if (value.deviceReportedAt !== null && (typeof value.deviceReportedAt !== "string" || !canonicalInstant(value.deviceReportedAt))) {
    return null;
  }
  return {
    clientEventId: value.clientEventId,
    noteId: value.noteId.toLowerCase(),
    deviceReportedAt: value.deviceReportedAt,
  };
}

export function validateNoteViewEnvelope(
  value: unknown,
): { ok: true; localDeviceId: string; items: NoteViewBatchItem[] } | { ok: false } {
  if (!isRecord(value) || !exactKeys(value, ENVELOPE_KEYS)) return { ok: false };
  if (value.version !== NOTE_VIEW_SYNC_VERSION) return { ok: false };
  if (typeof value.localDeviceId !== "string" || !isUuid(value.localDeviceId)) return { ok: false };
  if (!Array.isArray(value.events) || value.events.length < 1 || value.events.length > MAX_NOTE_VIEW_EVENTS) return { ok: false };
  if (utf8Bytes(JSON.stringify(value)).byteLength > MAX_UNCOMPRESSED_BYTES) return { ok: false };
  const seen = new Set<string>();
  const items: NoteViewBatchItem[] = [];
  for (let index = 0; index < value.events.length; index += 1) {
    const raw = value.events[index];
    const clientEventId = eventIdOf(raw, index);
    if (!isRecord(raw)) {
      items.push({ ok: false, clientEventId, code: "invalid_event" });
      continue;
    }
    const event = parseEvent(raw);
    if (!event || seen.has(event.clientEventId)) {
      items.push({ ok: false, clientEventId, code: "invalid_event" });
      continue;
    }
    seen.add(event.clientEventId);
    items.push({ ok: true, event });
  }
  return { ok: true, localDeviceId: value.localDeviceId.toLowerCase(), items };
}
