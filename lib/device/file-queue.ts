// Homework files saved on the phone. They are not attendance events and they
// are not grade edits. The Blob stays until the server says the file is stored.
// IndexedDB is not encrypted. Logout does not delete these rows.

import { closeWorkingDatabase, localRequest, openWorkingDatabase, runLocalTransaction } from "./local-db";
import { checkStorageReadiness, type StorageProbe } from "./storage-readiness";
import { isUuid } from "@/lib/lms/timetable";
import type { AllowedSubmissionMime } from "@/lib/storage/file-rules";
import { isAllowedMime } from "@/lib/storage/file-rules";

export type FileQueueStatus = "queued" | "uploading" | "awaiting_confirmation" | "failed" | "submitted";

export type FileQueueRecord = {
  clientSubmissionId: string;
  centerId: string;
  userId: string;
  learnerId: string;
  assignmentId: string;
  sectionId: string;
  localDeviceId: string;
  displayFilename: string;
  mimeType: AllowedSubmissionMime;
  byteSize: number;
  checksumSha256: string;
  blob: Blob | null;
  status: FileQueueStatus;
  lastError: string | null;
  serverSubmissionId: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
};

export type FileOwner = { centerId: string; userId: string; learnerId: string };

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,80}$/;

const KEPT = "This file is on this phone, waiting to send.";
const KEPT_WARNING = "This file is on this phone, waiting to send. This browser did not promise to keep it.";
const NO_ROOM = "This phone does not have enough free space for this file. It was not saved.";
const UNMEASURED = "This phone could not measure its free space. The file was not saved.";
const LOCKED = "This phone is locked for another account. The file was not saved.";
const UNREADABLE = "This phone's saved files could not be read. They were not deleted.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deviceIdOf(value: unknown): string | null | "bad" {
  if (value === undefined) return null;
  if (!isRecord(value) || value.key !== "device" || typeof value.localDeviceId !== "string") return "bad";
  if (!DEVICE_ID.test(value.localDeviceId) || !isUuid(value.localDeviceId)) return "bad";
  return value.localDeviceId.toLowerCase();
}

function lockBlocks(value: unknown, owner: FileOwner): boolean | "bad" {
  if (value === undefined) return false;
  if (!isRecord(value) || value.key !== "current" || !("lock" in value)) return "bad";
  if (value.lock === null) return false;
  if (!isRecord(value.lock) || typeof value.lock.userId !== "string" || typeof value.lock.centerId !== "string") return "bad";
  return value.lock.userId !== owner.userId || value.lock.centerId !== owner.centerId;
}

function parseRow(value: unknown): FileQueueRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.clientSubmissionId !== "string" || !CLIENT_ID.test(value.clientSubmissionId)) return null;
  if (!isUuid(String(value.assignmentId)) || !isUuid(String(value.sectionId)) || !isUuid(String(value.learnerId))) return null;
  if (!isUuid(String(value.localDeviceId))) return null;
  if (typeof value.mimeType !== "string" || !isAllowedMime(value.mimeType)) return null;
  if (typeof value.byteSize !== "number" || !Number.isSafeInteger(value.byteSize) || value.byteSize < 1) return null;
  if (typeof value.checksumSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.checksumSha256)) return null;
  const status = value.status;
  if (status !== "queued" && status !== "uploading" && status !== "awaiting_confirmation" && status !== "failed" && status !== "submitted") return null;
  if (value.blob !== null && !(value.blob instanceof Blob)) return null;
  return {
    clientSubmissionId: value.clientSubmissionId,
    centerId: String(value.centerId),
    userId: String(value.userId),
    learnerId: String(value.learnerId).toLowerCase(),
    assignmentId: String(value.assignmentId).toLowerCase(),
    sectionId: String(value.sectionId).toLowerCase(),
    localDeviceId: String(value.localDeviceId).toLowerCase(),
    displayFilename: typeof value.displayFilename === "string" ? value.displayFilename.slice(0, 120) : "homework",
    mimeType: value.mimeType,
    byteSize: value.byteSize,
    checksumSha256: value.checksumSha256,
    blob: value.blob,
    status,
    lastError: typeof value.lastError === "string" ? value.lastError : null,
    serverSubmissionId: typeof value.serverSubmissionId === "string" && isUuid(value.serverSubmissionId) ? value.serverSubmissionId.toLowerCase() : null,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
    lastAttemptAt: typeof value.lastAttemptAt === "string" ? value.lastAttemptAt : null,
  };
}

