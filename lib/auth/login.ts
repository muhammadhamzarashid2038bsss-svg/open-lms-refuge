import {
  FAILED_ATTEMPTS_BEFORE_LOCK,
  IP_FAILED_ATTEMPTS_BEFORE_LOCK,
  type LoginError,
} from "./constants";
import { verifySecret } from "./password";
import { hashBucket, isLockActive, recordFailure, type ThrottleStore } from "./throttle";
import type { LearnerCredential, StaffCredential } from "./lookup";

const MAX_SECRET_LENGTH = 200;

export function staffBucketId(email: string): string {
  return hashBucket(`staff:${normalizeEmail(email)}`);
}

export function learnerBucketId(centerCode: string, learnerCode: string): string {
  return hashBucket(`learner:${normalizeCode(centerCode)}:${normalizeCode(learnerCode)}`);
}

export function ipBucketId(ip: string): string {
  return hashBucket(`ip:${ip}`);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

type Attempt = {
  now: Date;
  ip: string;
  store: ThrottleStore;
  secret: string;
  bucketKey: string;
  storedHash: string | null;
  active: boolean;
  found: boolean;
};

// Missing accounts still run scrypt against a dummy hash inside verifySecret.
// The reply is the same for a wrong password and an unknown account, so the
// form cannot be used to discover which emails or learner codes exist.
async function takeAttempt(attempt: Attempt): Promise<LoginError | "ok"> {
  const ipKey = ipBucketId(attempt.ip);
  const [accountRow, ipRow] = await Promise.all([
    attempt.store.get(attempt.bucketKey),
    attempt.store.get(ipKey),
  ]);
  if (isLockActive(accountRow, attempt.now) || isLockActive(ipRow, attempt.now)) {
    return "locked";
  }

  const bounded = attempt.secret.length > 0 && attempt.secret.length <= MAX_SECRET_LENGTH;
  const matches =
    verifySecret(bounded ? attempt.secret : "bounded-check", attempt.storedHash) &&
    bounded &&
    attempt.found;

  if (!matches) {
    const accountFailure = await recordFailure(
      attempt.store,
      attempt.bucketKey,
      attempt.now,
      FAILED_ATTEMPTS_BEFORE_LOCK,
    );
    const ipFailure = await recordFailure(
      attempt.store,
      ipKey,
      attempt.now,
      IP_FAILED_ATTEMPTS_BEFORE_LOCK,
    );
    return accountFailure.locked || ipFailure.locked ? "locked" : "mismatch";
  }

  await attempt.store.clear(attempt.bucketKey);
  if (!attempt.active) return "deactivated";
  return "ok";
}

export async function authenticateStaff(input: {
  email: string;
  password: string;
  now: Date;
  ip: string;
  store: ThrottleStore;
  findStaff: (email: string) => Promise<StaffCredential | null>;
}): Promise<
  | { ok: true; userId: string; centerId: string; role: StaffCredential["role"] }
  | { ok: false; error: LoginError }
> {
  const email = normalizeEmail(input.email);
  if (!email.includes("@") || email.length > 254) {
    return { ok: false, error: "mismatch" };
  }

  const staff = await input.findStaff(email);
  const verdict = await takeAttempt({
    now: input.now,
    ip: input.ip,
    store: input.store,
    secret: input.password,
    bucketKey: staffBucketId(email),
    storedHash: staff?.passwordHash ?? null,
    active: staff?.active ?? false,
    found: staff !== null,
  });
  if (verdict !== "ok" || !staff) return { ok: false, error: verdict === "ok" ? "mismatch" : verdict };
  return { ok: true, userId: staff.id, centerId: staff.centerId, role: staff.role };
}

export async function authenticateLearner(input: {
  centerCode: string;
  learnerCode: string;
  pin: string;
  now: Date;
  ip: string;
  store: ThrottleStore;
  findLearner: (centerCode: string, learnerCode: string) => Promise<LearnerCredential | null>;
}): Promise<
  | { ok: true; userId: string; centerId: string; role: "STUDENT" }
  | { ok: false; error: LoginError }
> {
  const centerCode = normalizeCode(input.centerCode);
  const learnerCode = normalizeCode(input.learnerCode);
  if (!/^[A-Z0-9-]{2,32}$/.test(centerCode) || !/^[A-Z0-9-]{4,32}$/.test(learnerCode)) {
    return { ok: false, error: "mismatch" };
  }

  const learner = await input.findLearner(centerCode, learnerCode);
  const verdict = await takeAttempt({
    now: input.now,
    ip: input.ip,
    store: input.store,
    secret: input.pin,
    bucketKey: learnerBucketId(centerCode, learnerCode),
    storedHash: learner?.pinHash ?? null,
    active: learner?.active ?? false,
    found: learner !== null,
  });
  if (verdict !== "ok" || !learner) {
    return { ok: false, error: verdict === "ok" ? "mismatch" : verdict };
  }
  return { ok: true, userId: learner.id, centerId: learner.centerId, role: "STUDENT" };
}
