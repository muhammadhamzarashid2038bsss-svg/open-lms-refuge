import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TeacherSectionList } from "@/components/teacher-section-list";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listAssignedSections } from "@/lib/data/records";

export const instant = false;

export default function TeacherAttendancePage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading attendance…</p>}>
      <TeacherAttendance />
    </Suspense>
  );
}

async function TeacherAttendance() {
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  const sections = actor ? await listAssignedSections(actor) : [];
  return (
    <Shell title="Attendance" lede="Choose a section to take attendance.">
      <TeacherSectionList sections={sections} mode="attendance" />
    </Shell>
  );
}
