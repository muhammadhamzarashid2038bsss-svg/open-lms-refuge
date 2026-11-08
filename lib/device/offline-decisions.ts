// Decisions for offline kiosk attendance. Nothing here reads the phone's
// storage or the network. Later stages call these functions. Stage 1 does
// not change sign-in, the attendance save, or the database.
//
// The idle and absolute limits are the same ones the server already uses.
// Comparing them with the phone clock is a convenience for a supervised
// phone with synthetic data. It is not a security check. After a restart,
// the browser only has the new phone clock. Setting that clock backward
// makes an expired snapshot look valid. Setting it forward hides the class
// early. A fixed offset measured when the class was loaded corrects a clock
// that was already wrong by the same amount. It does not detect a later change.
//
// Later stages still owe these rules:
// - Prove a cached /kiosk-shell can run at an attendance address before adding
//   a service worker. If a cached Next.js page breaks there, use a standalone
//   static page. Never cache the personalized attendance page or its server
//   response.
// - Storage persistence and quota checks live in storage-readiness.ts. The
//   attendance save asks them before it writes. A denied request or a full
//   phone must not be reported as a saved mark. Granted persistence still
//   does not mean the browser can never delete IndexedDB.
// - Each local attendance event gets a rising sequence number and the id of
//   the event it corrects. Later sync uses that order. The phone clock does
//   not choose which correction is newest.
// - If the lock cannot be written, hide the roster and do not claim that the
//   lock or the sign-out finished. decideSignOut records that rule.

import { sessionVerdict, type SessionVerdict } from "@/lib/auth/session-policy";
import { allowSignIn, type DeviceItem, type DeviceLock, type DeviceRelease, type DeviceState } from "./shared-device";
import type { StoredDevice } from "./phone-check";

export const UNREADABLE_RECORDS =
  "This phone's saved records could not be read. They were not deleted. Do not hand the phone over yet.";

export const MISMATCHED_RECORDS =
  "This phone's saved records do not match. They were not deleted. Do not hand the phone over yet.";

export const UNCHECKED_RECORDS =
  "This phone's saved records could not be checked. They were not deleted. Do not hand the phone over yet.";

const LOCK_FAILED =
  "This phone could not lock the saved records. Sign-out was not completed. Do not hand it over yet.";

const LOCKED_WAITING =
  "This phone is locked. The sign-in on the server will end when the phone can reach it. Marks waiting to send are still here.";

const LOCKED_AND_SIGNED_OUT =
  "This phone is locked and the sign-in has ended. Marks waiting to send are still here.";

const MARK_FAILED = "This phone could not save the mark. It was not stored.";

const MARK_SAVED = "Saved on this phone, waiting to send";

export type AccountRef = {
  userId: string;
  centerId: string;
};

export type ClassRef = {
  sectionId: string;
  classSessionId: string;
};

/// Copied from a server session that already succeeded. The instants are the
/// server's lastSeenAt and expiresAt, plus the two clocks at the moment of
/// that successful load.
export type AuthSnapshot = AccountRef &
  ClassRef & {
    authSessionId: string;
    serverNowAtIssue: string;
    phoneNowAtIssue: string;
    lastSeenAt: string;
    expiresAt: string;
    revokedAt: string | null;
  };

export type SnapshotDecision =
  | { ok: true }
  | { ok: false; reason: "invalid" | "owner" | "scope" | SessionVerdict };

export type PracticeRow = {
  id: string;
  userId: string;
  centerId: string;
  createdAt: string;
};

export type LocalAttendanceRow = {
  clientEventId: string;
  userId: string;
  centerId: string;
  syncState: "pending" | "acknowledged";
  queuedAt: string;
};

export type QueueSource =
  | { type: "wait" }
  | { type: "stop"; message: string }
  | { type: "legacy" }
  | { type: "indexed" };

export type SharedPhoneDecision =
  | { type: "wait" }
  | { type: "stop"; message: string; deletePending: false }
  | { type: "blocked"; itemCount: number; deletePending: false }
  | { type: "stay-locked"; deletePending: false }
  | { type: "clear-lock"; deletePending: false }
  | { type: "open"; deletePending: false };

