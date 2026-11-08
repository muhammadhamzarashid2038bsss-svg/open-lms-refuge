import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openingDestination } from "../lib/device/phone-check";
import {
  inspectLocalDatabase,
  migrateLegacyDevice,
  prepareLegacyMigration,
  readActiveAccount,
} from "../lib/device/local-db";
import { readLocalCatalog, saveLocalAttendance, storeAuthorizedClass } from "../lib/device/local-attendance";
import { addVerifiedPractice, addVerifiedRelease, openVerifiedQueue, performPhoneSignOut } from "../lib/device/phone-access";
import { applyOnlineAccess, childrenVisible } from "../lib/device/phone-online";
import { deleteObsoleteCaches } from "../lib/device/sw-navigation";
import { DEVICE_STORAGE_KEY } from "../lib/device/storage-key";
import type { StorageProbe } from "../lib/device/storage-readiness";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const owner = { userId: "user-a", centerId: "center-a" };
const other = { userId: "user-b", centerId: "center-a" };
const otherCenter = { userId: "user-a", centerId: "center-b" };
const phoneNow = new Date("2026-11-08T08:00:00.000Z");
const roomy: StorageProbe = {
  persist: async () => true,
  estimate: async () => ({ usage: 0, quota: 50_000_000 }),
};

const practice = {
  id: "item-1",
  userId: owner.userId,
  centerId: owner.centerId,
  kind: "practice",
  summary: "Practice record. No personal details.",
  createdAt: "2026-11-08T00:00:00.000Z",
};

const legacyQueue = {
  lock: { lockId: "lock-1", userId: owner.userId, centerId: owner.centerId },
  items: [practice],
  releases: [{ userId: owner.userId, centerId: owner.centerId, lockId: "lock-1", itemCount: 1 }],
};

beforeEach(() => {
  globalThis.IDBKeyRange = IDBKeyRange;
});

function memory(initial: string | null) {
  let raw = initial;
  let writes = 0;
  return {
    read: () => raw,
    set: (next: string | null) => {
      raw = next;
    },
    current: () => raw,
    writes: () => writes,
    write: (next: string | null) => {
      writes += 1;
      raw = next;
    },
  };
}

function clock(authSessionId: string, now = phoneNow) {
  return {
    authSessionId,
    serverNow: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  };
}

async function saveMark(factory: IDBFactory, account = owner, authSessionId = "session-1") {
  const stored = await storeAuthorizedClass({
    factory,
    storage: roomy,
    owner: account,
    sectionId: "section-1",
    classSessionId: "session-1",
    sectionName: "Morning group",
    classTitle: "Literacy class",
    whenLabel: "Monday 9 Nov, 09:00 to 10:00",
    clock: clock(authSessionId),
    learners: [
      {
        learnerId: "learner-01",
        displayName: "Demo Learner 01",
        learnerCode: "LNR-0001",
        serverAttendanceRecordId: null,
        serverStatus: null,
        serverReasonCode: null,
      },
    ],
    phoneNow,
  });
  expect(stored.ok).toBe(true);
  const marked = await saveLocalAttendance({
    factory,
    storage: roomy,
    owner: account,
    sectionId: "section-1",
    classSessionId: "session-1",
    marks: [
      {
        learnerId: "learner-01",
        status: "PRESENT",
        reasonCode: null,
        serverEventId: null,
        clientEventId: "event-kept",
        recordedAt: phoneNow.toISOString(),
      },
    ],
    phoneNow,
  });
  expect(marked.ok).toBe(true);
}

