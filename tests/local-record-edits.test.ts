import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { closeWorkingDatabase, LOCAL_DB_NAME, LOCAL_DB_VERSION, localRequest, openLocalDatabase, openWorkingDatabase, runLocalTransaction } from "../lib/device/local-db";
import { listLocalRecords, saveLocalGrade, saveLocalNote } from "../lib/device/local-records";
import { syncLocalRecords } from "../lib/sync/record-sync";

const owner = { centerId: "00000000-0000-4000-8000-0000000000c1", userId: "00000000-0000-4000-8000-0000000000a1" };
const other = { centerId: owner.centerId, userId: "00000000-0000-4000-8000-0000000000b2" };
const assignmentId = "00000000-0000-4000-8000-000000000011";
const learnerId = "00000000-0000-4000-8000-000000000022";
const sectionId = "00000000-0000-4000-8000-000000000033";

const granted = {
  persist: async () => true,
  estimate: async () => ({ quota: 5_000_000, usage: 1000 }),
};

function trackedFactory() {
  const indexedDB = new IDBFactory();
  let deleted = 0;
  const original = indexedDB.deleteDatabase.bind(indexedDB);
  indexedDB.deleteDatabase = (name: string) => {
    deleted += 1;
    return original(name);
  };
  return { indexedDB, deleted: () => deleted };
}

beforeEach(() => {
  globalThis.IDBKeyRange = IDBKeyRange;
});

