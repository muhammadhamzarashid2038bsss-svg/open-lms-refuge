import { describe, expect, it } from "vitest";
import {
  decidePhoneCheck,
  openingDestination,
  settlePhoneCheck,
  type StoredDevice,
} from "../lib/device/phone-check";
import {
  addDeviceItem,
  addRelease,
  allowSignIn,
  clearLock,
  emptyDeviceState,
  lockDevice,
  parseDeviceState,
  visibleItems,
} from "../lib/device/shared-device";

const owner = { userId: "user-a", centerId: "center-a" };
const next = { userId: "user-b", centerId: "center-a" };

describe("shared device lock", () => {
  it("keeps unsent records on sign-out and hides them from the next person", () => {
    const saved = addDeviceItem(emptyDeviceState(), {
      id: "item-1",
      userId: owner.userId,
      centerId: owner.centerId,
      kind: "practice",
      summary: "Practice record",
      createdAt: "2026-11-05T00:00:00.000Z",
    });
    const locked = lockDevice(saved, { lockId: "lock-1", ...owner });
    expect(locked.items).toHaveLength(1);
    expect(visibleItems(locked, owner.userId)).toEqual([]);
    expect(allowSignIn(locked, next)).toMatchObject({ ok: false, itemCount: 1 });
    expect(allowSignIn(locked, owner)).toEqual({ ok: true });

    const reopened = clearLock(locked);
    expect(visibleItems(reopened, owner.userId)).toHaveLength(1);
    expect(visibleItems(reopened, next.userId)).toEqual([]);
  });

  it("lets the next account in after a handover without deleting the records", () => {
    const locked = lockDevice(
      addDeviceItem(emptyDeviceState(), {
        id: "item-1",
        userId: owner.userId,
        centerId: owner.centerId,
        kind: "practice",
        summary: "Practice record",
        createdAt: "2026-11-05T00:00:00.000Z",
      }),
      { lockId: "lock-1", ...owner },
    );
    const released = addRelease(locked, { ...owner, lockId: "lock-1", itemCount: 1 });
    expect(released.items).toHaveLength(1);
    expect(allowSignIn(released, next)).toEqual({ ok: true });
    const after = clearLock(released);
    expect(visibleItems(after, next.userId)).toEqual([]);
    expect(visibleItems(after, owner.userId)).toHaveLength(1);
  });

  it("does not block the next person when nothing is waiting", () => {
    const locked = lockDevice(emptyDeviceState(), { lockId: "lock-2", ...owner });
    expect(allowSignIn(locked, next)).toEqual({ ok: true });
  });

  it("refuses to treat a broken saved value as an empty queue", () => {
    expect(parseDeviceState("{")).toBeNull();
    const parsed = parseDeviceState(JSON.stringify({ items: [], releases: [] }));
    expect(parsed).not.toBeNull();
    expect(parsed?.lock).toBeNull();
  });
});

const admin = { id: "user-admin", centerId: "center-a", role: "ADMIN" as const };

function ready(state: ReturnType<typeof emptyDeviceState>): StoredDevice {
  return { status: "ready", state };
}

describe("opening phone check", () => {
  it("sends an unauthenticated phone with nothing waiting to the sign-in doors", () => {
    expect(openingDestination(null)).toEqual({ type: "login", href: "/session/clear" });
  });

  it("sends an authenticated phone with nothing waiting to that role's home", () => {
    const destination = openingDestination(admin);
    expect(destination).toEqual({ type: "phone", userId: admin.id, centerId: admin.centerId, home: "/admin" });
    if (destination.type !== "phone") return;
    expect(
      decidePhoneCheck({
        stored: ready(emptyDeviceState()),
        userId: destination.userId,
        centerId: destination.centerId,
        home: destination.home,
        mode: "continue",
      }),
    ).toEqual({ type: "enter", home: "/admin" });
  });

  it("keeps another person's unsent records on the release path", () => {
    const locked = lockDevice(
      addDeviceItem(emptyDeviceState(), {
        id: "item-1",
        userId: owner.userId,
        centerId: owner.centerId,
        kind: "practice",
        summary: "Practice record",
        createdAt: "2026-11-05T00:00:00.000Z",
      }),
      { lockId: "lock-1", ...owner },
    );
    const decision = decidePhoneCheck({
      stored: ready(locked),
      userId: next.userId,
      centerId: next.centerId,
      home: "/admin",
      mode: "continue",
    });
    expect(decision).toEqual({ type: "release" });
    expect(locked.items).toHaveLength(1);
    expect(
      decidePhoneCheck({
        stored: ready(locked),
        userId: owner.userId,
        centerId: owner.centerId,
        home: "/student",
        mode: "continue",
      }),
    ).toEqual({ type: "enter", home: "/student" });
    expect(locked.items).toHaveLength(1);
  });

  it("does not treat storage that is still opening as an empty queue", () => {
    const loading = decidePhoneCheck({
      stored: { status: "loading" },
      userId: next.userId,
      centerId: next.centerId,
      home: "/admin",
      mode: "continue",
    });
    expect(loading).toEqual({ type: "wait" });
    const first = settlePhoneCheck(null, "continue:user-b:center-a", loading);
    expect(first.perform).toBeNull();
    const later = settlePhoneCheck(first.already, "continue:user-b:center-a", {
      type: "enter",
      home: "/admin",
    });
    expect(later.perform).toEqual({ type: "enter", home: "/admin" });
  });

  it("stops when the phone check cannot read saved records", () => {
    const decision = decidePhoneCheck({
      stored: { status: "unavailable" },
      userId: next.userId,
      centerId: next.centerId,
      home: "/admin",
      mode: "continue",
    });
    expect(decision.type).toBe("error");
    if (decision.type === "error") expect(decision.message).toMatch(/not deleted/i);
  });

  it("performs one navigation for a finished check", () => {
    const key = "continue:user-admin:center-a";
    const enter = { type: "enter" as const, home: "/admin" };
    const first = settlePhoneCheck(null, key, enter);
    const second = settlePhoneCheck(first.already, key, enter);
    expect(first.perform).toEqual(enter);
    expect(second.perform).toBeNull();
  });
});
