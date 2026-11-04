import { describe, expect, it } from "vitest";
import { hashSecret, isFourDigitPin, verifySecret } from "../lib/auth/password";
import { authenticateLearner, authenticateStaff } from "../lib/auth/login";
import { LOGIN_MESSAGES } from "../lib/auth/constants";
import type { ThrottleRow, ThrottleStore } from "../lib/auth/throttle";
import type { LearnerCredential, StaffCredential } from "../lib/auth/lookup";

function memoryStore(): ThrottleStore {
  const rows = new Map<string, ThrottleRow>();
  return {
    async get(key) {
      return rows.get(key) ?? null;
    },
    async save(key, row) {
      rows.set(key, { ...row });
    },
    async clear(key) {
      rows.delete(key);
    },
  };
}

describe("password and PIN hashes", () => {
  it("stores a one-way hash and never the PIN itself", () => {
    const pin = "1234";
    const stored = hashSecret(pin);
    expect(isFourDigitPin(pin)).toBe(true);
    expect(stored).not.toContain(pin);
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifySecret(pin, stored)).toBe(true);
    expect(verifySecret("0000", stored)).toBe(false);
    expect(verifySecret(pin, null)).toBe(false);
  });
});

describe("failed sign-in limits", () => {
  const password = "correct-horse";
  const staff: StaffCredential = {
    id: "staff-1",
    centerId: "center-a",
    role: "TEACHER",
    active: true,
    passwordHash: hashSecret(password),
  };
  const switchedOff: StaffCredential = { ...staff, id: "staff-off", active: false };
  const learner: LearnerCredential = {
    id: "learner-user",
    centerId: "center-a",
    role: "STUDENT",
    active: true,
    pinHash: hashSecret("1234"),
  };

  function staffLogin(store: ThrottleStore, email: string, attempt: string, now: Date) {
    return authenticateStaff({
      email,
      password: attempt,
      now,
      ip: "203.0.113.10",
      store,
      findStaff: async (value) => {
        if (value === "teacher@demo.invalid") return staff;
        if (value === "off@demo.invalid") return switchedOff;
        return null;
      },
    });
  }

  it("uses the same message for an unknown email and a wrong password", async () => {
    const store = memoryStore();
    const now = new Date("2026-11-05T00:00:00.000Z");
    const unknown = await staffLogin(store, "missing@demo.invalid", "nope", now);
    const wrong = await staffLogin(store, "teacher@demo.invalid", "nope", now);
    expect(unknown).toEqual({ ok: false, error: "mismatch" });
    expect(wrong).toEqual({ ok: false, error: "mismatch" });
    expect(LOGIN_MESSAGES.mismatch).toBe(LOGIN_MESSAGES.mismatch);
    expect(LOGIN_MESSAGES.mismatch).not.toBe(LOGIN_MESSAGES.deactivated);
  });

  it("locks the account for 15 minutes after 5 failures, then allows the right password", async () => {
    const store = memoryStore();
    let now = new Date("2026-11-05T00:00:00.000Z");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await staffLogin(store, "teacher@demo.invalid", "wrong-password", now);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(attempt === 4 ? "locked" : "mismatch");
    }
    const duringLock = await staffLogin(store, "teacher@demo.invalid", password, now);
    expect(duringLock).toEqual({ ok: false, error: "locked" });

    now = new Date(now.getTime() + 15 * 60 * 1000 + 1);
    const after = await staffLogin(store, "teacher@demo.invalid", password, now);
    expect(after).toEqual({ ok: true, userId: staff.id, centerId: staff.centerId, role: "TEACHER" });
  });

  it("tells a deactivated account only when the password matches", async () => {
    const store = memoryStore();
    const now = new Date("2026-11-05T00:00:00.000Z");
    const wrong = await staffLogin(store, "off@demo.invalid", "wrong-password", now);
    const right = await staffLogin(store, "off@demo.invalid", password, now);
    expect(wrong).toEqual({ ok: false, error: "mismatch" });
    expect(right).toEqual({ ok: false, error: "deactivated" });
  });

  it("locks a learner code the same way and does not keep the PIN", async () => {
    const store = memoryStore();
    const now = new Date("2026-11-05T00:00:00.000Z");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await authenticateLearner({
        centerCode: "demo",
        learnerCode: "lnr-0001",
        pin: "9999",
        now,
        ip: "203.0.113.10",
        store,
        findLearner: async () => learner,
      });
      expect(result).toEqual({ ok: false, error: "mismatch" });
    }
    const locked = await authenticateLearner({
      centerCode: "DEMO",
      learnerCode: "LNR-0001",
      pin: "9999",
      now,
      ip: "203.0.113.10",
      store,
      findLearner: async () => learner,
    });
    expect(locked).toEqual({ ok: false, error: "locked" });
    expect(learner.pinHash).not.toContain("1234");
  });
});
