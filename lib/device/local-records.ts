// Grades and progress notes saved on the phone before they can be sent.
// IndexedDB is not encrypted. These rows live in their own stores so they are
// not mixed with attendance events or homework files.
//
// The phone's count for each record is stored here, not in memory, so a
// reload cannot reuse a count. The phone clock is kept as a label for people.
// It is not used to choose the count. A save is reported only after the
// storage check passes and the new row is read back.

import { decideMarkWrite } from "./offline-decisions";
import { closeWorkingDatabase, localRequest, openWorkingDatabase, runLocalTransaction } from "./local-db";
import { browserStorageProbe, checkStorageReadiness, type StorageProbe, type StorageReadiness } from "./storage-readiness";
import { canonicalPoints, SKILL_GAPS, type SkillGapName } from "@/lib/sync/record-batch";
import { canonicalVector, parseVersionVector, type VersionVector } from "@/lib/sync/version-vector";
import { isUuid } from "@/lib/lms/timetable";

const SAVED = decideMarkWrite(true).message;
const NOT_SAVED = "This edit was not saved on this phone.";
const NO_ROOM = "This phone does not have enough free space. This edit was not saved.";
const DENIED = "This phone did not allow saved data to stay. This edit was not saved.";
const UNAVAILABLE = "This phone cannot safely keep an offline edit. This edit was not saved.";
const UNREADABLE = "This phone's saved edits could not be read. Nothing was deleted, and this edit was not saved.";
const LOCKED = "This phone is locked for another sign-in. This edit was not saved.";
const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecordEntityType = "GRADE_ENTRY" | "PROGRESS_NOTE";
export type LocalSyncState = "pending" | "acknowledged" | "conflict" | "stale" | "rejected";

export type StoredGradeContent = {
  assignmentId: string;
  learnerId: string;
  points: string;
  academicNote: string | null;
};

export type StoredNoteContent = {
  sectionId: string;
  learnerId: string;
  body: string;
  skillGaps: SkillGapName[];
  customSkillLabel: string | null;
};

export type LocalRecordMutation = {
  clientMutationId: string;
  centerId: string;
  userId: string;
  localDeviceId: string;
  entityType: RecordEntityType;
  recordId: string;
  versionVector: VersionVector;
  deviceRecordedAt: string;
  createdOffline: boolean;
  content: StoredGradeContent | StoredNoteContent;
  syncState: LocalSyncState;
};

export type LocalRecordSaveResult =
  | { ok: true; message: string; mutation: LocalRecordMutation }
  | { ok: false; message: string };

type Owner = { centerId: string; userId: string };

type CounterRow = {
  id: string;
  centerId: string;
  userId: string;
  localDeviceId: string;
  entityType: RecordEntityType;
  recordId: string;
  lastCounter: number;
};

export type LocalSaveOptions = {
  storage?: StorageProbe | null;
  /// Tests use this to pretend the read-back returned something else.
  readback?: (value: unknown) => unknown;
  now?: Date;
};

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

function bytesFor(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length + 1024;
}

function readinessMessage(readiness: StorageReadiness): string | null {
  if (readiness.mayClaimSaved) return null;
  if (readiness.estimate === "ready" && !readiness.enoughRoom) return NO_ROOM;
  if (readiness.persistence === "denied") return DENIED;
  return UNAVAILABLE;
}

function deviceIdOf(value: unknown): string | null | "bad" {
  if (value === undefined) return null;
  if (!isRecord(value) || value.key !== "device" || typeof value.localDeviceId !== "string") return "bad";
  if (!DEVICE_ID.test(value.localDeviceId)) return "bad";
  return value.localDeviceId.toLowerCase();
}

function lockBlocks(value: unknown, owner: Owner): boolean | "bad" {
  if (value === undefined) return false;
  if (!isRecord(value) || value.key !== "current" || !("lock" in value)) return "bad";
  if (value.lock === null) return false;
  if (!isRecord(value.lock) || typeof value.lock.userId !== "string" || typeof value.lock.centerId !== "string") return "bad";
  return value.lock.userId !== owner.userId || value.lock.centerId !== owner.centerId;
}

