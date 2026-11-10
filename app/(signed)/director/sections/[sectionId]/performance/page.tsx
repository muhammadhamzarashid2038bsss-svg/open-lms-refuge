import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SectionPerformanceView } from "@/components/performance-dashboard";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { loadSectionPerformance } from "@/lib/data/dashboard";

export const instant = false;

export default function DirectorSectionPerformancePage({ params }: { params: Promise<{ sectionId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading performance…</p>}>
      <DirectorSection params={params} />
    </Suspense>
  );
}

async function DirectorSection({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const model = actor ? await loadSectionPerformance(actor, sectionId) : null;
  if (!model) redirect("/director/performance");
  return (
    <Shell wide title={`${model.sectionName} performance`} lede={`${model.courseTitle}. This center only.`}>
      <SectionPerformanceView
        model={model}
        backHref="/director/performance"
        backLabel="Back to center performance"
        learnerHref={(learnerId) => `/director/sections/${model.sectionId}/performance/${learnerId}`}
      />
    </Shell>
  );
}
