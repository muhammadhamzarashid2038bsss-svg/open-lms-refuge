// Only a signed-in page may clear the phone lock. The offline shell does not
// import this file, so it cannot reach the clear function through its bundle.

import { clearAccountLock, writeActiveAccount } from "./local-db";
import { UNCHECKED_RECORDS, UNREADABLE_RECORDS, decideSharedPhone, decideSignOut } from "./offline-decisions";
import { openVerifiedQueue, withWaiting } from "./phone-access";

export type OnlineAccess =
  | { type: "hidden"; message: string; retryRevoke: boolean }
  | { type: "blocked" }
  | { type: "enter"; home: string }
  | { type: "show" };

export function childrenVisible(access: OnlineAccess): boolean {
  return access.type === "show";
}

/// Online sign-in is the only way through this check. A saved email or user id
/// is not enough, and the offline shell never calls this function.
export async function applyOnlineAccess(input: {
  factory: IDBFactory;
  readRaw: () => string | null;
  userId: string;
  centerId: string;
  authSessionId: string;
  home: string;
  mode: "continue" | "guard";
}): Promise<OnlineAccess> {
  const queue = await openVerifiedQueue(input.factory, input.readRaw);
  if (!queue.ok) return { type: "hidden", message: queue.message, retryRevoke: false };
  const waiting = await withWaiting(input.factory, queue.state);
  if (!waiting.ok) return { type: "hidden", message: waiting.message, retryRevoke: false };
  const decision = decideSharedPhone({
    stored: { status: "ready", state: waiting.state },
    nextUserId: input.userId,
    nextCenterId: input.centerId,
    nextAuthSessionId: input.authSessionId,
    lockAuthSessionId: waiting.state.lock?.authSessionId ?? null,
  });
  if (decision.type === "wait" || decision.type === "stop") {
    return {
      type: "hidden",
      message: decision.type === "stop" ? decision.message : UNCHECKED_RECORDS,
      retryRevoke: false,
    };
  }
  if (decision.type === "stay-locked") {
    return { type: "hidden", message: decideSignOut(true).message, retryRevoke: true };
  }
  if (decision.type === "blocked") return { type: "blocked" };
  const active = { userId: input.userId, centerId: input.centerId, authSessionId: input.authSessionId };
  if (decision.type === "clear-lock") {
    const cleared = await clearAccountLock(input.factory, active);
    if (!cleared) return { type: "hidden", message: UNREADABLE_RECORDS, retryRevoke: false };
  } else {
    const recorded = await writeActiveAccount(input.factory, active);
    if (!recorded) return { type: "hidden", message: UNREADABLE_RECORDS, retryRevoke: false };
  }
  if (input.mode === "continue") return { type: "enter", home: input.home };
  return { type: "show" };
}
