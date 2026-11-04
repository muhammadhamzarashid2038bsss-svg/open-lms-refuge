import { prisma } from "../db";
import type { ThrottleStore } from "./throttle";

type Database = {
  loginThrottle: typeof prisma.loginThrottle;
};

export function prismaThrottleStore(db: Database = prisma): ThrottleStore {
  return {
    async get(bucketKey) {
      const row = await db.loginThrottle.findUnique({ where: { bucketKey } });
      if (!row) return null;
      return { failedCount: row.failedCount, lockedUntil: row.lockedUntil };
    },
    async save(bucketKey, row) {
      await db.loginThrottle.upsert({
        where: { bucketKey },
        create: { bucketKey, failedCount: row.failedCount, lockedUntil: row.lockedUntil },
        update: { failedCount: row.failedCount, lockedUntil: row.lockedUntil },
      });
    },
    async clear(bucketKey) {
      await db.loginThrottle.deleteMany({ where: { bucketKey } });
    },
  };
}
