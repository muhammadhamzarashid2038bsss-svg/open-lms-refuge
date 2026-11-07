// IndexedDB copy of the phone queue. IndexedDB is not encrypted. Anyone who
// can open this browser's storage tools can read what is stored here.
//
// localStorage and IndexedDB cannot commit together. The copy uses this
// state machine so an interrupted copy can be tried again without duplicating
// records or pretending the copy is empty:
//
//   none      The database exists and no copy has been committed.
//   pending   A copy was committed, but it has not been read back and matched.
//   verified  The read-back matched the source. Only this state is usable.
//
// A crash during the write rolls the transaction back, so the status stays
// where it was. A crash after pending and before verified is resumed by
// reading the pending rows back. The same source is not inserted again.
// If the original text changes after verified, the copy is left as it was
// and the caller must stop. This module never deletes olr.device.v1 and
// never calls deleteDatabase. Nothing here runs on startup.

import { emptyDeviceState, type DeviceItem, type DeviceLock, type DeviceRelease, type DeviceState } from "./shared-device";
import {
  fingerprintText,
  readLegacySource,
  validateDeviceState,
  type LegacyRead,
} from "./legacy-validate";

export const LOCAL_DB_NAME = "olr-local";
export const LOCAL_DB_VERSION = 1;

export const LOCAL_STORE_NAMES = [
  "meta",
  "deviceItems",
  "deviceReleases",
  "deviceLock",
  "snapshots",
  "rosters",
  "events",
] as const;

type StoreName = (typeof LOCAL_STORE_NAMES)[number];

const LEGACY_STORES = ["meta", "deviceItems", "deviceReleases", "deviceLock"] as const;

type IndexPlan = { name: string; keyPath: string | string[] };

type StorePlan = {
  name: StoreName;
  options: IDBObjectStoreParameters;
  indexes: IndexPlan[];
};

/// meta holds the migration record. deviceItems, deviceReleases, and
/// deviceLock hold the copied queue. snapshots, rosters, and events are
/// empty until a later stage. Their indexes already include centerId and
/// userId so those rows stay tied to one account.
const STORE_PLAN: StorePlan[] = [
  { name: "meta", options: { keyPath: "key" }, indexes: [] },
  {
    name: "deviceItems",
    options: { keyPath: "sourceIndex" },
    indexes: [{ name: "byOwner", keyPath: ["centerId", "userId"] }],
  },
  { name: "deviceReleases", options: { keyPath: "sourceIndex" }, indexes: [] },
  { name: "deviceLock", options: { keyPath: "key" }, indexes: [] },
  {
    name: "snapshots",
    options: { keyPath: "id" },
    indexes: [{ name: "byOwner", keyPath: ["centerId", "userId"] }],
  },
  {
    name: "rosters",
    options: { keyPath: "id" },
    indexes: [{ name: "byOwner", keyPath: ["centerId", "userId"] }],
  },
  {
    name: "events",
    options: { keyPath: "clientEventId" },
    indexes: [
      { name: "byOwner", keyPath: ["centerId", "userId"] },
      { name: "bySequence", keyPath: ["centerId", "userId", "sequence"] },
    ],
  },
];