describe("offline grade and note edits", () => {
  it("keeps a rising per-record count across repeated saves", async () => {
    const { indexedDB, deleted } = trackedFactory();
    const misleading = new Date("1999-01-01T00:00:00.000Z");
    const first = await saveLocalGrade(indexedDB, owner, { assignmentId, learnerId, points: "10", academicNote: null }, { storage: granted, now: misleading });
    const second = await saveLocalGrade(indexedDB, owner, { assignmentId, learnerId, points: "11", academicNote: "steady" }, { storage: granted, now: misleading });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.message).toBe("Saved on this phone, waiting to send");
    const deviceId = first.mutation.localDeviceId;
    expect(first.mutation.versionVector).toEqual({ [deviceId]: 1 });
    expect(second.mutation.versionVector).toEqual({ [deviceId]: 2 });
    expect(second.mutation.recordId).toBe(first.mutation.recordId);
    expect(second.mutation.clientMutationId).not.toBe(first.mutation.clientMutationId);
    expect(second.mutation.deviceRecordedAt).toBe("1999-01-01T00:00:00.000Z");
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok && listed.mutations).toHaveLength(2);
    expect(deleted()).toBe(0);
  });

  it("does not claim a save when storage or read-back fails", async () => {
    const { indexedDB } = trackedFactory();
    const full = await saveLocalGrade(
      indexedDB,
      owner,
      { assignmentId, learnerId, points: "8", academicNote: null },
      { storage: { persist: async () => false, estimate: async () => ({ quota: 10, usage: 10 }) } },
    );
    expect(full.ok).toBe(false);
    if (full.ok) return;
    expect(full.message).not.toContain("Saved on this phone");
    expect(full.message.toLowerCase()).toContain("not saved");
    const unread = await saveLocalGrade(
      indexedDB,
      owner,
      { assignmentId, learnerId, points: "8", academicNote: null },
      { storage: granted, readback: () => ({ clientMutationId: "mismatch" }) },
    );
    expect(unread.ok).toBe(false);
    if (unread.ok) return;
    expect(unread.message).not.toContain("Saved on this phone");
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok && listed.mutations).toEqual([]);
  });

  it("stores a grade when the browser has room but will not promise to keep it", async () => {
    const { indexedDB } = trackedFactory();
    const held = await saveLocalGrade(
      indexedDB,
      owner,
      { assignmentId, learnerId, points: "8", academicNote: null },
      { storage: { persist: async () => false, estimate: async () => ({ quota: 5000, usage: 0 }) } },
    );
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.message).toBe("This edit is on this phone, waiting to send. This browser did not promise to keep it.");
    expect(held.message).not.toContain("Saved on this phone");
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok && listed.mutations).toHaveLength(1);
  });

  it("hides edits from another account and does not write them into attendance", async () => {
    const { indexedDB } = trackedFactory();
    const saved = await saveLocalGrade(indexedDB, owner, { assignmentId, learnerId, points: "9", academicNote: null }, { storage: granted });
    expect(saved.ok).toBe(true);
    const hidden = await listLocalRecords(indexedDB, other);
    expect(hidden.ok && hidden.mutations).toEqual([]);
    const opened = await openWorkingDatabase(indexedDB);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const events = await runLocalTransaction(opened.db, ["events"], "readonly", (tx) => localRequest(tx.objectStore("events").getAll()));
    closeWorkingDatabase(opened.db);
    expect(events).toEqual([]);
  });

  it("refuses a save while the phone is locked for someone else", async () => {
    const { indexedDB } = trackedFactory();
    const opened = await openWorkingDatabase(indexedDB);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    await runLocalTransaction(opened.db, ["deviceLock"], "readwrite", (tx) =>
      localRequest(tx.objectStore("deviceLock").put({
        key: "current",
        lock: { lockId: "lock-1", userId: other.userId, centerId: owner.centerId, authSessionId: "session-1" },
      })),
    );
    closeWorkingDatabase(opened.db);
    const saved = await saveLocalGrade(indexedDB, owner, { assignmentId, learnerId, points: "7", academicNote: null }, { storage: granted });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.message).not.toContain("Saved on this phone");
  });

  it("upgrades a version 1 database without dropping attendance, locks, or handover rows", async () => {
    const { indexedDB, deleted } = trackedFactory();
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LOCAL_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("meta", { keyPath: "key" });
        const items = db.createObjectStore("deviceItems", { keyPath: "sourceIndex" });
        items.createIndex("byOwner", ["centerId", "userId"]);
        db.createObjectStore("deviceReleases", { keyPath: "sourceIndex" });
        db.createObjectStore("deviceLock", { keyPath: "key" });
        const snapshots = db.createObjectStore("snapshots", { keyPath: "id" });
        snapshots.createIndex("byOwner", ["centerId", "userId"]);
        const rosters = db.createObjectStore("rosters", { keyPath: "id" });
        rosters.createIndex("byOwner", ["centerId", "userId"]);
        const events = db.createObjectStore("events", { keyPath: "clientEventId" });
        events.createIndex("byOwner", ["centerId", "userId"]);
        events.createIndex("bySequence", ["centerId", "userId", "sequence"]);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await runLocalTransaction(legacy, ["meta", "deviceItems", "deviceReleases", "deviceLock", "events"], "readwrite", async (tx) => {
      await localRequest(tx.objectStore("meta").put({
        key: "migration",
        schemaVersion: 1,
        importStatus: "verified",
        legacyPresence: "present",
        legacyFingerprint: "abc",
        itemCount: 1,
        releaseCount: 1,
      }));
      await localRequest(tx.objectStore("deviceItems").put({ sourceIndex: 0, id: "item-1", userId: owner.userId, centerId: owner.centerId, kind: "practice", summary: "kept", createdAt: "2026-01-01T00:00:00.000Z" }));
      await localRequest(tx.objectStore("deviceReleases").put({ sourceIndex: 0, userId: owner.userId, centerId: owner.centerId, lockId: "lock-1", itemCount: 1 }));
      await localRequest(tx.objectStore("deviceLock").put({ key: "current", lock: { lockId: "lock-1", userId: owner.userId, centerId: owner.centerId } }));
      await localRequest(tx.objectStore("events").put({ clientEventId: "attendance-kept", centerId: owner.centerId, userId: owner.userId, status: "PRESENT" }));
    });
    legacy.close();

    const upgraded = await openLocalDatabase(indexedDB);
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.version).toBe(LOCAL_DB_VERSION);
    expect(upgraded.stores).toEqual(expect.arrayContaining(["events", "deviceLock", "deviceReleases", "recordMutations", "recordCounters"]));

    const opened = await openWorkingDatabase(indexedDB);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const [events, items, releases, lock] = await runLocalTransaction(opened.db, ["events", "deviceItems", "deviceReleases", "deviceLock"], "readonly", (tx) =>
      Promise.all([
        localRequest(tx.objectStore("events").get("attendance-kept")),
        localRequest(tx.objectStore("deviceItems").get(0)),
        localRequest(tx.objectStore("deviceReleases").get(0)),
        localRequest(tx.objectStore("deviceLock").get("current")),
      ]),
    );
    closeWorkingDatabase(opened.db);
    expect(events).toMatchObject({ clientEventId: "attendance-kept", status: "PRESENT" });
    expect(items).toMatchObject({ id: "item-1", kind: "practice" });
    expect(releases).toMatchObject({ lockId: "lock-1" });
    expect(lock).toMatchObject({ lock: { lockId: "lock-1" } });
    expect(deleted()).toBe(0);
  });

  it("leaves a pending edit in place when the send fails", async () => {
    const { indexedDB } = trackedFactory();
    const saved = await saveLocalNote(
      indexedDB,
      owner,
      { sectionId, learnerId, body: "Day9 local note", skillGaps: ["READING"], customSkillTagId: null },
      { storage: granted },
    );
    expect(saved.ok).toBe(true);
    const result = await syncLocalRecords({
      factory: indexedDB,
      account: owner,
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.pending).toBe(1);
    const listed = await listLocalRecords(indexedDB, owner);
    expect(listed.ok && listed.mutations[0]?.syncState).toBe("pending");
  });
});
