// Chooses which local attendance rows may enter the next upload.
// The signed-in account and this browser's device id come from the page.
// Rows for another person, another center, or another browser stay out.
// Practice rows are not attendance. Acknowledged rows were already confirmed.
// A correction waits until the earlier local row is confirmed, or is placed
// earlier in this same list. Nothing here writes, deletes, or marks a row sent.

import type { FutureAttendanceEvent } from "@/lib/device/local-db";
import { isAbsenceReason, isAttendanceStatus } from "@/lib/lms/attendance";
import { toWireEvent } from "@/lib/sync/batch";
import { isAutomaticAttemptDue, isManualAttemptAllowed, RETRY_MAX_ATTEMPTS, type SyncPass, type SyncRetryMeta } from "@/lib/sync/retry";

export type { SyncPass } from "@/lib/sync/retry";

export type PracticeCandidate = {
  kind: "practice";
  id: string;
  userId: string;
  centerId: string;
};

// Practice rows are the only candidates with `kind`. Attendance rows leave it
// absent. That tag is what separates the two: a practice row is held back and
// is never read as a mark to upload. Centers share phones, so a practice
// record must not leave the device as if it were attendance.
type AttendanceCandidate = FutureAttendanceEvent & { kind?: undefined };

export type CollectCandidate = AttendanceCandidate | PracticeCandidate;

export type CollectHoldReason =
  | "practice"
  | "other_account"
  | "other_center"
  | "other_device"
  | "acknowledged"
  | "permanent"
  | "retry_wait"
  | "retry_cap"
  | "predecessor"
  | "invalid";

export type CollectHold = {
  id: string;
  reason: CollectHoldReason;
};

export type CollectResult =
  | { ok: false; reason: "invalid_account" | "invalid_device" | "duplicate_event" | "duplicate_sequence" | "unreadable" }
  | { ok: true; events: FutureAttendanceEvent[]; held: CollectHold[] };

export type CollectInput = {
  account: { userId: string; centerId: string };
  localDeviceId: string;
  records: CollectCandidate[];
  retry: SyncRetryMeta;
  now: Date;
  mode: SyncPass;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isPractice(value: CollectCandidate): value is PracticeCandidate {
  return isRecord(value) && value.kind === "practice";
}

function practiceRow(value: PracticeCandidate): PracticeCandidate | null {
  if (!present(value.id) || !present(value.userId) || !present(value.centerId)) return null;
  return { kind: "practice", id: value.id, userId: value.userId, centerId: value.centerId };
}

/// A row that cannot be checked fails the whole read. It is not treated as
/// an empty list, and the other rows are not uploaded in its place.
function readableEvent(value: CollectCandidate): FutureAttendanceEvent | null {
  if (!isRecord(value) || value.kind !== undefined) return null;
  if (!present(value.clientEventId) || !present(value.centerId) || !present(value.userId)) return null;
  if (!present(value.localDeviceId) || !present(value.sectionId) || !present(value.classSessionId)) return null;
  if (!present(value.learnerId) || !present(value.recordedAt) || !present(value.status)) return null;
  if (!isAttendanceStatus(value.status)) return null;
  if (value.syncState !== "pending" && value.syncState !== "acknowledged") return null;
  if (value.reasonCode !== null && (typeof value.reasonCode !== "string" || !isAbsenceReason(value.reasonCode))) return null;
  if (!Number.isInteger(value.sequence) || value.sequence < 1) return null;
  if (value.correctsClientEventId !== null && !present(value.correctsClientEventId)) return null;
  if (value.correctsServerEventId !== null && !present(value.correctsServerEventId)) return null;
  if (value.correctsClientEventId !== null && value.correctsServerEventId !== null) return null;
  return value;
}

export function collectEligibleEvents(input: CollectInput): CollectResult {
  if (!present(input.account.userId) || !present(input.account.centerId)) return { ok: false, reason: "invalid_account" };
  if (!present(input.localDeviceId)) return { ok: false, reason: "invalid_device" };
  if (input.retry.key !== `sync:${input.account.centerId}:${input.account.userId}`) return { ok: false, reason: "unreadable" };

  const events: FutureAttendanceEvent[] = [];
  const held: CollectHold[] = [];
  for (const record of input.records) {
    if (isPractice(record)) {
      const practice = practiceRow(record);
      if (!practice) return { ok: false, reason: "unreadable" };
      held.push({ id: practice.id, reason: "practice" });
      continue;
    }
    const event = readableEvent(record);
    if (!event) return { ok: false, reason: "unreadable" };
    events.push(event);
  }

  const seenIds = new Set<string>();
  for (const event of events) {
    if (seenIds.has(event.clientEventId)) return { ok: false, reason: "duplicate_event" };
    seenIds.add(event.clientEventId);
  }

  const owned = events.filter((event) => event.userId === input.account.userId && event.centerId === input.account.centerId);
  const sequences = new Set<number>();
  for (const event of owned) {
    if (sequences.has(event.sequence)) return { ok: false, reason: "duplicate_sequence" };
    sequences.add(event.sequence);
  }

  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const satisfied = new Set<string>();
  const selected: FutureAttendanceEvent[] = [];

  for (const event of ordered) {
    if (event.userId !== input.account.userId) {
      held.push({ id: event.clientEventId, reason: "other_account" });
      continue;
    }
    if (event.centerId !== input.account.centerId) {
      held.push({ id: event.clientEventId, reason: "other_center" });
      continue;
    }
    if (event.localDeviceId !== input.localDeviceId) {
      held.push({ id: event.clientEventId, reason: "other_device" });
      continue;
    }
    if (event.syncState === "acknowledged") {
      // The copy is only for the wire check. The stored row stays acknowledged.
      if (!toWireEvent({ ...event, syncState: "pending" })) {
        held.push({ id: event.clientEventId, reason: "invalid" });
        continue;
      }
      satisfied.add(event.clientEventId);
      held.push({ id: event.clientEventId, reason: "acknowledged" });
      continue;
    }
    if (!toWireEvent(event)) {
      held.push({ id: event.clientEventId, reason: "invalid" });
      continue;
    }

    const retry = input.retry.events[event.clientEventId];
    if (retry?.permanent) {
      held.push({ id: event.clientEventId, reason: "permanent" });
      continue;
    }
    if (input.mode === "automatic" && retry && !isAutomaticAttemptDue(retry, input.now)) {
      const reason = retry.attempts >= RETRY_MAX_ATTEMPTS ? "retry_cap" : "retry_wait";
      held.push({ id: event.clientEventId, reason: reason });
      continue;
    }
    if (input.mode === "manual" && !isManualAttemptAllowed(retry)) {
      held.push({ id: event.clientEventId, reason: "permanent" });
      continue;
    }

    if (event.correctsClientEventId !== null && !satisfied.has(event.correctsClientEventId)) {
      held.push({ id: event.clientEventId, reason: "predecessor" });
      continue;
    }

    satisfied.add(event.clientEventId);
    selected.push(event);
  }

  selected.sort((left, right) => left.sequence - right.sequence);
  return { ok: true, events: selected, held };
}
