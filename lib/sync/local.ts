// Reads and updates the phone's attendance sync notes.
// IndexedDB is not encrypted. This file does not delete attendance rows,
// does not change the database version, and does not touch the old
// localStorage backup. A mark becomes acknowledged only after the write
// is read back. A failed write leaves the mark pending.

import type { PracticeCandidate } from "@/lib/sync/collect";
import type { FutureAttendanceEvent } from "@/lib/device/local-db";
import { closeWorkingDatabase, localRequest, openWorkingDatabase, runLocalTransaction } from "@/lib/device/local-db";
import { readLocalCatalog } from "@/lib/device/local-attendance";
import {
  emptySyncRetryMeta,
  parseSyncRetryMeta,
  syncMetaKey,
  type SyncAccount,
  type SyncRetryMeta,
} from "@/lib/sync/retry";

export type LoadedSync = {
  deviceId: string;
  events: FutureAttendanceEvent[];
  practice: PracticeCandidate[];
  meta: SyncRetryMeta;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameFacts(stored: Record<string, unknown>, event: FutureAttendanceEvent): boolean {
  return (
    stored.clientEventId === event.clientEventId &&
    stored.centerId === event.centerId &&
    stored.userId === event.userId &&
    stored.localDeviceId === event.localDeviceId &&
    stored.sectionId === event.sectionId &&
    stored.classSessionId === event.classSessionId &&
    stored.learnerId === event.learnerId &&
    stored.status === event.status &&
    stored.reasonCode === event.reasonCode &&
    stored.recordedAt === event.recordedAt &&
    stored.sequence === event.sequence &&
    stored.correctsClientEventId === event.correctsClientEventId &&
    stored.correctsServerEventId === event.correctsServerEventId
  );
}

async function readPractice(factory: IDBFactory): Promise<PracticeCandidate[] | null> {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) return null;
  try {
    const rows = await runLocalTransaction(opened.db, ["deviceItems"], "readonly", (tx) =>
      localRequest(tx.objectStore("deviceItems").getAll()),
    );
    if (!Array.isArray(rows)) return null;
    const practice: PracticeCandidate[] = [];
    for (const row of rows) {
      if (!isRecord(row) || row.kind !== "practice") continue;
      if (typeof row.id !== "string" || typeof row.userId !== "string" || typeof row.centerId !== "string") return null;
      practice.push({ kind: "practice", id: row.id, userId: row.userId, centerId: row.centerId });
    }
    return practice;
  } catch {
    return null;
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

export async function readRetryMeta(
  factory: IDBFactory,
  account: SyncAccount,
): Promise<{ ok: true; meta: SyncRetryMeta } | { ok: false; reason: "unavailable" | "unreadable" }> {
  const key = syncMetaKey(account);
  const empty = emptySyncRetryMeta(account);
  if (!key || !empty) return { ok: false, reason: "unreadable" };
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) return { ok: false, reason: "unavailable" };
  try {
    const value = await runLocalTransaction(opened.db, ["meta"], "readonly", (tx) => localRequest(tx.objectStore("meta").get(key)));
    if (value === undefined) return { ok: true, meta: empty };
    const parsed = parseSyncRetryMeta(value, account);
    if (!parsed.ok) return { ok: false, reason: "unreadable" };
    return parsed;
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

/// Writes the note and reads it back. A failed write does not replace a bad
/// note with an empty one. The caller decides that before calling.
export async function writeRetryMeta(factory: IDBFactory, account: SyncAccount, meta: SyncRetryMeta): Promise<boolean> {
  const parsed = parseSyncRetryMeta(meta, account);
  if (!parsed.ok) return false;
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) return false;
  try {
    await runLocalTransaction(opened.db, ["meta"], "readwrite", async (tx) => {
      await localRequest(tx.objectStore("meta").put(parsed.meta));
      const stored = parseSyncRetryMeta(await localRequest(tx.objectStore("meta").get(parsed.meta.key)), account);
      if (!stored.ok || JSON.stringify(stored.meta) !== JSON.stringify(parsed.meta)) throw new Error("sync note was not stored");
    });
    return true;
  } catch {
    return false;
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

export async function loadAttendanceSync(
  factory: IDBFactory,
  account: SyncAccount,
): Promise<{ ok: true; loaded: LoadedSync } | { ok: false; reason: "unavailable" | "unreadable" | "no_device" }> {
  const catalog = await readLocalCatalog(factory);
  if (!catalog.ok) return { ok: false, reason: "unreadable" };
  if (!catalog.deviceId) return { ok: false, reason: "no_device" };
  const practice = await readPractice(factory);
  if (!practice) return { ok: false, reason: "unreadable" };
  const meta = await readRetryMeta(factory, account);
  if (!meta.ok) return { ok: false, reason: meta.reason === "unavailable" ? "unavailable" : "unreadable" };
  return {
    ok: true,
    loaded: { deviceId: catalog.deviceId, events: catalog.events, practice, meta: meta.meta },
  };
}

/// Marks confirmed rows acknowledged. The transaction rolls back on failure,
/// so a crash does not delete the row or leave a half-applied claim that
/// this function then reports as confirmed.
export async function acknowledgeEvents(factory: IDBFactory, events: FutureAttendanceEvent[]): Promise<boolean> {
  if (events.length === 0) return true;
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) return false;
  try {
    await runLocalTransaction(opened.db, ["events"], "readwrite", async (tx) => {
      for (const event of events) {
        const stored = await localRequest(tx.objectStore("events").get(event.clientEventId));
        if (!isRecord(stored) || !sameFacts(stored, event)) throw new Error("attendance row did not match");
        if (stored.syncState !== "pending" && stored.syncState !== "acknowledged") throw new Error("attendance row did not match");
        if (stored.syncState === "acknowledged") continue;
        await localRequest(tx.objectStore("events").put({ ...event, syncState: "acknowledged" }));
      }
    });
    const confirmed = await runLocalTransaction(opened.db, ["events"], "readonly", async (tx) => {
      for (const event of events) {
        const stored = await localRequest(tx.objectStore("events").get(event.clientEventId));
        if (!isRecord(stored) || !sameFacts(stored, event) || stored.syncState !== "acknowledged") return false;
      }
      return true;
    });
    return confirmed;
  } catch {
    return false;
  } finally {
    closeWorkingDatabase(opened.db);
  }
}
