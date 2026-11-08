"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useActionState } from "react";
import { releaseDevice, type ReleaseState } from "@/app/actions/auth";
import { readDeviceBackup } from "@/lib/device/browser";
import { addVerifiedRelease, waitingForAccount } from "@/lib/device/phone-access";
import { UNREADABLE_RECORDS } from "@/lib/device/offline-decisions";
import type { DeviceLock } from "@/lib/device/shared-device";
import { Shell, buttonClass, inputClass, labelClass } from "./ui";

const initial: ReleaseState = {};

export function DeviceReleaseScreen() {
  const [lock, setLock] = useState<DeviceLock | null | undefined>(undefined);
  const [pendingCount, setPendingCount] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [storedRelease, setStoredRelease] = useState(false);
  const [state, action, pending] = useActionState(releaseDevice, initial);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const queue = await waitingForAccount({
        factory: indexedDB,
        readRaw: readDeviceBackup,
        account: { userId: "pending", centerId: "pending" },
      });
      if (cancelled) return;
      if (!queue.ok) {
        setProblem(queue.message);
        setLock(null);
        return;
      }
      setLock(queue.state.lock);
      const owner = queue.state.lock;
      setPendingCount(
        owner
          ? queue.state.items.filter((item) => item.userId === owner.userId && item.centerId === owner.centerId).length
          : 0,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state.ok || !lock || storedRelease) return;
    let cancelled = false;
    void (async () => {
      const saved = await addVerifiedRelease({
        factory: indexedDB,
        readRaw: readDeviceBackup,
        release: { userId: lock.userId, centerId: lock.centerId, lockId: lock.lockId, itemCount: pendingCount },
      });
      if (cancelled) return;
      if (!saved.ok) {
        setProblem(saved.message || UNREADABLE_RECORDS);
        return;
      }
      setStoredRelease(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [lock, pendingCount, state.ok, storedRelease]);

  if (problem) {
    return (
      <Shell title="Checking this phone">
        <p className="text-lg">{problem}</p>
      </Shell>
    );
  }

  if (lock === undefined) {
    return (
      <Shell title="Checking this phone">
        <p className="text-lg">One moment.</p>
      </Shell>
    );
  }

  return (
    <Shell
      title="This phone is locked"
      lede="Records waiting to send were kept. They are not deleted, and the next person cannot open them."
    >
      {lock && pendingCount > 0 ? (
        <p className="text-lg leading-7">
          {pendingCount} record{pendingCount === 1 ? "" : "s"} still waiting. The same person can sign in again, or a
          teacher, director, or admin can write a handover note.
        </p>
      ) : (
        <p className="text-lg leading-7">No unsent records are blocking the next sign-in.</p>
      )}
      <p className="flex flex-col gap-3 text-lg">
        <Link className="underline" href="/sign-in/learner">
          Learner sign-in
        </Link>
        <Link className="underline" href="/sign-in/staff">
          Staff sign-in
        </Link>
      </p>
      {lock && pendingCount > 0 ? (
        <form action={action} className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Handover note</h2>
          <p className="text-lg leading-7">
            A teacher, director, or admin confirms their password to write the note. This does not open their home page.
            Do not type a PIN, a password, or a family story in the reason.
          </p>
          <input type="hidden" name="fromUserId" value={lock.userId} />
          <input type="hidden" name="centerId" value={lock.centerId} />
          <input type="hidden" name="itemCount" value={String(pendingCount)} />
          <label className={labelClass}>
            Staff email
            <input className={inputClass} name="email" type="email" required />
          </label>
          <label className={labelClass}>
            Staff password
            <input className={inputClass} name="password" type="password" required />
          </label>
          <label className={labelClass}>
            Phone label
            <input className={inputClass} name="deviceLabel" defaultValue="shared phone" maxLength={80} />
          </label>
          <label className={labelClass}>
            Reason
            <textarea className={inputClass} name="reason" minLength={10} maxLength={200} required rows={3} />
          </label>
          {state.error ? (
            <p role="alert" className="text-lg font-medium">
              {state.error}
            </p>
          ) : null}
          {storedRelease ? (
            <p className="text-lg font-medium">
              The note is saved. The unsent records stay on this phone for the previous account. The next person can
              sign in.
            </p>
          ) : null}
          <button className={buttonClass} type="submit" disabled={pending || storedRelease}>
            {pending ? "Saving…" : "Save the handover note"}
          </button>
        </form>
      ) : null}
    </Shell>
  );
}
