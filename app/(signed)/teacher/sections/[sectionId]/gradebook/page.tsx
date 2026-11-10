import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { CreateAssignmentForm } from "@/components/assignment-form";
import { SectionGradebook } from "@/components/section-gradebook";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { loadSectionGradebook } from "@/lib/data/assignments";

export const instant = false;

export default function GradebookPage({ params }: { params: Promise<{ sectionId: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading gradebook…</p>}>
      <Gradebook params={params} />
    </Suspense>
  );
}

async function Gradebook({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  const actor = await getActor();
  const guard = pageGuard(actor, "TEACHER");
  if (!guard.ok) redirect(guard.redirectTo);
  const book = actor ? await loadSectionGradebook(actor, sectionId) : null;
  if (!actor || !book) redirect("/teacher");
  return (
    <Shell
      wide
      title={`${book.sectionName} gradebook`}
      lede={`${book.courseTitle}. One row per learner. Paper, digital, both, and in-class exam marks stay in this table. A save stays on this phone first.`}
    >
      <p className="text-lg">
        <Link className="underline" href="/teacher">
          Back to teacher home
        </Link>
      </p>
      <SectionGradebook centerId={actor.centerId} userId={actor.id} book={book} />
      <CreateAssignmentForm sectionId={book.sectionId} />
    </Shell>
  );
}
