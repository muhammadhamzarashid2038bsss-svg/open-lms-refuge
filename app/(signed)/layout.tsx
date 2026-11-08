import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { DeviceGate } from "@/components/device-gate";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";
import { readSessionClock } from "@/lib/auth/session";

// A signed-in page has to wait for the session before any shell is sent.
// Putting that redirect inside <Suspense> makes Next retry the page, which
// traps a shared phone on "Checking this phone…".
export const instant = false;

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/session/clear");
  // The session id is printed into the page by the server. The cookie itself
  // stays httpOnly, and the service worker is not given this value.
  const clock = await readSessionClock();
  if (!clock) redirect("/session/clear");
  return (
    <DeviceGate
      userId={actor.id}
      centerId={actor.centerId}
      home={homeForRole(actor.role)}
      mode="guard"
      authSessionId={clock.authSessionId}
    >
      {children}
    </DeviceGate>
  );
}
