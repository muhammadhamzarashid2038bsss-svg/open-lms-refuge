import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { fingerprintText, readLegacyText } from "../lib/device/legacy-validate";
import {
  LOCAL_DB_NAME,
  LOCAL_DB_VERSION,
  LOCAL_STORE_NAMES,
  finishLegacyMigration,
  inspectLocalDatabase,
  migrateLegacyDevice,
  openLocalDatabase,
  prepareLegacyMigration,
} from "../lib/device/local-db";
import { DEVICE_STORAGE_KEY } from "../lib/device/storage-key";

const practice = {
  id: "item-1",
  userId: "user-a",
  centerId: "center-a",
  kind: "practice",
  summary: "Practice record. No personal details.",
  createdAt: "2026-11-08T00:00:00.000Z",
  note: "kept",
};

const queue = {
  lock: { lockId: "lock-1", userId: "user-a", centerId: "center-a" },
  items: [practice],
  releases: [{ userId: "user-a", centerId: "center-a", lockId: "lock-1", itemCount: 1, witness: "staff" }],
};

function memory(initial: string | null) {
  let raw = initial;
  return {
    read: () => raw,
    set: (next: string | null) => {
      raw = next;
    },
    current: () => raw,
  };
}

function trackedFactory() {
  const indexedDB = new IDBFactory();
  let deleted = 0;
  const original = indexedDB.deleteDatabase.bind(indexedDB);
  indexedDB.deleteDatabase = ((name?: string) => {
    deleted += 1;
    return original(name as string);
  }) as IDBFactory["deleteDatabase"];
  return { indexedDB, deleted: () => deleted };
}

