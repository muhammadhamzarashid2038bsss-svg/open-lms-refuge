// Attendance marks kept on the phone before a later stage can send them.
// IndexedDB is not encrypted. This file stores the class list, the class name,
// the mark already on the server, and the marks for one signed-in center account.
// It does not store a meeting link or a course title.
//
// A correction is a new row. The phone clock is stored as a note on the row
// and is never used to decide which correction is newest. The rising sequence
// number does that. A failed write is not sent to the server instead: a later
// stage sends only rows this phone has read back.

import { assessSnapshot, decideMarkWrite, type AccountRef, type AuthSnapshot, type ClassRef } from "./offline-decisions";
import {
  closeWorkingDatabase,
  localRequest,
  openWorkingDatabase,
  runLocalTransaction,
  type FutureAttendanceEvent,
} from "./local-db";
import {
  draftFromLearner,
  isAbsenceReason,
  isAttendanceStatus,
  normalizeAttendanceBatch,
  reasonAllowedFor,
  type AbsenceReasonName,
  type AttendanceLearnerRow,
  type AttendanceStatusName,
  type LearnerDraft,
  type MarkDraftInput,
} from "@/lib/lms/attendance";
import { browserStorageProbe, checkStorageReadiness, type StorageProbe, type StorageReadiness } from "./storage-readiness";

const SAVED_MESSAGE = decideMarkWrite(true).message;
const NOT_STORED = decideMarkWrite(false).message;
const UNAVAILABLE = "Local attendance saving is unavailable on this phone. The marks were not stored.";
const NO_ROOM = "This phone does not have enough free space. Local attendance saving is unavailable. The marks were not stored.";
const DENIED = "This phone did not allow saved data to stay. Local attendance saving is unavailable. The marks were not stored.";
const UNREADABLE = "This phone's saved attendance could not be read. It was not deleted, and these marks were not stored.";
const EXPIRED = "This sign-in is no longer valid for saving on this phone. The marks were not stored.";
const OTHER_ACCOUNT = "These marks belong to a different sign-in. They were not stored.";
const NO_SNAPSHOT = "Open this class while connected before saving on this phone. The marks were not stored.";
export const OUTDATED_SNAPSHOT = "Open this class again while connected before correcting attendance. The marks already on this phone were kept.";
/// Rows written by this version. The IndexedDB database stays at version 1.
export const SNAPSHOT_FORMAT = 1;
const NOT_ON_ROSTER = "That learner is not on the saved class list. The marks were not stored.";
const DUPLICATE = "This save id was already used for a different mark. It was not stored.";
const BAD_LINK = "The earlier attendance record could not be linked. The mark was not stored.";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTENDANCE_STORES = ["meta", "snapshots", "rosters", "events"] as const;

export type AuthorizedClock = {
  authSessionId: string;
  serverNow: string;
  lastSeenAt: string;
  expiresAt: string;
};

export type LocalRosterLearner = {
  learnerId: string;
  displayName: string;
  learnerCode: string;
  /// False means this row was saved before the server mark was kept.
  /// The nulls below are then unknown, not a genuinely unmarked learner.
  serverKnown: boolean;
  serverAttendanceRecordId: string | null;
  serverStatus: AttendanceStatusName | null;
  serverReasonCode: AbsenceReasonName | null;
};

export type LocalRoster = {
  id: string;
  centerId: string;
  userId: string;
  localDeviceId: string;
  sectionId: string;
  classSessionId: string;
  formatVersion: 1 | null;
  learners: LocalRosterLearner[];
};

export type StoredSnapshot = AuthSnapshot & {
  localDeviceId: string;
  formatVersion: 1 | null;
  sectionName: string | null;
  classTitle: string | null;
  whenLabel: string | null;
};

export type ServerMarkInput = {
  learnerId: string;
  displayName: string;
  learnerCode: string;
  serverAttendanceRecordId: string | null;
  serverStatus: AttendanceStatusName | null;
  serverReasonCode: AbsenceReasonName | null;
};

export type LocalAttendanceEvent = FutureAttendanceEvent & {
  status: AttendanceStatusName;
  reasonCode: AbsenceReasonName | null;
};

export type LocalMarkInput = MarkDraftInput & {
  serverEventId: string | null;
};

export type LocalSaveResult =
  | { ok: true; message: string; count: number; events: LocalAttendanceEvent[] }
  | { ok: false; message: string; count: null; unreadable: boolean };

