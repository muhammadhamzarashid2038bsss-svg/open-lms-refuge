import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LearnerHome } from "@/components/learner-home";
import { PhoneTools } from "@/components/phone-tools";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { listLearnerSections } from "@/lib/data/courses";
import { readLearnerRecord } from "@/lib/data/records";
import { listTodayClasses } from "@/lib/data/timetable";

export const instant = false;

export default function StudentPage() {
  return (
    <Suspense fallback={<p className="p-4 text-lg">Loading your page…</p>}>
      <StudentHome />
    </Suspense>
  );
}

async function StudentHome() {
  const actor = await getActor();
  const guard = pageGuard(actor, "STUDENT");
  if (!guard.ok) redirect(guard.redirectTo);
  const record = actor?.learnerId ? await readLearnerRecord(actor, actor.learnerId) : null;
  const sections = actor ? await listLearnerSections(actor) : [];
  const today = actor ? await listTodayClasses(actor) : { ok: true as const, classes: [] };
  return (
    <Shell title={record ? `Hello, ${record.displayName}` : "Learner home"}>
      {record ? (
        <LearnerHome
          learnerCode={record.learnerCode}
          attendanceCount={record.attendanceCount}
          gradeCount={record.gradeCount}
          sections={sections}
          today={today}
        />
      ) : (
        <p className="text-lg">Your learner record could not be opened.</p>
      )}
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
