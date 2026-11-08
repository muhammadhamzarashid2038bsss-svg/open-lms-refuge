// The opening screen decides where this phone goes after sign-in.
// Records waiting on the phone stay here. This check must not delete them,
// and it must not treat "not read yet" or a broken save as an empty queue.
// A shared classroom phone often has a weak connection, so the decision is a
// pure function the tests can run without a browser.

import { homeForRole, type RoleName } from "@/lib/auth/permissions";
import { allowSignIn, type DeviceState } from "./shared-device";

export type StoredDevice =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; state: DeviceState };

export type PhoneCheckResult =
  | { type: "wait" }
  | { type: "error"; message: string }
  | { type: "release" }
  | { type: "enter"; home: string }
  | { type: "show" };

const UNREADABLE =
  "This phone's saved records could not be read. They were not deleted. Do not hand the phone over yet.";

export function openingDestination(actor: { id: string; centerId: string; role: RoleName } | null):
  | { type: "login"; href: "/" | "/session/clear" }
  | { type: "phone"; userId: string; centerId: string; home: string } {
  // /session/clear deletes a cookie that no longer matches an account, then
  // shows "/". That page is the door to staff sign-in and learner sign-in.
  // Sending "/" directly leaves the dead cookie in place, and the proxy
  // sends the phone back here.
  if (!actor) return { type: "login", href: "/session/clear" };
  return {
    type: "phone",
    userId: actor.id,
    centerId: actor.centerId,
    home: homeForRole(actor.role),
  };
}

export function decidePhoneCheck(input: {
  stored: StoredDevice;
  userId: string;
  centerId: string;
  home: string;
  mode: "continue" | "guard";
}): PhoneCheckResult {
  // Still opening local storage. An empty list would let the next person in
  // before we know whether unsent records are locked on this phone.
  if (input.stored.status === "loading") return { type: "wait" };
  if (input.stored.status === "unavailable") return { type: "error", message: UNREADABLE };

  const decision = allowSignIn(input.stored.state, { userId: input.userId, centerId: input.centerId });
  if (!decision.ok) return { type: "release" };
  if (input.mode === "guard") return { type: "show" };
  return { type: "enter", home: input.home };
}

// One completed check per mounted screen. "wait" does not count: the read
// has not finished, so a later ready result must still be allowed to run.
// A second enter/release/error for the same account is ignored so a refresh
// of this page cannot start another navigation.
export function settlePhoneCheck(
  already: string | null,
  key: string,
  decision: PhoneCheckResult,
): { already: string | null; perform: PhoneCheckResult | null } {
  if (decision.type === "wait") return { already, perform: null };
  const actionKey = `${key}:${decision.type}`;
  if (already === actionKey) return { already, perform: null };
  return { already: actionKey, perform: decision };
}