async function openRaw(indexedDB: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

describe("IndexedDB phone queue", () => {
  it("keeps the existing localStorage key", () => {
    expect(DEVICE_STORAGE_KEY).toBe("olr.device.v1");
  });

  it("creates the current version with the documented stores and indexes", async () => {
    const { indexedDB, deleted } = trackedFactory();
    const opened = await openLocalDatabase(indexedDB);
    expect(opened).toMatchObject({ ok: true, version: LOCAL_DB_VERSION });
    if (!opened.ok) return;
    expect(opened.stores.sort()).toEqual([...LOCAL_STORE_NAMES].sort());
    expect(opened.indexes.deviceItems).toEqual(["byOwner"]);
    expect(opened.indexes.snapshots).toEqual(["byOwner"]);
    expect(opened.indexes.rosters).toEqual(["byOwner"]);
    expect(opened.indexes.events.sort()).toEqual(["byOwner", "bySequence"]);
    const inspected = await inspectLocalDatabase(indexedDB);
    expect(inspected).toEqual({ status: "none", state: null, fingerprint: null, presence: null });
    expect(deleted()).toBe(0);
  });

  it("copies a practice record, lock, and handover note and matches the source", async () => {
    const { indexedDB, deleted } = trackedFactory();
    const bucket = memory(JSON.stringify(queue));
    const result = await migrateLegacyDevice(indexedDB, bucket.read);
    expect(result).toMatchObject({ ok: true, outcome: "verified", presence: "present" });
    const inspected = await inspectLocalDatabase(indexedDB);
    expect(inspected.status).toBe("verified");
    expect(inspected.state).toEqual(queue);
    expect(bucket.current()).toBe(JSON.stringify(queue));
    expect(deleted()).toBe(0);
  });

  it("retries a pending copy and a verified copy without duplicating records", async () => {
    const { indexedDB } = trackedFactory();
    const bucket = memory(JSON.stringify(queue));
    const first = await prepareLegacyMigration(indexedDB, bucket.read);
    expect(first).toMatchObject({ ok: true, outcome: "pending" });
    const second = await prepareLegacyMigration(indexedDB, bucket.read);
    expect(second).toMatchObject({ ok: true, outcome: "pending" });
    const pending = await inspectLocalDatabase(indexedDB);
    expect(pending.status).toBe("pending");
    expect(pending.state?.items).toHaveLength(1);
    const finished = await finishLegacyMigration(indexedDB, bucket.read);
    expect(finished).toMatchObject({ ok: true, outcome: "verified" });
    const again = await migrateLegacyDevice(indexedDB, bucket.read);
    expect(again).toMatchObject({ ok: true, outcome: "already-verified" });
    const inspected = await inspectLocalDatabase(indexedDB);
    expect(inspected.state?.items).toHaveLength(1);
    expect(inspected.state?.releases).toHaveLength(1);
  });

  it("treats a missing key differently from an unreadable or incomplete value", async () => {
    const missingDb = trackedFactory();
    const missing = await migrateLegacyDevice(missingDb.indexedDB, memory(null).read);
    expect(missing).toMatchObject({ ok: true, outcome: "verified", presence: "missing", fingerprint: null });
    const missingView = await inspectLocalDatabase(missingDb.indexedDB);
    expect(missingView.state).toEqual({ lock: null, items: [], releases: [] });

    let opened = 0;
    const blocked = {
      open() {
        opened += 1;
        throw new Error("should not open");
      },
      deleteDatabase() {
        return {} as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    expect(await migrateLegacyDevice(blocked, () => "{")).toEqual({ ok: false, reason: "unreadable" });
    expect(await migrateLegacyDevice(blocked, () => JSON.stringify({ items: [] }))).toEqual({ ok: false, reason: "invalid" });
    expect(await migrateLegacyDevice(blocked, () => JSON.stringify({ items: [{}], releases: [] }))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await migrateLegacyDevice(blocked, () => {
      throw new Error("storage failed");
    })).toEqual({ ok: false, reason: "unreadable" });
    expect(opened).toBe(0);
    expect(readLegacyText(null).status).toBe("missing");
    expect(readLegacyText("{").status).toBe("unreadable");
  });

  it("stops when the saved text changes after verification and keeps the copy", async () => {
    const { indexedDB } = trackedFactory();
    const bucket = memory(JSON.stringify(queue));
    await migrateLegacyDevice(indexedDB, bucket.read);
    bucket.set(JSON.stringify({ ...queue, items: [] }));
    const changed = await migrateLegacyDevice(indexedDB, bucket.read);
    expect(changed).toEqual({ ok: false, reason: "changed" });
    const inspected = await inspectLocalDatabase(indexedDB);
    expect(inspected.status).toBe("verified");
    expect(inspected.state?.items).toHaveLength(1);
  });

  it("does not mark a copy verified when the read-back does not match", async () => {
    const { indexedDB } = trackedFactory();
    const bucket = memory(JSON.stringify(queue));
    await prepareLegacyMigration(indexedDB, bucket.read);
    const db = await openRaw(indexedDB);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("deviceItems", "readwrite");
      const store = tx.objectStore("deviceItems");
      const request = store.get(0);
      request.onsuccess = () => {
        const row = request.result as { summary: string };
        row.summary = "tampered";
        store.put(row);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const finished = await finishLegacyMigration(indexedDB, bucket.read);
    expect(finished).toEqual({ ok: false, reason: "mismatch" });
    const inspected = await inspectLocalDatabase(indexedDB);
    expect(inspected.status).not.toBe("verified");
    expect(inspected.status).not.toBe("none");
  });

  it("does not replace a database it cannot open or a migration record it cannot read", async () => {
    let deleted = 0;
    const failing = {
      open() {
        throw new Error("blocked");
      },
      deleteDatabase() {
        deleted += 1;
        return {} as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    const bucket = memory(JSON.stringify(queue));
    expect(await openLocalDatabase(failing)).toEqual({ ok: false, reason: "unavailable" });
    expect(await migrateLegacyDevice(failing, bucket.read)).toEqual({ ok: false, reason: "unavailable" });
    expect(deleted).toBe(0);

    const { indexedDB } = trackedFactory();
    await openLocalDatabase(indexedDB);
    const db = await openRaw(indexedDB);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["meta", "deviceItems"], "readwrite");
      tx.objectStore("meta").put({ key: "migration", schemaVersion: LOCAL_DB_VERSION, importStatus: "bogus" });
      tx.objectStore("deviceItems").put({ ...practice, sourceIndex: 0 });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    expect(await prepareLegacyMigration(indexedDB, bucket.read)).toEqual({ ok: false, reason: "corrupt" });
    const check = await openRaw(indexedDB);
    const kept = await new Promise<unknown>((resolve, reject) => {
      const tx = check.transaction("deviceItems", "readonly");
      const request = tx.objectStore("deviceItems").get(0);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    check.close();
    expect(kept).toMatchObject({ id: "item-1" });
  });

  it("aborts a failed upgrade without deleting the database", async () => {
    let deleted = 0;
    let aborted = 0;
    const factory = {
      open() {
        const request = {
          result: {
            objectStoreNames: { contains: () => false },
            createObjectStore() {
              throw new Error("upgrade failed");
            },
            close() {},
          },
          transaction: {
            abort() {
              aborted += 1;
            },
          },
          onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
          onsuccess: null,
          onerror: null,
          onblocked: null,
        };
        queueMicrotask(() => request.onupgradeneeded?.({} as IDBVersionChangeEvent));
        return request as unknown as IDBOpenDBRequest;
      },
      deleteDatabase() {
        deleted += 1;
        return {} as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    expect(await openLocalDatabase(factory)).toEqual({ ok: false, reason: "unavailable" });
    expect(aborted).toBe(1);
    expect(deleted).toBe(0);
  });

  it("hashes the exact saved text", async () => {
    const raw = JSON.stringify(queue);
    expect(await fingerprintText(raw)).toBe(await fingerprintText(raw));
    expect(await fingerprintText(raw)).not.toBe(await fingerprintText(`${raw} `));
  });
});
