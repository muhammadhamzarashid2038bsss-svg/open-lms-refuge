// The verified IndexedDB queue is the only place new phone records are written.
// olr.device.v1 stays as the backup from the moment the copy was checked.
// An older tab can still change that backup. This module cannot stop that
// write, so any change makes the phone stop. Neither store is deleted.

import { readLocalCatalog } from "./local-attendance";
import {
  appendDeviceItem,
  appendDeviceRelease,
  inspectLocalDatabase,
  migrateLegacyDevice,
  readActiveAccount,
  writeAccountLock,
  type ActiveAccount,
} from "./local-db";
import { fingerprintText, readLegacySource } from "./legacy-validate";
import {
  MISMATCHED_RECORDS,
  UNCHECKED_RECORDS,
  UNREADABLE_RECORDS,
  decideQueueSource,
  decideRevokeResult,
  decideSignOut,
  mergeWaitingItems,
  type AccountRef,
} from "./offline-decisions";
import { emptyDeviceState, type DeviceItem, type DeviceLock, type DeviceRelease, type DeviceState } from "./shared-device";

export const PHONE_PRIVACY_EVENT = "olr-phone-privacy";

export type PhonePrivacyDetail = {
  message: string;
  claimLocked: boolean;
};

export type VerifiedQueue = {
  ok: true;
  state: DeviceState;
  active: ActiveAccount | null;
  backup: string | null;
};

export type QueueFailure = { ok: false; message: string };

function failure(reason: string): QueueFailure {
  if (reason === "mismatch" || reason === "changed") return { ok: false, message: MISMATCHED_RECORDS };
  if (reason === "pending" || reason === "not-ready" || reason === "none") return { ok: false, message: UNCHECKED_RECORDS };
  return { ok: false, message: UNREADABLE_RECORDS };
}

/// Runs the existing copy, then checks the backup again. A pending copy, a
/// damaged database, or a backup that no longer matches the checked hash
/// stops the phone. The backup text is not rewritten.
async function acceptVerifiedCopy(
  factory: IDBFactory,
  backup: string | null,
  state: DeviceState,
  importedFingerprint: string | null,
  importedPresence: "missing" | "present" | null,
): Promise<VerifiedQueue | QueueFailure> {
  const legacy = readLegacySource(() => backup);
  if (legacy.status === "unreadable" || legacy.status === "invalid") return failure(legacy.status);
  const legacyFingerprint = legacy.status === "ready" ? await fingerprintText(legacy.raw) : null;
  const source = decideQueueSource({
    legacy: legacy.status === "missing" ? { status: "ready", state: emptyDeviceState() } : { status: "ready", state: legacy.state },
    importStatus: "verified",
    legacyFingerprint,
    importedFingerprint,
    legacyPresence: legacy.status === "missing" ? "missing" : "present",
    importedPresence,
  });
  if (source.type === "stop") return { ok: false, message: source.message };
  if (source.type !== "indexed") return failure("not-ready");
  const active = await readActiveAccount(factory);
  if (active === "unreadable") return failure("unreadable");
  return { ok: true, state, active, backup };
}

export async function openVerifiedQueue(factory: IDBFactory, readRaw: () => string | null): Promise<VerifiedQueue | QueueFailure> {
  let first: string | null;
  try {
    first = readRaw();
  } catch {
    return failure("unreadable");
  }
  // A verified copy is not compared to the backup row by row. New practice
  // records live only in IndexedDB. Calling the copy again would treat those
  // new rows as damage and hide them. Only the saved hash is checked.
  const existing = await inspectLocalDatabase(factory);
  if (existing.status === "verified" && existing.state) {
    let latest: string | null;
    try {
      latest = readRaw();
    } catch {
      return failure("unreadable");
    }
    if (latest !== first) return { ok: false, message: MISMATCHED_RECORDS };
    return acceptVerifiedCopy(factory, latest, existing.state, existing.fingerprint, existing.presence);
  }
  const migrated = await migrateLegacyDevice(factory, () => first);
  if (!migrated.ok) return failure(migrated.reason);
  let latest: string | null;
  try {
    latest = readRaw();
  } catch {
    return failure("unreadable");
  }
  if (latest !== first) return { ok: false, message: MISMATCHED_RECORDS };
  const inspected = await inspectLocalDatabase(factory);
  if (inspected.status !== "verified" || !inspected.state) return failure(inspected.status);
  return acceptVerifiedCopy(factory, latest, inspected.state, inspected.fingerprint, inspected.presence);
}