export type LocalReadResult =
  | { ok: true; sessionEvents: LocalAttendanceEvent[]; pendingCount: number; roster: LocalRoster | null }
  | { ok: false; message: string; count: null; unreadable: true };

export type LocalStoreResult = { ok: true; localDeviceId: string } | { ok: false; message: string; unreadable: boolean };

type View = { sessionEvents: LocalAttendanceEvent[]; pendingCount: number; roster: LocalRoster | null };

class LocalStop extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalStop";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function owned(owner: AccountRef): boolean {
  return present(owner.userId) && present(owner.centerId);
}

export function attendanceRecordId(owner: AccountRef, sectionId: string, classSessionId: string): string {
  return `${owner.centerId}:${owner.userId}:${sectionId}:${classSessionId}`;
}

function sequenceKey(owner: AccountRef): string {
  return `sequence:${owner.centerId}:${owner.userId}`;
}

/// A new id for one attendance change. The time is kept on the row as a note.
/// The sequence number, not this clock, decides which correction is newest.
export function newLocalEventId(now = new Date()): { clientEventId: string; recordedAt: string } {
  return { clientEventId: crypto.randomUUID(), recordedAt: now.toISOString() };
}

function readinessMessage(readiness: StorageReadiness): string | null {
  if (readiness.mayClaimSaved) return null;
  if (readiness.estimate === "ready" && !readiness.enoughRoom) return NO_ROOM;
  if (readiness.persistence === "denied") return DENIED;
  return UNAVAILABLE;
}

function bytesFor(value: unknown): number {
  // estimate() does not reserve space. The extra bytes cover the index keys
  // stored beside the row. A later write can still fail, and that failure
  // must not be described as saved.
  return new TextEncoder().encode(JSON.stringify(value)).length + 1024;
}

function ownerRange(owner: AccountRef): IDBKeyRange {
  if (typeof IDBKeyRange === "undefined") throw new LocalStop(UNREADABLE);
  return IDBKeyRange.only([owner.centerId, owner.userId]);
}

function deviceIdOf(value: unknown): string | null | "bad" {
  if (value === undefined) return null;
  if (!isRecord(value) || value.key !== "device" || typeof value.localDeviceId !== "string") return "bad";
  if (!DEVICE_ID.test(value.localDeviceId)) return "bad";
  return value.localDeviceId;
}

function sequenceOf(value: unknown, owner: AccountRef): number | null | "bad" {
  if (value === undefined) return null;
  if (!isRecord(value) || value.key !== sequenceKey(owner)) return "bad";
  if (!Number.isInteger(value.next) || (value.next as number) < 1) return "bad";
  return value.next as number;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function labelText(value: unknown): string | null {
  if (!present(value)) return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 200) return null;
  return text;
}

function parseSnapshot(value: unknown): StoredSnapshot | null {
  if (!isRecord(value)) return null;
  const snapshot = {
    centerId: value.centerId,
    userId: value.userId,
    localDeviceId: value.localDeviceId,
    sectionId: value.sectionId,
    classSessionId: value.classSessionId,
    authSessionId: value.authSessionId,
    serverNowAtIssue: value.serverNowAtIssue,
    phoneNowAtIssue: value.phoneNowAtIssue,
    lastSeenAt: value.lastSeenAt,
    expiresAt: value.expiresAt,
    revokedAt: value.revokedAt === null ? null : value.revokedAt,
  };
  if (!present(snapshot.localDeviceId) || !DEVICE_ID.test(snapshot.localDeviceId)) return null;
  if (snapshot.revokedAt !== null && !present(snapshot.revokedAt)) return null;
  const text = Object.values(snapshot).every((item) => item === null || typeof item === "string");
  if (!text) return null;
  const sectionName = labelText(value.sectionName);
  const classTitle = labelText(value.classTitle);
  const whenLabel = labelText(value.whenLabel);
  const current = value.formatVersion === SNAPSHOT_FORMAT && sectionName !== null && classTitle !== null && whenLabel !== null;
  return {
    ...(snapshot as AuthSnapshot & { localDeviceId: string }),
    formatVersion: current ? SNAPSHOT_FORMAT : null,
    sectionName: current ? sectionName : null,
    classTitle: current ? classTitle : null,
    whenLabel: current ? whenLabel : null,
  };
}

