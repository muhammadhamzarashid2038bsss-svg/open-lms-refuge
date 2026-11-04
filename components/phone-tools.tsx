"use client";

import { useEffect, useState } from "react";
import { logout } from "@/app/actions/auth";
import { lockCurrentAccount, savePracticeRecord, waitingCount } from "@/lib/device/browser";
import { buttonClass, secondaryButtonClass } from "./ui";

export function PhoneTools({ userId, centerId }: { userId: string; centerId: string }) {
  const [waiting, setWaiting] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    setWaiting(waitingCount(userId));
  }, [userId]);

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
          const saved = savePracticeRecord(userId, centerId);
          if (!saved) {
            setProblem("This phone could not save the practice record.");
            return;
          }
          setWaiting(waitingCount(userId));
          setProblem(null);
        }}
      >
        Save a practice record on this phone
      </button>
      <form
        action={async () => {
          const locked = lockCurrentAccount(userId, centerId);
          if (!locked) {
            setProblem("This phone could not lock the saved records. Do not hand it over yet.");
            return;
          }
          await logout();
        }}
      >
        <button className={buttonClass} type="submit">
          Sign out
        </button>
      </form>
      {problem ? (
        <p role="alert" className="text-lg font-medium">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
