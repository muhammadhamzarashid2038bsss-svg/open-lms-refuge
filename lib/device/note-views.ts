// A separate phone queue for "this note was opened" receipts.
// The row holds a note id and an event id. It does not hold the note text,
// a skill-tag name, a learner name, or a learner code.
// Rows stay here until the server acknowledges them. A rejection is kept too,
// so a failed receipt is not thrown away.
// IndexedDB is not encrypted.

import { closeWorkingDatabase, localRequest, openWorkingDatabase, runLocalTransaction } from "./local-db";
import { readOrCreateLocalDeviceId } from "./local-records";
import type { StorageProbe } from "./storage-readiness";
import { isUuid } from "@/lib/lms/timetable";

const KEPT = "This phone is keeping a private record that the note was opened. The note text is not in that record.";
const NOT_KEPT = "This phone could not record that the note was opened. Nothing already stored was deleted.";
const UNREADABLE = "This phone's note-view records could not be read. Nothing was deleted.";
const LOCKED = "This phone is locked for another sign-in. The note-view records were not changed.";

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NoteViewSyncState = "pending" | "acknowledged" | "rejected";

export type LocalNoteView = {
  clientEventId: string;
  centerId: string;
  userId: string;
  localDeviceId: string;
  noteId: string;
  deviceReportedAt: string | null;
  syncState: NoteViewSyncState;
};

type Owner = { centerId: string; userId: string };

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

function owned(owner: Owner): boolean {
  return isUuid(owner.centerId) && isUuid(owner.userId);
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

function parseView(value: unknown): LocalNoteView | null {
  if (!isRecord(value)) return null;
  if (!present(value.clientEventId) || !present(value.centerId) || !present(value.userId) || !present(value.localDeviceId)) return null;
  if (typeof value.noteId !== "string" || !isUuid(value.noteId)) return null;
  if (value.deviceReportedAt !== null && typeof value.deviceReportedAt !== "string") return null;
  if (value.syncState !== "pending" && value.syncState !== "acknowledged" && value.syncState !== "rejected") return null;
  if ("body" in value || "customSkillLabel" in value || "learnerName" in value || "learnerCode" in value) return null;
  return {
    clientEventId: value.clientEventId,
    centerId: value.centerId,
    userId: value.userId,
    localDeviceId: value.localDeviceId.toLowerCase(),
    noteId: value.noteId.toLowerCase(),
    deviceReportedAt: value.deviceReportedAt,
    syncState: value.syncState,
  };
}

async function withDb<T>(factory: IDBFactory, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new LocalStop(NOT_KEPT);
  try {
    return await run(opened.db);
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

/// Queues one new view event per note id. A later genuine view calls this again
/// and receives new event ids. The phone clock is optional and untrusted.
export async function queueNoteViews(
  factory: IDBFactory,
  owner: Owner,
  noteIds: string[],
  options: { now?: Date; storage?: StorageProbe | null } = {},
): Promise<{ ok: true; message: string; events: LocalNoteView[] } | { ok: false; message: string }> {
  if (!owned(owner) || noteIds.length === 0 || noteIds.some((id) => !isUuid(id))) return { ok: false, message: NOT_KEPT };
  const device = await readOrCreateLocalDeviceId(factory, options.storage);
  if (!device.ok) return { ok: false, message: NOT_KEPT };
  const deviceReportedAt = options.now ? options.now.toISOString() : null;
  try {
    const events = await withDb(factory, async (db) => {
      return runLocalTransaction(db, ["meta", "deviceLock", "noteViewEvents"], "readwrite", async (tx) => {
        const locked = lockBlocks(await localRequest(tx.objectStore("deviceLock").get("current")), owner);
        if (locked === "bad") throw new LocalStop(UNREADABLE);
        if (locked) throw new LocalStop(LOCKED);
        const currentDevice = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (currentDevice !== device.deviceId) throw new LocalStop(UNREADABLE);
        const store = tx.objectStore("noteViewEvents");
        const written: LocalNoteView[] = [];
        for (const noteId of noteIds) {
          const row: LocalNoteView = {
            clientEventId: crypto.randomUUID(),
            centerId: owner.centerId,
            userId: owner.userId,
            localDeviceId: device.deviceId,
            noteId: noteId.toLowerCase(),
            deviceReportedAt,
            syncState: "pending",
          };
          await localRequest(store.put(row));
          const seen = parseView(await localRequest(store.get(row.clientEventId)));
          if (!seen || seen.noteId !== row.noteId || seen.syncState !== "pending" || seen.userId !== owner.userId) {
            throw new LocalStop(NOT_KEPT);
          }
          written.push(seen);
        }
        return written;
      });
    });
    return { ok: true, message: KEPT, events };
  } catch (error) {
    if (error instanceof LocalStop) return { ok: false, message: error.message };
    return { ok: false, message: NOT_KEPT };
  }
}

export async function listLocalNoteViews(
  factory: IDBFactory,
  owner: Owner,
): Promise<{ ok: true; deviceId: string | null; events: LocalNoteView[] } | { ok: false; message: string }> {
  if (!owned(owner)) return { ok: false, message: UNREADABLE };
  try {
    return await withDb(factory, async (db) => {
      return runLocalTransaction(db, ["meta", "deviceLock", "noteViewEvents"], "readonly", async (tx) => {
        const locked = lockBlocks(await localRequest(tx.objectStore("deviceLock").get("current")), owner);
        if (locked === "bad") throw new LocalStop(UNREADABLE);
        const deviceId = deviceIdOf(await localRequest(tx.objectStore("meta").get("device")));
        if (deviceId === "bad") throw new LocalStop(UNREADABLE);
        if (locked || !deviceId) return { ok: true as const, deviceId, events: [] };
        const rows = await localRequest(tx.objectStore("noteViewEvents").index("byOwner").getAll(IDBKeyRange.only([owner.centerId, owner.userId, deviceId])));
        if (!Array.isArray(rows)) throw new LocalStop(UNREADABLE);
        const events: LocalNoteView[] = [];
        for (const row of rows) {
          const parsed = parseView(row);
          if (!parsed || parsed.centerId !== owner.centerId || parsed.userId !== owner.userId || parsed.localDeviceId !== deviceId) {
            throw new LocalStop(UNREADABLE);
          }
          events.push(parsed);
        }
        return { ok: true as const, deviceId, events };
      });
    });
  } catch (error) {
    if (error instanceof LocalStop) return { ok: false, message: error.message };
    return { ok: false, message: UNREADABLE };
  }
}

export async function markLocalNoteViews(
  factory: IDBFactory,
  owner: Owner,
  updates: { clientEventId: string; syncState: NoteViewSyncState }[],
): Promise<boolean> {
  if (!owned(owner) || updates.length === 0) return updates.length === 0;
  try {
    await withDb(factory, async (db) => {
      await runLocalTransaction(db, ["noteViewEvents"], "readwrite", async (tx) => {
        for (const update of updates) {
          const stored = parseView(await localRequest(tx.objectStore("noteViewEvents").get(update.clientEventId)));
          if (!stored || stored.centerId !== owner.centerId || stored.userId !== owner.userId) throw new LocalStop(UNREADABLE);
          const next = { ...stored, syncState: update.syncState };
          await localRequest(tx.objectStore("noteViewEvents").put(next));
          const seen = parseView(await localRequest(tx.objectStore("noteViewEvents").get(update.clientEventId)));
          if (!seen || seen.syncState !== update.syncState) throw new LocalStop(NOT_KEPT);
        }
      });
      return true;
    });
    return true;
  } catch {
    return false;
  }
}
