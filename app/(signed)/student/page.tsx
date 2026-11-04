import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PhoneTools } from "@/components/phone-tools";
import { Shell } from "@/components/ui";
import { getActor } from "@/lib/auth/actor";
import { pageGuard } from "@/lib/auth/permissions";
import { readLearnerRecord } from "@/lib/data/records";

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
  return (
    <Shell title={record ? `Hello, ${record.displayName}` : "Learner home"}>
      {record ? (
        <>
          <p className="text-lg">Learner code {record.learnerCode}</p>
          <p className="text-lg">
            Sections: {record.sections.map((section) => section.name).join(", ") || "None yet"}
          </p>
          <p className="text-lg">Attendance marks: {record.attendanceCount}</p>
          <p className="text-lg">Grades: {record.gradeCount}</p>
        </>
      ) : (
        <p className="text-lg">Your learner record could not be opened.</p>
      )}
      {actor ? <PhoneTools userId={actor.id} centerId={actor.centerId} /> : null}
    </Shell>
  );
}
