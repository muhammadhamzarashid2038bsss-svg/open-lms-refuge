import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { AttendanceSheetView } from "../components/attendance-sheet";
import {
  applyLocalEvents,
  attendanceRecordId,
  effectiveLocalEvent,
  newLocalEventId,
  readLocalAttendance,
  saveLocalAttendance,
  storeAuthorizedClass,
  type LocalAttendanceEvent,
  type LocalMarkInput,
} from "../lib/device/local-attendance";
import {
  closeWorkingDatabase,
  localRequest,
  openWorkingDatabase,
  runLocalTransaction,
} from "../lib/device/local-db";
import type { StorageProbe } from "../lib/device/storage-readiness";
import { ABSENCE_REASONS, ATTENDANCE_STATUSES, type AbsenceReasonName, type AttendanceStatusName, type LearnerDraft } from "../lib/lms/attendance";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const saved = "Saved on this phone, waiting to send";
const heldWithoutPromise = "These marks are on this phone, waiting to send. This browser did not promise to keep them.";
const unreadable = "This phone's saved attendance could not be read. It was not deleted, and these marks were not stored.";
const phoneNow = new Date("2026-11-08T08:00:00.000Z");
const owner = { userId: "user-a", centerId: "center-a" };
const sectionId = "section-1";
const classSessionId = "session-1";
const scope = { sectionId, classSessionId };
const labels = {
  sectionName: "Morning group",
  classTitle: "Literacy class",
  whenLabel: "Monday 9 Nov, 09:00 to 10:00",
};

function listed(
  rows: typeof learners,
  marks: Record<string, { serverAttendanceRecordId: string; serverStatus: AttendanceStatusName; serverReasonCode: AbsenceReasonName | null }> = {},
) {
  return rows.map((learner) => ({
    learnerId: learner.learnerId,
    displayName: learner.displayName,
    learnerCode: learner.learnerCode,
    serverAttendanceRecordId: marks[learner.learnerId]?.serverAttendanceRecordId ?? null,
    serverStatus: marks[learner.learnerId]?.serverStatus ?? null,
    serverReasonCode: marks[learner.learnerId]?.serverReasonCode ?? null,
  }));
}

const learners = [
  { learnerId: "learner-01", displayName: "Demo Learner 01", learnerCode: "LNR-0001" },
  { learnerId: "learner-02", displayName: "Demo Learner 02", learnerCode: "LNR-0002" },
  { learnerId: "learner-03", displayName: "Demo Learner 03", learnerCode: "LNR-0003" },
  { learnerId: "learner-04", displayName: "Demo Learner 04", learnerCode: "LNR-0004" },
  { learnerId: "learner-05", displayName: "Demo Learner 05", learnerCode: "LNR-0005" },
];

const roomy: StorageProbe = {
  persist: async () => true,
  estimate: async () => ({ usage: 0, quota: 50_000_000 }),
};

/// Chrome returns false from persist() for a normal site. IndexedDB still works.
const persistenceRefused: StorageProbe = {
  persist: async () => false,
  estimate: async () => ({ usage: 0, quota: 50_000_000 }),
};

beforeEach(() => {
  globalThis.IDBKeyRange = IDBKeyRange;
});

function clock(now = phoneNow) {
  return {
    authSessionId: "session-a-1111",
    serverNow: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  };
}

function tracked(real = new IDBFactory()) {
  let opens = 0;
  const factory = {
    open(name: string, version?: number) {
      opens += 1;
      return real.open(name, version);
    },
  } as IDBFactory;
  return { factory, real, opens: () => opens };
}

function mark(
  learnerId: string,
  status: AttendanceStatusName,
  reasonCode: AbsenceReasonName | null = null,
  serverEventId: string | null = null,
  recordedAt = phoneNow.toISOString(),
): LocalMarkInput {
  return { learnerId, status, reasonCode, serverEventId, clientEventId: crypto.randomUUID(), recordedAt };
}

