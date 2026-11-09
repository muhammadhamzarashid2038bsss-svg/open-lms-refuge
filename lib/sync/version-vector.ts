// A version vector is a scoreboard: each phone has a count of how many times
// it has saved that one record. A missing phone means zero. Phone clocks are
// not an input to this file. Two edits are ordered only when one scoreboard
// is ahead on every phone and strictly ahead on at least one.

export const MAX_VECTOR_DEVICES = 16;

const DEVICE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type VersionVector = Record<string, number>;

export type VectorOrder = "dominates" | "dominated" | "equal" | "concurrent";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/// Returns the scoreboard, or null when the value is not a safe one.
/// Keys are device ids. Counters are zero or a positive safe integer.
export function parseVersionVector(value: unknown): VersionVector | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > MAX_VECTOR_DEVICES) return null;
  const vector: VersionVector = {};
  const seen = new Set<string>();
  for (const key of keys) {
    if (key.length !== 36) return null;
    const deviceId = key.toLowerCase();
    if (!DEVICE_KEY.test(deviceId) || seen.has(deviceId)) return null;
    seen.add(deviceId);
    const counter = value[key];
    if (typeof counter !== "number" || !Number.isSafeInteger(counter) || counter < 0 || Object.is(counter, -0)) return null;
    if (counter > 0) vector[deviceId] = counter;
  }
  return vector;
}

export function canonicalVector(vector: VersionVector): VersionVector {
  const sorted: VersionVector = {};
  for (const key of Object.keys(vector).sort()) sorted[key] = vector[key]!;
  return sorted;
}

function counterAt(vector: VersionVector, deviceId: string): number {
  return vector[deviceId] ?? 0;
}

function deviceIds(left: VersionVector, right: VersionVector): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])];
}

/// `dominates` means left happened after right. `dominated` means left is the
/// earlier edit. `concurrent` means each side has an edit the other never saw.
export function compareVersionVectors(left: VersionVector, right: VersionVector): VectorOrder {
  let greater = false;
  let less = false;
  for (const deviceId of deviceIds(left, right)) {
    const a = counterAt(left, deviceId);
    const b = counterAt(right, deviceId);
    if (a > b) greater = true;
    else if (a < b) less = true;
  }
  if (greater && less) return "concurrent";
  if (greater) return "dominates";
  if (less) return "dominated";
  return "equal";
}

/// The highest count each phone has reached. Used when a teacher resolves a conflict.
export function mergeVersionVectors(left: VersionVector, right: VersionVector): VersionVector {
  const merged: VersionVector = {};
  for (const deviceId of deviceIds(left, right)) {
    const counter = Math.max(counterAt(left, deviceId), counterAt(right, deviceId));
    if (counter > 0) merged[deviceId] = counter;
  }
  return canonicalVector(merged);
}

/// Adds one to this phone's own count. Returns null if the id is not a device
/// id or the count cannot grow without leaving safe integer range.
export function incrementDeviceCounter(vector: VersionVector, deviceId: string): VersionVector | null {
  const parsed = parseVersionVector({ [deviceId]: 1 });
  const key = deviceId.toLowerCase();
  if (!parsed || !parsed[key]) return null;
  const current = counterAt(vector, key);
  if (current >= Number.MAX_SAFE_INTEGER) return null;
  return canonicalVector({ ...vector, [key]: current + 1 });
}

/// True when `incoming` is the current scoreboard plus a higher count for this
/// phone only. Raising another phone's count is not treated as a normal save.
export function isOwnIncrement(current: VersionVector, incoming: VersionVector, deviceId: string): boolean {
  const key = deviceId.toLowerCase();
  if (counterAt(incoming, key) <= counterAt(current, key)) return false;
  for (const id of deviceIds(current, incoming)) {
    if (id === key) continue;
    if (counterAt(incoming, id) !== counterAt(current, id)) return false;
  }
  return true;
}

/// A first save may mention only the phone that saved it.
export function isSingleDeviceVector(vector: VersionVector, deviceId: string): boolean {
  const key = deviceId.toLowerCase();
  const keys = Object.keys(vector);
  return keys.length === 1 && keys[0] === key && (vector[key] ?? 0) >= 1;
}
