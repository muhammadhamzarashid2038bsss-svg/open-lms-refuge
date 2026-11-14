// Reads .env.test only. Calling dotenv/config here would also load .env and
// could point tests at the Prisma Dev database.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { assertTestDatabaseUrl } from "./url";

export type TestDatabaseEnv = {
  url: string;
  poolMax: string;
};

export function loadTestDatabaseEnv(root = process.cwd()): TestDatabaseEnv {
  const filePath = resolve(root, ".env.test");
  let parsed: Record<string, string>;
  try {
    parsed = parse(readFileSync(filePath));
  } catch (error) {
    const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (missing) {
      throw new Error("TEST_DATABASE_URL is missing. Copy .env.test.example to .env.test.");
    }
    throw new Error("TEST_DATABASE_URL is missing. .env.test could not be read.");
  }

  const url = parsed.TEST_DATABASE_URL?.trim() ?? "";
  if (!url) {
    throw new Error("TEST_DATABASE_URL is missing. Copy .env.test.example to .env.test.");
  }
  assertTestDatabaseUrl(url);

  const requestedPool = parsed.TEST_DATABASE_POOL_MAX?.trim() ?? "";
  const poolMax = requestedPool === "" ? "4" : requestedPool;
  if (!/^[1-9]\d*$/.test(poolMax)) {
    throw new Error("TEST_DATABASE_POOL_MAX must be a positive integer.");
  }

  return { url, poolMax };
}

// The existing Prisma client reads DATABASE_URL. Set it from the test URL
// before that client is imported. dotenv does not replace a variable that is
// already set, so a later import of lib/db.ts cannot switch back to .env.
export function applyTestDatabaseEnv(env: TestDatabaseEnv = loadTestDatabaseEnv()): TestDatabaseEnv {
  process.env.TEST_DATABASE_URL = env.url;
  process.env.TEST_DATABASE_POOL_MAX = env.poolMax;
  process.env.DATABASE_URL = env.url;
  process.env.DATABASE_POOL_MAX = env.poolMax;
  return env;
}
