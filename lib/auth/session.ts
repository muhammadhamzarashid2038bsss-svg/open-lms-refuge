// iron-session seals the cookie so the browser cannot edit the session id.
// It is the session library the Next.js 16 cache-components guide uses, and
// it was updated in 2026. The account check itself stays in this app because
// learners sign in with a code and a PIN, and those hashes already live on
// our tables. A hosted login service would send learner codes off the center's
// server, which this project does not do.
//
// The cookie is not the permission. Every page and API loads the session row
// and the account. Logout sets revokedAt, so a copied cookie dies immediately.
import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { SESSION_ABSOLUTE_MS, SESSION_COOKIE } from "./constants";
import { createSessionRow, findSessionRow, revokeSessionRow, touchSessionRow } from "./session-db";
import { sessionVerdict, shouldDropSessionCookie, shouldTouchSession } from "./session-policy";

type CookieData = {
  sessionId?: string;
};

function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters. Set it in .env.");
  }
  return {
    cookieName: SESSION_COOKIE,
    password,
    ttl: SESSION_ABSOLUTE_MS / 1000,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

async function cookieSession() {
  // iron-session reads the clock while opening the cookie. Cache Components
  // refuses to prerender that. connection() waits for a real request first,
  // which is what a sign-in check needs on a shared phone anyway.
  await connection();
  return getIronSession<CookieData>(await cookies(), sessionOptions());
}

export async function openSession(userId: string, now = new Date()): Promise<void> {
  const row = await createSessionRow(userId, now);
  const session = await cookieSession();
  session.sessionId = row.id;
  await session.save();
}

export async function revokeCurrentSession(now = new Date()): Promise<void> {
  const session = await cookieSession();
  if (session.sessionId) await revokeSessionRow(session.sessionId, now);
  session.destroy();
}

export async function readSessionUserId(now?: Date): Promise<string | null> {
  let sessionId: string | undefined;
  try {
    // Read the cookie before the clock. With Cache Components, new Date() in a
    // default argument runs before this await and Next.js refuses to prerender it.
    const session = await cookieSession();
    sessionId = session.sessionId;
  } catch {
    return null;
  }
  if (!sessionId) return null;

  const checkedAt = now ?? new Date();
  const row = await findSessionRow(sessionId);
  if (!row) return null;
  const verdict = sessionVerdict(row, checkedAt);
  // A page is not allowed to change cookies. The dead cookie is removed by
  // /session/clear, which is the only place that may write it.
  if (shouldDropSessionCookie(verdict)) {
    if (!row.revokedAt) await revokeSessionRow(row.id, checkedAt);
    return null;
  }
  if (shouldTouchSession(row, checkedAt)) await touchSessionRow(row.id, checkedAt);
  return row.userId;
}
