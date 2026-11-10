import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LearnerPerformanceView } from "@/components/performance-dashboard";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { loadLearnerPerformance } from "@/lib/data/dashboard";

export const instant = false;

export default function DirectorLearnerPerformancePage({
  params,
}: {
  params: Promise<{ sectionId: string; learnerId: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading learner performance…</p>}>
      <DirectorLearner params={params} />
    </Suspense>
  );
}

async function DirectorLearner({ params }: { params: Promise<{ sectionId: string; learnerId: string }> }) {
  const { sectionId, learnerId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "CENTER_DIRECTOR");
  if (!guard.ok) redirect(guard.redirectTo);
  const page = actor ? await loadLearnerPerformance(actor, sectionId, learnerId) : null;
  if (!page) redirect("/director/performance");
  return (
    <Shell wide title={page.learner.displayName} lede="Settled marks, file submissions, and attendance for this learner.">
      <LearnerPerformanceView
        sectionName={page.sectionName}
        courseTitle={page.courseTitle}
        learner={page.learner}
        backHref={`/director/sections/${page.sectionId}/performance`}
        backLabel="Back to section performance"
      />
    </Shell>
  );
}
