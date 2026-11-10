import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LearnerHomework } from "@/components/learner-homework";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listLearnerHomework } from "@/lib/data/learner-homework";

export const instant = false;

export default function StudentHomeworkPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading homework…</p>}>
      <Homework />
    </Suspense>
  );
}

async function Homework() {
  const actor = await getActor();
  const guard = pageGuard(actor, "STUDENT");
  if (!guard.ok) redirect(guard.redirectTo);
  const assignments = actor ? await listLearnerHomework(actor) : null;
  if (!actor?.learnerId || !assignments) redirect("/student");
  return (
    <Shell title="Homework files" lede="Digital and Both tasks for your sections.">
      <p className="text-lg">
        <Link className="underline" href="/student">
          Back to learner home
        </Link>
      </p>
      <LearnerHomework centerId={actor.centerId} userId={actor.id} learnerId={actor.learnerId} assignments={assignments} />
    </Shell>
  );
}
