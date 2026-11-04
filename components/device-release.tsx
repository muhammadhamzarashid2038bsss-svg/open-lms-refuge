"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useActionState } from "react";
import { releaseDevice, type ReleaseState } from "@/app/actions/auth";
import { rememberRelease, loadDevice } from "@/lib/device/browser";
import type { DeviceState } from "@/lib/device/shared-device";
import { Shell, buttonClass, inputClass, labelClass } from "./ui";

const initial: ReleaseState = {};

export function DeviceReleaseScreen() {
  const [snap, setSnap] = useState<DeviceState | null>(null);
  const [state, action, pending] = useActionState(releaseDevice, initial);

  useEffect(() => {
    setSnap(loadDevice());
  }, []);

  useEffect(() => {
    if (!state.ok || !snap?.lock) return;
    const pendingItems = snap.items.filter(
      (item) => item.userId === snap.lock?.userId && item.centerId === snap.lock?.centerId,
    );
    rememberRelease({
      userId: snap.lock.userId,
      centerId: snap.lock.centerId,
      lockId: snap.lock.lockId,
      itemCount: pendingItems.length,
    });
  }, [snap, state.ok]);

  if (!snap) {
    return (
      <Shell title="Checking this phone">
        <p className="text-lg">One moment.</p>
      </Shell>
    );
  }

  const pendingItems = snap.lock
    ? snap.items.filter((item) => item.userId === snap.lock?.userId && item.centerId === snap.lock?.centerId)
    : [];

  return (
    <Shell
      title="This phone is locked"
      lede="Records waiting to send were kept. They are not deleted, and the next person cannot open them."
    >
      {snap.lock && pendingItems.length > 0 ? (
        <p className="text-lg leading-7">
          {pendingItems.length} record{pendingItems.length === 1 ? "" : "s"} still waiting. The same person can sign in
          again, or a teacher, director, or admin can write a handover note.
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
      {snap.lock && pendingItems.length > 0 ? (
        <form action={action} className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Handover note</h2>
          <p className="text-lg leading-7">
            A teacher, director, or admin confirms their password to write the note. This does not open their home page.
            Do not type a PIN, a password, or a family story in the reason.
          </p>
          <input type="hidden" name="fromUserId" value={snap.lock.userId} />
          <input type="hidden" name="centerId" value={snap.lock.centerId} />
          <input type="hidden" name="itemCount" value={String(pendingItems.length)} />
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
          {state.ok ? (
            <p className="text-lg font-medium">
              The note is saved. The unsent records stay on this phone for the previous account. The next person can
              sign in.
            </p>
          ) : null}
          <button className={buttonClass} type="submit" disabled={pending || state.ok}>
            {pending ? "Saving…" : "Save the handover note"}
          </button>
        </form>
      ) : null}
    </Shell>
  );
}
