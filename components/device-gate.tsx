"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { endSession } from "@/app/actions/auth";
import { readDeviceBackup, watchDeviceBackup } from "@/lib/device/browser";
import { MISMATCHED_RECORDS, decideRevokeResult } from "@/lib/device/offline-decisions";
import { PHONE_PRIVACY_EVENT, type PhonePrivacyDetail } from "@/lib/device/phone-access";
import { applyOnlineAccess, childrenVisible } from "@/lib/device/phone-online";
import { settlePhoneCheck } from "@/lib/device/phone-check";
import { revokeServerSession } from "@/lib/device/revoke-session";

export type PhoneSession = { userId: string; centerId: string; authSessionId: string };

const PhoneSessionContext = createContext<PhoneSession | null>(null);

export function usePhoneSession(): PhoneSession | null {
  return useContext(PhoneSessionContext);
}

export function DeviceGate({
  userId,
  centerId,
  home,
  mode,
  authSessionId,
  children,
}: {
  userId: string;
  centerId: string;
  home: string;
  mode: "continue" | "guard";
  authSessionId: string;
  children?: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const onPrivacy = (event: Event) => {
      const detail = (event as CustomEvent<PhonePrivacyDetail>).detail;
      if (!detail || typeof detail.message !== "string") return;
      setReady(false);
      setProblem(detail.message);
    };
    window.addEventListener(PHONE_PRIVACY_EVENT, onPrivacy);
    // Another tab still running the old page can change the frozen backup.
    // Hide the open page. Do not delete either copy.
    const stopWatch = watchDeviceBackup(() => {
      setReady(false);
      setProblem(MISMATCHED_RECORDS);
    });
    return () => {
      window.removeEventListener(PHONE_PRIVACY_EVENT, onPrivacy);
      stopWatch();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const access = await applyOnlineAccess({
        factory: indexedDB,
        readRaw: readDeviceBackup,
        userId,
        centerId,
        authSessionId,
        home,
        mode,
      });
      if (cancelled) return;
      if (access.type === "hidden") {
        setReady(false);
        setProblem(access.message);
        if (!access.retryRevoke) return;
        const revoked = await revokeServerSession();
        if (cancelled) return;
        setProblem(decideRevokeResult({ lockWritten: true, serverRevoked: revoked }).message);
        return;
      }
      const key = `${mode}:${userId}:${centerId}:${authSessionId}`;
      if (access.type === "blocked") {
        const step = settlePhoneCheck(handled.current, key, { type: "release" });
        handled.current = step.already;
        if (!step.perform) return;
        void endSession().then(
          () => {
            window.location.replace("/device-release");
          },
          () => {
            setProblem("This phone could not end the sign-in. Do not hand the phone over yet.");
          },
        );
        return;
      }
      if (access.type === "enter") {
        const step = settlePhoneCheck(handled.current, key, { type: "enter", home: access.home });
        handled.current = step.already;
        if (!step.perform || step.perform.type !== "enter") return;
        window.location.replace(step.perform.home);
        return;
      }
      if (!childrenVisible(access)) return;
      setProblem(null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authSessionId, centerId, home, mode, userId]);

  const session = { userId, centerId, authSessionId };
  if (problem) return <p className="p-4 text-lg text-zinc-950">{problem}</p>;
  if (!ready) return <p className="p-4 text-lg text-zinc-950">Checking this phone…</p>;
  return <PhoneSessionContext.Provider value={session}>{children}</PhoneSessionContext.Provider>;
}