/// Later stages fill these stores. Stage 2 only creates them.
export type FutureSnapshotRecord = {
  id: string;
  centerId: string;
  userId: string;
  sectionId: string;
  classSessionId: string;
  authSessionId: string;
  serverNowAtIssue: string;
  phoneNowAtIssue: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type FutureRosterRecord = {
  id: string;
  centerId: string;
  userId: string;
  sectionId: string;
  classSessionId: string;
  learners: { learnerId: string; displayName: string; learnerCode: string }[];
};

export type FutureAttendanceEvent = {
  clientEventId: string;
  centerId: string;
  userId: string;
  sectionId: string;
  classSessionId: string;
  learnerId: string;
  status: string;
  reasonCode: string | null;
  recordedAt: string;
  sequence: number;
  correctsClientEventId: string | null;
  syncState: "pending" | "acknowledged";
};

export type MigrationStatus = "none" | "pending" | "verified";

type MigrationMeta = {
  key: "migration";
  schemaVersion: number;
  importStatus: MigrationStatus;
  legacyPresence: "missing" | "present" | null;
  legacyFingerprint: string | null;
  itemCount: number;
  releaseCount: number;
};

export type OpenLocalDbResult =
  | { ok: true; version: number; stores: string[]; indexes: Record<string, string[]> }
  | { ok: false; reason: "unavailable" | "corrupt" };

export type LocalDbInspection = {
  status: "unavailable" | "corrupt" | "none" | "pending" | "verified";
  state: DeviceState | null;
  fingerprint: string | null;
  presence: "missing" | "present" | null;
};

export type MigrationResult =
  | {
      ok: true;
      outcome: "pending" | "verified" | "already-verified";
      fingerprint: string | null;
      presence: "missing" | "present";
    }
  | { ok: false; reason: "unreadable" | "invalid" | "unavailable" | "corrupt" | "mismatch" | "changed" | "not-ready" };

type SourceIdentity = {
  presence: "missing" | "present";
  fingerprint: string | null;
  state: DeviceState;
};

function emptyMeta(): MigrationMeta {
  return {
    key: "migration",
    schemaVersion: LOCAL_DB_VERSION,
    importStatus: "none",
    legacyPresence: null,
    legacyFingerprint: null,
    itemCount: 0,
    releaseCount: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMeta(value: unknown): MigrationMeta | null {
  if (!isRecord(value)) return null;
  if (value.key !== "migration" || value.schemaVersion !== LOCAL_DB_VERSION) return null;
  if (value.importStatus !== "none" && value.importStatus !== "pending" && value.importStatus !== "verified") return null;
  if (value.legacyPresence !== null && value.legacyPresence !== "missing" && value.legacyPresence !== "present") return null;
  if (value.legacyFingerprint !== null && typeof value.legacyFingerprint !== "string") return null;
  if (typeof value.itemCount !== "number" || !Number.isInteger(value.itemCount) || value.itemCount < 0) return null;
  if (typeof value.releaseCount !== "number" || !Number.isInteger(value.releaseCount) || value.releaseCount < 0) return null;
  if (value.importStatus === "none") {
    if (value.legacyPresence !== null || value.legacyFingerprint !== null) return null;
    if (value.itemCount !== 0 || value.releaseCount !== 0) return null;
  } else if (value.legacyPresence === null) {
    return null;
  }
  if (value.legacyPresence === "missing" && value.legacyFingerprint !== null) return null;
  if (value.legacyPresence === "present" && (!value.legacyFingerprint || typeof value.legacyFingerprint !== "string")) return null;
  return {
    key: "migration",
    schemaVersion: LOCAL_DB_VERSION,
    importStatus: value.importStatus,
    legacyPresence: value.legacyPresence,
    legacyFingerprint: value.legacyFingerprint,
    itemCount: value.itemCount,
    releaseCount: value.releaseCount,
  };
}

function sameIdentity(meta: MigrationMeta, source: SourceIdentity): boolean {
  return meta.legacyPresence === source.presence && meta.legacyFingerprint === source.fingerprint;
}

function sameState(left: DeviceState, right: DeviceState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function withTransaction<T>(
  db: IDBDatabase,
  storeNames: readonly string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let completed = false;
    let value: T;
    let hasValue = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error("IndexedDB request failed"));
    };
    const succeed = () => {
      if (settled || !hasValue) return;
      settled = true;
      resolve(value);
    };
    let tx: IDBTransaction;
    try {
      tx = db.transaction([...storeNames], mode);
    } catch (error) {
      fail(error);
      return;
    }
    tx.oncomplete = () => {
      completed = true;
      if (!hasValue) fail(new Error("IndexedDB transaction ended early"));
      else succeed();
    };
    tx.onabort = () => fail(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => fail(tx.error ?? new Error("IndexedDB transaction failed"));
    run(tx).then(
      (next) => {
        hasValue = true;
        value = next;
        if (completed) succeed();
      },
      (error) => {
        try {
          tx.abort();
        } catch {
          // The transaction has already finished.
        }
        fail(error);
      },
    );
  });
}

function createSchema(db: IDBDatabase): void {
  for (const plan of STORE_PLAN) {
    if (db.objectStoreNames.contains(plan.name)) continue;
    const store = db.createObjectStore(plan.name, plan.options);
    for (const index of plan.indexes) store.createIndex(index.name, index.keyPath);
  }
}

function connect(factory: IDBFactory): Promise<{ ok: true; db: IDBDatabase } | { ok: false; reason: "unavailable" }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: true; db: IDBDatabase } | { ok: false; reason: "unavailable" }) => {
      if (settled) {
        if (result.ok) result.db.close();
        return;
      }
      settled = true;
      resolve(result);
    };
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    } catch {
      finish({ ok: false, reason: "unavailable" });
      return;
    }
    request.onblocked = () => finish({ ok: false, reason: "unavailable" });
    request.onerror = () => finish({ ok: false, reason: "unavailable" });
    request.onupgradeneeded = () => {
      try {
        createSchema(request.result);
      } catch {
        try {
          request.transaction?.abort();
        } catch {
          // The upgrade is already failing.
        }
        finish({ ok: false, reason: "unavailable" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      finish({ ok: true, db });
    };
  });
}

