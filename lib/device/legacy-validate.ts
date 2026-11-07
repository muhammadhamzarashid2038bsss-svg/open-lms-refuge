// Strict reading of the existing phone queue. A missing key means this phone
// has nothing saved. A value that cannot be parsed, or a queue with a broken
// lock, practice item, or handover note, is not an empty queue.

import type { DeviceItem, DeviceLock, DeviceRelease, DeviceState } from "./shared-device";

export type LegacyRead =
  | { status: "missing" }
  | { status: "unreadable" }
  | { status: "invalid" }
  | { status: "ready"; raw: string; state: DeviceState };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function presentString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function jsonCopy(value: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const copy = JSON.parse(JSON.stringify(value)) as unknown;
    if (!isRecord(copy)) return null;
    return copy;
  } catch {
    return null;
  }
}

function copyItem(value: unknown): DeviceItem | null {
  if (!isRecord(value)) return null;
  const copy = jsonCopy(value);
  // sourceIndex is the IndexedDB key added during the copy. An original
  // practice item does not have it. Rejecting it avoids hiding a field.
  if (!copy || "sourceIndex" in copy) return null;
  if (
    !presentString(copy.id) ||
    !presentString(copy.userId) ||
    !presentString(copy.centerId) ||
    !presentString(copy.kind) ||
    !presentString(copy.summary) ||
    !presentString(copy.createdAt)
  ) {
    return null;
  }
  return copy as DeviceItem;
}

function copyRelease(value: unknown): DeviceRelease | null {
  if (!isRecord(value)) return null;
  const copy = jsonCopy(value);
  if (!copy || "sourceIndex" in copy) return null;
  if (!presentString(copy.userId) || !presentString(copy.centerId) || !presentString(copy.lockId)) return null;
  if (typeof copy.itemCount !== "number" || !Number.isInteger(copy.itemCount) || copy.itemCount < 0) return null;
  return copy as DeviceRelease;
}

function copyLock(value: unknown): DeviceLock | null {
  if (!isRecord(value)) return null;
  const copy = jsonCopy(value);
  if (!copy) return null;
  if (!presentString(copy.lockId) || !presentString(copy.userId) || !presentString(copy.centerId)) return null;
  return copy as DeviceLock;
}

/// Checks every field the current phone queue can hold: the lock, each
/// practice item, and each handover note. Extra saved fields are kept.
export function validateDeviceState(value: unknown): DeviceState | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.items) || !Array.isArray(value.releases)) return null;
  let lock: DeviceLock | null = null;
  if (value.lock !== null && value.lock !== undefined) {
    lock = copyLock(value.lock);
    if (!lock) return null;
  }
  const items: DeviceItem[] = [];
  for (const item of value.items) {
    const copied = copyItem(item);
    if (!copied) return null;
    items.push(copied);
  }
  const releases: DeviceRelease[] = [];
  for (const release of value.releases) {
    const copied = copyRelease(release);
    if (!copied) return null;
    releases.push(copied);
  }
  return { lock, items, releases };
}

/// null is a missing key. Any other string is parsed. Broken text is
/// unreadable. A parsed object with a missing or broken field is invalid.
export function readLegacyText(raw: string | null): LegacyRead {
  if (raw === null) return { status: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "unreadable" };
  }
  const state = validateDeviceState(parsed);
  if (!state) return { status: "invalid" };
  return { status: "ready", raw, state };
}

export function readLegacySource(readRaw: () => string | null): LegacyRead {
  try {
    return readLegacyText(readRaw());
  } catch {
    return { status: "unreadable" };
  }
}

/// Hash of the exact saved text, not of a rewritten object. Two texts that
/// look the same after parsing still differ when the characters differ.
export async function fingerprintText(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