function parseServerMark(value: Record<string, unknown>): Pick<LocalRosterLearner, "serverKnown" | "serverAttendanceRecordId" | "serverStatus" | "serverReasonCode"> | null {
  const keys = ["serverAttendanceRecordId", "serverStatus", "serverReasonCode"] as const;
  if (!keys.every((key) => hasOwn(value, key))) {
    return { serverKnown: false, serverAttendanceRecordId: null, serverStatus: null, serverReasonCode: null };
  }
  const serverAttendanceRecordId = value.serverAttendanceRecordId;
  const serverStatus = value.serverStatus;
  const serverReasonCode = value.serverReasonCode;
  if (serverAttendanceRecordId === null && serverStatus === null && serverReasonCode === null) {
    return { serverKnown: true, serverAttendanceRecordId: null, serverStatus: null, serverReasonCode: null };
  }
  if (typeof serverAttendanceRecordId !== "string" || !SAFE_ID.test(serverAttendanceRecordId)) return null;
  if (typeof serverStatus !== "string" || !isAttendanceStatus(serverStatus)) return null;
  if (serverReasonCode !== null && (typeof serverReasonCode !== "string" || !isAbsenceReason(serverReasonCode))) return null;
  if (serverReasonCode !== null && !reasonAllowedFor(serverStatus)) return null;
  return { serverKnown: true, serverAttendanceRecordId, serverStatus, serverReasonCode };
}

function parseLearner(value: unknown): LocalRosterLearner | null {
  if (!isRecord(value)) return null;
  if (!present(value.learnerId) || !present(value.displayName) || !present(value.learnerCode)) return null;
  const server = parseServerMark(value);
  if (!server) return null;
  return {
    learnerId: value.learnerId,
    displayName: value.displayName,
    learnerCode: value.learnerCode,
    ...server,
  };
}

function parseRoster(value: unknown): LocalRoster | null {
  if (!isRecord(value) || !Array.isArray(value.learners)) return null;
  const learners: LocalRosterLearner[] = [];
  for (const learner of value.learners) {
    const parsed = parseLearner(learner);
    if (!parsed) return null;
    learners.push(parsed);
  }
  const id = value.id;
  const centerId = value.centerId;
  const userId = value.userId;
  const localDeviceId = value.localDeviceId;
  const sectionId = value.sectionId;
  const classSessionId = value.classSessionId;
  if (!present(id) || !present(centerId) || !present(userId)) return null;
  if (!present(localDeviceId) || !DEVICE_ID.test(localDeviceId)) return null;
  if (!present(sectionId) || !present(classSessionId)) return null;
  const known = learners.length === 0 || learners.every((learner) => learner.serverKnown);
  const legacy = learners.every((learner) => !learner.serverKnown);
  if (!known && !legacy) return null;
  const formatVersion = value.formatVersion === SNAPSHOT_FORMAT && known ? SNAPSHOT_FORMAT : null;
  return { id, centerId, userId, localDeviceId, sectionId, classSessionId, learners, formatVersion };
}

function parseEvent(value: unknown): LocalAttendanceEvent | null {
  if (!isRecord(value)) return null;
  if (!present(value.clientEventId) || !SAFE_ID.test(value.clientEventId)) return null;
  if (!present(value.centerId) || !present(value.userId) || !present(value.sectionId)) return null;
  if (!present(value.classSessionId) || !present(value.learnerId) || !present(value.recordedAt)) return null;
  if (!present(value.localDeviceId) || !DEVICE_ID.test(value.localDeviceId)) return null;
  const status = String(value.status);
  if (!isAttendanceStatus(status)) return null;
  const reasonCode = value.reasonCode === null ? null : String(value.reasonCode);
  if (reasonCode !== null && !isAbsenceReason(reasonCode)) return null;
  if (!Number.isInteger(value.sequence) || (value.sequence as number) < 1) return null;
  if (value.correctsClientEventId !== null && !present(value.correctsClientEventId)) return null;
  if (value.correctsServerEventId !== null && !present(value.correctsServerEventId)) return null;
  if (value.correctsClientEventId !== null && value.correctsServerEventId !== null) return null;
  if (value.syncState !== "pending" && value.syncState !== "acknowledged") return null;
  return {
    clientEventId: value.clientEventId,
    centerId: value.centerId,
    userId: value.userId,
    localDeviceId: value.localDeviceId,
    sectionId: value.sectionId,
    classSessionId: value.classSessionId,
    learnerId: value.learnerId,
    status,
    reasonCode,
    recordedAt: value.recordedAt,
    sequence: value.sequence as number,
    correctsClientEventId: value.correctsClientEventId,
    correctsServerEventId: value.correctsServerEventId,
    syncState: value.syncState,
  };
}

