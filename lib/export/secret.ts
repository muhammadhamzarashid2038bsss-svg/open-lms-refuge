// EXPORT_SECRET is the HMAC key. It lives in the environment, not in code.
// The documented generator is Node's crypto.randomBytes(32).toString("hex"),
// which is 64 hexadecimal characters (256 bits). This check accepts only that
// shape. It does not measure entropy: a person could still type 64 hex
// characters by hand. Counting distinct characters would not prove the key
// was random, so this file does not do that.

import { ExportError } from "./types";

export const EXPORT_SECRET_ENV = "EXPORT_SECRET";

const PLACEHOLDER = "replace-with-a-long-random-secret";
const GENERATED_HEX = /^[0-9a-f]{64}$/;

export function assertHighEntropySecret(secret: string): void {
  if (secret === PLACEHOLDER || !GENERATED_HEX.test(secret)) {
    throw new ExportError(
      "EXPORT_SECRET must be 64 lowercase hexadecimal characters from crypto.randomBytes(32). Do not reuse a password or the example placeholder.",
    );
  }
}

export function readExportSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env[EXPORT_SECRET_ENV] ?? "";
  assertHighEntropySecret(secret);
  return secret;
}