function closeDatabase(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // Already closed.
  }
}

async function readMeta(db: IDBDatabase): Promise<MigrationMeta | null | "missing"> {
  const value = await withTransaction(db, ["meta"], "readonly", (tx) =>
    requestToPromise(tx.objectStore("meta").get("migration")),
  );
  if (value === undefined) return "missing";
  return parseMeta(value);
}

async function schemaInfo(db: IDBDatabase): Promise<{ stores: string[]; indexes: Record<string, string[]> }> {
  const names = [...LOCAL_STORE_NAMES];
  const indexes = await withTransaction(db, names, "readonly", async (tx) => {
    const found: Record<string, string[]> = {};
    for (const name of names) found[name] = [...tx.objectStore(name).indexNames];
    return found;
  });
  return { stores: [...db.objectStoreNames], indexes };
}

function stripIndex<T extends { sourceIndex: number }>(rows: T[]): Omit<T, "sourceIndex">[] {
  return [...rows]
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map((row) => {
      const record = { ...row };
      delete record.sourceIndex;
      return record;
    });
}

async function readCopy(db: IDBDatabase): Promise<DeviceState | null> {
  const [itemRows, releaseRows, lockRow] = await withTransaction(db, ["deviceItems", "deviceReleases", "deviceLock"], "readonly", (tx) =>
    Promise.all([
      requestToPromise(tx.objectStore("deviceItems").getAll()),
      requestToPromise(tx.objectStore("deviceReleases").getAll()),
      requestToPromise(tx.objectStore("deviceLock").get("current")),
    ]),
  );
  if (!Array.isArray(itemRows) || !Array.isArray(releaseRows)) return null;
  let lock: DeviceLock | null = null;
  if (lockRow !== undefined) {
    if (!isRecord(lockRow) || !("lock" in lockRow)) return null;
    lock = lockRow.lock === null ? null : (lockRow.lock as DeviceLock);
  }
  const state = validateDeviceState({
    lock,
    items: stripIndex(itemRows as (DeviceItem & { sourceIndex: number })[]),
    releases: stripIndex(releaseRows as (DeviceRelease & { sourceIndex: number })[]),
  });
  return state;
}

function putAll(store: IDBObjectStore, records: unknown[], done: () => void, fail: (error: unknown) => void): void {
  let index = 0;
  const next = () => {
    if (index >= records.length) {
      done();
      return;
    }
    const request = store.put(records[index]);
    index += 1;
    request.onerror = () => fail(request.error);
    request.onsuccess = () => next();
  };
  next();
}