export async function withWaiting(factory: IDBFactory, state: DeviceState): Promise<{ ok: true; state: DeviceState } | QueueFailure> {
  let catalog: Awaited<ReturnType<typeof readLocalCatalog>>;
  try {
    catalog = await readLocalCatalog(factory);
  } catch {
    return failure("unreadable");
  }
  if (!catalog.ok) return { ok: false, message: catalog.message };
  const merged = mergeWaitingItems(
    state.items.map((item) => ({
      id: item.id,
      userId: item.userId,
      centerId: item.centerId,
      createdAt: item.createdAt,
    })),
    catalog.events.map((event) => ({
      clientEventId: event.clientEventId,
      userId: event.userId,
      centerId: event.centerId,
      syncState: event.syncState,
      queuedAt: event.recordedAt,
    })),
  );
  if (!merged.ok) return failure("unreadable");
  return { ok: true, state: { lock: state.lock, items: merged.items, releases: state.releases } };
}

/// Lock first. Hide next. Ask the server last. A failed lock does not call revoke.
export async function performPhoneSignOut(input: {
  factory: IDBFactory;
  readRaw: () => string | null;
  account: AccountRef;
  authSessionId: string;
  revoke: () => Promise<boolean>;
  onPrivacy: (message: string, claimLocked: boolean) => void;
  writeLock?: (factory: IDBFactory, lock: DeviceLock) => Promise<boolean>;
}): Promise<void> {
  const queue = await openVerifiedQueue(input.factory, input.readRaw);
  if (!queue.ok) {
    input.onPrivacy(queue.message, false);
    return;
  }
  if (input.authSessionId.trim() === "" || input.account.userId.trim() === "" || input.account.centerId.trim() === "") {
    input.onPrivacy(decideSignOut(false).message, false);
    return;
  }
  const lock: DeviceLock = {
    lockId: crypto.randomUUID(),
    userId: input.account.userId,
    centerId: input.account.centerId,
    authSessionId: input.authSessionId,
  };
  const written = await (input.writeLock ?? writeAccountLock)(input.factory, lock);
  const decision = decideSignOut(written);
  input.onPrivacy(decision.message, decision.claimLocked);
  if (!decision.mayCallServer) return;
  let revoked = false;
  try {
    revoked = await input.revoke();
  } catch {
    revoked = false;
  }
  input.onPrivacy(decideRevokeResult({ lockWritten: true, serverRevoked: revoked }).message, true);
}

export async function addVerifiedPractice(input: {
  factory: IDBFactory;
  readRaw: () => string | null;
  account: AccountRef;
}): Promise<{ ok: true } | QueueFailure> {
  const queue = await openVerifiedQueue(input.factory, input.readRaw);
  if (!queue.ok) return queue;
  const item: DeviceItem = {
    id: crypto.randomUUID(),
    userId: input.account.userId,
    centerId: input.account.centerId,
    kind: "practice",
    summary: "Practice record. No personal details.",
    createdAt: new Date().toISOString(),
  };
  const saved = await appendDeviceItem(input.factory, item);
  if (!saved) return failure("unavailable");
  const checked = await openVerifiedQueue(input.factory, input.readRaw);
  if (!checked.ok) return checked;
  return { ok: true };
}

export async function addVerifiedRelease(input: {
  factory: IDBFactory;
  readRaw: () => string | null;
  release: DeviceRelease;
}): Promise<{ ok: true } | QueueFailure> {
  const queue = await openVerifiedQueue(input.factory, input.readRaw);
  if (!queue.ok) return queue;
  if (!queue.state.lock || queue.state.lock.lockId !== input.release.lockId) return failure("invalid");
  if (queue.state.lock.userId !== input.release.userId || queue.state.lock.centerId !== input.release.centerId) return failure("invalid");
  const saved = await appendDeviceRelease(input.factory, input.release);
  if (!saved) return failure("unavailable");
  return { ok: true };
}

export async function waitingForAccount(input: {
  factory: IDBFactory;
  readRaw: () => string | null;
  account: AccountRef;
}): Promise<{ ok: true; count: number; state: DeviceState } | QueueFailure> {
  const queue = await openVerifiedQueue(input.factory, input.readRaw);
  if (!queue.ok) return queue;
  const waiting = await withWaiting(input.factory, queue.state);
  if (!waiting.ok) return waiting;
  const count = waiting.state.items.filter(
    (item) => item.userId === input.account.userId && item.centerId === input.account.centerId,
  ).length;
  return { ok: true, count, state: waiting.state };
}
