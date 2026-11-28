import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TeacherSectionList } from "@/components/teacher-section-list";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listAssignedSections } from "@/lib/data/records";

export const instant = false;

export default function TeacherGradebookPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading gradebooks…</p>}>
      <TeacherGradebook />
    </Suspense>
  );
}

async function TeacherGradebook() {
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  const sections = actor ? await listAssignedSections(actor) : [];
  return (
    <Shell title="Gradebook" lede="Choose a section to open its gradebook.">
      <TeacherSectionList sections={sections} mode="gradebook" />
    </Shell>
  );
}