export type WaitingCount =
  | { type: "wait" }
  | { type: "stop"; message: string }
  | { type: "count"; count: number };

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseInstant(value: string): Date | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function sameAccount(left: AccountRef, right: AccountRef): boolean {
  return present(left.userId) && present(left.centerId) && left.userId === right.userId && left.centerId === right.centerId;
}

function sameClass(left: ClassRef, right: ClassRef): boolean {
  return (
    present(left.sectionId) &&
    present(left.classSessionId) &&
    left.sectionId === right.sectionId &&
    left.classSessionId === right.classSessionId
  );
}

function clocks(snapshot: AuthSnapshot, phoneNow: Date): { row: Parameters<typeof sessionVerdict>[0]; at: Date } | null {
  if (!present(snapshot.authSessionId)) return null;
  const serverIssue = parseInstant(snapshot.serverNowAtIssue);
  const phoneIssue = parseInstant(snapshot.phoneNowAtIssue);
  const lastSeenAt = parseInstant(snapshot.lastSeenAt);
  const expiresAt = parseInstant(snapshot.expiresAt);
  if (!serverIssue || !phoneIssue || !lastSeenAt || !expiresAt || Number.isNaN(phoneNow.getTime())) return null;
  let revokedAt: Date | null = null;
  if (snapshot.revokedAt !== null) {
    revokedAt = parseInstant(snapshot.revokedAt);
    if (!revokedAt) return null;
  }
  // Remove only the offset measured at load. A clock change after that is invisible.
  const at = new Date(phoneNow.getTime() - (phoneIssue.getTime() - serverIssue.getTime()));
  return { row: { revokedAt, lastSeenAt, expiresAt }, at };
}

export function assessSnapshot(snapshot: AuthSnapshot, viewer: AccountRef & ClassRef, phoneNow: Date): SnapshotDecision {
  const timed = clocks(snapshot, phoneNow);
  if (!timed) return { ok: false, reason: "invalid" };
  if (!sameAccount(snapshot, viewer)) return { ok: false, reason: "owner" };
  if (!sameClass(snapshot, viewer)) return { ok: false, reason: "scope" };
  const verdict = sessionVerdict(timed.row, timed.at);
  if (verdict !== "ok") return { ok: false, reason: verdict };
  return { ok: true };
}

function validItem(item: DeviceItem): boolean {
  return (
    present(item.id) &&
    present(item.userId) &&
    present(item.centerId) &&
    present(item.kind) &&
    present(item.summary) &&
    present(item.createdAt)
  );
}

function validRelease(release: DeviceRelease): boolean {
  return present(release.userId) && present(release.centerId) && present(release.lockId) && Number.isInteger(release.itemCount) && release.itemCount >= 0;
}

function validLock(lock: DeviceLock): boolean {
  return present(lock.lockId) && present(lock.userId) && present(lock.centerId);
}

/// Duplicate ids are one record. The same id claimed by two accounts is not
/// an empty queue: the whole read stops so the next person is not let in.
function checkedState(state: DeviceState): DeviceState | null {
  if (!state || !Array.isArray(state.items) || !Array.isArray(state.releases)) return null;
  if (state.lock !== null && !validLock(state.lock)) return null;
  const seen = new Map<string, DeviceItem>();
  for (const item of state.items) {
    if (!validItem(item)) return null;
    const previous = seen.get(item.id);
    if (previous && !sameAccount(previous, item)) return null;
    if (!previous) seen.set(item.id, item);
  }
  for (const release of state.releases) {
    if (!validRelease(release)) return null;
  }
  return { lock: state.lock, items: [...seen.values()], releases: state.releases };
}

function stop(message: string): Extract<SharedPhoneDecision, { type: "stop" }> {
  return { type: "stop", message, deletePending: false };
}

