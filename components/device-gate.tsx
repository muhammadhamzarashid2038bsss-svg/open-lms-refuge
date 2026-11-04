"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { endSession } from "@/app/actions/auth";
import { allowSignIn } from "@/lib/device/shared-device";
import { loadDevice, unlockCurrentDevice } from "@/lib/device/browser";

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
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const decision = allowSignIn(loadDevice(), { userId, centerId });
    if (!decision.ok) {
      // A full page load drops the previous account from the client router.
      // router.replace can keep that screen and also clashes with the sign-out action.
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
    unlockCurrentDevice();
    if (mode === "continue") router.replace(home);
    else setReady(true);
  }, [centerId, home, mode, router, userId]);

  if (problem) return <p className="p-4 text-lg text-zinc-950">{problem}</p>;
  if (!ready) return <p className="p-4 text-lg text-zinc-950">Checking this phone…</p>;
  return children;
}
