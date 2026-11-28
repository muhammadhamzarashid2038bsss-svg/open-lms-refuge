"use client";

import { createContext, useContext, type ReactNode } from "react";

export type PhoneSession = { userId: string; centerId: string; authSessionId: string };

const PhoneSessionContext = createContext<PhoneSession | null>(null);

export function PhoneSessionProvider({ value, children }: { value: PhoneSession; children: ReactNode }) {
  return <PhoneSessionContext.Provider value={value}>{children}</PhoneSessionContext.Provider>;
}

export function usePhoneSession(): PhoneSession | null {
  return useContext(PhoneSessionContext);
}