function sameEvent(left: LocalAttendanceEvent, right: LocalAttendanceEvent): boolean {
  return (
    left.clientEventId === right.clientEventId &&
    left.centerId === right.centerId &&
    left.userId === right.userId &&
    left.localDeviceId === right.localDeviceId &&
    left.sectionId === right.sectionId &&
    left.classSessionId === right.classSessionId &&
    left.learnerId === right.learnerId &&
    left.status === right.status &&
    left.reasonCode === right.reasonCode &&
    left.recordedAt === right.recordedAt &&
    left.sequence === right.sequence &&
    left.correctsClientEventId === right.correctsClientEventId &&
    left.correctsServerEventId === right.correctsServerEventId &&
    left.syncState === right.syncState
  );
}

async function ownedValues(store: IDBObjectStore, owner: AccountRef): Promise<unknown[]> {
  const rows = await localRequest(store.index("byOwner").getAll(ownerRange(owner)));
  if (!Array.isArray(rows)) throw new LocalStop(UNREADABLE);
  for (const row of rows) {
    if (!isRecord(row) || row.centerId !== owner.centerId || row.userId !== owner.userId) throw new LocalStop(UNREADABLE);
  }
  return rows;
}

function eventsFrom(rows: unknown[]): LocalAttendanceEvent[] {
  const events: LocalAttendanceEvent[] = [];
  const sequences = new Set<number>();
  for (const row of rows) {
    const event = parseEvent(row);
    // A row that cannot be checked is not the same as an empty list.
    if (!event || sequences.has(event.sequence)) throw new LocalStop(UNREADABLE);
    sequences.add(event.sequence);
    events.push(event);
  }
  return events;
}

function viewFrom(events: LocalAttendanceEvent[], roster: LocalRoster | null, scope: ClassRef): View {
  const sessionEvents = events.filter(
    (event) => event.sectionId === scope.sectionId && event.classSessionId === scope.classSessionId,
  );
  return {
    sessionEvents,
    pendingCount: events.filter((event) => event.syncState === "pending").length,
    roster,
  };
}

async function readView(tx: IDBTransaction, owner: AccountRef, scope: ClassRef): Promise<View> {
  const events = eventsFrom(await ownedValues(tx.objectStore("events"), owner));
  const rosterRow = await localRequest(tx.objectStore("rosters").get(attendanceRecordId(owner, scope.sectionId, scope.classSessionId)));
  if (rosterRow === undefined) return viewFrom(events, null, scope);
  const roster = parseRoster(rosterRow);
  if (!roster || roster.centerId !== owner.centerId || roster.userId !== owner.userId) throw new LocalStop(UNREADABLE);
  if (roster.sectionId !== scope.sectionId || roster.classSessionId !== scope.classSessionId) throw new LocalStop(UNREADABLE);
  return viewFrom(events, roster, scope);
}

function refusal(error: unknown, fallback: string): { message: string; unreadable: boolean } {
  if (error instanceof LocalStop) {
    return { message: error.message, unreadable: error.message === UNREADABLE };
  }
  return { message: fallback, unreadable: true };
}

