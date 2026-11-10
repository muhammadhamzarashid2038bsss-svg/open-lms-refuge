import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CenterPerformanceView } from "@/components/performance-dashboard";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { loadCenterPerformance } from "@/lib/data/dashboard";

export const instant = false;

export default function DirectorPerformancePage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading performance…</p>}>
      <DirectorPerformance />
    </Suspense>
  );
}

async function DirectorPerformance() {
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const center = actor ? await loadCenterPerformance(actor) : null;
  if (!center) redirect("/director");
  return (
    <Shell wide title="Center performance" lede="You see this center only. Open a section for the learner rows.">
      <p className="text-lg">
        <Link className="underline" href="/director">
          Back to center home
        </Link>
      </p>
      <CenterPerformanceView
        sections={center.sections}
        sectionHref={(sectionId) => `/director/sections/${sectionId}/performance`}
      />
    </Shell>
  );
}
