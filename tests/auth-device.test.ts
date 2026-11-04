import { describe, expect, it } from "vitest";
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