function writePending(db: IDBDatabase, state: DeviceState, meta: MigrationMeta): Promise<void> {
  return withTransaction(db, LEGACY_STORES, "readwrite", (tx) => {
    return new Promise((resolve, reject) => {
      const items = tx.objectStore("deviceItems");
      const releases = tx.objectStore("deviceReleases");
      const locks = tx.objectStore("deviceLock");
      const metas = tx.objectStore("meta");
      const clearItems = items.clear();
      clearItems.onerror = () => reject(clearItems.error);
      clearItems.onsuccess = () => {
        const clearReleases = releases.clear();
        clearReleases.onerror = () => reject(clearReleases.error);
        clearReleases.onsuccess = () => {
          const clearLocks = locks.clear();
          clearLocks.onerror = () => reject(clearLocks.error);
          clearLocks.onsuccess = () => {
            putAll(
              items,
              state.items.map((item, sourceIndex) => ({ ...item, sourceIndex })),
              () => {
                putAll(
                  releases,
                  state.releases.map((release, sourceIndex) => ({ ...release, sourceIndex })),
                  () => {
                    const lockRequest = locks.put({ key: "current", lock: state.lock });
                    lockRequest.onerror = () => reject(lockRequest.error);
                    lockRequest.onsuccess = () => {
                      const metaRequest = metas.put(meta);
                      metaRequest.onerror = () => reject(metaRequest.error);
                      metaRequest.onsuccess = () => resolve();
                    };
                  },
                  reject,
                );
              },
              reject,
            );
          };
        };
      };
    });
  });
}

function writeMeta(db: IDBDatabase, meta: MigrationMeta): Promise<void> {
  return withTransaction(db, ["meta"], "readwrite", (tx) => requestToPromise(tx.objectStore("meta").put(meta)).then(() => undefined));
}

async function sourceFrom(read: LegacyRead): Promise<SourceIdentity | MigrationResult> {
  if (read.status === "unreadable" || read.status === "invalid") return { ok: false, reason: read.status };
  if (read.status === "missing") {
    return { presence: "missing", fingerprint: null, state: emptyDeviceState() };
  }
  return { presence: "present", fingerprint: await fingerprintText(read.raw), state: read.state };
}

function isFailure(value: SourceIdentity | MigrationResult): value is MigrationResult {
  return "ok" in value && value.ok === false;
}

async function openReady(factory: IDBFactory): Promise<{ ok: true; db: IDBDatabase; meta: MigrationMeta } | MigrationResult> {
  const opened = await connect(factory);
  if (!opened.ok) return { ok: false, reason: "unavailable" };
  try {
    let meta = await readMeta(opened.db);
    if (meta === "missing") {
      await writeMeta(opened.db, emptyMeta());
      meta = await readMeta(opened.db);
    }
    if (meta === "missing" || meta === null) {
      closeDatabase(opened.db);
      return { ok: false, reason: "corrupt" };
    }
    return { ok: true, db: opened.db, meta };
  } catch {
    closeDatabase(opened.db);
    return { ok: false, reason: "unavailable" };
  }
}

export async function openLocalDatabase(factory: IDBFactory): Promise<OpenLocalDbResult> {
  const opened = await openReady(factory);
  if (!opened.ok) return { ok: false, reason: opened.reason === "corrupt" ? "corrupt" : "unavailable" };
  try {
    const info = await schemaInfo(opened.db);
    return { ok: true, version: opened.db.version, ...info };
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    closeDatabase(opened.db);
  }
}

/// Recovery and tests use this. A pending or none result is not an empty
/// queue, and a corrupt result is not an empty queue. Only verified may be
/// treated as the copied phone queue.
export async function inspectLocalDatabase(factory: IDBFactory): Promise<LocalDbInspection> {
  const opened = await connect(factory);
  if (!opened.ok) {
    return { status: "unavailable", state: null, fingerprint: null, presence: null };
  }
  try {
    const meta = await readMeta(opened.db);
    if (meta === "missing" || meta === null) {
      return { status: "corrupt", state: null, fingerprint: null, presence: null };
    }
    if (meta.importStatus === "none") {
      return { status: "none", state: null, fingerprint: null, presence: null };
    }
    const state = await readCopy(opened.db);
    if (!state || state.items.length !== meta.itemCount || state.releases.length !== meta.releaseCount) {
      return { status: "corrupt", state: null, fingerprint: meta.legacyFingerprint, presence: meta.legacyPresence };
    }
    return {
      status: meta.importStatus,
      state,
      fingerprint: meta.legacyFingerprint,
      presence: meta.legacyPresence,
    };
  } catch {
    return { status: "unavailable", state: null, fingerprint: null, presence: null };
  } finally {
    closeDatabase(opened.db);
  }
}

