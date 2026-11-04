import { Suspense } from "react";
import { redirect } from "next/navigation";
import { DeviceGate } from "@/components/device-gate";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";

// This hop only exists to check the session and the phone lock. It is not a
// public page that should be prefetched ahead of time.
export const instant = false;

export default function OpeningPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg text-zinc-950">Checking this phone…</p>}>
      <Opening />
    </Suspense>
  );
}

async function Opening() {
  const actor = await getActor();
  if (!actor) redirect("/");
  return <DeviceGate userId={actor.id} centerId={actor.centerId} home={homeForRole(actor.role)} mode="continue" />;
}
