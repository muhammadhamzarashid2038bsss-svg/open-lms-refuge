import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ipBucketId, learnerBucketId, staffBucketId } from "../lib/auth/login";
import {
  DEMO_LEARNER_CODES,
  DEMO_STAFF_EMAILS,
  deleteDemoLoginThrottles,
  demoThrottleBucketKeys,
} from "../prisma/demo-throttle";

// These checks build hashes and read the seed file. They do not open a database.
const seedSource = readFileSync(resolve(process.cwd(), "prisma/seed.ts"), "utf8");

describe("demo throttle keys", () => {
  const keys = demoThrottleBucketKeys();

  it("includes the five synthetic DEMO staff accounts", () => {
    expect(DEMO_STAFF_EMAILS).toEqual([
      "admin@demo.invalid",
      "director@demo.invalid",
      "teacher.one@demo.invalid",
      "teacher.two@demo.invalid",
      "teacher.three@demo.invalid",
    ]);
    for (const email of DEMO_STAFF_EMAILS) {
      expect(keys).toContain(staffBucketId(email));
    }
  });

  it("includes learner codes LNR-0001 through LNR-0030 at centre DEMO", () => {
    expect(DEMO_LEARNER_CODES).toHaveLength(30);
    expect(DEMO_LEARNER_CODES[0]).toBe("LNR-0001");
    expect(DEMO_LEARNER_CODES[29]).toBe("LNR-0030");
    for (const learnerCode of DEMO_LEARNER_CODES) {
      expect(keys).toContain(learnerBucketId("DEMO", learnerCode));
    }
  });

  it("does not include the same learner code at another centre", () => {
    expect(keys).not.toContain(learnerBucketId("NORTH", "LNR-0001"));
    expect(keys).not.toContain(learnerBucketId("OTHER", "LNR-0030"));
  });

  it("does not include an unrelated staff email", () => {
    expect(keys).not.toContain(staffBucketId("other.staff@example.invalid"));
  });

  it("does not include a network-address key", () => {
    const expected = [
      ...DEMO_STAFF_EMAILS.map((email) => staffBucketId(email)),
      ...DEMO_LEARNER_CODES.map((learnerCode) => learnerBucketId("DEMO", learnerCode)),
    ];
    expect(keys).toEqual(expected);
    expect(keys).toHaveLength(35);
    expect(keys).not.toContain(ipBucketId("198.51.100.20"));
    expect(keys).not.toContain(ipBucketId("203.0.113.10"));
  });
});

describe("demo throttle deletion", () => {
  it("passes only the known DEMO keys to deleteMany", async () => {
    const calls: Array<{ where: { bucketKey: { in: string[] } } }> = [];
    await deleteDemoLoginThrottles(async (args) => {
      calls.push(args);
      return { count: args.where.bucketKey.in.length };
    });

    expect(calls).toEqual([
      { where: { bucketKey: { in: demoThrottleBucketKeys() } } },
    ]);
    const deleted = calls[0].where.bucketKey.in;
    expect(deleted).not.toContain(ipBucketId("198.51.100.20"));
    expect(deleted).not.toContain(staffBucketId("other.staff@example.invalid"));
    expect(deleted).not.toContain(learnerBucketId("NORTH", "LNR-0001"));
  });

  it("is the deletion the seed uses, with a centre filter on the key list", () => {
    expect(seedSource).toContain(
      "await deleteDemoLoginThrottles((args) => tx.loginThrottle.deleteMany(args));",
    );
    expect(seedSource).not.toMatch(/loginThrottle\.deleteMany\(\s*\)/);
  });
});