/// The existing shared-phone rules decide who may come in. A lock written
/// during sign-out also stores the server session id. The same id means the
/// server sign-in was never ended, including when that call failed offline.
/// The roster stays hidden until a different server session arrives. A lock
/// from the current app has no session id yet, and that lock still follows
/// today's rule: the same account may clear it.
export function decideSharedPhone(input: {
  stored: StoredDevice;
  nextUserId: string;
  nextCenterId: string;
  nextAuthSessionId: string | null;
  lockAuthSessionId: string | null;
}): SharedPhoneDecision {
  if (input.stored.status === "loading") return { type: "wait" };
  if (input.stored.status === "unavailable") return stop(UNREADABLE_RECORDS);
  if (!present(input.nextUserId) || !present(input.nextCenterId)) return stop(UNREADABLE_RECORDS);
  if (input.nextAuthSessionId !== null && !present(input.nextAuthSessionId)) return stop(UNREADABLE_RECORDS);
  if (input.lockAuthSessionId !== null && !present(input.lockAuthSessionId)) return stop(UNREADABLE_RECORDS);

  const state = checkedState(input.stored.state);
  if (!state) return stop(UNREADABLE_RECORDS);

  const lock = state.lock;
  const owner =
    lock !== null && sameAccount(lock, { userId: input.nextUserId, centerId: input.nextCenterId });
  const sameServerSession =
    input.lockAuthSessionId !== null &&
    (input.nextAuthSessionId === null || input.nextAuthSessionId === input.lockAuthSessionId);
  if (owner && sameServerSession) return { type: "stay-locked", deletePending: false };

  const admission = allowSignIn(state, { userId: input.nextUserId, centerId: input.nextCenterId });
  if (!admission.ok) return { type: "blocked", itemCount: admission.itemCount, deletePending: false };
  if (lock) return { type: "clear-lock", deletePending: false };
  return { type: "open", deletePending: false };
}

export function mayShowRoster(snapshot: SnapshotDecision, phone: SharedPhoneDecision): boolean {
  return snapshot.ok && phone.type === "open";
}

/// localStorage stays the backup. IndexedDB is used only after a verified copy
/// whose fingerprint still matches that backup. A pending copy, a mismatch,
/// or an unreadable backup stops the phone. Neither store is treated as empty.
export function decideQueueSource(input: {
  legacy: StoredDevice;
  importStatus: "none" | "pending" | "verified";
  legacyFingerprint: string | null;
  importedFingerprint: string | null;
}): QueueSource {
  if (input.importStatus === "pending") return { type: "stop", message: UNCHECKED_RECORDS };
  if (input.legacy.status === "loading") return { type: "wait" };
  if (input.legacy.status === "unavailable") return { type: "stop", message: UNREADABLE_RECORDS };
  if (input.importStatus === "none") return { type: "legacy" };
  if (!present(input.legacyFingerprint) || !present(input.importedFingerprint)) {
    return { type: "stop", message: UNREADABLE_RECORDS };
  }
  if (input.legacyFingerprint !== input.importedFingerprint) return { type: "stop", message: MISMATCHED_RECORDS };
  return { type: "indexed" };
}

function validPractice(row: PracticeRow): boolean {
  return present(row.id) && present(row.userId) && present(row.centerId) && present(row.createdAt);
}

function validEvent(row: LocalAttendanceRow): boolean {
  return (
    present(row.clientEventId) &&
    present(row.userId) &&
    present(row.centerId) &&
    present(row.queuedAt) &&
    (row.syncState === "pending" || row.syncState === "acknowledged")
  );
}

/// Practice rows and pending attendance events become one waiting list.
/// An acknowledged event is not waiting. The same id is one record. A broken
/// row fails the whole list so a bad read is not reported as zero waiting.
export function mergeWaitingItems(
  practice: PracticeRow[],
  events: LocalAttendanceRow[],
): { ok: true; items: DeviceItem[] } | { ok: false } {
  const items = new Map<string, DeviceItem>();
  for (const row of practice) {
    if (!validPractice(row)) return { ok: false };
    const previous = items.get(row.id);
    if (previous && !sameAccount(previous, row)) return { ok: false };
    if (previous) continue;
    items.set(row.id, {
      id: row.id,
      userId: row.userId,
      centerId: row.centerId,
      kind: "practice",
      summary: "Practice record. No personal details.",
      createdAt: row.createdAt,
    });
  }
  const seenEvents = new Map<string, AccountRef>();
  for (const row of events) {
    if (!validEvent(row)) return { ok: false };
    const previousEvent = seenEvents.get(row.clientEventId);
    if (previousEvent && !sameAccount(previousEvent, row)) return { ok: false };
    seenEvents.set(row.clientEventId, row);
    const previous = items.get(row.clientEventId);
    if (previous && !sameAccount(previous, row)) return { ok: false };
    // Already received by the server. It must not add a second waiting record,
    // and it must not erase a practice row that shares the id.
    if (row.syncState === "acknowledged") continue;
    items.set(row.clientEventId, {
      id: row.clientEventId,
      userId: row.userId,
      centerId: row.centerId,
      kind: "attendance",
      summary: "Attendance mark",
      createdAt: row.queuedAt,
    });
  }
  return { ok: true, items: [...items.values()] };
}

