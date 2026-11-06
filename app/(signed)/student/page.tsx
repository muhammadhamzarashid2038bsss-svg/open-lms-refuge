import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TodayClasses } from "@/components/today-classes";
import { semesterLabel } from "@/lib/lms/resources";
import { listLearnerSections } from "@/lib/data/courses";
import { listTodayClasses } from "@/lib/data/timetable";
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
  const sections = actor ? await listLearnerSections(actor) : [];
  const today = actor ? await listTodayClasses(actor) : { ok: true as const, classes: [] };
  return (
    <Shell title={record ? `Hello, ${record.displayName}` : "Learner home"}>
      {record ? (
        <>
          {today.ok ? <TodayClasses classes={today.classes} /> : <p className="text-lg">{today.message}</p>}
          <p className="text-lg">Learner code {record.learnerCode}</p>
          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">Your sections</h2>
            <ul className="flex flex-col gap-2 text-lg">
              {sections.map((section) => (
                <li key={section.id}>
                  <Link className="underline" href={`/student/sections/${section.id}`}>
                    {section.name} · {section.courseTitle} · {section.academicYear} ·{" "}
                    {semesterLabel(section.semester)}
                  </Link>
                  <p className="text-base text-zinc-700">
                    {section.downloadableCount === 0
                      ? "No downloadable files for you here."
                      : `${section.downloadableCount} downloadable file${section.downloadableCount === 1 ? "" : "s"}.`}
                  </p>
                </li>
              ))}
              {sections.length === 0 ? <li>No section yet.</li> : null}
            </ul>
          </section>
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
