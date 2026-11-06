import { type ReactNode } from "react";
import { redirect } from "next/navigation";
import { DeviceGate } from "@/components/device-gate";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";

// A signed-in page has to wait for the session before any shell is sent.
// Putting that redirect inside <Suspense> makes Next retry the page, which
// traps a shared phone on "Checking this phone…".
export const instant = false;

export default async function SignedInLayout({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/session/clear");
  return (
    <DeviceGate userId={actor.id} centerId={actor.centerId} home={homeForRole(actor.role)} mode="guard">
      {children}
    </DeviceGate>
  );
}
