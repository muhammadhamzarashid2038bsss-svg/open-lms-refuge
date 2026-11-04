import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { DeviceGate } from "@/components/device-gate";
import { getActor } from "@/lib/auth/actor";
import { homeForRole } from "@/lib/auth/permissions";

// A signed-in page has to wait for the session. It must not be prefetched as a
// shared shell, or the next person on this phone could see the previous account.
export const instant = false;

export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg text-zinc-950">Checking this phone…</p>}>
      <Frame>{children}</Frame>
    </Suspense>
  );
}

async function Frame({ children }: { children: ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/");
  return (
    <DeviceGate userId={actor.id} centerId={actor.centerId} home={homeForRole(actor.role)} mode="guard">
      {children}
    </DeviceGate>
  );
}
