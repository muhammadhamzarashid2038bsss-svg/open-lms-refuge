"use client";

import { useEffect } from "react";
import { registerKioskServiceWorker } from "@/lib/device/register-service-worker";

// Production pages register one worker. A failure is ignored so the online
// class still opens. Development does not register anything.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    void registerKioskServiceWorker();
  }, []);
  return null;
}
