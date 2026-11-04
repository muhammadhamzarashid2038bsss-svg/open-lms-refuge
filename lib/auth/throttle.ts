import { createHash } from "node:crypto";
import { FAILED_ATTEMPTS_BEFORE_LOCK, LOCKOUT_MS } from "./constants";

export type ThrottleRow = {
  failedCount: number;
  lockedUntil: Date | null;
};

export type ThrottleStore = {
  get(bucketKey: string): Promise<ThrottleRow | null>;
  save(bucketKey: string, row: ThrottleRow): Promise<void>;
  clear(bucketKey: string): Promise<void>;
};

export function hashBucket(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

export function isLockActive(row: ThrottleRow | null, now: Date): boolean {
  return Boolean(row?.lockedUntil && row.lockedUntil.getTime() > now.getTime());
}

// A failed try adds one. The fifth try starts the 15-minute wait. Tries during
// the wait do not push the wait further out, so a script cannot extend it.
// When the wait is over, the counter starts again at one.
export async function recordFailure(
  store: ThrottleStore,
  bucketKey: string,
  now: Date,
  limit = FAILED_ATTEMPTS_BEFORE_LOCK,
): Promise<{ locked: boolean }> {
  const existing = await store.get(bucketKey);
  const lockExpired = Boolean(existing?.lockedUntil && existing.lockedUntil.getTime() <= now.getTime());
  const failedCount = lockExpired ? 1 : (existing?.failedCount ?? 0) + 1;
  const locked = failedCount >= limit;
  await store.save(bucketKey, {
    failedCount,
    lockedUntil: locked ? new Date(now.getTime() + LOCKOUT_MS) : null,
  });
  return { locked };
}
