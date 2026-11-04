import { prisma } from "../db";
import { sessionExpiry } from "./session-policy";

type Database = {
  authSession: typeof prisma.authSession;
};

export async function createSessionRow(userId: string, now = new Date(), db: Database = prisma) {
  return db.authSession.create({
    data: {
      userId,
      lastSeenAt: now,
      expiresAt: sessionExpiry(now),
    },
    select: { id: true, expiresAt: true },
  });
}

export async function revokeSessionRow(sessionId: string, now = new Date(), db: Database = prisma) {
  await db.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function revokeSessionsForUser(userId: string, now = new Date(), db: Database = prisma) {
  await db.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
}

export async function findSessionRow(sessionId: string, db: Database = prisma) {
  return db.authSession.findUnique({ where: { id: sessionId } });
}

export async function touchSessionRow(sessionId: string, now: Date, db: Database = prisma) {
  await db.authSession.update({ where: { id: sessionId }, data: { lastSeenAt: now } });
}
