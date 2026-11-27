// Login-throttle rows store a hash, not a centre id. The demo reset can
// rebuild only the keys for the published DEMO accounts. A shared school
// network address, a guessed account, and any other centre must keep their
// lockouts.
import { learnerBucketId, staffBucketId } from "../lib/auth/login";

export const DEMO_CENTER_CODE = "DEMO";

export const DEMO_STAFF_EMAILS = [
  "admin@demo.invalid",
  "director@demo.invalid",
  "teacher.one@demo.invalid",
  "teacher.two@demo.invalid",
  "teacher.three@demo.invalid",
] as const;

export function demoLearnerCode(index: number): string {
  return `LNR-${String(index).padStart(4, "0")}`;
}

export const DEMO_LEARNER_CODES = Array.from({ length: 30 }, (_, offset) =>
  demoLearnerCode(offset + 1),
);

export function demoThrottleBucketKeys(): string[] {
  return [
    ...DEMO_STAFF_EMAILS.map((email) => staffBucketId(email)),
    ...DEMO_LEARNER_CODES.map((learnerCode) => learnerBucketId(DEMO_CENTER_CODE, learnerCode)),
  ];
}

type ThrottleDeleteArgs = {
  where: { bucketKey: { in: string[] } };
};

// The seed passes Prisma's deleteMany through this function. Tests pass a
// fake so the filter can be checked without opening a database.
export async function deleteDemoLoginThrottles(
  deleteMany: (args: ThrottleDeleteArgs) => Promise<unknown>,
): Promise<void> {
  await deleteMany({ where: { bucketKey: { in: demoThrottleBucketKeys() } } });
}
