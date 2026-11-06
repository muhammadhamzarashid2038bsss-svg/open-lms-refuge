import { redirect } from "next/navigation";
import { DeviceGate } from "@/components/device-gate";
import { getActor } from "@/lib/auth/actor";
import { openingDestination } from "@/lib/device/phone-check";

// This hop only exists to check the session and the phone lock. It is not a
// public page that should be prefetched ahead of time.
// The redirect stays in this component, not inside <Suspense>. A redirect
// inside the loading boundary is reported as a failed render, and the browser
// retries /opening while the old cookie is still present.
export const instant = false;

export default async function OpeningPage() {
  const destination = openingDestination(await getActor());
  if (destination.type === "login") redirect(destination.href);
  return (
    <DeviceGate userId={destination.userId} centerId={destination.centerId} home={destination.home} mode="continue" />
  );
}