describe("Stage 6 shared-device integration", () => {
  it("does not write the frozen backup after a verified copy", async () => {
    const factory = new IDBFactory();
    const bucket = memory(JSON.stringify(legacyQueue));
    const opened = await openVerifiedQueue(factory, bucket.read);
    expect(opened.ok).toBe(true);
    const saved = await addVerifiedPractice({ factory, readRaw: bucket.read, account: owner });
    expect(saved.ok).toBe(true);
    expect(bucket.current()).toBe(JSON.stringify(legacyQueue));
    expect(bucket.writes()).toBe(0);
    const source = readFileSync(join(root, "lib", "device", "browser.ts"), "utf8");
    expect(source).not.toContain("setItem");
    expect(readFileSync(join(root, "lib", "device", "phone-access.ts"), "utf8")).not.toContain("setItem");
    expect(readFileSync(join(root, "lib", "device", "kiosk-shell.ts"), "utf8")).not.toContain("clearAccountLock");
    expect(readFileSync(join(root, "lib", "device", "kiosk-shell.ts"), "utf8")).not.toContain("phone-online");
    expect(DEVICE_STORAGE_KEY).toBe("olr.device.v1");
  });

  it("copies practice records, the lock, and the handover note once", async () => {
    const factory = new IDBFactory();
    const bucket = memory(JSON.stringify(legacyQueue));
    const prepared = await prepareLegacyMigration(factory, bucket.read);
    expect(prepared).toMatchObject({ ok: true, outcome: "pending" });
    const again = await prepareLegacyMigration(factory, bucket.read);
    expect(again).toMatchObject({ ok: true, outcome: "pending" });
    const pending = await inspectLocalDatabase(factory);
    expect(pending.state?.items).toHaveLength(1);
    expect(pending.state?.releases).toHaveLength(1);
    const finished = await migrateLegacyDevice(factory, bucket.read);
    expect(finished).toMatchObject({ ok: true, outcome: "verified" });
    const repeated = await migrateLegacyDevice(factory, bucket.read);
    expect(repeated).toMatchObject({ ok: true, outcome: "already-verified" });
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.state?.items).toHaveLength(1);
    expect(inspected.state?.lock?.lockId).toBe("lock-1");
    expect(bucket.current()).toBe(JSON.stringify(legacyQueue));
  });

  it("keeps one copy when two migrations run together", async () => {
    const factory = new IDBFactory();
    const bucket = memory(JSON.stringify(legacyQueue));
    const results = await Promise.all([
      migrateLegacyDevice(factory, bucket.read),
      migrateLegacyDevice(factory, bucket.read),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.state?.items).toHaveLength(1);
    expect(inspected.state?.releases).toHaveLength(1);
    expect(bucket.current()).toBe(JSON.stringify(legacyQueue));
  });

  it("stops when the backup changes and keeps both copies", async () => {
    const factory = new IDBFactory();
    const bucket = memory(JSON.stringify(legacyQueue));
    expect((await openVerifiedQueue(factory, bucket.read)).ok).toBe(true);
    bucket.set(JSON.stringify({ ...legacyQueue, items: [] }));
    const changed = await openVerifiedQueue(factory, bucket.read);
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.message).toMatch(/not deleted/i);
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.state?.items).toHaveLength(1);
    expect(bucket.current()).not.toContain("item-1");
  });

  it("does not treat an unreadable backup as an empty queue", async () => {
    const factory = new IDBFactory();
    const broken = await openVerifiedQueue(factory, () => "{");
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.message).toMatch(/not deleted/i);
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.status).not.toBe("verified");
  });

  it("hides the roster before a failed server revocation and keeps the mark", async () => {
    const factory = new IDBFactory();
    const bucket = memory(null);
    await saveMark(factory);
    const order: string[] = [];
    let revoked = false;
    await performPhoneSignOut({
      factory,
      readRaw: bucket.read,
      account: owner,
      authSessionId: "session-1",
      revoke: async () => {
        order.push("revoke");
        revoked = true;
        return false;
      },
      onPrivacy: (_message, claimLocked) => {
        order.push(claimLocked ? "hide" : "fail");
      },
    });
    expect(order[0]).toBe("hide");
    expect(revoked).toBe(true);
    expect(order.at(-1)).toBe("hide");
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    expect(catalog.events).toHaveLength(1);
    expect(catalog.events[0]).toMatchObject({ userId: owner.userId, centerId: owner.centerId, clientEventId: "event-kept" });
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.state?.lock?.authSessionId).toBe("session-1");
    expect(bucket.current()).toBeNull();
  });

  it("does not call the server when the lock cannot be stored", async () => {
    const factory = new IDBFactory();
    const bucket = memory(null);
    await saveMark(factory);
    let calls = 0;
    const messages: string[] = [];
    await performPhoneSignOut({
      factory,
      readRaw: bucket.read,
      account: owner,
      authSessionId: "session-1",
      writeLock: async () => false,
      revoke: async () => {
        calls += 1;
        return true;
      },
      onPrivacy: (message, claimLocked) => {
        messages.push(message);
        expect(claimLocked).toBe(false);
      },
    });
    expect(calls).toBe(0);
    expect(messages[0]).toMatch(/not completed/i);
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok && catalog.events).toHaveLength(1);
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.state?.lock).toBeNull();
  });

  it("stays locked for the same server session and opens for a new one", async () => {
    const factory = new IDBFactory();
    const bucket = memory(null);
    await saveMark(factory);
    await performPhoneSignOut({
      factory,
      readRaw: bucket.read,
      account: owner,
      authSessionId: "session-1",
      revoke: async () => true,
      onPrivacy: () => undefined,
    });
    const same = await applyOnlineAccess({
      factory,
      readRaw: bucket.read,
      userId: owner.userId,
      centerId: owner.centerId,
      authSessionId: "session-1",
      home: "/teacher",
      mode: "guard",
    });
    expect(same).toMatchObject({ type: "hidden", retryRevoke: true });
    expect(childrenVisible(same)).toBe(false);
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.state?.lock?.authSessionId).toBe("session-1");
    const next = await applyOnlineAccess({
      factory,
      readRaw: bucket.read,
      userId: owner.userId,
      centerId: owner.centerId,
      authSessionId: "session-2",
      home: "/teacher",
      mode: "guard",
    });
    expect(next).toEqual({ type: "show" });
    expect(childrenVisible(next)).toBe(true);
    const cleared = await inspectLocalDatabase(factory);
    expect(cleared.state?.lock).toBeNull();
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok && catalog.events[0]).toMatchObject({ userId: owner.userId, centerId: owner.centerId });
    expect(await readActiveAccount(factory)).toMatchObject({ userId: owner.userId, authSessionId: "session-2" });
  });

  it("blocks another account or center, and a handover does not transfer the mark", async () => {
    const factory = new IDBFactory();
    const bucket = memory(null);
    await saveMark(factory);
    await performPhoneSignOut({
      factory,
      readRaw: bucket.read,
      account: owner,
      authSessionId: "session-1",
      revoke: async () => false,
      onPrivacy: () => undefined,
    });
    const mismatch = await applyOnlineAccess({
      factory,
      readRaw: bucket.read,
      userId: other.userId,
      centerId: other.centerId,
      authSessionId: "session-9",
      home: "/teacher",
      mode: "guard",
    });
    expect(mismatch).toEqual({ type: "blocked" });
    expect(childrenVisible(mismatch)).toBe(false);
    const wrongCenter = await applyOnlineAccess({
      factory,
      readRaw: bucket.read,
      userId: otherCenter.userId,
      centerId: otherCenter.centerId,
      authSessionId: "session-8",
      home: "/teacher",
      mode: "guard",
    });
    expect(wrongCenter).toEqual({ type: "blocked" });
    const locked = await inspectLocalDatabase(factory);
    const release = await addVerifiedRelease({
      factory,
      readRaw: bucket.read,
      release: {
        userId: owner.userId,
        centerId: owner.centerId,
        lockId: locked.state?.lock?.lockId ?? "",
        itemCount: 1,
      },
    });
    expect(release.ok).toBe(true);
    const handed = await applyOnlineAccess({
      factory,
      readRaw: bucket.read,
      userId: other.userId,
      centerId: other.centerId,
      authSessionId: "session-9",
      home: "/teacher",
      mode: "continue",
    });
    expect(handed).toEqual({ type: "enter", home: "/teacher" });
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok && catalog.events).toHaveLength(1);
    if (!catalog.ok) return;
    expect(catalog.events[0]).toMatchObject({ userId: owner.userId, centerId: owner.centerId });
    expect(catalog.events.some((event) => event.userId === other.userId)).toBe(false);
    expect(await readActiveAccount(factory)).toMatchObject({ userId: other.userId, centerId: other.centerId });
  });

  it("sends an expired sign-in to the door and does not unlock from the shell", () => {
    expect(openingDestination(null)).toEqual({ type: "login", href: "/session/clear" });
    const shell = readFileSync(join(root, "lib", "device", "kiosk-shell.ts"), "utf8");
    expect(shell).not.toContain("clearAccountLock");
    expect(shell).not.toContain("openSession");
    expect(readFileSync(join(root, "app", "sw.ts"), "utf8")).not.toContain("olr_session");
    expect(readFileSync(join(root, "lib", "device", "revoke-session.ts"), "utf8")).not.toContain("document.cookie");
  });

  it("keeps the pending mark when an old precache bucket is deleted", async () => {
    const factory = new IDBFactory();
    const bucket = memory(null);
    await saveMark(factory);
    await performPhoneSignOut({
      factory,
      readRaw: bucket.read,
      account: owner,
      authSessionId: "session-1",
      revoke: async () => false,
      onPrivacy: () => undefined,
    });
    const deleted = await deleteObsoleteCaches(
      {
        keys: async () => ["serwist-precache-v2-https://center.test/", "olr-local"],
        delete: async (name) => name.includes("-precache-"),
      },
      "olr-shell-precache",
      "https://center.test/",
    );
    expect(deleted).toEqual(["serwist-precache-v2-https://center.test/"]);
    const catalog = await readLocalCatalog(factory);
    expect(catalog.ok && catalog.events).toHaveLength(1);
    const inspected = await inspectLocalDatabase(factory);
    expect(inspected.state?.lock?.authSessionId).toBe("session-1");
  });
});
