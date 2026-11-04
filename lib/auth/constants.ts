// Shared phones in a classroom are often left signed in. These limits are
// short on purpose. A person who walks away should not leave records on screen
// for the rest of the day, and an overnight cookie should already be dead.
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_TOUCH_MS = 5 * 60 * 1000;

// SYS-1 lockout: 15 minutes after 5 failed attempts.
export const FAILED_ATTEMPTS_BEFORE_LOCK = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

// Many learners share one phone and one public network address. The per-account
// lock is the rule that matters. This network limit only stops a script from
// trying hundreds of different codes. It is high so a class mistyping PINs
// does not lock the whole room.
export const IP_FAILED_ATTEMPTS_BEFORE_LOCK = 100;

export const SESSION_COOKIE = "olr_session";

export const LOGIN_MESSAGES = {
  mismatch: "Those details do not match. Try again.",
  locked: "Too many tries. Wait 15 minutes, then try again.",
  deactivated: "This account is switched off. Ask a director.",
} as const;

export type LoginError = keyof typeof LOGIN_MESSAGES;
