"use client";

import { readDeviceBackup } from "@/lib/device/browser";
import { decideSignOut } from "@/lib/device/offline-decisions";
import { performPhoneSignOut, PHONE_PRIVACY_EVENT } from "@/lib/device/phone-access";
import { revokeServerSession } from "@/lib/device/revoke-session";
import { usePhoneSession } from "./phone-session";

const focusClass =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-zinc-950";

// Same lock-then-revoke path as the old home-page button. The header only
// moves where the control sits. It does not start a second sign-out.
export function SignOutButton() {
  const session = usePhoneSession();
  return (
    <button
      className={`inline-flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-zinc-950 px-4 text-lg font-medium text-white ${focusClass}`}
      type="button"
      onClick={() => {
        void (async () => {
          if (!session) {
            window.dispatchEvent(
              new CustomEvent(PHONE_PRIVACY_EVENT, {
                detail: { message: decideSignOut(false).message, claimLocked: false },
              }),
            );
            return;
          }
          await performPhoneSignOut({
            factory: indexedDB,
            readRaw: readDeviceBackup,
            account: { userId: session.userId, centerId: session.centerId },
            authSessionId: session.authSessionId,
            revoke: revokeServerSession,
            onPrivacy: (message, claimLocked) => {
              window.dispatchEvent(new CustomEvent(PHONE_PRIVACY_EVENT, { detail: { message, claimLocked } }));
            },
          });
        })();
      }}
    >
      Sign out
    </button>
  );
}
