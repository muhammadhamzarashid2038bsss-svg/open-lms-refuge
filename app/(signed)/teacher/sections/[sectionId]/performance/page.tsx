import { Suspense } from "react";
import { redirect } from "next/navigation";
import { SectionPerformanceView } from "@/components/performance-dashboard";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { loadSectionPerformance } from "@/lib/data/dashboard";

export const instant = false;

export default function TeacherPerformancePage({ params }: { params: Promise<{ sectionId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading performance…</p>}>
      <TeacherPerformance params={params} />
    </Suspense>
  );
}

async function TeacherPerformance({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  const model = actor ? await loadSectionPerformance(actor, sectionId) : null;
  if (!model) redirect("/teacher");
  return (
    <Shell wide title={`${model.sectionName} performance`} lede={`${model.courseTitle}. Grades, files, and attendance stay in separate columns.`}>
      <SectionPerformanceView
        model={model}
        backHref="/teacher"
        backLabel="Back to teacher home"
        learnerHref={(learnerId) => `/teacher/sections/${model.sectionId}/performance/${learnerId}`}
      />
    </Shell>
  );
}