async function rows(factory: IDBFactory, store: "events" | "snapshots" | "rosters" | "meta") {
  const opened = await openWorkingDatabase(factory);
  if (!opened.ok) throw new Error(opened.reason);
  try {
    return await runLocalTransaction(opened.db, [store], "readonly", (tx) => localRequest(tx.objectStore(store).getAll()));
  } finally {
    closeWorkingDatabase(opened.db);
  }
}

async function prepared() {
  const db = tracked();
  const stored = await storeAuthorizedClass({
    factory: db.factory,
    storage: roomy,
    owner,
    sectionId,
    classSessionId,
    ...labels,
    clock: clock(),
    learners: listed(learners),
    phoneNow,
  });
  expect(stored.ok).toBe(true);
  return db;
}

describe("local attendance", () => {
  it("saves Present, Absent, Late, and Excused on this phone", async () => {
    const db = await prepared();
    const marks = ATTENDANCE_STATUSES.map((status, index) => mark(learners[index]!.learnerId, status));
    const result = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks, phoneNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe(saved);
    expect(result.count).toBe(4);
    expect([...result.events].sort((left, right) => left.sequence - right.sequence).map((event) => event.status)).toEqual([...ATTENDANCE_STATUSES]);
    expect(result.events.every((event) => event.syncState === "pending")).toBe(true);
    expect(result.events.every((event) => event.centerId === owner.centerId && event.userId === owner.userId)).toBe(true);
  });

  it("saves each approved reason and rejects any other reason", async () => {
    const db = await prepared();
    const marks = ABSENCE_REASONS.map((reason, index) => mark(learners[index]!.learnerId, index % 2 === 0 ? "ABSENT" : "EXCUSED", reason));
    const result = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks, phoneNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...result.events].sort((left, right) => left.sequence - right.sequence).map((event) => event.reasonCode)).toEqual([...ABSENCE_REASONS]);

    const rejected = tracked(db.real);
    const before = rejected.opens();
    const invalid = await saveLocalAttendance({
      factory: rejected.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [{ ...mark("learner-01", "ABSENT"), reasonCode: "sick today" }],
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.count).toBeNull();
    expect(rejected.opens()).toBe(before);
    expect(await rows(db.real, "events")).toHaveLength(5);
  });

  it("does not create a record for an unmarked learner", async () => {
    const db = await prepared();
    const empty = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks: [], phoneNow });
    expect(empty.ok).toBe(false);
    const result = await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT")],
    });
    expect(result.ok).toBe(true);
    const stored = (await rows(db.real, "events")) as LocalAttendanceEvent[];
    expect(stored.map((event) => event.learnerId)).toEqual(["learner-01"]);
  });

  it("keeps the generated save id and refuses a repeated id used for a different mark", async () => {
    const ids = new Set(Array.from({ length: 20 }, () => newLocalEventId().clientEventId));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/i);

    const db = await prepared();
    const first = mark("learner-01", "PRESENT");
    const savedOnce = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks: [first], phoneNow });
    expect(savedOnce.ok).toBe(true);
    const again = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks: [first], phoneNow });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.count).toBe(1);
    expect(again.events).toHaveLength(1);
    expect(again.events[0]?.clientEventId).toBe(first.clientEventId);

    const changed = await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [{ ...first, status: "ABSENT", reasonCode: null }],
    });
    expect(changed.ok).toBe(false);
    const stored = (await rows(db.real, "events")) as LocalAttendanceEvent[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe("PRESENT");
  });

  it("gives every new mark the next sequence number and does not use the phone clock to pick the newest", async () => {
    const db = await prepared();
    const earlyClock = mark("learner-01", "ABSENT", "UNKNOWN", null, "2026-11-08T12:00:00.000Z");
    const laterCorrection = mark("learner-01", "PRESENT", null, null, "2026-11-08T01:00:00.000Z");
    const first = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks: [earlyClock], phoneNow });
    const second = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks: [laterCorrection], phoneNow });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const ordered = [...second.events].sort((left, right) => left.sequence - right.sequence);
    expect(ordered.map((event) => event.sequence)).toEqual([1, 2]);
    const newest = effectiveLocalEvent(second.events, "learner-01");
    expect(newest?.clientEventId).toBe(laterCorrection.clientEventId);
    expect(newest?.status).toBe("PRESENT");
    expect(newest?.recordedAt).toBe("2026-11-08T01:00:00.000Z");
  });

  it("keeps the earlier event and links a correction to it", async () => {
    const db = await prepared();
    const serverEventId = "server-event-0001";
    const restored = await storeAuthorizedClass({
      factory: db.factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      ...labels,
      clock: clock(),
      phoneNow,
      learners: listed(learners, { "learner-01": { serverAttendanceRecordId: serverEventId, serverStatus: "ABSENT", serverReasonCode: "ILLNESS" } }),
    });
    expect(restored.ok).toBe(true);
    const original = mark("learner-01", "ABSENT", "ILLNESS", serverEventId);
    const correction = mark("learner-01", "LATE", null, serverEventId);
    await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks: [original], phoneNow });
    const result = await saveLocalAttendance({ factory: db.factory, storage: roomy, owner, ...scope, marks: [correction], phoneNow });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = [...result.events].sort((left, right) => left.sequence - right.sequence);
    expect(first?.clientEventId).toBe(original.clientEventId);
    expect(first?.status).toBe("ABSENT");
    expect(first?.correctsServerEventId).toBe(serverEventId);
    expect(first?.correctsClientEventId).toBeNull();
    expect(second?.clientEventId).toBe(correction.clientEventId);
    expect(second?.correctsClientEventId).toBe(original.clientEventId);
    expect(second?.correctsServerEventId).toBeNull();
    expect(second?.sequence).toBe(2);
    const sheet = applyLocalEvents(
      [{ id: "learner-01", displayName: "Demo Learner 01", learnerCode: "LNR-0001", saved: { eventId: serverEventId, status: "ABSENT", reasonCode: "ILLNESS" } }],
      result.events,
    );
    expect(sheet[0]?.status).toBe("LATE");
    expect(sheet[0]?.saved?.eventId).toBe(correction.clientEventId);
  });

  it("links a first local correction to the server record", async () => {
    const db = await prepared();
    const serverEventId = "server-event-0002";
    const restored = await storeAuthorizedClass({
      factory: db.factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      ...labels,
      clock: clock(),
      phoneNow,
      learners: listed(learners, { "learner-02": { serverAttendanceRecordId: serverEventId, serverStatus: "EXCUSED", serverReasonCode: "FAMILY_CARE" } }),
    });
    expect(restored.ok).toBe(true);
    const result = await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-02", "EXCUSED", "FAMILY_CARE", serverEventId)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]?.correctsServerEventId).toBe(serverEventId);
    expect(result.events[0]?.correctsClientEventId).toBeNull();
  });

  it("counts only this account's pending events, including after the database is opened again", async () => {
    const db = await prepared();
    await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT"), mark("learner-02", "LATE")],
    });
    const other = { userId: "user-b", centerId: "center-b" };
    await storeAuthorizedClass({
      factory: db.factory,
      storage: roomy,
      owner: other,
      sectionId,
      classSessionId,
      ...labels,
      clock: clock(),
      learners: listed(learners),
      phoneNow,
    });
    await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner: other,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "ABSENT", "UNKNOWN")],
    });
    const firstRead = await readLocalAttendance(db.factory, owner, scope);
    const mine = await readLocalAttendance(db.factory, owner, scope);
    const theirs = await readLocalAttendance(db.factory, other, scope);
    const sameUserOtherCenter = await readLocalAttendance(db.factory, { userId: owner.userId, centerId: "center-b" }, scope);
    expect(mine.ok && theirs.ok && sameUserOtherCenter.ok && firstRead.ok).toBe(true);
    if (!mine.ok || !theirs.ok || !sameUserOtherCenter.ok || !firstRead.ok) return;
    expect(mine.pendingCount).toBe(2);
    expect(mine.sessionEvents).toHaveLength(2);
    expect(theirs.pendingCount).toBe(1);
    expect(theirs.sessionEvents.every((event) => event.userId === "user-b" && event.centerId === "center-b")).toBe(true);
    expect(sameUserOtherCenter.pendingCount).toBe(0);
    expect(sameUserOtherCenter.sessionEvents).toEqual([]);
    expect(sameUserOtherCenter.roster).toBeNull();
    expect(firstRead.sessionEvents.map((event) => event.clientEventId).sort()).toEqual(mine.sessionEvents.map((event) => event.clientEventId).sort());

    const stored = (await rows(db.real, "events")) as LocalAttendanceEvent[];
    const base = stored.find((event) => event.userId === owner.userId && event.learnerId === "learner-01");
    if (!base) throw new Error("missing event");
    const acknowledged: LocalAttendanceEvent = {
      ...base,
      clientEventId: crypto.randomUUID(),
      sequence: 9,
      status: "EXCUSED",
      reasonCode: "TRANSPORT_OR_COST",
      syncState: "acknowledged",
      correctsClientEventId: base.clientEventId,
      correctsServerEventId: null,
    };
    const opened = await openWorkingDatabase(db.real);
    if (!opened.ok) throw new Error(opened.reason);
    await runLocalTransaction(opened.db, ["events"], "readwrite", (tx) => localRequest(tx.objectStore("events").add(acknowledged)));
    closeWorkingDatabase(opened.db);
    const after = await readLocalAttendance(db.factory, owner, scope);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.pendingCount).toBe(2);
    expect(after.sessionEvents).toHaveLength(3);
    expect(effectiveLocalEvent(after.sessionEvents, "learner-01")?.syncState).toBe("acknowledged");
  });

  it("refuses an expired, revoked, or mismatched snapshot and does not store a class the server would not allow", async () => {
    const expiredDb = tracked();
    const expiredClock = clock();
    expiredClock.expiresAt = expiredClock.serverNow;
    const expired = await storeAuthorizedClass({
      factory: expiredDb.factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      ...labels,
      clock: expiredClock,
      learners: listed(learners),
      phoneNow,
    });
    expect(expired.ok).toBe(false);
    expect(expiredDb.opens()).toBe(0);

    const db = await prepared();
    const id = attendanceRecordId(owner, sectionId, classSessionId);
    const opened = await openWorkingDatabase(db.real);
    if (!opened.ok) throw new Error(opened.reason);
    const current = await runLocalTransaction(opened.db, ["snapshots"], "readonly", (tx) => localRequest(tx.objectStore("snapshots").get(id)));
    await runLocalTransaction(opened.db, ["snapshots"], "readwrite", (tx) =>
      localRequest(tx.objectStore("snapshots").put({ ...current, userId: "user-b" })),
    );
    closeWorkingDatabase(opened.db);
    const mismatched = await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT")],
    });
    expect(mismatched.ok).toBe(false);
    expect(await rows(db.real, "events")).toHaveLength(0);

    const again = await openWorkingDatabase(db.real);
    if (!again.ok) throw new Error(again.reason);
    await runLocalTransaction(again.db, ["snapshots"], "readwrite", (tx) =>
      localRequest(tx.objectStore("snapshots").put({ ...current, revokedAt: phoneNow.toISOString() })),
    );
    closeWorkingDatabase(again.db);
    const revoked = await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT")],
    });
    expect(revoked.ok).toBe(false);
    expect(await rows(db.real, "events")).toHaveLength(0);
  });

  it("does not claim a save when IndexedDB cannot be written or read", async () => {
    const blocked = {
      open() {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    const missed = await saveLocalAttendance({
      factory: blocked,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT")],
    });
    expect(missed.ok).toBe(false);
    if (!missed.ok) {
      expect(missed.count).toBeNull();
      expect(missed.message).not.toBe(saved);
    }

    const db = await prepared();
    await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT"), mark("learner-02", "LATE")],
    });
    const before = (await rows(db.real, "events")) as LocalAttendanceEvent[];
    const collided = await saveLocalAttendance({
      factory: db.factory,
      storage: roomy,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-03", "EXCUSED", "ILLNESS"), { ...before[0]!, status: "ABSENT", reasonCode: null, serverEventId: null }],
    });
    expect(collided.ok).toBe(false);
    if (!collided.ok) expect(collided.count).toBeNull();
    const after = (await rows(db.real, "events")) as LocalAttendanceEvent[];
    expect(after.map((event) => event.clientEventId)).toEqual(before.map((event) => event.clientEventId));

    const opened = await openWorkingDatabase(db.real);
    if (!opened.ok) throw new Error(opened.reason);
    await runLocalTransaction(opened.db, ["events"], "readwrite", (tx) =>
      localRequest(
        tx.objectStore("events").add({
          clientEventId: crypto.randomUUID(),
          centerId: owner.centerId,
          userId: owner.userId,
          status: "NOPE",
        }),
      ),
    );
    closeWorkingDatabase(opened.db);
    const unreadable = await readLocalAttendance(db.factory, owner, scope);
    expect(unreadable.ok).toBe(false);
    if (!unreadable.ok) expect(unreadable.count).toBeNull();
    expect(await rows(db.real, "events")).toHaveLength(before.length + 1);
  });

  it("stores a verified class and marks when persistent storage is refused but IndexedDB has room", async () => {
    const db = tracked();
    const stored = await storeAuthorizedClass({
      factory: db.factory,
      storage: persistenceRefused,
      owner,
      sectionId,
      classSessionId,
      ...labels,
      clock: clock(),
      learners: listed(learners),
      phoneNow,
    });
    expect(stored.ok).toBe(true);
    expect(db.opens()).toBeGreaterThan(0);

    const marks = [mark("learner-01", "PRESENT"), mark("learner-02", "ABSENT", "ILLNESS")];
    const result = await saveLocalAttendance({
      factory: db.factory,
      storage: persistenceRefused,
      owner,
      ...scope,
      phoneNow,
      marks,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toBe(heldWithoutPromise);
    expect(result.message).not.toBe(saved);
    expect(result.count).toBe(2);
    const view = await readLocalAttendance(db.factory, owner, scope);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect(view.pendingCount).toBe(2);
    expect(view.sessionEvents.map((event) => event.clientEventId).sort()).toEqual(marks.map((item) => item.clientEventId).sort());
    expect(view.sessionEvents.every((event) => event.syncState === "pending")).toBe(true);

    const failedRequest: StorageProbe = {
      persist: async () => {
        throw new Error("persist failed");
      },
      estimate: async () => ({ usage: 0, quota: 50_000_000 }),
    };
    const afterFailure = await saveLocalAttendance({
      factory: db.factory,
      storage: failedRequest,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-03", "LATE")],
    });
    expect(afterFailure.ok).toBe(true);
    if (!afterFailure.ok) return;
    expect(afterFailure.message).toBe(heldWithoutPromise);
    expect(afterFailure.count).toBe(3);
    const reread = await readLocalAttendance(db.factory, owner, scope);
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.sessionEvents).toHaveLength(3);
  });

  it("does not report a save when persistent storage is refused and IndexedDB cannot be opened", async () => {
    let opens = 0;
    const factory = {
      open() {
        opens += 1;
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    const stored = await storeAuthorizedClass({
      factory,
      storage: persistenceRefused,
      owner,
      sectionId,
      classSessionId,
      ...labels,
      clock: clock(),
      learners: listed(learners),
      phoneNow,
    });
    expect(stored.ok).toBe(false);
    if (!stored.ok) {
      expect(stored.message).toBe(unreadable);
      expect(stored.message).not.toContain("did not promise");
      expect(stored.message).not.toContain("did not allow saved data");
    }
    const result = await saveLocalAttendance({
      factory,
      storage: persistenceRefused,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT")],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(unreadable);
      expect(result.count).toBeNull();
      expect(result.message).not.toBe(saved);
      expect(result.message).not.toBe(heldWithoutPromise);
    }
    expect(opens).toBe(2);
  });

  it("does not save when free space is too small or cannot be measured", async () => {
    const fullDb = tracked();
    const full = await storeAuthorizedClass({
      factory: fullDb.factory,
      owner,
      sectionId,
      classSessionId,
      ...labels,
      clock: clock(),
      learners: listed(learners),
      phoneNow,
      storage: { persist: async () => false, estimate: async () => ({ usage: 20, quota: 20 }) },
    });
    expect(full.ok).toBe(false);
    if (!full.ok) expect(full.message).toContain("enough free space");
    expect(fullDb.opens()).toBe(0);

    const unmeasured = tracked();
    const failedEstimate = await saveLocalAttendance({
      factory: unmeasured.factory,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT")],
      storage: {
        persist: async () => true,
        estimate: async () => {
          throw new Error("estimate failed");
        },
      },
    });
    expect(failedEstimate.ok).toBe(false);
    if (!failedEstimate.ok) {
      expect(failedEstimate.message).toContain("unavailable");
      expect(failedEstimate.message).not.toBe(heldWithoutPromise);
      expect(failedEstimate.count).toBeNull();
    }
    expect(unmeasured.opens()).toBe(0);

    const missing = tracked();
    const noStorage = await saveLocalAttendance({
      factory: missing.factory,
      owner,
      ...scope,
      phoneNow,
      marks: [mark("learner-01", "PRESENT")],
      storage: null,
    });
    expect(noStorage.ok).toBe(false);
    if (!noStorage.ok) expect(noStorage.message).toContain("unavailable");
    expect(missing.opens()).toBe(0);
  });

  it("stores only the class list fields and does not call the server save", async () => {
    const db = tracked();
    const stored = await storeAuthorizedClass({
      factory: db.factory,
      storage: roomy,
      owner,
      sectionId,
      classSessionId,
      ...labels,
      clock: clock(),
      phoneNow,
      learners: [Object.assign(listed([learners[0]!])[0]!, { note: "family story", phone: "555" })],
    });
    expect(stored.ok).toBe(true);
    const roster = (await rows(db.real, "rosters")) as { learners: Record<string, string>[] }[];
    expect(Object.keys(roster[0]!.learners[0]!).sort()).toEqual([
      "displayName",
      "learnerCode",
      "learnerId",
      "serverAttendanceRecordId",
      "serverReasonCode",
      "serverStatus",
    ]);
    const snapshot = JSON.stringify(await rows(db.real, "snapshots"));
    expect(snapshot).not.toContain("family story");
    expect(snapshot).not.toContain("pin");
    expect(snapshot).not.toContain("cookie");
    expect(snapshot).not.toContain("password");

    const kiosk = readFileSync(join(root, "components", "attendance-kiosk.tsx"), "utf8");
    const sheet = readFileSync(join(root, "components", "attendance-sheet.tsx"), "utf8");
    const local = readFileSync(join(root, "lib", "device", "local-attendance.ts"), "utf8");
    expect(kiosk).not.toContain("saveAttendanceAction");
    expect(kiosk).not.toContain("runAttendanceSync");
    expect(sheet).not.toContain("saveAttendanceAction");
    expect(sheet).not.toContain("runAttendanceSync");
    expect(sheet).not.toContain("Sync now");
    expect(kiosk).not.toContain("router.refresh");
    expect(local).not.toContain("saveAttendanceAction");
    expect(local).not.toContain("prisma");
    expect(local).not.toContain("deleteDatabase");
    expect(local).not.toContain("migrateLegacyDevice");
    expect(local).not.toContain(".delete(");
    expect(local).not.toContain(".clear(");
  });

  it("shows a waiting count only when one was confirmed", () => {
    const draft: LearnerDraft = {
      learnerId: "learner-01",
      displayName: "Demo Learner 01",
      learnerCode: "LNR-0001",
      saved: null,
      status: null,
      reasonCode: null,
      clientEventId: null,
      recordedAt: null,
      phoneSync: null,
    };
    const shown = renderToStaticMarkup(
      <AttendanceSheetView learners={[draft]} cancelled={false} saving={false} message={saved} waitingCount={2} onStatus={() => undefined} onReason={() => undefined} onSave={() => undefined} />,
    );
    expect(shown).toContain("Waiting to send: 2");
    expect(shown).toContain(saved);
    const hidden = renderToStaticMarkup(
      <AttendanceSheetView learners={[draft]} cancelled={false} saving={false} message={null} onStatus={() => undefined} onReason={() => undefined} onSave={() => undefined} />,
    );
    expect(hidden).not.toContain("Waiting to send");
  });
});
