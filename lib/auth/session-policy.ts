import { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_TOUCH_MS } from "./constants";

export type SessionRow = {
  revokedAt: Date | null;
  expiresAt: Date;
  lastSeenAt: Date;
};

export type SessionVerdict = "ok" | "idle" | "absolute" | "revoked";

export function sessionVerdict(row: SessionRow, now: Date): SessionVerdict {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "absolute";
  if (now.getTime() - row.lastSeenAt.getTime() >= SESSION_IDLE_MS) return "idle";
  return "ok";
}

export function shouldTouchSession(row: SessionRow, now: Date): boolean {
  return sessionVerdict(row, now) === "ok" && now.getTime() - row.lastSeenAt.getTime() >= SESSION_TOUCH_MS;
}

export function sessionExpiry(now: Date): Date {
  return new Date(now.getTime() + SESSION_ABSOLUTE_MS);
}

export { SESSION_ABSOLUTE_MS, SESSION_IDLE_MS };
