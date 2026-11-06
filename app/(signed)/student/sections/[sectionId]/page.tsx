import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ResourceList } from "@/components/resource-list";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { readLearnerSection } from "@/lib/data/courses";
import { semesterLabel } from "@/lib/lms/resources";

export const instant = false;

export default function StudentSectionPage({ params }: { params: Promise<{ sectionId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading section…</p>}>
      <StudentSection params={params} />
    </Suspense>
  );
}

async function StudentSection({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "STUDENT");
  if (!guard.ok) redirect(guard.redirectTo);
  const section = actor ? await readLearnerSection(actor, sectionId) : null;
  if (!section) redirect("/student");

  return (
    <Shell
      title={section.name}
      lede={`${section.courseTitle} · ${section.academicYear} · ${semesterLabel(section.semester)}`}
    >
      <p className="text-lg">
        <Link className="underline" href="/student">
          Back to learner home
        </Link>
        {" · "}
        <Link className="underline" href={`/sections/${section.id}/timetable`}>
          Weekly timetable
        </Link>
      </p>
      <ResourceList resources={section.resources} downloadableCount={section.downloadableCount} />
    </Shell>
  );
}
