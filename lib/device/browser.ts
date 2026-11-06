"use client";

import type { StoredDevice } from "./phone-check";
import {
  addDeviceItem,
  addRelease,
  clearLock,
  emptyDeviceState,
  lockDevice,
  parseDeviceState,
  type DeviceState,
} from "./shared-device";

const STORAGE_KEY = "olr.device.v1";

function readRaw(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function loadDevice(): DeviceState {
  const raw = readRaw();
  if (raw === null) return emptyDeviceState();
  return parseDeviceState(raw) ?? emptyDeviceState();
}

// The opening check uses this instead of loadDevice(). A missing key is a phone
// with nothing saved. A broken value is not an empty queue: replacing it, or
// treating it as empty, could hide unsent records and let the next person in.
export function readStoredDevice(): StoredDevice {
  try {
    const raw = readRaw();
    if (raw === null) return { status: "ready", state: emptyDeviceState() };
    const parsed = parseDeviceState(raw);
    if (parsed === null) return { status: "unavailable" };
    return { status: "ready", state: parsed };
  } catch {
    return { status: "unavailable" };
  }
}

// A broken saved value is left in place. Replacing it would delete unsent records.
export function saveDevice(state: DeviceState): boolean {
  try {
    const existing = readRaw();
    if (existing !== null && parseDeviceState(existing) === null) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function lockCurrentAccount(userId: string, centerId: string): boolean {
  const lockId = crypto.randomUUID();
  const next = lockDevice(loadDevice(), { lockId, userId, centerId });
  return saveDevice(next);
}

export function rememberRelease(release: {
  userId: string;
  centerId: string;
  lockId: string;
  itemCount: number;
}): boolean {
  return saveDevice(addRelease(loadDevice(), release));
}

export function unlockCurrentDevice(): boolean {
  return saveDevice(clearLock(loadDevice()));
}

export function savePracticeRecord(userId: string, centerId: string): boolean {
  const item = {
    id: crypto.randomUUID(),
    userId,
    centerId,
    kind: "practice",
    summary: "Practice record. No personal details.",
    createdAt: new Date().toISOString(),
  };
  return saveDevice(addDeviceItem(loadDevice(), item));
}

export function waitingCount(userId: string): number {
  return loadDevice().items.filter((item) => item.userId === userId).length;
}