async function withDatabase<T>(factory: IDBFactory, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new LocalStop(UNREADABLE);
  try {
    return await run(opened.db);
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

function cleanLearners(input: ServerMarkInput[]): LocalRosterLearner[] | null {
  const learners: LocalRosterLearner[] = [];
  const seen = new Set<string>();
  for (const learner of input) {
    if (!learner || typeof learner.learnerId !== "string" || seen.has(learner.learnerId)) return null;
    const row = parseLearner(learner);
    if (!row?.serverKnown) return null;
    seen.add(row.learnerId);
    learners.push(row);
  }
  return learners;
}

function cleanLabels(input: { sectionName: string; classTitle: string; whenLabel: string }): Pick<StoredSnapshot, "formatVersion" | "sectionName" | "classTitle" | "whenLabel"> | null {
  const sectionName = labelText(input.sectionName);
  const classTitle = labelText(input.classTitle);
  const whenLabel = labelText(input.whenLabel);
  if (!sectionName || !classTitle || !whenLabel) return null;
  return { formatVersion: SNAPSHOT_FORMAT, sectionName, classTitle, whenLabel };
}

function storedLearner(learner: LocalRosterLearner) {
  return {
    learnerId: learner.learnerId,
    displayName: learner.displayName,
    learnerCode: learner.learnerCode,
    serverAttendanceRecordId: learner.serverAttendanceRecordId,
    serverStatus: learner.serverStatus,
    serverReasonCode: learner.serverReasonCode,
  };
}

function sameSnapshot(stored: StoredSnapshot, expected: StoredSnapshot): boolean {
  return (
    stored.centerId === expected.centerId &&
    stored.userId === expected.userId &&
    stored.localDeviceId === expected.localDeviceId &&
    stored.sectionId === expected.sectionId &&
    stored.classSessionId === expected.classSessionId &&
    stored.authSessionId === expected.authSessionId &&
    stored.serverNowAtIssue === expected.serverNowAtIssue &&
    stored.phoneNowAtIssue === expected.phoneNowAtIssue &&
    stored.lastSeenAt === expected.lastSeenAt &&
    stored.expiresAt === expected.expiresAt &&
    stored.revokedAt === expected.revokedAt &&
    stored.formatVersion === expected.formatVersion &&
    stored.sectionName === expected.sectionName &&
    stored.classTitle === expected.classTitle &&
    stored.whenLabel === expected.whenLabel
  );
}

function sameRoster(stored: LocalRoster, expected: LocalRoster): boolean {
  return (
    stored.id === expected.id &&
    stored.centerId === expected.centerId &&
    stored.userId === expected.userId &&
    stored.localDeviceId === expected.localDeviceId &&
    stored.sectionId === expected.sectionId &&
    stored.classSessionId === expected.classSessionId &&
    stored.formatVersion === expected.formatVersion &&
    JSON.stringify(stored.learners) === JSON.stringify(expected.learners)
  );
}

export function rosterReady(snapshot: StoredSnapshot, roster: LocalRoster): boolean {
  return snapshot.formatVersion === SNAPSHOT_FORMAT && roster.formatVersion === SNAPSHOT_FORMAT && roster.learners.every((learner) => learner.serverKnown);
}

function snapshotDecisionMessage(reason: string): string {
  if (reason === "owner") return OTHER_ACCOUNT;
  if (reason === "scope") return NO_SNAPSHOT;
  return EXPIRED;
}

export async function storeAuthorizedClass(input: {
  factory: IDBFactory;
  storage?: StorageProbe | null;
  owner: AccountRef;
  sectionId: string;
  classSessionId: string;
  sectionName: string;
  classTitle: string;
  whenLabel: string;
  clock: AuthorizedClock;
  learners: ServerMarkInput[];
  phoneNow: Date;
}): Promise<LocalStoreResult> {
  if (!owned(input.owner) || !present(input.sectionId) || !present(input.classSessionId)) {
    return { ok: false, message: NO_SNAPSHOT, unreadable: false };
  }
  const learners = cleanLearners(input.learners);
  const labels = cleanLabels(input);
  if (!learners || !labels || !present(input.clock.authSessionId)) return { ok: false, message: NO_SNAPSHOT, unreadable: false };
  const id = attendanceRecordId(input.owner, input.sectionId, input.classSessionId);
  const draftSnapshot: AuthSnapshot = {
    centerId: input.owner.centerId,
    userId: input.owner.userId,
    sectionId: input.sectionId,
    classSessionId: input.classSessionId,
    authSessionId: input.clock.authSessionId,
    serverNowAtIssue: input.clock.serverNow,
    phoneNowAtIssue: input.phoneNow.toISOString(),
    lastSeenAt: input.clock.lastSeenAt,
    expiresAt: input.clock.expiresAt,
    revokedAt: null,
  };
  const decision = assessSnapshot(draftSnapshot, { ...input.owner, sectionId: input.sectionId, classSessionId: input.classSessionId }, input.phoneNow);
  if (!decision.ok) return { ok: false, message: snapshotDecisionMessage(decision.reason), unreadable: false };

  const storage = input.storage === undefined ? browserStorageProbe() : input.storage;
  const readiness = await checkStorageReadiness(bytesFor({ id, learners }), storage);
  const blocked = readinessMessage(readiness);
  if (blocked) return { ok: false, message: blocked, unreadable: false };

  try {
    const localDeviceId = await withDatabase(input.factory, async (db) => {
      const written = await runLocalTransaction(db, ["meta", "snapshots", "rosters"], "readwrite", async (tx) => {
        const current = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (current === "bad") throw new LocalStop(UNREADABLE);
        const deviceId = current ?? crypto.randomUUID();
        const snapshot: StoredSnapshot = { ...draftSnapshot, localDeviceId: deviceId, ...labels };
        const roster = {
          id,
          centerId: input.owner.centerId,
          userId: input.owner.userId,
          localDeviceId: deviceId,
          sectionId: input.sectionId,
          classSessionId: input.classSessionId,
          formatVersion: SNAPSHOT_FORMAT,
          learners: learners.map(storedLearner),
        };
        if (current === null) {
          await localRequest(tx.objectStore("meta").put({ key: "device", localDeviceId: deviceId }));
        }
        await localRequest(tx.objectStore("snapshots").put({ ...snapshot, id }));
        await localRequest(tx.objectStore("rosters").put(roster));
        const storedSnapshot = parseSnapshot(await localRequest(tx.objectStore("snapshots").get(id)));
        const storedRoster = parseRoster(await localRequest(tx.objectStore("rosters").get(id)));
        const storedDevice = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        const expectedRoster = parseRoster(roster);
        if (!storedSnapshot || !storedRoster || !expectedRoster || storedDevice !== deviceId) throw new LocalStop(NOT_STORED);
        if (!sameSnapshot(storedSnapshot, snapshot) || !sameRoster(storedRoster, expectedRoster)) throw new LocalStop(NOT_STORED);
        return deviceId;
      });
      const confirmed = await runLocalTransaction(db, ["snapshots", "rosters", "meta"], "readonly", async (tx) => {
        const storedSnapshot = parseSnapshot(await localRequest(tx.objectStore("snapshots").get(id)));
        const storedRoster = parseRoster(await localRequest(tx.objectStore("rosters").get(id)));
        return storedSnapshot?.localDeviceId === written && storedRoster?.localDeviceId === written;
      });
      if (!confirmed) throw new LocalStop(NOT_STORED);
      return written;
    });
    return { ok: true, localDeviceId };
  } catch (error) {
    const failed = refusal(error, NOT_STORED);
    return { ok: false, message: failed.message, unreadable: failed.unreadable };
  }
}

function sameBody(existing: LocalAttendanceEvent, mark: { learnerId: string; status: AttendanceStatusName; reasonCode: AbsenceReasonName | null }, owner: AccountRef, scope: ClassRef): boolean {
  return (
    existing.learnerId === mark.learnerId &&
    existing.status === mark.status &&
    existing.reasonCode === mark.reasonCode &&
    existing.centerId === owner.centerId &&
    existing.userId === owner.userId &&
    existing.sectionId === scope.sectionId &&
    existing.classSessionId === scope.classSessionId
  );
}

function latestFor(events: LocalAttendanceEvent[], learnerId: string, scope: ClassRef): LocalAttendanceEvent | null {
  let best: LocalAttendanceEvent | null = null;
  for (const event of events) {
    if (event.learnerId !== learnerId || event.sectionId !== scope.sectionId || event.classSessionId !== scope.classSessionId) continue;
    if (!best || event.sequence > best.sequence) best = event;
  }
  return best;
}

export function effectiveLocalEvent(events: LocalAttendanceEvent[], learnerId: string): LocalAttendanceEvent | null {
  return events
    .filter((event) => event.learnerId === learnerId)
    .reduce<LocalAttendanceEvent | null>((best, event) => (!best || event.sequence > best.sequence ? event : best), null);
}

export function eventsInSequence(events: LocalAttendanceEvent[]): LocalAttendanceEvent[] {
  return [...events].sort((left, right) => left.sequence - right.sequence);
}

/// The sheet shows the newest sequence for each learner. Older rows stay in
/// the history list the caller already has.
export function applyLocalEvents(learners: AttendanceLearnerRow[], events: LocalAttendanceEvent[]): LearnerDraft[] {
  return learners.map((learner) => {
    const draft = draftFromLearner(learner);
    const latest = events
      .filter((event) => event.learnerId === learner.id)
      .reduce<LocalAttendanceEvent | null>((best, event) => (!best || event.sequence > best.sequence ? event : best), null);
    if (!latest) return draft;
    return {
      ...draft,
      status: latest.status,
      reasonCode: latest.reasonCode,
      saved: { eventId: latest.clientEventId, status: latest.status, reasonCode: latest.reasonCode },
      clientEventId: null,
      recordedAt: null,
    };
  });
}

export async function readLocalAttendance(
  factory: IDBFactory,
  owner: AccountRef,
  scope: ClassRef,
): Promise<LocalReadResult> {
  if (!owned(owner)) return { ok: false, message: UNREADABLE, count: null, unreadable: true };
  try {
    const view = await withDatabase(factory, (db) =>
      runLocalTransaction(db, ["events", "rosters"], "readonly", (tx) => readView(tx, owner, scope)),
    );
    return { ok: true, ...view };
  } catch (error) {
    const failed = refusal(error, UNREADABLE);
    return { ok: false, message: failed.message, count: null, unreadable: true };
  }
}

export async function saveLocalAttendance(input: {
  factory: IDBFactory;
  storage?: StorageProbe | null;
  owner: AccountRef;
  sectionId: string;
  classSessionId: string;
  marks: LocalMarkInput[];
  phoneNow: Date;
}): Promise<LocalSaveResult> {
  const scope = { sectionId: input.sectionId, classSessionId: input.classSessionId };
  if (!owned(input.owner) || !present(scope.sectionId) || !present(scope.classSessionId)) {
    return { ok: false, message: NO_SNAPSHOT, count: null, unreadable: false };
  }
  const normalized = normalizeAttendanceBatch(input.marks);
  if (!normalized.ok) return { ok: false, message: normalized.message, count: null, unreadable: false };
  const serverIds = new Map(input.marks.map((mark) => [mark.learnerId, mark.serverEventId]));

  const storage = input.storage === undefined ? browserStorageProbe() : input.storage;
  const readiness = await checkStorageReadiness(bytesFor(normalized.marks), storage);
  const blocked = readinessMessage(readiness);
  if (blocked) return { ok: false, message: blocked, count: null, unreadable: false };

  try {
    const view = await withDatabase(input.factory, async (db) => {
      const expected = await runLocalTransaction(db, ATTENDANCE_STORES, "readwrite", async (tx) => {
        const id = attendanceRecordId(input.owner, scope.sectionId, scope.classSessionId);
        const snapshot = parseSnapshot(await localRequest(tx.objectStore("snapshots").get(id)));
        if (!snapshot) throw new LocalStop(NO_SNAPSHOT);
        const decision = assessSnapshot(snapshot, { ...input.owner, ...scope }, input.phoneNow);
        if (!decision.ok) throw new LocalStop(snapshotDecisionMessage(decision.reason));
        const deviceId = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (deviceId === "bad" || deviceId === null || deviceId !== snapshot.localDeviceId) throw new LocalStop(UNREADABLE);
        const roster = parseRoster(await localRequest(tx.objectStore("rosters").get(id)));
        if (!roster || roster.centerId !== input.owner.centerId || roster.userId !== input.owner.userId) throw new LocalStop(UNREADABLE);
        if (roster.localDeviceId !== deviceId) throw new LocalStop(UNREADABLE);
        if (!rosterReady(snapshot, roster)) throw new LocalStop(OUTDATED_SNAPSHOT);
        const allowed = new Set(roster.learners.map((learner) => learner.learnerId));
        if (normalized.marks.some((mark) => !allowed.has(mark.learnerId))) throw new LocalStop(NOT_ON_ROSTER);

        const existing = eventsFrom(await ownedValues(tx.objectStore("events"), input.owner));
        const byId = new Map(existing.map((event) => [event.clientEventId, event]));
        const planned: LocalAttendanceEvent[] = [];
        const created: LocalAttendanceEvent[] = [];
        const storedNext = sequenceOf(await localRequest(tx.objectStore("meta").get(sequenceKey(input.owner))), input.owner);
        if (storedNext === "bad") throw new LocalStop(UNREADABLE);
        const highest = existing.reduce((max, event) => Math.max(max, event.sequence), 0);
        let sequence = Math.max(storedNext ?? 1, highest + 1);

        for (const mark of normalized.marks) {
          const current = byId.get(mark.clientEventId);
          if (current) {
            if (!sameBody(current, mark, input.owner, scope)) throw new LocalStop(DUPLICATE);
            planned.push(current);
            continue;
          }
          const baseline = roster.learners.find((learner) => learner.learnerId === mark.learnerId);
          if (!baseline?.serverKnown) throw new LocalStop(OUTDATED_SNAPSHOT);
          const serverEventId = serverIds.get(mark.learnerId) ?? null;
          // The saved class, not the button, names the original server row.
          if (serverEventId !== baseline.serverAttendanceRecordId) throw new LocalStop(BAD_LINK);
          const previous = latestFor(existing, mark.learnerId, scope);
          let correctsClientEventId: string | null = null;
          let correctsServerEventId: string | null = null;
          if (previous) correctsClientEventId = previous.clientEventId;
          else if (serverEventId !== null) correctsServerEventId = serverEventId;
          const event: LocalAttendanceEvent = {
            clientEventId: mark.clientEventId,
            centerId: input.owner.centerId,
            userId: input.owner.userId,
            localDeviceId: deviceId,
            sectionId: scope.sectionId,
            classSessionId: scope.classSessionId,
            learnerId: mark.learnerId,
            status: mark.status,
            reasonCode: mark.reasonCode,
            recordedAt: mark.recordedAt && !Number.isNaN(new Date(mark.recordedAt).getTime()) ? mark.recordedAt : input.phoneNow.toISOString(),
            sequence,
            correctsClientEventId,
            correctsServerEventId,
            syncState: "pending",
          };
          sequence += 1;
          planned.push(event);
          created.push(event);
          existing.push(event);
        }

        for (const event of created) {
          // add refuses an id that is already stored, so a retry cannot replace it.
          await localRequest(tx.objectStore("events").add(event));
        }
        if (created.length > 0) {
          await localRequest(tx.objectStore("meta").put({ key: sequenceKey(input.owner), next: sequence }));
        }
        for (const event of planned) {
          const stored = parseEvent(await localRequest(tx.objectStore("events").get(event.clientEventId)));
          if (!stored || !sameEvent(stored, event)) throw new LocalStop(NOT_STORED);
        }
        const confirmedNext = sequenceOf(await localRequest(tx.objectStore("meta").get(sequenceKey(input.owner))), input.owner);
        if (created.length > 0 && confirmedNext !== sequence) throw new LocalStop(NOT_STORED);
        return planned.map((event) => event.clientEventId);
      });

      const confirmed = await runLocalTransaction(db, ["events", "rosters"], "readonly", async (tx) => {
        const view = await readView(tx, input.owner, scope);
        const found = new Map(view.sessionEvents.map((event) => [event.clientEventId, event]));
        if (expected.some((clientEventId) => !found.has(clientEventId))) throw new LocalStop(NOT_STORED);
        return view;
      });
      return confirmed;
    });
    return { ok: true, message: SAVED_MESSAGE, count: view.pendingCount, events: view.sessionEvents };
  } catch (error) {
    const failed = refusal(error, NOT_STORED);
    return { ok: false, message: failed.message, count: null, unreadable: failed.unreadable };
  }
}

export type LocalCatalog =
  | {
      ok: true;
      deviceId: string | null;
      snapshots: (StoredSnapshot & { id: string })[];
      rosters: LocalRoster[];
      events: LocalAttendanceEvent[];
    }
  | { ok: false; message: string };

/// Reads every local attendance row. A row that cannot be checked fails the
/// whole read. It does not come back as an empty class list.
export async function readLocalCatalog(factory: IDBFactory): Promise<LocalCatalog> {
  try {
    return await withDatabase(factory, (db) =>
      runLocalTransaction(db, ["meta", "snapshots", "rosters", "events"], "readonly", async (tx) => {
        const device = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (device === "bad") throw new LocalStop(UNREADABLE);
        const snapshotRows = await localRequest(tx.objectStore("snapshots").getAll());
        const rosterRows = await localRequest(tx.objectStore("rosters").getAll());
        const eventRows = await localRequest(tx.objectStore("events").getAll());
        if (!Array.isArray(snapshotRows) || !Array.isArray(rosterRows) || !Array.isArray(eventRows)) {
          throw new LocalStop(UNREADABLE);
        }
        const snapshots: (StoredSnapshot & { id: string })[] = [];
        for (const row of snapshotRows) {
          const parsed = parseSnapshot(row);
          if (!parsed || !isRecord(row) || !present(row.id)) throw new LocalStop(UNREADABLE);
          snapshots.push({ ...parsed, id: String(row.id) });
        }
        const rosters: LocalRoster[] = [];
        for (const row of rosterRows) {
          const parsed = parseRoster(row);
          if (!parsed) throw new LocalStop(UNREADABLE);
          rosters.push(parsed);
        }
        const grouped = new Map<string, unknown[]>();
        for (const row of eventRows) {
          if (!isRecord(row) || !present(row.centerId) || !present(row.userId)) throw new LocalStop(UNREADABLE);
          const key = `${row.centerId}:${row.userId}`;
          const list = grouped.get(key) ?? [];
          list.push(row);
          grouped.set(key, list);
        }
        const events: LocalAttendanceEvent[] = [];
        for (const rows of grouped.values()) events.push(...eventsFrom(rows));
        return { ok: true, deviceId: device, snapshots, rosters, events };
      }),
    );
  } catch (error) {
    return { ok: false, message: refusal(error, UNREADABLE).message };
  }
}
