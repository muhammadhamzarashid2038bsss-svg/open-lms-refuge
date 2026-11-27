import { describe, expect, it } from "vitest";
import { assertSessionSecret, sessionConfigurationMessage } from "../lib/auth/session-secret";

const PUBLISHED = "replace-with-a-long-random-secret";
const ACCEPTED = "test-only-session-secret-must-be-32";

describe("session secret", () => {
  it("rejects the published example before it can seal a cookie", () => {
    expect(PUBLISHED.length).toBeGreaterThanOrEqual(32);
    expect(() => assertSessionSecret(PUBLISHED)).toThrow(/SESSION_SECRET/);
    try {
      assertSessionSecret(PUBLISHED);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message.startsWith("SESSION_SECRET ")).toBe(true);
      expect(message).not.toContain(PUBLISHED);
      expect(sessionConfigurationMessage(error)).toBe(message);
    }
  });

  it("accepts a different secret that meets the existing length", () => {
    expect(ACCEPTED.length).toBeGreaterThanOrEqual(32);
    expect(assertSessionSecret(ACCEPTED)).toBe(ACCEPTED);
    expect(assertSessionSecret(`${PUBLISHED}-local-only`)).toBe(`${PUBLISHED}-local-only`);
  });

  it("keeps the short-secret error and hides unrelated failures", () => {
    expect(() => assertSessionSecret("too-short")).toThrow(
      "SESSION_SECRET must be at least 32 characters. Set it in .env.",
    );
    expect(sessionConfigurationMessage(new Error("database unavailable"))).toBeNull();
  });
});