function pendingMeta(source: SourceIdentity): MigrationMeta {
  return {
    key: "migration",
    schemaVersion: LOCAL_DB_VERSION,
    importStatus: "pending",
    legacyPresence: source.presence,
    legacyFingerprint: source.fingerprint,
    itemCount: source.state.items.length,
    releaseCount: source.state.releases.length,
  };
}

function done(source: SourceIdentity, outcome: "pending" | "verified" | "already-verified"): MigrationResult {
  return { ok: true, outcome, fingerprint: source.fingerprint, presence: source.presence };
}

/// Writes the copy and marks it pending. Does not mark it verified.
/// The original localStorage value is only read. A second call with the same
/// text replaces nothing new: the pending rows are left in place.
export async function prepareLegacyMigration(factory: IDBFactory, readRaw: () => string | null): Promise<MigrationResult> {
  const source = await sourceFrom(readLegacySource(readRaw));
  if (isFailure(source)) return source;
  const opened = await openReady(factory);
  if (!opened.ok) return opened;
  try {
    if (opened.meta.importStatus === "verified") {
      return sameIdentity(opened.meta, source) ? done(source, "already-verified") : { ok: false, reason: "changed" };
    }
    if (opened.meta.importStatus === "pending" && sameIdentity(opened.meta, source)) return done(source, "pending");
    await writePending(opened.db, source.state, pendingMeta(source));
    return done(source, "pending");
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    closeDatabase(opened.db);
  }
}

/// Reads the pending copy back. Verified is set only when it matches the
/// source. A mismatch leaves the rows in place and does not report success.
export async function finishLegacyMigration(factory: IDBFactory, readRaw: () => string | null): Promise<MigrationResult> {
  const source = await sourceFrom(readLegacySource(readRaw));
  if (isFailure(source)) return source;
  const opened = await openReady(factory);
  if (!opened.ok) return opened;
  try {
    if (opened.meta.importStatus === "none") return { ok: false, reason: "not-ready" };
    if (!sameIdentity(opened.meta, source)) return { ok: false, reason: "changed" };
    const copied = await readCopy(opened.db);
    const matches =
      copied !== null &&
      copied.items.length === opened.meta.itemCount &&
      copied.releases.length === opened.meta.releaseCount &&
      sameState(copied, source.state);
    if (!matches) {
      if (opened.meta.importStatus === "verified") await writeMeta(opened.db, pendingMeta(source));
      return { ok: false, reason: "mismatch" };
    }
    if (opened.meta.importStatus === "verified") return done(source, "already-verified");
    await writeMeta(opened.db, { ...pendingMeta(source), importStatus: "verified" });
    const confirmed = await readCopy(opened.db);
    if (!confirmed || !sameState(confirmed, source.state)) {
      await writeMeta(opened.db, pendingMeta(source));
      return { ok: false, reason: "mismatch" };
    }
    return done(source, "verified");
  } catch {
    return { ok: false, reason: "unavailable" };
  } finally {
    closeDatabase(opened.db);
  }
}

/// Copies the current phone queue, reads it back, and marks it verified only
/// when the copy matches. Does not write or delete localStorage.
export async function migrateLegacyDevice(factory: IDBFactory, readRaw: () => string | null): Promise<MigrationResult> {
  const prepared = await prepareLegacyMigration(factory, readRaw);
  if (!prepared.ok) return prepared;
  return finishLegacyMigration(factory, readRaw);
}