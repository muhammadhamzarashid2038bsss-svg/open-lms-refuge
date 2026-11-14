import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "../lib/test-db/url";

const ACCEPTABLE = "postgresql://open_lms_refuge_test:local-test-password@127.0.0.1:5433/open_lms_refuge_test?schema=public";

describe("test database URL", () => {
  it("accepts the local test database URL", () => {
    expect(() => assertTestDatabaseUrl(ACCEPTABLE)).not.toThrow();
    expect(() =>
      assertTestDatabaseUrl("postgresql://open_lms_refuge_test:local-test-password@localhost:5433/open_lms_refuge_test"),
    ).not.toThrow();
  });

  it("rejects a development database URL", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://postgres:dev-password@127.0.0.1:5432/open_lms_refuge"),
    ).toThrow(/open_lms_refuge_test login role/);
  });

  it("rejects a different database name", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://open_lms_refuge_test:local-test-password@127.0.0.1:5433/template1"),
    ).toThrow(/open_lms_refuge_test database/);
  });

  it("rejects a remote host", () => {
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://open_lms_refuge_test:local-test-password@db.example.com:5433/open_lms_refuge_test",
      ),
    ).toThrow(/local test database host/);
  });

  it("rejects an unexpected port", () => {
    expect(() =>
      assertTestDatabaseUrl("postgresql://open_lms_refuge_test:local-test-password@127.0.0.1:5432/open_lms_refuge_test"),
    ).toThrow(/port 5433/);
  });

  it("rejects missing and placeholder credentials", () => {
    expect(() => assertTestDatabaseUrl("")).toThrow(/missing/);
    expect(() =>
      assertTestDatabaseUrl(
        "postgresql://open_lms_refuge_test:<URL_ENCODED_PASSWORD>@127.0.0.1:5433/open_lms_refuge_test?schema=public",
      ),
    ).toThrow(/real password/);
    expect(() =>
      assertTestDatabaseUrl("postgresql://open_lms_refuge_test:@127.0.0.1:5433/open_lms_refuge_test"),
    ).toThrow(/real password/);
    expect(() =>
      assertTestDatabaseUrl("postgresql://open_lms_refuge_test:PASSWORD@127.0.0.1:5433/open_lms_refuge_test"),
    ).toThrow(/real password/);
  });
});
