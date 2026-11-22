import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { pgPoolConfig, resolveDatabasePoolMax } from "../lib/db-pool";

// Not a real server. The pool is constructed only so its options can be read.
// No query is sent, and end() runs before any connection.
const UNUSED_URL = "postgresql://pool-config:unused@127.0.0.1:9/pool_config_check";

const pools: Pool[] = [];

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
});

function poolMax(env: { DATABASE_POOL_MAX?: string; NODE_ENV?: string }): number {
  const pool = new Pool(pgPoolConfig(UNUSED_URL, env));
  pools.push(pool);
  return pool.options.max ?? 0;
}

describe("database pool size", () => {
  it("uses 1 in production when DATABASE_POOL_MAX is absent or blank", () => {
    expect(resolveDatabasePoolMax({ NODE_ENV: "production" })).toBe(1);
    expect(resolveDatabasePoolMax({ NODE_ENV: "production", DATABASE_POOL_MAX: "" })).toBe(1);
    expect(resolveDatabasePoolMax({ NODE_ENV: "production", DATABASE_POOL_MAX: "  " })).toBe(1);
    expect(poolMax({ NODE_ENV: "production" })).toBe(1);
  });

  it("keeps the driver default of 10 outside production when the variable is absent", () => {
    expect(resolveDatabasePoolMax({ NODE_ENV: "development" })).toBe(10);
    expect(resolveDatabasePoolMax({ NODE_ENV: "test" })).toBe(10);
    expect(poolMax({ NODE_ENV: "development" })).toBe(10);
  });

  it("uses an explicit positive integer in production and development", () => {
    expect(poolMax({ NODE_ENV: "production", DATABASE_POOL_MAX: "1" })).toBe(1);
    expect(poolMax({ NODE_ENV: "production", DATABASE_POOL_MAX: "4" })).toBe(4);
    expect(poolMax({ NODE_ENV: "development", DATABASE_POOL_MAX: "1" })).toBe(1);
    expect(poolMax({ NODE_ENV: "development", DATABASE_POOL_MAX: " 10 " })).toBe(10);
  });

  it("rejects zero, negative numbers, and values that are not whole numbers", () => {
    for (const value of ["0", "-1", "1.5", "10.0", "4abc", "abc", "NaN", "Infinity", "+4", "08", "1e1"]) {
      expect(() => resolveDatabasePoolMax({ NODE_ENV: "production", DATABASE_POOL_MAX: value })).toThrow(
        "DATABASE_POOL_MAX must be a positive integer when set.",
      );
      expect(() => poolMax({ NODE_ENV: "production", DATABASE_POOL_MAX: value })).toThrow(
        /DATABASE_POOL_MAX/,
      );
    }
  });
});