async function withDb<T>(factory: IDBFactory, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new Error("unavailable");
  try {
    return await run(opened.db);
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

async function ensureDevice(factory: IDBFactory, storage: StorageProbe | null, bytesNeeded: number): Promise<{ ok: true; deviceId: string } | { ok: false; message: string }> {
  const readiness = await checkStorageReadiness(bytesNeeded, storage);
  if (readiness.estimate !== "ready") return { ok: false, message: UNMEASURED };
  if (!readiness.enoughRoom) return { ok: false, message: NO_ROOM };
  try {
    const deviceId = await withDb(factory, (db) =>
      runLocalTransaction(db, ["meta"], "readwrite", async (tx) => {
        const current = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (current === "bad") throw new Error("bad device");
        const id = current ?? crypto.randomUUID();
        if (current === null) await localRequest(tx.objectStore("meta").put({ key: "device", localDeviceId: id }));
        const seen = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (seen !== id) throw new Error("bad device");
        return id;
      }),
    );
    return { ok: true, deviceId };
  } catch {
    return { ok: false, message: UNREADABLE };
  }
}

export async function listQueuedFiles(
  factory: IDBFactory,
  owner: FileOwner,
): Promise<{ ok: true; deviceId: string | null; files: FileQueueRecord[] } | { ok: false; message: string }> {
  try {
    return await withDb(factory, (db) =>
      runLocalTransaction(db, ["fileQueue", "deviceLock", "meta"], "readonly", async (tx) => {
        const locked = lockBlocks(await localRequest(tx.objectStore("deviceLock").get("current")), owner);
        if (locked === "bad") return { ok: false as const, message: UNREADABLE };
        if (locked) return { ok: true as const, deviceId: null, files: [] };
        const deviceId = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (deviceId === "bad") return { ok: false as const, message: UNREADABLE };
        if (!deviceId) return { ok: true as const, deviceId: null, files: [] };
        const rows = await localRequest(tx.objectStore("fileQueue").index("byOwner").getAll(IDBKeyRange.only([owner.centerId, owner.userId, deviceId])));
        const files = rows.flatMap((row) => {
          const parsed = parseRow(row);
          if (!parsed || parsed.learnerId !== owner.learnerId || parsed.centerId !== owner.centerId || parsed.userId !== owner.userId) return [];
          return [parsed];
        });
        return { ok: true as const, deviceId, files };
      }),
    );
  } catch {
    return { ok: false, message: UNREADABLE };
  }
}

export async function queueHomeworkFile(
  factory: IDBFactory,
  owner: FileOwner,
  input: {
    assignmentId: string;
    sectionId: string;
    displayFilename: string;
    mimeType: AllowedSubmissionMime;
    checksumSha256: string;
    bytes: Uint8Array;
  },
  storage: StorageProbe | null,
): Promise<{ ok: true; file: FileQueueRecord; message: string } | { ok: false; message: string }> {
  if (!isUuid(input.assignmentId) || !isUuid(input.sectionId) || !isUuid(owner.learnerId)) return { ok: false, message: UNREADABLE };
  if (!/^[0-9a-f]{64}$/.test(input.checksumSha256)) return { ok: false, message: UNREADABLE };
  // A copied buffer is a plain Blob part. The original view may sit on a
  // shared buffer, which the Blob constructor refuses.
  const copy = new Uint8Array(new ArrayBuffer(input.bytes.byteLength));
  copy.set(input.bytes);
  const blob = new Blob([copy], { type: input.mimeType });
  const room = await ensureDevice(factory, storage, blob.size + 4096);
  if (!room.ok) return room;
  const readiness = await checkStorageReadiness(blob.size + 4096, storage);
  const warned = readiness.readyForWrite && !readiness.mayClaimSaved;
  try {
    const file = await withDb(factory, (db) =>
      runLocalTransaction(db, ["fileQueue", "deviceLock"], "readwrite", async (tx) => {
        const locked = lockBlocks(await localRequest(tx.objectStore("deviceLock").get("current")), owner);
        if (locked === "bad") throw new Error("bad lock");
        if (locked) throw new Error("locked");
        const store = tx.objectStore("fileQueue");
        const existing = await localRequest(store.index("byAssignment").getAll(IDBKeyRange.only([owner.centerId, owner.userId, owner.learnerId, input.assignmentId.toLowerCase()])));
        const parsed = existing.flatMap((row) => {
          const item = parseRow(row);
          return item && item.localDeviceId === room.deviceId ? [item] : [];
        });
        const same = parsed.find((item) => item.checksumSha256 === input.checksumSha256 && item.status !== "submitted");
        const clientSubmissionId = same?.clientSubmissionId ?? `file-${crypto.randomUUID()}`;
        for (const item of parsed) {
          if (item.clientSubmissionId !== clientSubmissionId && item.status !== "submitted") await localRequest(store.delete(item.clientSubmissionId));
        }
        const row: FileQueueRecord = {
          clientSubmissionId,
          centerId: owner.centerId,
          userId: owner.userId,
          learnerId: owner.learnerId.toLowerCase(),
          assignmentId: input.assignmentId.toLowerCase(),
          sectionId: input.sectionId.toLowerCase(),
          localDeviceId: room.deviceId,
          displayFilename: input.displayFilename.slice(0, 120) || "homework",
          mimeType: input.mimeType,
          byteSize: blob.size,
          checksumSha256: input.checksumSha256,
          blob,
          status: "queued",
          lastError: null,
          serverSubmissionId: same?.serverSubmissionId ?? null,
          createdAt: same?.createdAt ?? new Date().toISOString(),
          lastAttemptAt: null,
        };
        await localRequest(store.put(row));
        const seen = parseRow(await localRequest(store.get(clientSubmissionId)));
        if (!seen || seen.checksumSha256 !== row.checksumSha256 || seen.blob?.size !== blob.size) throw new Error("mismatch");
        return seen;
      }),
    );
    return { ok: true, file, message: warned ? KEPT_WARNING : KEPT };
  } catch (error) {
    if (error instanceof Error && error.message === "locked") return { ok: false, message: LOCKED };
    if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")) {
      return { ok: false, message: NO_ROOM };
    }
    return { ok: false, message: UNREADABLE };
  }
}

export async function updateQueuedFile(
  factory: IDBFactory,
  owner: FileOwner,
  clientSubmissionId: string,
  patch: Partial<Pick<FileQueueRecord, "status" | "lastError" | "serverSubmissionId" | "lastAttemptAt" | "blob">>,
): Promise<boolean> {
  try {
    return await withDb(factory, (db) =>
      runLocalTransaction(db, ["fileQueue", "deviceLock", "meta"], "readwrite", async (tx) => {
        const locked = lockBlocks(await localRequest(tx.objectStore("deviceLock").get("current")), owner);
        if (locked !== false) return false;
        const deviceId = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (!deviceId || deviceId === "bad") return false;
        const current = parseRow(await localRequest(tx.objectStore("fileQueue").get(clientSubmissionId)));
        if (!current || current.userId !== owner.userId || current.centerId !== owner.centerId || current.learnerId !== owner.learnerId) return false;
        if (current.localDeviceId !== deviceId) return false;
        const next = { ...current, ...patch };
        await localRequest(tx.objectStore("fileQueue").put(next));
        return true;
      }),
    );
  } catch {
    return false;
  }
}