function parseVector(value: unknown): VersionVector | null {
  const parsed = parseVersionVector(value ?? {});
  return parsed ? canonicalVector(parsed) : null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseMutation(value: unknown): LocalRecordMutation | null {
  if (!isRecord(value)) return null;
  if (!present(value.clientMutationId) || !present(value.centerId) || !present(value.userId) || !present(value.localDeviceId)) return null;
  if (value.entityType !== "GRADE_ENTRY" && value.entityType !== "PROGRESS_NOTE") return null;
  if (typeof value.recordId !== "string" || !isUuid(value.recordId)) return null;
  const versionVector = parseVector(value.versionVector);
  if (!versionVector || typeof value.deviceRecordedAt !== "string" || typeof value.createdOffline !== "boolean") return null;
  if (!["pending", "acknowledged", "conflict", "stale", "rejected"].includes(String(value.syncState))) return null;
  if (!isRecord(value.content)) return null;
  return {
    clientMutationId: value.clientMutationId,
    centerId: value.centerId,
    userId: value.userId,
    localDeviceId: value.localDeviceId.toLowerCase(),
    entityType: value.entityType,
    recordId: value.recordId.toLowerCase(),
    versionVector,
    deviceRecordedAt: value.deviceRecordedAt,
    createdOffline: value.createdOffline,
    content: value.content as LocalRecordMutation["content"],
    syncState: value.syncState as LocalSyncState,
  };
}

async function withDb<T>(factory: IDBFactory, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new LocalStop(UNAVAILABLE);
  try {
    return await run(opened.db);
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

async function rowsForRecord(
  store: IDBObjectStore,
  owner: Owner,
  deviceId: string,
  entityType: RecordEntityType,
  recordId: string,
): Promise<LocalRecordMutation[]> {
  const rows = await localRequest(store.index("byRecord").getAll(IDBKeyRange.only([owner.centerId, owner.userId, deviceId, entityType, recordId])));
  if (!Array.isArray(rows)) throw new LocalStop(UNREADABLE);
  return rows.map((row) => {
    const parsed = parseMutation(row);
    if (!parsed) throw new LocalStop(UNREADABLE);
    return parsed;
  });
}

function pendingBase(mutations: LocalRecordMutation[], deviceId: string): VersionVector | null {
  let best: LocalRecordMutation | null = null;
  let bestCount = -1;
  for (const mutation of mutations) {
    if (mutation.syncState !== "pending") continue;
    const count = mutation.versionVector[deviceId] ?? 0;
    if (count >= bestCount) {
      best = mutation;
      bestCount = count;
    }
  }
  return best ? best.versionVector : null;
}

type EditDraft = {
  entityType: RecordEntityType;
  content: LocalRecordMutation["content"];
  baseVector: VersionVector;
  createdOffline: boolean;
  deviceRecordedAt: string;
  counterId: (deviceId: string) => string;
  recordId: (deviceId: string, existing: CounterRow | null) => string;
};

async function writeEdit(factory: IDBFactory, owner: Owner, draft: EditDraft, options: LocalSaveOptions): Promise<LocalRecordSaveResult> {
  if (!present(owner.centerId) || !present(owner.userId)) return { ok: false, message: NOT_SAVED };
  const storage = options.storage === undefined ? browserStorageProbe() : options.storage;
  const readiness = await checkStorageReadiness(bytesFor(draft.content), storage);
  const blocked = readinessMessage(readiness);
  if (blocked) return { ok: false, message: blocked };

  try {
    const mutation = await withDb(factory, async (db) => {
      const written = await runLocalTransaction(db, ["meta", "deviceLock", "recordMutations", "recordCounters"], "readwrite", async (tx) => {
        const locked = lockBlocks(await localRequest(tx.objectStore("deviceLock").get("current")), owner);
        if (locked === "bad") throw new LocalStop(UNREADABLE);
        if (locked) throw new LocalStop(LOCKED);
        const currentDevice = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (currentDevice === "bad") throw new LocalStop(UNREADABLE);
        const deviceId = currentDevice ?? crypto.randomUUID();
        if (currentDevice === null) await localRequest(tx.objectStore("meta").put({ key: "device", localDeviceId: deviceId }));

        const counterId = draft.counterId(deviceId);
        const counters = tx.objectStore("recordCounters");
        const existingRaw = await localRequest(counters.get(counterId));
        let existing: CounterRow | null = null;
        if (existingRaw !== undefined) {
          if (
            !isRecord(existingRaw) ||
            existingRaw.centerId !== owner.centerId ||
            existingRaw.userId !== owner.userId ||
            existingRaw.localDeviceId !== deviceId ||
            typeof existingRaw.lastCounter !== "number" ||
            !Number.isSafeInteger(existingRaw.lastCounter) ||
            existingRaw.lastCounter < 0 ||
            typeof existingRaw.recordId !== "string"
          ) {
            throw new LocalStop(UNREADABLE);
          }
          existing = existingRaw as CounterRow;
        }
        const recordId = draft.recordId(deviceId, existing);
        if (!isUuid(recordId)) throw new LocalStop(NOT_SAVED);
        const base = pendingBase(await rowsForRecord(tx.objectStore("recordMutations"), owner, deviceId, draft.entityType, recordId), deviceId) ?? draft.baseVector;
        const next = Math.max(existing?.lastCounter ?? 0, base[deviceId] ?? 0) + 1;
        if (!Number.isSafeInteger(next)) throw new LocalStop(NOT_SAVED);
        const row: LocalRecordMutation = {
          clientMutationId: crypto.randomUUID(),
          centerId: owner.centerId,
          userId: owner.userId,
          localDeviceId: deviceId,
          entityType: draft.entityType,
          recordId,
          versionVector: canonicalVector({ ...base, [deviceId]: next }),
          deviceRecordedAt: draft.deviceRecordedAt,
          createdOffline: draft.createdOffline,
          content: draft.content,
          syncState: "pending",
        };
        const counterRow: CounterRow = {
          id: counterId,
          centerId: owner.centerId,
          userId: owner.userId,
          localDeviceId: deviceId,
          entityType: draft.entityType,
          recordId,
          lastCounter: next,
        };
        await localRequest(tx.objectStore("recordMutations").put(row));
        await localRequest(counters.put(counterRow));
        const seen = options.readback
          ? options.readback(await localRequest(tx.objectStore("recordMutations").get(row.clientMutationId)))
          : await localRequest(tx.objectStore("recordMutations").get(row.clientMutationId));
        const seenCounter = await localRequest(counters.get(counterId));
        if (!sameJson(seen, row) || !sameJson(seenCounter, counterRow)) throw new LocalStop(NOT_SAVED);
        return row;
      });
      const confirmed = await runLocalTransaction(db, ["recordMutations"], "readonly", async (tx) =>
        sameJson(await localRequest(tx.objectStore("recordMutations").get(written.clientMutationId)), written),
      );
      if (!confirmed) throw new LocalStop(NOT_SAVED);
      return written;
    });
    return { ok: true, message: SAVED, mutation };
  } catch (error) {
    if (error instanceof LocalStop) return { ok: false, message: error.message };
    return { ok: false, message: NOT_SAVED };
  }
}

function owned(owner: Owner): boolean {
  return present(owner.centerId) && present(owner.userId);
}

export async function saveLocalGrade(
  factory: IDBFactory,
  owner: Owner,
  input: {
    assignmentId: string;
    learnerId: string;
    points: string;
    academicNote: string | null;
    recordId?: string | null;
    baseVector?: unknown;
  },
  options: LocalSaveOptions = {},
): Promise<LocalRecordSaveResult> {
  if (!owned(owner) || !isUuid(input.assignmentId) || !isUuid(input.learnerId)) return { ok: false, message: NOT_SAVED };
  const points = canonicalPoints(input.points);
  const note = input.academicNote?.trim() ?? "";
  if (!points || note.length > 500) return { ok: false, message: NOT_SAVED };
  const baseVector = parseVector(input.baseVector ?? {});
  if (!baseVector) return { ok: false, message: NOT_SAVED };
  const assignmentId = input.assignmentId.toLowerCase();
  const learnerId = input.learnerId.toLowerCase();
  const requestedId = input.recordId && isUuid(input.recordId) ? input.recordId.toLowerCase() : null;
  return writeEdit(
    factory,
    owner,
    {
      entityType: "GRADE_ENTRY",
      content: { assignmentId, learnerId, points, academicNote: note.length > 0 ? note : null },
      baseVector,
      createdOffline: true,
      deviceRecordedAt: (options.now ?? new Date()).toISOString(),
      counterId: (deviceId) => `grade:${owner.centerId}:${owner.userId}:${deviceId}:${assignmentId}:${learnerId}`,
      recordId: (_deviceId, existing) => (existing && isUuid(existing.recordId) ? existing.recordId : requestedId ?? crypto.randomUUID()),
    },
    options,
  );
}

export async function saveLocalNote(
  factory: IDBFactory,
  owner: Owner,
  input: {
    sectionId: string;
    learnerId: string;
    body: string;
    skillGaps: string[];
    customSkillLabel: string | null;
    recordId?: string | null;
    baseVector?: unknown;
  },
  options: LocalSaveOptions = {},
): Promise<LocalRecordSaveResult> {
  if (!owned(owner) || !isUuid(input.sectionId) || !isUuid(input.learnerId)) return { ok: false, message: NOT_SAVED };
  const body = input.body.trim();
  const label = input.customSkillLabel?.trim() ?? "";
  if (body.length < 1 || body.length > 2000 || label.length > 80) return { ok: false, message: NOT_SAVED };
  if (input.skillGaps.length > SKILL_GAPS.length || input.skillGaps.some((gap, index) => !SKILL_GAPS.includes(gap as SkillGapName) || input.skillGaps.indexOf(gap) !== index)) {
    return { ok: false, message: NOT_SAVED };
  }
  const skillGaps = [...input.skillGaps].sort() as SkillGapName[];
  const customSkillLabel = label.length > 0 ? label : null;
  if (skillGaps.includes("CUSTOM") !== (customSkillLabel !== null)) return { ok: false, message: NOT_SAVED };
  const baseVector = parseVector(input.baseVector ?? {});
  if (!baseVector) return { ok: false, message: NOT_SAVED };
  const requestedId = input.recordId && isUuid(input.recordId) ? input.recordId.toLowerCase() : crypto.randomUUID();
  return writeEdit(
    factory,
    owner,
    {
      entityType: "PROGRESS_NOTE",
      content: {
        sectionId: input.sectionId.toLowerCase(),
        learnerId: input.learnerId.toLowerCase(),
        body,
        skillGaps,
        customSkillLabel,
      },
      baseVector,
      createdOffline: true,
      deviceRecordedAt: (options.now ?? new Date()).toISOString(),
      counterId: (deviceId) => `note:${owner.centerId}:${owner.userId}:${deviceId}:${requestedId}`,
      recordId: (_deviceId, existing) => (existing && isUuid(existing.recordId) ? existing.recordId : requestedId),
    },
    options,
  );
}

export async function listLocalRecords(factory: IDBFactory, owner: Owner): Promise<{ ok: true; deviceId: string | null; mutations: LocalRecordMutation[] } | { ok: false; message: string }> {
  if (!owned(owner)) return { ok: false, message: UNREADABLE };
  try {
    return await withDb(factory, async (db) => {
      return runLocalTransaction(db, ["meta", "deviceLock", "recordMutations"], "readonly", async (tx) => {
        const locked = lockBlocks(await localRequest(tx.objectStore("deviceLock").get("current")), owner);
        if (locked === "bad") throw new LocalStop(UNREADABLE);
        const deviceId = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (deviceId === "bad") throw new LocalStop(UNREADABLE);
        if (locked || !deviceId) return { ok: true as const, deviceId, mutations: [] };
        const rows = await localRequest(tx.objectStore("recordMutations").index("byOwner").getAll(IDBKeyRange.only([owner.centerId, owner.userId, deviceId])));
        if (!Array.isArray(rows)) throw new LocalStop(UNREADABLE);
        const mutations: LocalRecordMutation[] = [];
        for (const row of rows) {
          const parsed = parseMutation(row);
          if (!parsed || parsed.centerId !== owner.centerId || parsed.userId !== owner.userId || parsed.localDeviceId !== deviceId) {
            throw new LocalStop(UNREADABLE);
          }
          mutations.push(parsed);
        }
        return { ok: true as const, deviceId, mutations };
      });
    });
  } catch (error) {
    if (error instanceof LocalStop) return { ok: false, message: error.message };
    return { ok: false, message: UNREADABLE };
  }
}

export async function markLocalRecords(
  factory: IDBFactory,
  owner: Owner,
  updates: { clientMutationId: string; syncState: LocalSyncState }[],
): Promise<boolean> {
  if (!owned(owner) || updates.length === 0) return updates.length === 0;
  try {
    await withDb(factory, async (db) => {
      await runLocalTransaction(db, ["recordMutations"], "readwrite", async (tx) => {
        for (const update of updates) {
          const stored = parseMutation(await localRequest(tx.objectStore("recordMutations").get(update.clientMutationId)));
          if (!stored || stored.centerId !== owner.centerId || stored.userId !== owner.userId) throw new LocalStop(UNREADABLE);
          const next = { ...stored, syncState: update.syncState };
          await localRequest(tx.objectStore("recordMutations").put(next));
          const seen = parseMutation(await localRequest(tx.objectStore("recordMutations").get(update.clientMutationId)));
          if (!seen || seen.syncState !== update.syncState) throw new LocalStop(NOT_SAVED);
        }
      });
      return true;
    });
    return true;
  } catch {
    return false;
  }
}

/// Reads the phone's saved name. Creates one only when storage can keep it.
/// A failure here is not described as a saved grade or note.
export async function readOrCreateLocalDeviceId(
  factory: IDBFactory,
  storage?: StorageProbe | null,
): Promise<{ ok: true; deviceId: string } | { ok: false; message: string }> {
  try {
    const existing = await withDb(factory, async (db) =>
      runLocalTransaction(db, ["meta"], "readonly", async (tx) => deviceIdOf(await localRequest(tx.objectStore("meta").get("device")))),
    );
    if (existing === "bad") return { ok: false, message: UNREADABLE };
    if (existing) return { ok: true, deviceId: existing };
  } catch (error) {
    if (error instanceof LocalStop) return { ok: false, message: error.message };
    return { ok: false, message: UNAVAILABLE };
  }
  const readiness = await checkStorageReadiness(128, storage === undefined ? browserStorageProbe() : storage);
  const blocked = readinessMessage(readiness);
  if (blocked) return { ok: false, message: blocked };
  try {
    const deviceId = await withDb(factory, async (db) =>
      runLocalTransaction(db, ["meta"], "readwrite", async (tx) => {
        const current = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (current === "bad") throw new LocalStop(UNREADABLE);
        const id = current ?? crypto.randomUUID();
        if (current === null) await localRequest(tx.objectStore("meta").put({ key: "device", localDeviceId: id }));
        const seen = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (seen !== id) throw new LocalStop(NOT_SAVED);
        return id;
      }),
    );
    return { ok: true, deviceId };
  } catch (error) {
    if (error instanceof LocalStop) return { ok: false, message: error.message };
    return { ok: false, message: NOT_SAVED };
  }
}
