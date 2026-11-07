import { describe, expect, it } from "vitest";
import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../lib/auth/constants";
import { addDeviceItem, addRelease, emptyDeviceState, lockDevice, type DeviceItem, type DeviceState } from "../lib/device/shared-device";
import type { StoredDevice } from "../lib/device/phone-check";
import {
  assessSnapshot,
  decideMarkWrite,
  decideQueueSource,
  decideRevokeResult,
  decideSharedPhone,
  decideSignOut,
  mayShowRoster,
  mergeWaitingItems,
  sameAccount,
  waitingCountFromSource,
  type AuthSnapshot,
  type LocalAttendanceRow,
  type PracticeRow,
} from "../lib/device/offline-decisions";

const owner = { userId: "user-a", centerId: "center-a" };
const other = { userId: "user-b", centerId: "center-a" };
const issuedAt = new Date("2026-11-08T08:00:00.000Z");
const section = { sectionId: "section-1", classSessionId: "class-1" };

function snapshot(overrides: Partial<AuthSnapshot> = {}): AuthSnapshot {
  return {
    ...owner,
    ...section,
    authSessionId: "session-1",
    serverNowAtIssue: issuedAt.toISOString(),
    phoneNowAtIssue: issuedAt.toISOString(),
    lastSeenAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + SESSION_ABSOLUTE_MS).toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

function viewer(phoneNow: Date, snapshotOverrides: Partial<AuthSnapshot> = {}) {
  const stored = snapshot(snapshotOverrides);
  return assessSnapshot(stored, { ...owner, ...section }, phoneNow);
}

function practice(id: string, account = owner): PracticeRow {
  return { id, ...account, createdAt: issuedAt.toISOString() };
}

function event(
  clientEventId: string,
  syncState: LocalAttendanceRow["syncState"] = "pending",
  account = owner,
): LocalAttendanceRow {
  return { clientEventId, ...account, syncState, queuedAt: issuedAt.toISOString() };
}

function ready(state: DeviceState): StoredDevice {
  return { status: "ready", state };
}

function phone(state: DeviceState, next = owner, sessions: { next?: string | null; lock?: string | null } = {}) {
  return decideSharedPhone({
    stored: ready(state),
    nextUserId: next.userId,
    nextCenterId: next.centerId,
    nextAuthSessionId: sessions.next === undefined ? null : sessions.next,
    lockAuthSessionId: sessions.lock === undefined ? null : sessions.lock,
  });
}

describe("snapshot deadlines", () => {
  it("uses the existing 30-minute idle limit and 8-hour absolute limit", () => {
    expect(SESSION_IDLE_MS).toBe(30 * 60 * 1000);
    expect(SESSION_ABSOLUTE_MS).toBe(8 * 60 * 60 * 1000);
    expect(viewer(new Date(issuedAt.getTime() + SESSION_IDLE_MS - 1))).toEqual({ ok: true });
    expect(viewer(new Date(issuedAt.getTime() + SESSION_IDLE_MS))).toEqual({ ok: false, reason: "idle" });
    const freshSeen = new Date(issuedAt.getTime() + SESSION_ABSOLUTE_MS - 1000);
    expect(viewer(new Date(issuedAt.getTime() + SESSION_ABSOLUTE_MS), { lastSeenAt: freshSeen.toISOString() })).toEqual({
      ok: false,
      reason: "absolute",
    });
    expect(viewer(issuedAt, { revokedAt: issuedAt.toISOString() })).toEqual({ ok: false, reason: "revoked" });
  });

  it("corrects a clock that was already fast when the class was loaded", () => {
    const phoneIssue = new Date(issuedAt.getTime() + 3 * 60 * 60 * 1000);
    const stillInside = assessSnapshot(
      snapshot({ phoneNowAtIssue: phoneIssue.toISOString() }),
      { ...owner, ...section },
      new Date(phoneIssue.getTime() + SESSION_IDLE_MS - 1),
    );
    const idleOnTheServerClock = assessSnapshot(
      snapshot({ phoneNowAtIssue: phoneIssue.toISOString() }),
      { ...owner, ...section },
      new Date(phoneIssue.getTime() + SESSION_IDLE_MS),
    );
    expect(stillInside).toEqual({ ok: true });
    expect(idleOnTheServerClock).toEqual({ ok: false, reason: "idle" });
  });

  it("does not notice a phone clock set backward, including after a browser restart", () => {
    // Forty-five minutes later the server session is idle. The only value a
    // restarted browser can compare is the clock the phone reports now.
    const setBackward = new Date(issuedAt.getTime() + 60 * 1000);
    expect(viewer(setBackward)).toEqual({ ok: true });
    expect(viewer(new Date(issuedAt.getTime() + SESSION_IDLE_MS + 15 * 60 * 1000))).toEqual({
      ok: false,
      reason: "idle",
    });
  });

  it("hides the snapshot when the phone clock is set forward", () => {
    expect(viewer(new Date(issuedAt.getTime() + SESSION_IDLE_MS + 60 * 1000))).toEqual({ ok: false, reason: "idle" });
    expect(viewer(new Date(issuedAt.getTime() + SESSION_ABSOLUTE_MS))).toEqual({ ok: false, reason: "absolute" });
  });

  it("rejects a broken time instead of treating the snapshot as valid", () => {
    expect(viewer(issuedAt, { expiresAt: "not-a-time" })).toEqual({ ok: false, reason: "invalid" });
    expect(viewer(new Date(Number.NaN))).toEqual({ ok: false, reason: "invalid" });
    expect(viewer(issuedAt, { revokedAt: "not-a-time" })).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("account and class ownership", () => {
  it("requires both the center and the user", () => {
    expect(sameAccount(owner, owner)).toBe(true);
    expect(sameAccount(owner, other)).toBe(false);
    expect(sameAccount(owner, { userId: owner.userId, centerId: "center-b" })).toBe(false);
    expect(sameAccount({ userId: "", centerId: owner.centerId }, { userId: "", centerId: owner.centerId })).toBe(false);
  });

  it("hides a snapshot that belongs to another account or another class", () => {
    expect(assessSnapshot(snapshot(), { ...other, ...section }, issuedAt)).toEqual({ ok: false, reason: "owner" });
    expect(assessSnapshot(snapshot(), { ...owner, ...section, classSessionId: "class-2" }, issuedAt)).toEqual({
      ok: false,
      reason: "scope",
    });
  });
});

describe("shared-device lock", () => {
  const pending = addDeviceItem(emptyDeviceState(), {
    id: "item-1",
    ...owner,
    kind: "practice",
    summary: "Practice record. No personal details.",
    createdAt: issuedAt.toISOString(),
  });

  it("keeps waiting while storage is still opening and stops when it cannot be read", () => {
    expect(
      decideSharedPhone({
        stored: { status: "loading" },
        nextUserId: other.userId,
        nextCenterId: other.centerId,
        nextAuthSessionId: null,
        lockAuthSessionId: null,
      }),
    ).toEqual({ type: "wait" });
    const unread = decideSharedPhone({
      stored: { status: "unavailable" },
      nextUserId: other.userId,
      nextCenterId: other.centerId,
      nextAuthSessionId: null,
      lockAuthSessionId: null,
    });
    expect(unread.type).toBe("stop");
    if (unread.type === "stop") {
      expect(unread.message).toMatch(/not deleted/i);
      expect(unread.deletePending).toBe(false);
    }
  });

  it("blocks the next account without deleting the waiting record", () => {
    const locked = lockDevice(pending, { lockId: "lock-1", ...owner });
    const decision = phone(locked, other);
    expect(decision).toEqual({ type: "blocked", itemCount: 1, deletePending: false });
    expect(locked.items).toHaveLength(1);
  });

  it("lets the same account clear a lock that has no server session id", () => {
    const locked = lockDevice(pending, { lockId: "lock-1", ...owner });
    expect(phone(locked, owner)).toEqual({ type: "clear-lock", deletePending: false });
  });

  it("stays locked when sign-out did not reach the server, even with nothing waiting", () => {
    const locked = lockDevice(emptyDeviceState(), { lockId: "lock-1", ...owner });
    expect(phone(locked, owner, { next: "session-1", lock: "session-1" })).toEqual({
      type: "stay-locked",
      deletePending: false,
    });
    expect(phone(locked, owner, { next: null, lock: "session-1" })).toEqual({
      type: "stay-locked",
      deletePending: false,
    });
    expect(mayShowRoster({ ok: true }, phone(locked, owner, { next: "session-1", lock: "session-1" }))).toBe(false);
  });

  it("clears the lock only after a different server session for the same account", () => {
    const locked = lockDevice(pending, { lockId: "lock-1", ...owner });
    expect(phone(locked, owner, { next: "session-2", lock: "session-1" })).toEqual({
      type: "clear-lock",
      deletePending: false,
    });
  });

  it("keeps the records after a handover and still hides them from the next account", () => {
    const locked = lockDevice(pending, { lockId: "lock-1", ...owner });
    const released = addRelease(locked, { ...owner, lockId: "lock-1", itemCount: 1 });
    expect(phone(released, other)).toEqual({ type: "clear-lock", deletePending: false });
    expect(released.items).toHaveLength(1);
    expect(mayShowRoster({ ok: true }, { type: "clear-lock", deletePending: false })).toBe(false);
  });

  it("counts one record when the same id is stored twice, and stops on a broken row", () => {
    const duplicated = addDeviceItem(pending, pending.items[0] as DeviceItem);
    expect(phone(lockDevice(duplicated, { lockId: "lock-1", ...owner }), other)).toEqual({
      type: "blocked",
      itemCount: 1,
      deletePending: false,
    });
    const broken: DeviceState = {
      ...pending,
      items: [{ ...pending.items[0], userId: "" } as DeviceItem],
    };
    expect(phone(broken, other).type).toBe("stop");
  });

  it("shows the roster only when the snapshot is valid and the phone is unlocked", () => {
    expect(mayShowRoster({ ok: true }, { type: "open", deletePending: false })).toBe(true);
    expect(mayShowRoster({ ok: false, reason: "idle" }, { type: "open", deletePending: false })).toBe(false);
    expect(mayShowRoster({ ok: true }, { type: "stay-locked", deletePending: false })).toBe(false);
    expect(mayShowRoster({ ok: true }, { type: "wait" })).toBe(false);
  });
});

describe("waiting count", () => {
  const legacy = [practice("practice-1")];
  const indexed = [practice("practice-1"), practice("practice-2")];
  const pending = [event("event-1"), event("event-1"), event("event-2", "acknowledged")];

  it("counts imported practice records and pending attendance once", () => {
    const source = decideQueueSource({
      legacy: ready(emptyDeviceState()),
      importStatus: "verified",
      legacyFingerprint: "same",
      importedFingerprint: "same",
    });
    expect(source).toEqual({ type: "indexed" });
    expect(
      waitingCountFromSource({
        source,
        account: owner,
        legacyPractice: legacy,
        indexedPractice: indexed,
        indexedEvents: pending,
      }),
    ).toEqual({ type: "count", count: 3 });
  });

  it("does not add the legacy copy on top of the imported copy", () => {
    const verified = waitingCountFromSource({
      source: { type: "indexed" },
      account: owner,
      legacyPractice: [practice("practice-1"), practice("practice-9")],
      indexedPractice: [practice("practice-1")],
      indexedEvents: [event("event-1")],
    });
    expect(verified).toEqual({ type: "count", count: 2 });
  });

  it("stops when both stores have records before the copy is verified", () => {
    const split = waitingCountFromSource({
      source: { type: "legacy" },
      account: owner,
      legacyPractice: legacy,
      indexedPractice: [],
      indexedEvents: [event("event-1")],
    });
    expect(split.type).toBe("stop");
    if (split.type === "stop") expect(split.message).toMatch(/not deleted/i);
  });

  it("counts only this account in this center, and leaves out marks the server already accepted", () => {
    const merged = mergeWaitingItems(
      [practice("practice-1"), practice("practice-1"), practice("other", other)],
      [event("event-1"), event("done", "acknowledged"), event("elsewhere", "pending", { userId: owner.userId, centerId: "center-b" })],
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.items.map((item) => item.id).sort()).toEqual(["elsewhere", "event-1", "other", "practice-1"]);
    expect(
      waitingCountFromSource({
        source: { type: "indexed" },
        account: owner,
        legacyPractice: [],
        indexedPractice: [practice("practice-1"), practice("practice-1"), practice("other", other)],
        indexedEvents: [event("event-1"), event("done", "acknowledged")],
      }),
    ).toEqual({ type: "count", count: 2 });
  });

  it("counts a shared id once and stops when a row is broken or claimed by two accounts", () => {
    expect(
      waitingCountFromSource({
        source: { type: "indexed" },
        account: owner,
        legacyPractice: [],
        indexedPractice: [practice("same")],
        indexedEvents: [event("same")],
      }),
    ).toEqual({ type: "count", count: 1 });
    const broken = waitingCountFromSource({
      source: { type: "legacy" },
      account: owner,
      legacyPractice: [{ ...practice("practice-1"), id: "" }],
      indexedPractice: [],
      indexedEvents: [],
    });
    expect(broken).toMatchObject({ type: "stop" });
    expect(mergeWaitingItems([practice("same")], [event("same", "pending", other)]).ok).toBe(false);
    expect(
      waitingCountFromSource({
        source: { type: "indexed" },
        account: { userId: "", centerId: owner.centerId },
        legacyPractice: [],
        indexedPractice: [],
        indexedEvents: [],
      }).type,
    ).toBe("stop");
  });
});

describe("unreadable storage and failed writes", () => {
  it("does not treat an unreadable, unfinished, or mismatched store as empty", () => {
    expect(decideQueueSource({
      legacy: { status: "unavailable" },
      importStatus: "none",
      legacyFingerprint: null,
      importedFingerprint: null,
    })).toMatchObject({ type: "stop" });
    expect(decideQueueSource({
      legacy: { status: "loading" },
      importStatus: "none",
      legacyFingerprint: null,
      importedFingerprint: null,
    })).toEqual({ type: "wait" });
    expect(decideQueueSource({
      legacy: ready(emptyDeviceState()),
      importStatus: "pending",
      legacyFingerprint: "same",
      importedFingerprint: "same",
    })).toMatchObject({ type: "stop" });
    expect(decideQueueSource({
      legacy: ready(emptyDeviceState()),
      importStatus: "verified",
      legacyFingerprint: "legacy",
      importedFingerprint: "indexed",
    })).toMatchObject({ type: "stop" });
    expect(
      waitingCountFromSource({
        source: { type: "stop", message: "stopped" },
        account: owner,
        legacyPractice: [],
        indexedPractice: [],
        indexedEvents: [],
      }),
    ).toEqual({ type: "stop", message: "stopped" });
  });

  it("hides the roster and claims nothing when the lock cannot be written", () => {
    expect(decideSignOut(false)).toEqual({
      hideRoster: true,
      claimLocked: false,
      claimSignedOut: false,
      deletePending: false,
      mayCallServer: false,
      message: expect.stringMatching(/not completed/i),
    });
    expect(decideRevokeResult({ lockWritten: false, serverRevoked: true })).toMatchObject({
      hideRoster: true,
      claimLocked: false,
      claimSignedOut: false,
      deletePending: false,
    });
  });

  it("keeps the marks when the phone is locked but the server cannot be reached", () => {
    const decision = decideRevokeResult({ lockWritten: true, serverRevoked: false });
    expect(decision.hideRoster).toBe(true);
    expect(decision.claimLocked).toBe(true);
    expect(decision.claimSignedOut).toBe(false);
    expect(decision.deletePending).toBe(false);
    expect(decision.message).toMatch(/still here/i);
    expect(decideRevokeResult({ lockWritten: true, serverRevoked: true }).deletePending).toBe(false);
  });

  it("does not confirm a mark when the write fails", () => {
    expect(decideMarkWrite(false)).toEqual({
      confirmed: false,
      countChanges: false,
      deleteExisting: false,
      message: expect.stringMatching(/not stored/i),
    });
    expect(decideMarkWrite(true)).toMatchObject({
      confirmed: true,
      countChanges: true,
      deleteExisting: false,
      message: "Saved on this phone, waiting to send",
    });
  });
});
