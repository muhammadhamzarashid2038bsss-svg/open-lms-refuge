import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LearnerPerformanceView } from "@/components/performance-dashboard";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { loadLearnerPerformance } from "@/lib/data/dashboard";

export const instant = false;

export default function TeacherLearnerPerformancePage({
  params,
}: {
  params: Promise<{ sectionId: string; learnerId: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading learner performance…</p>}>
      <TeacherLearner params={params} />
    </Suspense>
  );
}

async function TeacherLearner({ params }: { params: Promise<{ sectionId: string; learnerId: string }> }) {
  const { sectionId, learnerId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  const page = actor ? await loadLearnerPerformance(actor, sectionId, learnerId) : null;
  if (!page) redirect("/teacher");
  return (
    <Shell wide title={page.learner.displayName} lede="Settled marks, file submissions, and attendance for this learner.">
      <LearnerPerformanceView
        sectionName={page.sectionName}
        courseTitle={page.courseTitle}
        learner={page.learner}
        backHref={`/teacher/sections/${page.sectionId}/performance`}
        backLabel="Back to section performance"
      />
    </Shell>
  );
}
