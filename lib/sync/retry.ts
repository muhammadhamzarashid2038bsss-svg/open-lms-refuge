// Retry timing for attendance that the server has not confirmed.
// The wait is stored later under the IndexedDB meta key sync:${centerId}:${userId}.
// This file does not open IndexedDB and does not change an attendance row.
// A reload can read the same key and continue the wait instead of starting again.
// Phone clocks jump, so a stored wait longer than the maximum delay is treated as due.

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;
export const RETRY_MAX_ATTEMPTS = 6;
export const RETRY_MAX_STORED_ATTEMPTS = 99;

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RETRY_CODE = /^[a-z][a-z0-9_]{0,39}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/;
const META_KEYS = ["key", "lastSuccessAt", "events"] as const;
const ENTRY_KEYS = ["attempts", "nextAttemptAt", "lastCode", "permanent"] as const;

export type SyncAccount = {
  centerId: string;
  userId: string;
};

/// Automatic passes honor the cap and the stored wait. Sync now is manual.
export type SyncPass = "automatic" | "manual";

export type SyncRetryEntry = {
  attempts: number;
  nextAttemptAt: string;
  lastCode: string;
  permanent: boolean;
};

export type SyncRetryMeta = {
  key: string;
  lastSuccessAt: string | null;
  events: Record<string, SyncRetryEntry>;
};

export type RetryFailureInput = {
  now: Date;
  code: string;
  /** A number from 0 through 1. Zero waits nothing. One waits the full upper bound. */
  randomUnit: number;
  permanent?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function safeAccountPart(value: string): boolean {
  return value.length > 0 && value.length <= 80 && !value.includes(":") && !value.includes("/");
}

export function canonicalInstant(value: string): boolean {
  return ISO_INSTANT.test(value) && new Date(value).toISOString() === value;
}

export function syncMetaKey(account: SyncAccount): string | null {
  if (!safeAccountPart(account.centerId) || !safeAccountPart(account.userId)) return null;
  return `sync:${account.centerId}:${account.userId}`;
}

export function emptySyncRetryMeta(account: SyncAccount): SyncRetryMeta | null {
  const key = syncMetaKey(account);
  if (!key) return null;
  return { key, lastSuccessAt: null, events: {} };
}

/// First failure waits at most the base delay. Each later failure doubles that
/// cap, and the cap never grows past five minutes. `failures` is how many
/// unsuccessful tries have already been recorded, starting at 1.
export function backoffUpperMs(failures: number): number | null {
  if (!Number.isInteger(failures) || failures < 1) return null;
  const shift = failures - 1;
  const factor = shift >= 31 ? Number.POSITIVE_INFINITY : 2 ** shift;
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_MS * factor);
}

/// Full jitter: every delay from zero through the upper bound is possible.
/// A value outside 0..1 is refused so a caller cannot stretch the wait.
export function backoffDelayMs(failures: number, randomUnit: number): number | null {
  const upper = backoffUpperMs(failures);
  if (upper === null) return null;
  if (typeof randomUnit !== "number" || !Number.isFinite(randomUnit) || randomUnit < 0 || randomUnit > 1) return null;
  return Math.min(upper, Math.floor(randomUnit * (upper + 1)));
}

export function withinAutomaticCap(attempts: number): boolean {
  return Number.isInteger(attempts) && attempts >= 0 && attempts < RETRY_MAX_ATTEMPTS;
}

export function isAutomaticAttemptDue(entry: SyncRetryEntry | undefined, now: Date): boolean {
  if (!entry) return true;
  if (entry.permanent || !withinAutomaticCap(entry.attempts)) return false;
  if (Number.isNaN(now.getTime()) || !canonicalInstant(entry.nextAttemptAt)) return false;
  const dueAt = new Date(entry.nextAttemptAt).getTime();
  if (dueAt - now.getTime() > RETRY_MAX_DELAY_MS) return true;
  return dueAt <= now.getTime();
}

/// Sync now can try a transient failure again after the automatic cap.
/// A permanent reject is never included in that pass.
export function isManualAttemptAllowed(entry: SyncRetryEntry | undefined): boolean {
  if (!entry) return true;
  return entry.permanent === false;
}

function readInstant(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || !canonicalInstant(value)) return undefined;
  return value;
}

function readEntry(value: unknown): SyncRetryEntry | null {
  if (!isRecord(value) || !exactKeys(value, ENTRY_KEYS)) return null;
  const { attempts, nextAttemptAt, lastCode, permanent } = value;
  if (!Number.isInteger(attempts) || (attempts as number) < 0 || (attempts as number) > RETRY_MAX_STORED_ATTEMPTS) return null;
  if (typeof nextAttemptAt !== "string" || !canonicalInstant(nextAttemptAt)) return null;
  if (typeof lastCode !== "string" || !RETRY_CODE.test(lastCode)) return null;
  if (typeof permanent !== "boolean") return null;
  return {
    attempts: attempts as number,
    nextAttemptAt,
    lastCode,
    permanent,
  };
}

/// Invalid meta is a failed read, not an empty queue. The caller must not
/// upload, and must not replace the stored object with a blank one.
export function parseSyncRetryMeta(value: unknown, account: SyncAccount): { ok: true; meta: SyncRetryMeta } | { ok: false } {
  const key = syncMetaKey(account);
  if (!key || !isRecord(value) || !exactKeys(value, META_KEYS) || value.key !== key) return { ok: false };
  const lastSuccessAt = readInstant(value.lastSuccessAt);
  if (lastSuccessAt === undefined) return { ok: false };
  if (!isRecord(value.events)) return { ok: false };
  const events: Record<string, SyncRetryEntry> = {};
  for (const [eventId, entry] of Object.entries(value.events)) {
    if (!SAFE_ID.test(eventId)) return { ok: false };
    const parsed = readEntry(entry);
    if (!parsed) return { ok: false };
    events[eventId] = parsed;
  }
  return { ok: true, meta: { key, lastSuccessAt, events } };
}

function copyMeta(meta: SyncRetryMeta): SyncRetryMeta {
  const events: Record<string, SyncRetryEntry> = {};
  for (const [eventId, entry] of Object.entries(meta.events)) {
    events[eventId] = { ...entry };
  }
  return { key: meta.key, lastSuccessAt: meta.lastSuccessAt, events };
}

/// Returns the next meta object. It does not write to the phone.
/// A permanent entry stays permanent if this is called again.
export function recordRetryFailure(meta: SyncRetryMeta, clientEventId: string, input: RetryFailureInput): SyncRetryMeta | null {
  if (!SAFE_ID.test(clientEventId) || !RETRY_CODE.test(input.code)) return null;
  const existing = meta.events[clientEventId];
  if (existing?.permanent) return copyMeta(meta);
  const attempts = Math.min(RETRY_MAX_STORED_ATTEMPTS, (existing?.attempts ?? 0) + 1);
  const delay = backoffDelayMs(attempts, input.randomUnit);
  if (delay === null || Number.isNaN(input.now.getTime())) return null;
  const next = copyMeta(meta);
  next.events[clientEventId] = {
    attempts,
    nextAttemptAt: new Date(input.now.getTime() + delay).toISOString(),
    lastCode: input.code,
    permanent: input.permanent === true,
  };
  return next;
}
