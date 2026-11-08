// Asks the browser whether this site may keep local data, and whether the
// reported free space covers one proposed write. IndexedDB is not encrypted.
// persist() returning true only asks the browser to avoid automatic eviction.
// The person can still clear the site, and this is not a promise that a
// saved mark can never disappear.
//
// Free space is quota minus usage, both in bytes, from estimate(). The
// numbers are a snapshot. They do not reserve space, so a later write can
// still fail. A denied persistence request, a failed or missing estimate, or
// too little free space must not be treated as a safely saved mark.

import { decideMarkWrite } from "./offline-decisions";

export type StorageProbe = {
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
};

export type StorageReadiness = {
  persistence: "granted" | "denied" | "unsupported" | "failed";
  estimate: "ready" | "unavailable" | "failed";
  quotaBytes: number | null;
  usageBytes: number | null;
  availableBytes: number | null;
  bytesNeeded: number;
  enoughRoom: boolean;
  readyForWrite: boolean;
  mayClaimSaved: boolean;
  evictionStillPossible: true;
};

function finiteByte(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function browserStorageProbe(): StorageProbe | null {
  const storage = globalThis.navigator?.storage;
  if (!storage || (typeof storage.persist !== "function" && typeof storage.estimate !== "function")) return null;
  return {
    persist: typeof storage.persist === "function" ? () => storage.persist() : undefined,
    estimate: typeof storage.estimate === "function" ? () => storage.estimate() : undefined,
  };
}

export async function checkStorageReadiness(
  bytesNeeded: number,
  storage: StorageProbe | null = browserStorageProbe(),
): Promise<StorageReadiness> {
  const bytesOk = Number.isInteger(bytesNeeded) && bytesNeeded >= 0;
  const result: StorageReadiness = {
    persistence: "unsupported",
    estimate: "unavailable",
    quotaBytes: null,
    usageBytes: null,
    availableBytes: null,
    bytesNeeded,
    enoughRoom: false,
    readyForWrite: false,
    mayClaimSaved: false,
    evictionStillPossible: true,
  };
  if (!storage) return result;

  if (typeof storage.persist === "function") {
    try {
      result.persistence = (await storage.persist()) ? "granted" : "denied";
    } catch {
      result.persistence = "failed";
    }
  }

  if (typeof storage.estimate !== "function") return result;
  let estimate: { usage?: number; quota?: number };
  try {
    estimate = await storage.estimate();
  } catch {
    result.estimate = "failed";
    return result;
  }
  if (!estimate || !finiteByte(estimate.quota) || !finiteByte(estimate.usage)) {
    result.estimate = "unavailable";
    return result;
  }
  const available = Math.max(0, estimate.quota - estimate.usage);
  result.estimate = "ready";
  result.quotaBytes = estimate.quota;
  result.usageBytes = estimate.usage;
  result.availableBytes = available;
  result.enoughRoom = bytesOk && available >= bytesNeeded;
  result.readyForWrite = result.enoughRoom;
  result.mayClaimSaved = result.readyForWrite && result.persistence === "granted";
  return result;
}

/// A mark may be described as saved only when this check allows it. The
/// attendance save asks before it writes.
export function claimForStorage(readiness: StorageReadiness) {
  return decideMarkWrite(readiness.mayClaimSaved);
}
