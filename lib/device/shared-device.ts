// Records waiting to be sent live on the phone, not on the server.
// Logout must not delete them. It locks the phone so the next person cannot
// read them. The same person can sign in again, or a staff member can write
// a handover note. Either one unlocks the phone. The records stay under the
// account that created them.
//
// The lock has an id from this phone. A handover note points at that id.
// Phone clocks are often wrong, so the note is not matched by time.

export type DeviceItem = {
  id: string;
  userId: string;
  centerId: string;
  kind: string;
  summary: string;
  createdAt: string;
};

export type DeviceRelease = {
  userId: string;
  centerId: string;
  lockId: string;
  itemCount: number;
};

export type DeviceLock = {
  lockId: string;
  userId: string;
  centerId: string;
};

export type DeviceState = {
  lock: DeviceLock | null;
  items: DeviceItem[];
  releases: DeviceRelease[];
};

export function emptyDeviceState(): DeviceState {
  return { lock: null, items: [], releases: [] };
}

export function parseDeviceState(raw: string): DeviceState | null {
  try {
    const value = JSON.parse(raw) as Partial<DeviceState>;
    if (!value || !Array.isArray(value.items) || !Array.isArray(value.releases)) return null;
    return {
      lock: value.lock ?? null,
      items: value.items,
      releases: value.releases,
    };
  } catch {
    return null;
  }
}

export function addDeviceItem(state: DeviceState, item: DeviceItem): DeviceState {
  return { ...state, items: [...state.items, item] };
}

export function lockDevice(state: DeviceState, lock: DeviceLock): DeviceState {
  return { ...state, lock };
}

export function clearLock(state: DeviceState): DeviceState {
  return { ...state, lock: null };
}

export function addRelease(state: DeviceState, release: DeviceRelease): DeviceState {
  return { ...state, releases: [...state.releases, release] };
}

function pendingForLock(state: DeviceState): DeviceItem[] {
  if (!state.lock) return [];
  return state.items.filter(
    (item) => item.userId === state.lock?.userId && item.centerId === state.lock?.centerId,
  );
}

function releasedThisLock(state: DeviceState): boolean {
  if (!state.lock) return false;
  return state.releases.some(
    (release) =>
      release.lockId === state.lock?.lockId &&
      release.userId === state.lock.userId &&
      release.centerId === state.lock.centerId,
  );
}

export function allowSignIn(
  state: DeviceState,
  next: { userId: string; centerId: string },
): { ok: true } | { ok: false; itemCount: number; lockedUserId: string; centerId: string; lockId: string } {
  if (!state.lock) return { ok: true };
  if (state.lock.userId === next.userId && state.lock.centerId === next.centerId) return { ok: true };
  const pending = pendingForLock(state);
  if (pending.length === 0 || releasedThisLock(state)) return { ok: true };
  return {
    ok: false,
    itemCount: pending.length,
    lockedUserId: state.lock.userId,
    centerId: state.lock.centerId,
    lockId: state.lock.lockId,
  };
}

// While the phone is locked, nobody sees the queue, including the owner.
// After they sign in again the lock is cleared and only their own rows return.
export function visibleItems(state: DeviceState, userId: string): DeviceItem[] {
  if (state.lock) return [];
  return state.items.filter((item) => item.userId === userId);
}
