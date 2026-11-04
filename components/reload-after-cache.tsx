"use client";

import { useEffect } from "react";

// The browser can show the previous page from memory after sign-out.
// Reloading sends the person to the server, which no longer has their cookie.
export function ReloadAfterCache() {
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return null;
}
