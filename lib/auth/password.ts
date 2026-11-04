// Staff passwords and learner PINs are stored with Node's built-in scrypt.
// scrypt is a one-way key-stretching function: the database can check a guess
// but cannot turn the stored value back into the password or the PIN.
// The format matches prisma/seed.ts so the existing demo hashes still work.
// Argon2 is the other maintained choice. It needs a native add-on, which is
// awkward on Windows and on the small servers a center is likely to use, so
// this project stays with scrypt until the hashes are deliberately rotated.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_BYTES = 32;

// A 4-digit PIN has only 10,000 possibilities. scrypt is intentionally slow
// so a stolen database cannot be guessed quickly. Do not lower these numbers.
const DUMMY_HASH = hashSecret("not-a-real-secret");

export function hashSecret(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, KEY_BYTES, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString("hex");
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${hash}`;
}

export function verifySecret(plain: string, stored: string | null | undefined): boolean {
  if (plain.length > 200) return verifySecret("bounded-check", stored ?? DUMMY_HASH) && false;
  if (!stored) return verifySecret(plain, DUMMY_HASH) && false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4] ?? "";
  const expected = Buffer.from(parts[5] ?? "", "hex");
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (expected.length === 0) return false;

  // Cap the work factor so a damaged row cannot ask the server for a huge scrypt.
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;

  const actual = scryptSync(plain, salt, expected.length, { N, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function isFourDigitPin(value: string): boolean {
  return /^\d{4}$/.test(value);
}
