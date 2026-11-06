"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { endSession } from "@/app/actions/auth";
import { readStoredDevice, unlockCurrentDevice } from "@/lib/device/browser";
import { decidePhoneCheck, settlePhoneCheck } from "@/lib/device/phone-check";

export function DeviceGate({
  userId,
  centerId,
  home,
  mode,
  children,
}: {
  userId: string;
  centerId: string;
  home: string;
  mode: "continue" | "guard";
  children?: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    // Read here, not during render. The server has no view of this phone's
    // saved records, so the first paint stays on "Checking this phone…".
    const stored = readStoredDevice();
    const decision = decidePhoneCheck({ stored, userId, centerId, home, mode });
    const step = settlePhoneCheck(handled.current, `${mode}:${userId}:${centerId}`, decision);
    handled.current = step.already;
    if (!step.perform) return;

    if (step.perform.type === "error") {
      const message = step.perform.message;
      queueMicrotask(() => setProblem(message));
      return;
    }
    if (step.perform.type === "release") {
      // A full page load drops the previous account from the client router.
      // router.replace can keep that screen, and calling it from this effect
      // makes Next retry /opening instead of leaving it.
      void endSession().then(
        () => {
          window.location.replace("/device-release");
        },
        () => {
          setProblem("This phone could not end the sign-in. Do not hand it over yet.");
        },
      );
      return;
    }

    const unlocked = unlockCurrentDevice();
    if (!unlocked) {
      queueMicrotask(() =>
        setProblem(
          "This phone could not finish the check. The saved records were not deleted. Do not hand the phone over yet.",
        ),
      );
      return;
    }
    if (step.perform.type === "enter") {
      window.location.replace(step.perform.home);
      return;
    }
    queueMicrotask(() => setReady(true));
  }, [centerId, home, mode, userId]);

  if (problem) return <p className="p-4 text-lg text-zinc-950">{problem}</p>;
  if (!ready) return <p className="p-4 text-lg text-zinc-950">Checking this phone…</p>;
  return children;
}
