"use client";

import { useEffect, useState } from "react";
import { readDeviceBackup } from "@/lib/device/browser";
import { addVerifiedPractice, performPhoneSignOut, waitingForAccount, PHONE_PRIVACY_EVENT } from "@/lib/device/phone-access";
import { decideSignOut } from "@/lib/device/offline-decisions";
import { revokeServerSession } from "@/lib/device/revoke-session";
import { usePhoneSession } from "./device-gate";
import { ATTENDANCE_SYNC_EVENT } from "@/lib/sync/trigger";
import { buttonClass, secondaryButtonClass } from "./ui";

export function PhoneTools({ userId, centerId }: { userId: string; centerId: string }) {
  const session = usePhoneSession();
  const [waiting, setWaiting] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const aligned = session !== null && session.userId === userId && session.centerId === centerId;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!aligned || !session) return;
      const result = await waitingForAccount({
        factory: indexedDB,
        readRaw: readDeviceBackup,
        account: { userId, centerId },
      });
      if (cancelled) return;
      if (!result.ok) {
        setWaiting(null);
        setProblem(result.message);
        return;
      }
      setWaiting(result.count);
      setProblem(null);
    })();
    const refresh = () => {
      void (async () => {
        if (!aligned || !session) return;
        const result = await waitingForAccount({
          factory: indexedDB,
          readRaw: readDeviceBackup,
          account: { userId, centerId },
        });
        if (cancelled) return;
        if (!result.ok) {
          setWaiting(null);
          setProblem(result.message);
          return;
        }
        setWaiting(result.count);
      })();
    };
    window.addEventListener(ATTENDANCE_SYNC_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(ATTENDANCE_SYNC_EVENT, refresh);
    };
  }, [aligned, centerId, session, userId]);

  return (
    <section className="flex flex-col gap-3 rounded-lg border-2 border-zinc-950 p-4">
      <h2 className="text-xl font-semibold">This phone</h2>
      <p className="text-lg leading-7">
        Sign-in ends after 30 minutes with no use, or after 8 hours. Sign out before you hand the phone to someone else.
      </p>
      <p className="text-lg leading-7">
        {waiting === null
          ? "Saved on this phone, waiting to send: check below."
          : `Saved on this phone, waiting to send: ${waiting}.`}
      </p>
      <button
        className={secondaryButtonClass}
        type="button"
        onClick={() => {
          void (async () => {
            if (!aligned) {
              setProblem(decideSignOut(false).message);
              return;
            }
            const saved = await addVerifiedPractice({
              factory: indexedDB,
              readRaw: readDeviceBackup,
              account: { userId, centerId },
            });
            if (!saved.ok) {
              setProblem(saved.message);
              return;
            }
            const result = await waitingForAccount({
              factory: indexedDB,
              readRaw: readDeviceBackup,
              account: { userId, centerId },
            });
            if (!result.ok) {
              setProblem(result.message);
              return;
            }
            setWaiting(result.count);
            setProblem(null);
          })();
        }}
      >
        Save a practice record on this phone
      </button>
      <button
        className={buttonClass}
        type="button"
        onClick={() => {
          void (async () => {
            if (!aligned || !session) {
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
              account: { userId, centerId },
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
      {problem ? (
        <p role="alert" className="text-lg font-medium">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