function countOwned(items: DeviceItem[], account: AccountRef): number {
  return items.filter((item) => sameAccount(item, account)).length;
}

export function waitingCountFromSource(input: {
  source: QueueSource;
  account: AccountRef;
  legacyPractice: PracticeRow[];
  indexedPractice: PracticeRow[];
  indexedEvents: LocalAttendanceRow[];
}): WaitingCount {
  if (input.source.type === "wait") return { type: "wait" };
  if (input.source.type === "stop") return { type: "stop", message: input.source.message };
  if (!present(input.account.userId) || !present(input.account.centerId)) {
    return { type: "stop", message: UNREADABLE_RECORDS };
  }
  // Before the copy is verified, indexed rows must not exist. Counting either
  // side alone could hide a record, and adding both would count a practice
  // record twice.
  if (input.source.type === "legacy" && (input.indexedPractice.length > 0 || input.indexedEvents.length > 0)) {
    return { type: "stop", message: MISMATCHED_RECORDS };
  }
  const merged =
    input.source.type === "legacy"
      ? mergeWaitingItems(input.legacyPractice, [])
      : mergeWaitingItems(input.indexedPractice, input.indexedEvents);
  if (!merged.ok) return { type: "stop", message: UNREADABLE_RECORDS };
  return { type: "count", count: countOwned(merged.items, input.account) };
}

export function decideMarkWrite(wrote: boolean): {
  confirmed: boolean;
  countChanges: boolean;
  deleteExisting: false;
  message: string;
} {
  if (!wrote) return { confirmed: false, countChanges: false, deleteExisting: false, message: MARK_FAILED };
  return { confirmed: true, countChanges: true, deleteExisting: false, message: MARK_SAVED };
}

/// The local lock is attempted first. The server is called only after that
/// write succeeds. A failed write hides the roster and claims neither a lock
/// nor a finished sign-out. Pending marks are never deleted here.
export function decideSignOut(lockWritten: boolean): {
  hideRoster: true;
  claimLocked: boolean;
  claimSignedOut: false;
  deletePending: false;
  mayCallServer: boolean;
  message: string;
} {
  if (!lockWritten) {
    return {
      hideRoster: true,
      claimLocked: false,
      claimSignedOut: false,
      deletePending: false,
      mayCallServer: false,
      message: LOCK_FAILED,
    };
  }
  return {
    hideRoster: true,
    claimLocked: true,
    claimSignedOut: false,
    deletePending: false,
    mayCallServer: true,
    message: LOCKED_WAITING,
  };
}

export function decideRevokeResult(input: { lockWritten: boolean; serverRevoked: boolean }): {
  hideRoster: true;
  claimLocked: boolean;
  claimSignedOut: boolean;
  deletePending: false;
  message: string;
} {
  if (!input.lockWritten) {
    return {
      hideRoster: true,
      claimLocked: false,
      claimSignedOut: false,
      deletePending: false,
      message: LOCK_FAILED,
    };
  }
  if (!input.serverRevoked) {
    return {
      hideRoster: true,
      claimLocked: true,
      claimSignedOut: false,
      deletePending: false,
      message: LOCKED_WAITING,
    };
  }
  return {
    hideRoster: true,
    claimLocked: true,
    claimSignedOut: true,
    deletePending: false,
    message: LOCKED_AND_SIGNED_OUT,
  };
}
